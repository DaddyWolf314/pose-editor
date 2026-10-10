// A prop in the scene: a root Group with one mesh per catalog box. Every prop shares one unit box
// geometry, scaled per part, and one matte material in the theme's prop colour.
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Color } from 'three';
import { uid } from '../scene/figure';
import type { PropData, PropInput } from '../scene/sceneData';
import { PROPS, isPropKind, propSize, type PropBox, type PropKind, type PropSize } from './catalog';

export interface Prop {
  id: string;
  name: string;
  kind: PropKind;
  size: PropSize;
  root: Group;
  /** The catalog boxes for `size`, in prop space. */
  boxes: PropBox[];
  meshes: Mesh[];
}

export class PropKit {
  readonly geometry = new BoxGeometry(1, 1, 1);
  readonly material = new MeshStandardMaterial({ roughness: 0.85, metalness: 0 });

  setColor(c: Color): void { this.material.color.copy(c); }

  dispose(): void { this.geometry.dispose(); this.material.dispose(); }
}

/** Rebuild the meshes from the catalog for the prop's current size. */
function build(p: Prop, kit: PropKit): void {
  p.meshes.forEach(m => m.removeFromParent());
  p.boxes = PROPS[p.kind].boxes(p.size);
  p.meshes = p.boxes.map(b => {
    const m = new Mesh(kit.geometry, kit.material);
    m.position.fromArray(b.center);
    m.scale.set(b.half[0] * 2, b.half[1] * 2, b.half[2] * 2);
    p.root.add(m);
    return m;
  });
}

export function createProp(d: PropInput, kit: PropKit): Prop {
  const kind: PropKind = isPropKind(d.kind) ? d.kind : 'box';
  const root = new Group();
  const r = d.root;
  if (r) { root.position.set(+r.x || 0, Math.max(0, +r.y || 0), +r.z || 0); root.rotation.y = +r.ry || 0; }
  const p: Prop = { id: d.id || uid(), name: d.name || PROPS[kind].label, kind, size: propSize(kind, d.size), root, boxes: [], meshes: [] };
  build(p, kit);
  return p;
}

/** Change one size parameter, clamped to the catalog's range. */
export function resizeProp(p: Prop, key: string, value: number, kit: PropKit): void {
  p.size = propSize(p.kind, { ...p.size, [key]: value });
  build(p, kit);
}

/** Footprint depth in front of and behind the origin, for placing new props. */
export function propExtentZ(p: Prop): { min: number; max: number } {
  let min = 0, max = 0;
  for (const b of p.boxes) { min = Math.min(min, b.center[2] - b.half[2]); max = Math.max(max, b.center[2] + b.half[2]); }
  return { min, max };
}

/** Geometry and material belong to the kit, so only the scene graph is let go. */
export function disposeProp(p: Prop): void {
  p.root.removeFromParent();
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function propData(p: Prop): PropData {
  const size: PropData['size'] = {};
  for (const k of Object.keys(p.size)) size[k] = r4(p.size[k]);
  return {
    id: p.id, name: p.name, kind: p.kind,
    root: { x: r4(p.root.position.x), y: r4(p.root.position.y), z: r4(p.root.position.z), ry: r4(p.root.rotation.y) },
    size,
  };
}
