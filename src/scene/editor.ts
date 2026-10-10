// The editor: owns the figures, selection, undo stack and autosave, and exposes commands plus a
// read-only UI snapshot for React. Scene state lives in three.js objects and is serialized to
// SceneData JSON on demand, exactly as in the prototype.
import { Box3, Color, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import { aimHead, poleFor, settleLimb, solveSpine } from '../rig/chains';
import { solveLimb } from '../rig/ik';
import { clampBone } from '../rig/limits';
import type { PhotoCamera, PoseEstimator } from '../pose/estimator';
import { PROPS, PROP_KINDS, type PropKind } from '../props/catalog';
import type { Colliders } from '../props/collide';
import { bodySpheres, collidersFor, dropGap, limbDepth } from '../props/contact';
import { PropKit, createProp, disposeProp, propData, propExtentZ, resizeProp, type Prop } from '../props/prop';
import { DEFAULT_MODEL_ID, ModelLibrary, type ModelInfo } from '../rig/models';
import { BONES, LIMBS, PALETTE, type LimbEnd } from '../rig/skeleton';
import { createFigure, disposeFigure, figData, refreshBody, uid, type Figure } from './figure';
import {
  LEGACY_STORAGE_KEY, STORAGE_KEY, migrateScene, type FigureInput, type PropInput, type SceneData,
} from './sceneData';
import { Handles, attachGizmo, hintText, pickAt, type Mode, type Selection } from './selection';
import { Stage } from './stage';

export interface FigureSummary { id: string; name: string; color: string }

export interface SelectedProp {
  id: string;
  name: string;
  params: { key: string; label: string; min: number; max: number; value: number }[];
}

export interface EditorUi {
  figures: FigureSummary[];
  activeId: string | null;
  props: { id: string; name: string }[];
  propKinds: { kind: PropKind; label: string }[];
  /** The selected prop, if the selection is a prop. */
  prop: SelectedProp | null;
  /** Model the active figure asks for. */
  activeModel: string | null;
  models: ModelInfo[];
  mode: Mode;
  pinFeet: boolean;
  limits: boolean;
  /** Whether figures meet props and the floor. */
  collisions: boolean;
  /** Whether the active figure's head follows a look target. */
  activeLook: boolean;
  canUndo: boolean;
  hint: string;
  photo: { busy: boolean; loaded: boolean; visible: boolean; message: string };
}

interface Drag {
  endQuat?: Quaternion;
  pins?: { k: LimbEnd; pos: Vector3; quat: Quaternion }[];
}

const UNDO_LIMIT = 60;

export class Editor {
  private stage: Stage;
  private handles: Handles;
  private models: ModelLibrary;
  private figures: Figure[] = [];
  private props: Prop[] = [];
  private propKit = new PropKit();
  /** Size slider being dragged (`id:key`), so one drag makes one undo step. */
  private resizing: string | null = null;
  private active: Figure | null = null;
  private sel: Selection | null = null;
  private mode: Mode = 'move';
  private pinFeet = true;
  private limits = true;
  private collide = true;
  /** Built on demand from the props; null whenever a prop has changed since. */
  private solids: Colliders | null = null;
  private drag: Drag | null = null;
  private counter = 0;
  private undoStack: string[] = [];
  private estimator: Promise<PoseEstimator> | null = null;
  private photo: { url: string; camera: PhotoCamera } | null = null;
  private photoUi: EditorUi['photo'] = { busy: false, loaded: false, visible: true, message: '' };
  private disposed = false;

  private ray = new Raycaster();
  private ndc = new Vector2();
  private down: { x: number; y: number; gizmo: boolean } | null = null;
  private cleanup: (() => void)[] = [];

  private listeners = new Set<() => void>();
  private ui: EditorUi;

  constructor(container: HTMLElement) {
    this.stage = new Stage(container);
    this.handles = new Handles(this.stage.scene);
    this.stage.onTheme(c => { this.handles.setColor(c.handle); this.propKit.setColor(c.prop); });
    this.models = new ModelLibrary(() => this.onModelsChanged());
    this.ui = this.buildUi();

    const tc = this.stage.tc;
    tc.addEventListener('dragging-changed', e => this.onDraggingChanged(!!e.value));
    tc.addEventListener('objectChange', () => this.onObjectChange());

    const dom = this.stage.dom;
    const onDown = (e: PointerEvent) => this.onPointerDown(e);
    const onUp = (e: PointerEvent) => this.onPointerUp(e);
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    this.cleanup.push(() => dom.removeEventListener('pointerdown', onDown), () => dom.removeEventListener('pointerup', onUp));

    let restored = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.figures) && d.figures.length) { this.loadScene(d); restored = true; }
      }
    } catch {
      this.figures.slice().forEach(f => this.removeFigure(f));
    }
    if (!restored) {
      this.counter = 1;
      this.setActive(this.addToScene({ name: 'Figure 1', color: PALETTE[0], model: DEFAULT_MODEL_ID, root: { x: 0, z: 0, ry: 0 } }));
    }
    this.undoStack = [];
    this.emit();

    this.stage.start(() => {
      for (const f of this.figures) {
        if (f.look) {
          f.root.updateMatrixWorld(true);
          aimHead(f.bones, f.look.clone().applyMatrix4(f.root.matrixWorld), this.limits);
        }
        f.body.update();
      }
      this.handles.place(this.active, tc, false);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.cleanup.forEach(fn => fn());
    this.estimator?.then(e => e.dispose(), () => {});
    if (this.photo) URL.revokeObjectURL(this.photo.url);
    this.figures.forEach(disposeFigure);
    this.figures = [];
    this.props.forEach(disposeProp);
    this.props = [];
    this.propKit.dispose();
    this.handles.dispose();
    this.stage.dispose();
    this.listeners.clear();
  }

  // ---------- UI store (for useSyncExternalStore) ----------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  getSnapshot = (): EditorUi => this.ui;

  private buildUi(): EditorUi {
    const sp = this.sel?.kind === 'prop' ? this.sel.prop : null;
    return {
      figures: this.figures.map(f => ({ id: f.id, name: f.name, color: f.color })),
      activeId: this.active?.id ?? null,
      props: this.props.map(p => ({ id: p.id, name: p.name })),
      propKinds: PROP_KINDS.map(kind => ({ kind, label: PROPS[kind].label })),
      prop: sp && {
        id: sp.id, name: sp.name,
        params: PROPS[sp.kind].params.map(q => ({ key: q.key, label: q.label, min: q.min, max: q.max, value: sp.size[q.key] })),
      },
      activeModel: this.active?.modelId ?? null,
      models: this.models.list(),
      mode: this.mode,
      pinFeet: this.pinFeet,
      limits: this.limits,
      collisions: this.collide,
      activeLook: !!this.active?.look,
      canUndo: this.undoStack.length > 0,
      hint: hintText(this.sel, this.mode, this.figures.length),
      photo: this.photoUi,
    };
  }

  private emit(): void {
    this.ui = this.buildUi();
    this.listeners.forEach(fn => fn());
  }

  // ---------- Scene state ----------

  private addToScene(d: FigureInput): Figure {
    const fig = createFigure(d, this.models);
    this.stage.scene.add(fig.root);
    this.figures.push(fig);
    return fig;
  }

  private removeFigure(fig: Figure): void {
    disposeFigure(fig);
    const i = this.figures.indexOf(fig);
    if (i >= 0) this.figures.splice(i, 1);
  }

  private addPropToScene(d: PropInput): Prop {
    const p = createProp(d, this.propKit);
    this.stage.scene.add(p.root);
    this.props.push(p);
    this.solids = null;
    return p;
  }

  private removeProp(p: Prop): void {
    disposeProp(p);
    const i = this.props.indexOf(p);
    if (i >= 0) this.props.splice(i, 1);
    this.solids = null;
  }

  private colliders(): Colliders {
    return (this.solids ??= collidersFor(this.props));
  }

  sceneData(): SceneData {
    return { version: 3, figures: this.figures.map(figData), props: this.props.map(propData) };
  }

  private loadScene(data: unknown): void {
    data = migrateScene(data);
    if (!data || !Array.isArray((data as SceneData).figures)) throw new Error('Expected an object with a "figures" list.');
    this.select(null);
    this.figures.slice().forEach(f => this.removeFigure(f));
    this.props.slice().forEach(p => this.removeProp(p));
    (data as SceneData).figures.forEach(d => this.addToScene(d || {}));
    const props = (data as SceneData).props;
    if (Array.isArray(props)) props.forEach(d => this.addPropToScene(d || {}));
    this.counter = Math.max(this.counter, this.figures.length);
    this.setActive(this.figures[0] || null);
  }

  private save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sceneData())); } catch { /* storage unavailable */ }
  }

  private pushUndo(): void {
    this.resizing = null;
    this.undoStack.push(JSON.stringify(this.sceneData()));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.emit();
  }

  // ---------- Selection ----------

  private setActive(fig: Figure | null): void {
    this.active = fig || null;
    if (this.sel && this.sel.kind !== 'prop' && this.sel.fig !== this.active) this.select(null);
    this.emit();
  }

  private highlight(): void {
    const sel = this.sel;
    for (const f of this.figures) f.body.setHighlight(sel?.kind === 'bone' && sel.fig === f ? sel.key : null);
  }

  /** A model finished loading (or failed): give waiting figures their real body. */
  private onModelsChanged(): void {
    let changed = false;
    for (const f of this.figures) changed = refreshBody(f, this.models) || changed;
    if (changed && this.sel) this.select(this.sel); else this.emit();
  }

  private select(s: Selection | null): void {
    this.sel = s;
    this.resizing = null;
    const movingHips = s?.kind === 'hips' && this.mode === 'move';
    if (s && (s.kind === 'ik' || movingHips)) this.handles.place(this.active, this.stage.tc, true);
    attachGizmo(this.stage.tc, this.handles, s, this.mode);
    this.highlight();
    this.emit();
  }

  /**
   * Two-bone IK toward `target`, then joint limits. `endQuat` is the end bone's world rotation to keep.
   * With collisions on too, the limb's swivel also steers the elbow or knee out of props and the floor.
   */
  private reach(f: Figure, k: LimbEnd, target: Vector3, endQuat?: Quaternion | null): void {
    const L = LIMBS[k];
    const keep = endQuat ?? f.bones[L.end].getWorldQuaternion(new Quaternion());
    const hint = poleFor(f.bones, L.kind);
    solveLimb(f.bones[L.upper], f.bones[L.lower], f.bones[L.end], target, hint, endQuat);
    if (!this.limits) return;
    const solids = this.collide ? this.colliders() : null;
    settleLimb(f.bones, L, keep, hint, solids ? () => limbDepth(f.bones, f.body.radii, L, solids) ** 2 : undefined);
  }

  private pinFeetOf(f: Figure): void {
    if (!this.drag || !this.drag.pins) return;
    for (const p of this.drag.pins) this.reach(f, p.k, p.pos, p.quat);
  }

  // ---------- Gizmo events ----------

  private onDraggingChanged(dragging: boolean): void {
    this.stage.orbit.enabled = !dragging;
    if (dragging) {
      this.pushUndo(); this.drag = {};
      const sel = this.sel;
      if (!sel || sel.kind === 'prop') return;
      const f = sel.fig; f.root.updateMatrixWorld(true);
      if (sel.kind === 'ik') this.drag.endQuat = f.bones[sel.key].getWorldQuaternion(new Quaternion());
      const hipsMoving = sel.kind === 'hips' || (sel.kind === 'bone' && sel.key === 'hips');
      if (hipsMoving && this.pinFeet) {
        this.drag.pins = (['leftFoot', 'rightFoot'] as const).map(k => ({
          k, pos: f.bones[k].getWorldPosition(new Vector3()), quat: f.bones[k].getWorldQuaternion(new Quaternion()),
        }));
      }
    } else { this.drag = null; this.save(); }
  }

  private onObjectChange(): void {
    const sel = this.sel;
    if (!sel) return;
    if (sel.kind === 'prop') {
      sel.prop.root.position.y = Math.max(0, sel.prop.root.position.y);
      this.solids = null;
      return;
    }
    const f = sel.fig;
    if (sel.kind === 'ik') {
      // With collisions on, the hand or foot travels from where it is toward the handle and stops at a
      // surface; the handle itself still follows the pointer.
      let target = this.handles.meshes[sel.key].position;
      if (this.collide) {
        f.root.updateMatrixWorld(true);
        target = this.colliders().sweepSphere(f.bones[sel.key].getWorldPosition(new Vector3()), target, f.body.radii[sel.key]);
      }
      this.reach(f, sel.key, target, this.drag && this.drag.endQuat);
    } else if (sel.kind === 'chest') {
      solveSpine(f.bones, this.handles.meshes.chest.position, this.limits);
    } else if (sel.kind === 'look') {
      f.root.updateMatrixWorld(true);
      f.look = f.root.worldToLocal(this.handles.meshes.look.position.clone());
    } else if (sel.kind === 'bone' && sel.key !== 'hips') {
      if (this.limits) clampBone(f.bones[sel.key], sel.key);
    } else if (sel.kind === 'hips') {
      if (this.stage.tc.object === this.handles.meshes.hips) {
        f.root.updateMatrixWorld(true);
        // With collisions on, the pelvis travels from where it is toward the handle and rests on a seat,
        // a bed or the floor rather than passing through.
        let p = this.handles.meshes.hips.position.clone();
        if (this.collide) p = this.colliders().sweepSphere(f.bones.hips.getWorldPosition(new Vector3()), p, f.body.radii.hips);
        f.bones.hips.position.copy(f.root.worldToLocal(p));
      }
      this.pinFeetOf(f);
    } else if (sel.kind === 'bone' && sel.key === 'hips') {
      this.pinFeetOf(f);
    } else if (sel.kind === 'base') {
      f.root.position.y = 0;
    }
  }

  // ---------- Click picking (a press that does not move is a click; drags belong to the camera or the gizmo) ----------

  private onPointerDown(e: PointerEvent): void {
    const tc = this.stage.tc;
    this.down = { x: e.clientX, y: e.clientY, gizmo: !!tc.object && tc.axis !== null };
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.down) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y), giz = this.down.gizmo;
    this.down = null;
    if (moved > 5 || giz) return;
    const r = this.stage.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.stage.camera);
    const s = pickAt(this.ray, this.active, this.handles, this.figures, this.props);
    if (s && s.kind !== 'prop' && s.fig !== this.active) this.setActive(s.fig);
    this.select(s);
  }

  // ---------- Commands ----------

  deselect(): void { this.select(null); }

  activate(id: string): void {
    const f = this.figures.find(x => x.id === id);
    if (f) this.setActive(f);
  }

  private nextSpot(): number {
    let x = 0;
    while (this.figures.some(f => Math.abs(f.root.position.x - x) < 0.5 && Math.abs(f.root.position.z) < 0.5)) x += 0.8;
    return x;
  }

  addFigure(): void {
    this.pushUndo(); this.counter++;
    const f = this.addToScene({
      name: 'Figure ' + this.counter, color: PALETTE[(this.counter - 1) % PALETTE.length],
      model: this.active?.modelId ?? DEFAULT_MODEL_ID,
      root: { x: this.nextSpot(), z: 0, ry: 0 },
    });
    this.setActive(f); this.save();
  }

  duplicate(): void {
    if (!this.active) return;
    this.pushUndo(); this.counter++;
    const d = figData(this.active);
    d.id = uid(); d.name = 'Figure ' + this.counter; d.color = PALETTE[(this.counter - 1) % PALETTE.length];
    d.root.x += 0.7; d.root.z += 0.3;
    this.setActive(this.addToScene(d)); this.save();
  }

  deleteFigure(id: string): void {
    const f = this.figures.find(x => x.id === id);
    if (!f) return;
    this.pushUndo();
    if (this.sel && this.sel.kind !== 'prop' && this.sel.fig === f) this.select(null);
    this.removeFigure(f);
    this.setActive(this.active === f ? (this.figures[0] || null) : this.active);
    this.save();
  }

  resetPose(): void {
    const a = this.active;
    if (!a) return;
    this.pushUndo();
    BONES.forEach(b => a.bones[b.name].quaternion.set(0, 0, 0, 1));
    a.bones.hips.position.fromArray(a.body.rest.hips);
    this.select(null); this.save();
  }

  dropToFloor(): void {
    const a = this.active;
    if (!a) return;
    this.pushUndo();
    a.root.updateMatrixWorld(true);
    a.body.update();
    // The floor meets the body's exact bounds; props meet the body's contact spheres.
    let gap = a.body.bounds(new Box3()).min.y;
    if (this.collide) gap = Math.min(gap, dropGap(bodySpheres(a.bones, a.body.radii), this.colliders()));
    a.bones.hips.position.y -= gap;
    if (this.sel) this.select(this.sel);
    this.save();
  }

  // ---------- Props ----------

  /** Add a prop of `kind` just behind the active figure along -Z, square to the scene axes, and select it. */
  addProp(kind: PropKind): void {
    this.pushUndo();
    const label = PROPS[kind].label;
    let n = 1;
    while (this.props.some(p => p.name === label + ' ' + n)) n++;
    const p = this.addPropToScene({ kind, name: label + ' ' + n });
    const a = this.active;
    if (a) {
      // Front edge of the prop 0.25 m behind the figure's root.
      p.root.position.set(a.root.position.x, 0, a.root.position.z - propExtentZ(p).max - 0.25);
    }
    this.select({ kind: 'prop', prop: p });
    this.save();
  }

  selectProp(id: string): void {
    const p = this.props.find(x => x.id === id);
    if (p) this.select({ kind: 'prop', prop: p });
  }

  deleteProp(id: string): void {
    const p = this.props.find(x => x.id === id);
    if (!p) return;
    this.pushUndo();
    if (this.sel?.kind === 'prop' && this.sel.prop === p) this.select(null);
    this.removeProp(p);
    this.emit(); this.save();
  }

  /** Set one size parameter of a prop. A run of changes to the same parameter is one undo step. */
  setPropSize(id: string, key: string, value: number): void {
    const p = this.props.find(x => x.id === id);
    if (!p) return;
    const tag = id + ':' + key;
    if (this.resizing !== tag) { this.pushUndo(); this.resizing = tag; }
    resizeProp(p, key, value, this.propKit);
    this.solids = null;
    this.emit(); this.save();
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    const keep = this.active ? this.active.id : null;
    this.loadScene(JSON.parse(s));
    const f = this.figures.find(x => x.id === keep);
    if (f) this.setActive(f);
    this.emit(); this.save();
  }

  setMode(m: Mode): void {
    this.mode = m;
    if (this.sel) this.select(this.sel); else this.emit();
  }

  /** Give the active figure another body. The pose carries over. */
  setModel(id: string): void {
    const a = this.active;
    if (!a || a.modelId === id) return;
    this.pushUndo();
    a.modelId = id;
    if (refreshBody(a, this.models) && this.sel) this.select(this.sel);
    this.emit(); this.save();
  }

  /** Load a .vrm from disk and put it on the active figure. Returns an error message, or null. */
  async loadModelFile(file: File): Promise<string | null> {
    try {
      const id = await this.models.addFile(file);
      if (this.active) this.setModel(id);
      return null;
    } catch (e) {
      return 'Could not load ' + file.name + '. ' + (e instanceof Error ? e.message : String(e));
    }
  }

  setPinFeet(on: boolean): void {
    this.pinFeet = on;
    this.emit();
  }

  /** Joint limits apply to every later solve and rotation; existing poses are left as they are. */
  setLimits(on: boolean): void {
    this.limits = on;
    this.emit();
  }

  /** Recolour the active figure: its body and its floor ring. */
  setColor(color: string): void {
    const a = this.active;
    if (!a || a.color === color) return;
    this.pushUndo();
    a.color = color;
    a.body.setColor(color);
    a.ring.material.color.set(color);
    this.emit(); this.save();
  }

  /** Collisions apply to later drags and drops; existing poses are left as they are. */
  setCollisions(on: boolean): void {
    this.collide = on;
    this.emit();
  }

  /** Make the active figure's head follow a look target, placed where it is looking now. */
  setLook(on: boolean): void {
    const a = this.active;
    if (!a || !!a.look === on) return;
    this.pushUndo();
    if (on) {
      a.root.updateMatrixWorld(true);
      const head = a.bones.head;
      const p = new Vector3(0, 0.08, 0.8).applyQuaternion(head.getWorldQuaternion(new Quaternion())).add(head.getWorldPosition(new Vector3()));
      a.look = a.root.worldToLocal(p);
    } else {
      a.look = null;
      if (this.sel?.kind === 'look' && this.sel.fig === a) this.select(null);
    }
    this.emit(); this.save();
  }

  // ---------- Photo import ----------

  private setPhotoUi(patch: Partial<EditorUi['photo']>): void {
    this.photoUi = { ...this.photoUi, ...patch };
    this.emit();
  }

  /** Detect the people in a photo and replace the scene with one figure per person, posed to match. */
  async importPhoto(file: File): Promise<void> {
    if (this.photoUi.busy) return;
    const url = URL.createObjectURL(file);
    try {
      this.setPhotoUi({ busy: true, message: 'Loading the pose detector\u2026' });
      // MediaPipe is loaded on first use only.
      this.estimator ??= import('../pose/mediapipe').then(m => m.MediaPipeEstimator.create());
      this.estimator.catch(() => { this.estimator = null; });
      const image = new Image();
      image.src = url;
      const [estimator] = await Promise.all([this.estimator, image.decode()]);
      if (this.disposed) return;
      this.setPhotoUi({ message: 'Finding people\u2026' });
      const est = await estimator.estimate(image);
      if (this.disposed) return;
      if (!est.people.length) {
        URL.revokeObjectURL(url);
        this.setPhotoUi({ busy: false, message: 'No people found in ' + file.name + '.' });
        return;
      }

      this.pushUndo();
      const model = this.active?.modelId ?? DEFAULT_MODEL_ID;
      this.select(null);
      this.figures.slice().forEach(f => this.removeFigure(f));
      // Left to right as seen in the photo.
      const people = est.people.slice().sort((a, b) => a.root.x - b.root.x);
      people.forEach((p, i) => this.addToScene({
        name: 'Figure ' + (i + 1), color: PALETTE[i % PALETTE.length], model, root: p.root, hips: p.hips, pose: p.pose,
      }));
      this.counter = Math.max(this.counter, people.length);
      this.setActive(this.figures[0]);

      if (this.photo) URL.revokeObjectURL(this.photo.url);
      this.photo = { url, camera: est.camera };
      this.stage.setBackdrop(image, est.camera);
      this.stage.setBackdropVisible(this.photoUi.visible);
      this.stage.viewFrom(est.camera);
      const n = people.length;
      this.setPhotoUi({ busy: false, loaded: true, message: `Found ${n} ${n === 1 ? 'person' : 'people'}. Depth and occluded limbs are guesses; correct them by eye.` });
      this.save();
    } catch (e) {
      console.error(e);
      URL.revokeObjectURL(url);
      this.setPhotoUi({ busy: false, message: 'Could not read that photo. ' + (e instanceof Error ? e.message : String(e)) });
    }
  }

  setPhotoVisible(on: boolean): void {
    this.stage.setBackdropVisible(on);
    this.setPhotoUi({ visible: on });
  }

  viewFromPhoto(): void {
    if (this.photo) this.stage.viewFrom(this.photo.camera);
  }

  removePhoto(): void {
    if (!this.photo) return;
    URL.revokeObjectURL(this.photo.url);
    this.photo = null;
    this.stage.setBackdrop(null);
    this.setPhotoUi({ loaded: false, message: '' });
  }

  /** Largest width or height `renderImage` accepts. */
  maxImageSize(): number {
    return this.stage.maxCaptureSize;
  }

  /**
   * Render the scene as a PNG of `width` by `height`, without the grid, handles, floor rings, gizmo,
   * bone highlight or photo. `background` is a CSS colour, or null for transparent.
   */
  renderImage(width: number, height: number, background: string | null): Promise<Blob> {
    for (const f of this.figures) f.body.setHighlight(null);
    let canvas: HTMLCanvasElement;
    try {
      canvas = this.stage.capture(width, height, background ? new Color(background) : null,
        [...this.handles.list, ...this.figures.map(f => f.ring)]);
    } finally {
      this.highlight();
    }
    return new Promise((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('The browser could not encode the image.'))), 'image/png'));
  }

  sceneJson(): string {
    return JSON.stringify(this.sceneData(), null, 1);
  }

  /** Replace the scene from JSON text. Returns an error message, or null on success. */
  loadSceneJson(text: string): string | null {
    let data: unknown;
    try { data = JSON.parse(text); }
    catch { return 'That text is not valid JSON. Check for a missing bracket or comma.'; }
    const before = JSON.stringify(this.sceneData());
    try { this.loadScene(data); }
    catch (e) {
      this.loadScene(JSON.parse(before));
      return 'Could not load that scene. ' + (e instanceof Error ? e.message : String(e));
    }
    this.undoStack.push(before);
    this.save(); this.emit();
    return null;
  }
}
