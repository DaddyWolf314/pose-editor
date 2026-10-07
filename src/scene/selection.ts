// What is selected, the IK handles, how the gizmo attaches, and click picking.
import { BoxGeometry, Mesh, MeshBasicMaterial, SphereGeometry, type Color, type Raycaster, type Scene } from 'three';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { LABEL, type BoneName, type LimbEnd } from '../rig/skeleton';
import { pickData, type Figure } from './figure';

export type Mode = 'move' | 'rotate';

export type Selection =
  | { fig: Figure; kind: 'bone'; key: BoneName }
  | { fig: Figure; kind: 'ik'; key: LimbEnd }
  | { fig: Figure; kind: 'hips'; key: 'hips' }
  | { fig: Figure; kind: 'base' };

// IK handles: one shared set, shown on the active figure. Each key is also the bone it sits on.
export const HANDLE_KEYS = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'hips'] as const;
export type HandleKey = (typeof HANDLE_KEYS)[number];
type HandleMesh = Mesh<BoxGeometry | SphereGeometry, MeshBasicMaterial>;

export class Handles {
  readonly meshes = {} as Record<HandleKey, HandleMesh>;
  readonly list: HandleMesh[];

  constructor(scene: Scene) {
    for (const k of HANDLE_KEYS) {
      const geo = k === 'hips' ? new BoxGeometry(0.075, 0.075, 0.075) : new SphereGeometry(0.04, 16, 12);
      const m = new Mesh(geo, new MeshBasicMaterial({ color: 0xffb000, depthTest: false, transparent: true, opacity: 0.95 }));
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
      if (!active) { h.visible = false; continue; }
      h.visible = true;
      if (!force && tc.dragging && tc.object === h) continue;
      active.bones[k].getWorldPosition(h.position);
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
      return k === 'hips' ? { fig: active, kind: 'hips', key: 'hips' } : { fig: active, kind: 'ik', key: k };
    }
  }
  const hit = ray.intersectObjects(figures.flatMap(f => f.pick));
  if (!hit.length) return null;
  const u = pickData(hit[0].object);
  return u.base ? { fig: u.fig, kind: 'base' } : { fig: u.fig, kind: 'bone', key: u.bone! };
}

export function hintText(sel: Selection | null, mode: Mode, figureCount: number): string {
  if (!figureCount) return 'The scene is empty. Add a figure to start posing.';
  if (!sel) return 'Click a body part to rotate it. Drag the yellow handles to move hands, feet and hips. Click a floor ring to move a figure.';
  const name = sel.fig.name;
  if (sel.kind === 'bone') return 'Rotating the ' + LABEL[sel.key] + ' of ' + name + '. Drag a coloured arc.';
  if (sel.kind === 'ik') return 'Moving the ' + LABEL[sel.key] + ' of ' + name + '. The limb bends to follow.';
  if (sel.kind === 'hips') return (mode === 'move' ? 'Moving' : 'Rotating') + ' the hips of ' + name + '.';
  return (mode === 'move' ? 'Moving ' : 'Turning ') + name + ' across the floor.';
}
