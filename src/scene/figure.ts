import { DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three';
import { MANNEQUIN_ID, type Body, type RigBones } from '../rig/body';
import { MannequinBody } from '../rig/mannequin';
import type { ModelLibrary } from '../rig/models';
import { BONES, PALETTE, type BoneName } from '../rig/skeleton';
import { VrmBody } from '../rig/vrm';
import type { FigureData, FigureInput, QuatTuple } from './sceneData';

export interface Figure {
  id: string;
  name: string;
  color: string;
  /** The body asked for. `body.modelId` differs while that model is loading or unavailable. */
  modelId: string;
  root: Group;
  /** The pose rig: what IK, gizmos and scene data act on. */
  bones: RigBones;
  body: Body;
  ring: Mesh<RingGeometry, MeshBasicMaterial>;
}

export function uid(): string {
  return 'f' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}

function makeBody(fig: Figure, models: ModelLibrary): Body {
  const t = fig.modelId === MANNEQUIN_ID ? null : models.get(fig.modelId);
  return t ? new VrmBody(fig.modelId, t, fig.root, fig.bones) : new MannequinBody(fig.bones, fig.color);
}

/** Lay the rig out for the body's proportions, keeping the pose and the hips offset from rest. */
function fitRig(fig: Figure, hipsOffset: Vector3): void {
  for (const def of BONES) fig.bones[def.name].position.fromArray(fig.body.rest[def.name]);
  fig.bones.hips.position.add(hipsOffset);
}

export function hipsOffset(fig: Figure): Vector3 {
  return fig.bones.hips.position.clone().sub(new Vector3(...fig.body.rest.hips));
}

export function createFigure(d: FigureInput, models: ModelLibrary): Figure {
  const color = d.color || PALETTE[0];
  const root = new Group();
  const bones = {} as RigBones;
  for (const def of BONES) {
    const b = new Group();
    b.name = def.name;
    (def.parent ? bones[def.parent] : root).add(b);
    bones[def.name] = b;
  }
  const ring = new Mesh(new RingGeometry(0.25, 0.35, 48),
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004;
  root.add(ring);

  const fig = { id: d.id || uid(), name: d.name || 'Figure', color, modelId: d.model || MANNEQUIN_ID, root, bones, ring } as Figure;
  fig.body = makeBody(fig, models);

  const off = new Vector3();
  if (Array.isArray(d.hips) && d.hips.length === 3) off.fromArray(d.hips.map(Number));
  fitRig(fig, off);
  if (d.root) { root.position.set(+d.root.x || 0, 0, +d.root.z || 0); root.rotation.y = +d.root.ry || 0; }
  if (d.pose) {
    for (const n of Object.keys(d.pose) as BoneName[]) {
      const q = d.pose[n];
      if (bones[n] && Array.isArray(q) && q.length === 4) bones[n].quaternion.fromArray(q.map(Number)).normalize();
    }
  }
  return fig;
}

/** Rebuild the body for `fig.modelId` if what is shown differs (for example, once a model has loaded). */
export function refreshBody(fig: Figure, models: ModelLibrary): boolean {
  const want = fig.modelId === MANNEQUIN_ID || models.get(fig.modelId) ? fig.modelId : MANNEQUIN_ID;
  if (fig.body.modelId === want) return false;
  const off = hipsOffset(fig);
  fig.body.dispose();
  fig.body = makeBody(fig, models);
  fitRig(fig, off);
  return true;
}

export function disposeFigure(fig: Figure): void {
  fig.body.dispose();
  fig.root.removeFromParent();
  fig.ring.geometry.dispose(); fig.ring.material.dispose();
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function figData(f: Figure): FigureData {
  const pose: FigureData['pose'] = {};
  for (const b of BONES) pose[b.name] = f.bones[b.name].quaternion.toArray().map(r4) as QuatTuple;
  return {
    id: f.id, name: f.name, color: f.color, model: f.modelId,
    root: { x: r4(f.root.position.x), z: r4(f.root.position.z), ry: r4(f.root.rotation.y) },
    hips: hipsOffset(f).toArray().map(r4) as FigureData['hips'],
    pose,
  };
}
