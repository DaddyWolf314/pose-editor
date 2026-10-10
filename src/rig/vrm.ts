// VRM bodies. A model file is loaded once into a template; each figure gets a cheap clone that
// shares geometry, with its own skeleton and humanoid. Every VRM is drawn in one matte material in
// the figure's colour, like the mannequin, so the model's own textures never distract.
import {
  Box3, DoubleSide, MeshStandardMaterial, Quaternion, SkinnedMesh, Vector3, type BufferAttribute, type Group,
  type Intersection, type Mesh, type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  VRMHumanoid, VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName, type VRMHumanBones,
} from '@pixiv/three-vrm';
import { BoneMarker, scaledRadii, type Body, type BoneRadii, type RigBones } from './body';
import { BONES, type BoneName, type RestOffsets, type Vec3Tuple } from './skeleton';

export interface VrmTemplate {
  vrm: VRM;
  /** VRM 0.x models face -Z and are turned 180 degrees about Y to face +Z like VRM 1.0. */
  isVrm0: boolean;
  /** Rig rest offsets measured from the model, in figure-root axes (facing +Z). */
  rest: RestOffsets;
}

export async function loadVrmTemplate(source: string | ArrayBuffer): Promise<VrmTemplate> {
  const loader = new GLTFLoader();
  loader.register(parser => new VRMLoaderPlugin(parser));
  const gltf = typeof source === 'string' ? await loader.loadAsync(source) : await loader.parseAsync(source, '');
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error('This file has no VRM data.');
  if (!vrm.humanoid) throw new Error('This VRM has no humanoid bones.');
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);

  const isVrm0 = vrm.meta?.metaVersion === '0';
  const flip = isVrm0 ? -1 : 1;
  vrm.scene.updateMatrixWorld(true);
  // World position of each of our bones in the T-pose. A bone the model lacks sits on its parent.
  const world = {} as Record<BoneName, Vector3>;
  for (const def of BONES) {
    const node = vrm.humanoid.getNormalizedBoneNode(def.name);
    const p = node ? node.getWorldPosition(new Vector3()) : def.parent ? world[def.parent].clone() : new Vector3();
    world[def.name] = p.set(p.x * flip, p.y, p.z * flip);
  }
  const rest = {} as RestOffsets;
  for (const def of BONES) {
    const p = def.parent ? world[def.name].clone().sub(world[def.parent]) : world[def.name];
    rest[def.name] = p.toArray() as Vec3Tuple;
  }
  return { vrm, isVrm0, rest };
}

function parallelTraverse(a: Object3D, b: Object3D, fn: (a: Object3D, b: Object3D) => void): void {
  fn(a, b);
  for (let i = 0; i < a.children.length; i++) parallelTraverse(a.children[i], b.children[i], fn);
}

const _q = new Quaternion(), _p = new Vector3();

export class VrmBody implements Body {
  readonly modelId: string;
  readonly rest: RestOffsets;
  readonly radii: BoneRadii;
  readonly pickables: Mesh[] = [];
  private scene: Group;
  private humanoid: VRMHumanoid;
  private bones: RigBones;
  private normalized = {} as Partial<Record<BoneName, Object3D>>;
  /** Raw skeleton node of each of our bones, for mapping a hit back to a bone. */
  private rawToBone = new Map<Object3D, BoneName>();
  private toModel: Quaternion;
  private marker: BoneMarker;
  private material: MeshStandardMaterial;

