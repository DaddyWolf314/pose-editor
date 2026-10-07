// What is selected, the IK handles, how the gizmo attaches, and click picking.
import {
  BoxGeometry, IcosahedronGeometry, Mesh, MeshBasicMaterial, OctahedronGeometry, SphereGeometry, type BufferGeometry,
  type Color, type Object3D, type Raycaster, type Scene,
} from 'three';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { LABEL, type BoneName, type LimbEnd } from '../rig/skeleton';
import type { Figure } from './figure';

export type Mode = 'move' | 'rotate';

export type Selection =
  | { fig: Figure; kind: 'bone'; key: BoneName }
  | { fig: Figure; kind: 'ik'; key: LimbEnd }
  | { fig: Figure; kind: 'hips'; key: 'hips' }
  | { fig: Figure; kind: 'chest' }
  | { fig: Figure; kind: 'look' }
  | { fig: Figure; kind: 'base' };

// Handles: one shared set, shown on the active figure. Each sits on a joint, except the look target.
export const HANDLE_KEYS = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'hips', 'chest', 'look'] as const;
export type HandleKey = (typeof HANDLE_KEYS)[number];
type HandleMesh = Mesh<BufferGeometry, MeshBasicMaterial>;
const JOINT: Record<Exclude<HandleKey, 'look'>, BoneName> = {
  leftHand: 'leftHand', rightHand: 'rightHand', leftFoot: 'leftFoot', rightFoot: 'rightFoot', hips: 'hips',
  chest: 'neck',
};
function handleGeometry(k: HandleKey): BufferGeometry {
  if (k === 'hips') return new BoxGeometry(0.075, 0.075, 0.075);
  if (k === 'chest') return new OctahedronGeometry(0.05);
  if (k === 'look') return new IcosahedronGeometry(0.06);
  return new SphereGeometry(0.04, 16, 12);
}

export class Handles {
  readonly meshes = {} as Record<HandleKey, HandleMesh>;
  readonly list: HandleMesh[];

  constructor(scene: Scene) {
    for (const k of HANDLE_KEYS) {
      const m = new Mesh(handleGeometry(k),
        new MeshBasicMaterial({ color: 0xffb000, depthTest: false, transparent: true, opacity: 0.95, wireframe: k === 'look' }));
      m.renderOrder = 10; m.visible = false; m.userData.handle = k;
      scene.add(m); this.meshes[k] = m;
    }
    this.list = HANDLE_KEYS.map(k => this.meshes[k]);
  }

  setColor(c: Color): void { this.list.forEach(h => h.material.color.copy(c)); }

  /** Snap handles to the active figure's joints, except one the gizmo is dragging (unless forced). */
  place(active: Figure | null, tc: TransformControls, force: boolean): void {
    for (const k of HANDLE_KEYS) {
      const h = this.meshes[k];
      h.visible = !!active && (k !== 'look' || !!active.look);
      if (!active || !h.visible) continue;
      if (!force && tc.dragging && tc.object === h) continue;
      if (k === 'look') h.position.copy(active.look!).applyMatrix4(active.root.matrixWorld);
      else active.bones[JOINT[k]].getWorldPosition(h.position);
    }
  }

  dispose(): void {
    this.list.forEach(h => { h.removeFromParent(); h.geometry.dispose(); h.material.dispose(); });
  }
}

/** Attach the gizmo for a selection. Handles must already be placed for 'ik' and moving 'hips'. */
export function attachGizmo(tc: TransformControls, handles: Handles, s: Selection | null, mode: Mode): void {
  tc.detach(); tc.showX = tc.showY = tc.showZ = true;
  if (!s) return;
  const f = s.fig;
  if (s.kind === 'bone') { tc.setMode('rotate'); tc.setSpace('local'); tc.attach(f.bones[s.key]); }
  else if (s.kind === 'ik') { tc.setMode('translate'); tc.setSpace('world'); tc.attach(handles.meshes[s.key]); }
  else if (s.kind === 'chest' || s.kind === 'look') {
    tc.setMode('translate'); tc.setSpace('world'); tc.attach(handles.meshes[s.kind]);
  }
  else if (s.kind === 'hips') {
    if (mode === 'move') { tc.setMode('translate'); tc.setSpace('world'); tc.attach(handles.meshes.hips); }
    else { tc.setMode('rotate'); tc.setSpace('local'); tc.attach(f.bones.hips); }
  }
  else {
    if (mode === 'move') { tc.setMode('translate'); tc.setSpace('world'); tc.showY = false; }
    else { tc.setMode('rotate'); tc.setSpace('local'); tc.showX = false; tc.showZ = false; }
    tc.attach(f.root);
  }
}

/** Handles on the active figure win; then the nearest body part or floor ring of any figure. */
export function pickAt(ray: Raycaster, active: Figure | null, handles: Handles, figures: Figure[]): Selection | null {
  if (active) {
    const hh = ray.intersectObjects(handles.list.filter(h => h.visible));
    if (hh.length) {
      const k = hh[0].object.userData.handle as HandleKey;
      if (k === 'hips') return { fig: active, kind: 'hips', key: 'hips' };
      if (k === 'chest' || k === 'look') return { fig: active, kind: k };
      return { fig: active, kind: 'ik', key: k };
    }
  }
  const owner = new Map<Object3D, Figure>();
  for (const f of figures) {
    owner.set(f.ring, f);
    f.body.pickables.forEach(o => owner.set(o, f));
  }
  const hit = ray.intersectObjects([...owner.keys()], false)[0];
  if (!hit) return null;
  const fig = owner.get(hit.object)!;
  if (hit.object === fig.ring) return { fig, kind: 'base' };
  const bone = fig.body.boneAt(hit);
  return bone ? { fig, kind: 'bone', key: bone } : null;
}

export function hintText(sel: Selection | null, mode: Mode, figureCount: number): string {
  if (!figureCount) return 'The scene is empty. Add a figure to start posing.';
  if (!sel) return 'Click a body part to rotate it. Drag the yellow handles to move hands, feet and hips. Click a floor ring to move a figure.';
  const name = sel.fig.name;
  if (sel.kind === 'bone' && sel.fig.look && (sel.key === 'head' || sel.key === 'neck')) {
    return 'The head of ' + name + ' follows its look target. Turn the target off to rotate it by hand.';
  }
  if (sel.kind === 'chest') return 'Moving the chest of ' + name + '. The spine bends to follow.';
  if (sel.kind === 'look') return 'Moving the look target of ' + name + '. The head turns to follow.';
  if (sel.kind === 'bone') return 'Rotating the ' + LABEL[sel.key] + ' of ' + name + '. Drag a coloured arc.';
  if (sel.kind === 'ik') return 'Moving the ' + LABEL[sel.key] + ' of ' + name + '. The limb bends to follow.';
  if (sel.kind === 'hips') return (mode === 'move' ? 'Moving' : 'Rotating') + ' the hips of ' + name + '.';
  return (mode === 'move' ? 'Moving ' : 'Turning ') + name + ' across the floor.';
}
