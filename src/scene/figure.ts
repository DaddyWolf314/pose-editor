import {
  DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, type Object3D,
} from 'three';
import { BONES, PALETTE, type BoneName } from '../rig/skeleton';
import { partsFor } from '../rig/mannequin';
import type { FigureData, FigureInput, QuatTuple } from './sceneData';

export interface Figure {
  id: string;
  name: string;
  color: string;
  root: Group;
  bones: Record<BoneName, Group>;
  meshes: Record<BoneName, Mesh[]>;
  /** Everything a click can hit: body meshes and the floor ring. */
  pick: Mesh[];
  mat: MeshStandardMaterial;
  matSel: MeshStandardMaterial;
  ring: Mesh<RingGeometry, MeshBasicMaterial>;
}

/** Stored in `userData` on every pickable mesh. */
export interface PickData { fig: Figure; bone?: BoneName; base?: true }
export const pickData = (o: Object3D) => o.userData as PickData;

export function uid(): string {
  return 'f' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}

export function createFigure(d: FigureInput): Figure {
  const color = d.color || PALETTE[0];
  const root = new Group();
  const bones = {} as Record<BoneName, Group>;
  const meshes = {} as Record<BoneName, Mesh[]>;
  const pick: Mesh[] = [];
  const mat = new MeshStandardMaterial({ color, roughness: 0.78, metalness: 0 });
  const matSel = new MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, emissive: 0xffb000, emissiveIntensity: 0.45 });
  const ring = new Mesh(new RingGeometry(0.25, 0.35, 48),
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: DoubleSide }));
  const fig: Figure = { id: d.id || uid(), name: d.name || 'Figure', color, root, bones, meshes, pick, mat, matSel, ring };

  for (const def of BONES) {
    const b = new Group();
    b.name = def.name;
    b.position.set(...def.offset);
    (def.parent ? bones[def.parent] : root).add(b);
    bones[def.name] = b;
    meshes[def.name] = [];
    for (const m of partsFor(def.name)) {
      m.material = mat;
      m.userData = { fig, bone: def.name } satisfies PickData;
      b.add(m); meshes[def.name].push(m); pick.push(m);
    }
  }
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004;
  ring.userData = { fig, base: true } satisfies PickData;
  root.add(ring); pick.push(ring);

  if (d.root) { root.position.set(+d.root.x || 0, 0, +d.root.z || 0); root.rotation.y = +d.root.ry || 0; }
  if (Array.isArray(d.hips) && d.hips.length === 3) bones.hips.position.fromArray(d.hips.map(Number));
  if (d.pose) {
    for (const n of Object.keys(d.pose) as BoneName[]) {
      const q = d.pose[n];
      if (bones[n] && Array.isArray(q) && q.length === 4) bones[n].quaternion.fromArray(q.map(Number)).normalize();
    }
  }
  return fig;
}

export function disposeFigure(fig: Figure): void {
  fig.root.removeFromParent();
  fig.pick.forEach(m => m.geometry.dispose());
  fig.mat.dispose(); fig.matSel.dispose(); fig.ring.material.dispose();
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function figData(f: Figure): FigureData {
  const pose: FigureData['pose'] = {};
  for (const b of BONES) pose[b.name] = f.bones[b.name].quaternion.toArray().map(r4) as QuatTuple;
  return {
    id: f.id, name: f.name, color: f.color,
    root: { x: r4(f.root.position.x), z: r4(f.root.position.z), ry: r4(f.root.rotation.y) },
    hips: f.bones.hips.position.toArray().map(r4) as FigureData['hips'],
    pose,
  };
}