  constructor(modelId: string, t: VrmTemplate, root: Group, bones: RigBones, color: string) {
    this.modelId = modelId;
    this.rest = t.rest;
    this.radii = scaledRadii(t.rest);
    this.bones = bones;

    const scene = SkeletonUtils.clone(t.vrm.scene) as Group;
    const twin = new Map<Object3D, Object3D>();
    parallelTraverse(t.vrm.scene, scene, (a, b) => twin.set(a, b));
    // The template's own normalized rig was cloned as plain nodes; build a fresh one on the clone.
    twin.get(t.vrm.humanoid.normalizedHumanBonesRoot)?.removeFromParent();
    const human: Partial<VRMHumanBones> = {};
    for (const [name, bone] of Object.entries(t.vrm.humanoid.rawHumanBones)) {
      const node = bone && twin.get(bone.node);
      if (node) human[name as VRMHumanBoneName] = { node };
    }
    scene.updateMatrixWorld(true);
    this.humanoid = new VRMHumanoid(human as VRMHumanBones);
    scene.add(this.humanoid.normalizedHumanBonesRoot);
    if (t.isVrm0) scene.rotation.y = Math.PI;
    this.scene = scene;

    for (const def of BONES) {
      const n = this.humanoid.getNormalizedBoneNode(def.name);
      if (n) this.normalized[def.name] = n;
      const raw = this.humanoid.getRawBoneNode(def.name);
      if (raw) this.rawToBone.set(raw, def.name);
    }
    // Normalized bones rest at identity in the model's frame; ours rest at identity in the figure's.
    this.toModel = scene.quaternion.clone();
    // Double-sided because VRM hair and clothing are often open sheets.
    this.material = new MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, side: DoubleSide });
    scene.traverse(o => {
      if (!(o as Mesh).isMesh) return;
      const m = o as Mesh;
      m.frustumCulled = false;
      m.material = this.material;
      this.pickables.push(m);
    });
    this.marker = new BoneMarker(bones, t.rest);
    root.add(scene);
  }

  update(): void {
    const r = this.toModel;
    for (const def of BONES) {
      const n = this.normalized[def.name];
      if (!n) continue;
      // Same rotation expressed in the model's axes: r^-1 * q * r.
      n.quaternion.copy(_q.copy(r).invert().multiply(this.bones[def.name].quaternion).multiply(r));
    }
    const hips = this.normalized.hips;
    if (hips?.parent) {
      this.bones.hips.updateWorldMatrix(true, false);
      this.bones.hips.getWorldPosition(_p);
      hips.parent.updateWorldMatrix(true, false);
      hips.position.copy(hips.parent.worldToLocal(_p));
    }
    this.humanoid.update();
    this.scene.updateMatrixWorld(true);
    // Posed skinned meshes need fresh bounds for raycasting; null makes three.js recompute them on demand.
    for (const m of this.pickables) {
      if (m instanceof SkinnedMesh) Object.assign(m, { boundingBox: null, boundingSphere: null });
    }
  }

  boneAt(hit: Intersection): BoneName | null {
    let node: Object3D | null = hit.object;
    const mesh = hit.object;
    if (mesh instanceof SkinnedMesh && hit.face) {
      // The bone with the most skin weight on the hit triangle.
      const idx = mesh.geometry.getAttribute('skinIndex') as BufferAttribute;
      const wt = mesh.geometry.getAttribute('skinWeight') as BufferAttribute;
      const sum = new Map<number, number>();
      for (const v of [hit.face.a, hit.face.b, hit.face.c]) {
        for (let k = 0; k < 4; k++) sum.set(idx.getComponent(v, k), (sum.get(idx.getComponent(v, k)) ?? 0) + wt.getComponent(v, k));
      }
      let best = -1, bestW = -1;
      sum.forEach((w, i) => { if (w > bestW) { bestW = w; best = i; } });
      node = mesh.skeleton.bones[best] ?? mesh;
    }
    // Walk up to the nearest bone we pose: fingers map to the hand, toes to the foot, hair to the head.
    for (; node; node = node.parent) {
      const b = this.rawToBone.get(node);
      if (b) return b;
    }
    return 'hips';
  }

  setHighlight(bone: BoneName | null): void { this.marker.show(bone); }

  setColor(color: string): void { this.material.color.set(color); }

  bounds(target: Box3): Box3 {
    target.makeEmpty();
    const b = new Box3();
    for (const m of this.pickables) {
      if (m instanceof SkinnedMesh) { m.computeBoundingBox(); b.copy(m.boundingBox!).applyMatrix4(m.matrixWorld); target.union(b); }
      else target.expandByObject(m);
    }
    return target;
  }

  dispose(): void {
    this.marker.dispose();
    this.scene.removeFromParent();
    // Geometry belongs to the template; the material and cloned skeletons are ours.
    this.material.dispose();
    for (const m of this.pickables) if (m instanceof SkinnedMesh) m.skeleton.dispose();
  }
}
