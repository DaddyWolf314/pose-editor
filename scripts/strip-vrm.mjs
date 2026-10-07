#!/usr/bin/env node
// Strip a VRoid Studio VRM 0.x export down to a plain posing mannequin:
//   - keeps only the skin, eyeball and hair parts (clothes, brows, lashes, irises, mouth go),
//   - merges what is left of each mesh into one primitive and drops vertices nothing uses,
//   - drops all textures, UVs and the thumbnail, and expression morph targets,
//   - replaces every material with one untextured material.
// Bones, skins, humanoid mapping, spring bones and metadata are kept, so the file stays a valid VRM.
//
// Usage: node scripts/strip-vrm.mjs <in.vrm> [out.vrm]   (writes in place without an output path)
import { readFileSync, writeFileSync } from 'node:fs';

/** Material names (VRoid's `<id>_<Part>_<n>_<KIND>`) whose primitives are kept. */
const KEEP = /(_SKIN|_EyeWhite_\d+_EYE|_HAIR)$/;
const DROP_ATTRIBUTES = /^(TEXCOORD_|TANGENT|COLOR_)/;
const MATERIAL_NAME = 'Mannequin';

const [input, output = input] = process.argv.slice(2);
if (!input) {
  console.error('Usage: node scripts/strip-vrm.mjs <in.vrm> [out.vrm]');
  process.exit(1);
}

// ---------- GLB in ----------
const glb = readFileSync(input);
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file.');
const jsonLength = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
const binStart = 20 + jsonLength + 8;
const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLength));
const vrm = json.extensions?.VRM;
if (!vrm) throw new Error('No VRM 0.x extension; this script only handles VRM 0.x exports.');

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

/** An accessor's elements as a tightly packed typed array (handles byte strides). */
function read(index) {
  const a = json.accessors[index];
  const Arr = ARRAYS[a.componentType], n = COMPONENTS[a.type];
  const out = new Arr(a.count * n);
  if (a.bufferView === undefined) return out;
  const view = json.bufferViews[a.bufferView];
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = view.byteStride ?? n * Arr.BYTES_PER_ELEMENT;
  for (let i = 0; i < a.count; i++) {
    const src = new Arr(bin.buffer.slice(bin.byteOffset + base + i * stride, bin.byteOffset + base + i * stride + n * Arr.BYTES_PER_ELEMENT));
    out.set(src, i * n);
  }
  return out;
}

// ---------- New binary: every kept accessor gets its own buffer view ----------
const chunks = [];
let binLength = 0;
const views = [], accessors = [];

function write(data, { type, componentType, normalized, target, minMax }) {
  const pad = (4 - (binLength % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); binLength += pad; }
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  views.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.length, ...(target ? { target } : {}) });
  chunks.push(bytes); binLength += bytes.length;
  const n = COMPONENTS[type];
  const acc = { bufferView: views.length - 1, componentType, count: data.length / n, type, ...(normalized ? { normalized } : {}) };
  if (minMax) {
    acc.min = Array(n).fill(Infinity); acc.max = Array(n).fill(-Infinity);
    for (let i = 0; i < data.length; i++) {
      acc.min[i % n] = Math.min(acc.min[i % n], data[i]);
      acc.max[i % n] = Math.max(acc.max[i % n], data[i]);
    }
  }
  accessors.push(acc);
  return accessors.length - 1;
}

function copy(index, extra = {}) {
  const a = json.accessors[index];
  return write(read(index), { type: a.type, componentType: a.componentType, normalized: a.normalized, ...extra });
}

// Skins: inverse bind matrices.
for (const skin of json.skins ?? []) {
  if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = copy(skin.inverseBindMatrices);
}

// Meshes: keep the wanted primitives, merge them, and compact their shared vertices.
const report = [];
for (const mesh of json.meshes) {
  const kept = mesh.primitives.filter(p => KEEP.test(json.materials[p.material]?.name ?? ''));
  report.push(`${mesh.name}: kept ${kept.length} of ${mesh.primitives.length} parts`);
  if (!kept.length) { mesh.primitives = []; continue; }
  const attrs = JSON.stringify(kept[0].attributes);
  if (kept.some(p => JSON.stringify(p.attributes) !== attrs || (p.mode ?? 4) !== 4)) {
    throw new Error(`${mesh.name}: parts do not share one vertex buffer of triangles; not supported.`);
  }
  const indices = kept.flatMap(p => Array.from(read(p.indices)));
  const used = [...new Set(indices)].sort((a, b) => a - b);
  const remap = new Map(used.map((v, i) => [v, i]));

  const attributes = {};
  for (const [name, index] of Object.entries(kept[0].attributes)) {
    if (DROP_ATTRIBUTES.test(name)) continue;
    const a = json.accessors[index], n = COMPONENTS[a.type];
    const src = read(index), dst = new src.constructor(used.length * n);
    used.forEach((v, i) => dst.set(src.subarray(v * n, v * n + n), i * n));
    attributes[name] = write(dst, { type: a.type, componentType: a.componentType, normalized: a.normalized, target: 34962, minMax: name === 'POSITION' });
  }
  const Idx = used.length < 65536 ? Uint16Array : Uint32Array;
  const idx = Idx.from(indices, v => remap.get(v));
  const indexAccessor = write(idx, { type: 'SCALAR', componentType: Idx === Uint16Array ? 5123 : 5125, target: 34963 });
  mesh.primitives = [{ attributes, indices: indexAccessor, material: 0, mode: 4 }];
  delete mesh.weights;
  if (mesh.extras) delete mesh.extras.targetNames;
}
json.meshes.forEach((m, i) => { if (!m.primitives.length) throw new Error(`Mesh ${i} (${m.name}) lost every part; adjust KEEP.`); });

// ---------- Materials, textures, VRM extension ----------
json.materials = [{
  name: MATERIAL_NAME,
  pbrMetallicRoughness: { baseColorFactor: [0.8, 0.78, 0.75, 1], metallicFactor: 0, roughnessFactor: 0.8 },
  // Hair is modelled as open sheets; render both sides.
  doubleSided: true,
}];
vrm.materialProperties = [{
  name: MATERIAL_NAME, shader: 'VRM_USE_GLTFSHADER', renderQueue: 2000,
  floatProperties: {}, vectorProperties: {}, textureProperties: {}, keywordMap: {}, tagMap: {},
}];
delete json.images; delete json.textures; delete json.samplers;
if (vrm.meta) delete vrm.meta.texture;
// Expressions are kept as names only; their morph targets and material changes are gone.
for (const g of vrm.blendShapeMaster?.blendShapeGroups ?? []) { g.binds = []; g.materialValues = []; }
json.extensionsUsed = (json.extensionsUsed ?? []).filter(e => e === 'VRM');
delete json.extensionsRequired;

json.accessors = accessors;
json.bufferViews = views;
const body = Buffer.concat(chunks);
json.buffers = [{ byteLength: body.length }];

// ---------- GLB out ----------
const padTo4 = (buf, fill) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4, fill)]);
const jsonChunk = padTo4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
const binChunk = padTo4(body, 0);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
const chunkHeader = (len, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(len, 0); h.writeUInt32LE(type, 4); return h; };
const out = Buffer.concat([header, chunkHeader(jsonChunk.length, 0x4e4f534a), jsonChunk, chunkHeader(binChunk.length, 0x004e4942), binChunk]);
writeFileSync(output, out);

console.log(`${input}: ${(glb.length / 1e6).toFixed(2)} MB -> ${output}: ${(out.length / 1e6).toFixed(2)} MB`);
report.forEach(r => console.log('  ' + r));
