// The editor: owns the figures, selection, undo stack and autosave, and exposes commands plus a
// read-only UI snapshot for React. Scene state lives in three.js objects and is serialized to
// SceneData JSON on demand, exactly as in the prototype.
import { Box3, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import { solveLimb } from '../rig/ik';
import { BONES, LIMBS, PALETTE, REST, type LimbEnd, type LimbKind } from '../rig/skeleton';
import { createFigure, disposeFigure, figData, uid, type Figure } from './figure';
import { STORAGE_KEY, type FigureInput, type SceneData } from './sceneData';
import { Handles, attachGizmo, hintText, pickAt, type Mode, type Selection } from './selection';
import { Stage } from './stage';

export interface FigureSummary { id: string; name: string; color: string }

export interface EditorUi {
  figures: FigureSummary[];
  activeId: string | null;
  mode: Mode;
  pinFeet: boolean;
  canUndo: boolean;
  hint: string;
}

interface Drag {
  endQuat?: Quaternion;
  pins?: { k: LimbEnd; pos: Vector3; quat: Quaternion }[];
}

const UNDO_LIMIT = 60;

export class Editor {
  private stage: Stage;
  private handles: Handles;
  private figures: Figure[] = [];
  private active: Figure | null = null;
  private sel: Selection | null = null;
  private mode: Mode = 'move';
  private pinFeet = true;
  private drag: Drag | null = null;
  private counter = 0;
  private undoStack: string[] = [];

  private ray = new Raycaster();
  private ndc = new Vector2();
  private down: { x: number; y: number; gizmo: boolean } | null = null;
  private cleanup: (() => void)[] = [];

  private listeners = new Set<() => void>();
  private ui: EditorUi;

  constructor(container: HTMLElement) {
    this.stage = new Stage(container);
    this.handles = new Handles(this.stage.scene);
    this.stage.onTheme(c => this.handles.setColor(c.handle));
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
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.figures) && d.figures.length) { this.loadScene(d); restored = true; }
      }
    } catch {
      this.figures.slice().forEach(f => this.removeFigure(f));
    }
    if (!restored) {
      this.counter = 1;
      this.setActive(this.addToScene({ name: 'Figure 1', color: PALETTE[0], root: { x: 0, z: 0, ry: 0 } }));
    }
    this.undoStack = [];
    this.emit();

    this.stage.start(() => this.handles.place(this.active, tc, false));
  }

  dispose(): void {
    this.cleanup.forEach(fn => fn());
    this.figures.forEach(disposeFigure);
    this.figures = [];
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
    return {
      figures: this.figures.map(f => ({ id: f.id, name: f.name, color: f.color })),
      activeId: this.active?.id ?? null,
      mode: this.mode,
      pinFeet: this.pinFeet,
      canUndo: this.undoStack.length > 0,
      hint: hintText(this.sel, this.mode, this.figures.length),
    };
  }

  private emit(): void {
    this.ui = this.buildUi();
    this.listeners.forEach(fn => fn());
  }

  // ---------- Scene state ----------

  private addToScene(d: FigureInput): Figure {
    const fig = createFigure(d);
    this.stage.scene.add(fig.root);
    this.figures.push(fig);
    return fig;
  }

  private removeFigure(fig: Figure): void {
    disposeFigure(fig);
    const i = this.figures.indexOf(fig);
    if (i >= 0) this.figures.splice(i, 1);
  }

  sceneData(): SceneData {
    return { version: 1, figures: this.figures.map(figData) };
  }

  private loadScene(data: unknown): void {
    if (!data || !Array.isArray((data as SceneData).figures)) throw new Error('Expected an object with a "figures" list.');
    this.select(null);
    this.figures.slice().forEach(f => this.removeFigure(f));
    (data as SceneData).figures.forEach(d => this.addToScene(d || {}));
    this.counter = Math.max(this.counter, this.figures.length);
    this.setActive(this.figures[0] || null);
  }

  private save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sceneData())); } catch { /* storage unavailable */ }
  }

  private pushUndo(): void {
    this.undoStack.push(JSON.stringify(this.sceneData()));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.emit();
  }

  // ---------- Selection ----------

  private setActive(fig: Figure | null): void {
    this.active = fig || null;
    if (this.sel && this.sel.fig !== this.active) this.select(null);
    this.emit();
  }

  private highlight(): void {
    const sel = this.sel;
    for (const f of this.figures) {
      for (const b of BONES) {
        const on = !!sel && sel.fig === f && sel.kind === 'bone' && sel.key === b.name;
        f.meshes[b.name].forEach(m => { m.material = on ? f.matSel : f.mat; });
      }
    }
  }

  private select(s: Selection | null): void {
    this.sel = s;
    const movingHips = s?.kind === 'hips' && this.mode === 'move';
    if (s && (s.kind === 'ik' || movingHips)) this.handles.place(this.active, this.stage.tc, true);
    attachGizmo(this.stage.tc, this.handles, s, this.mode);
    this.highlight();
    this.emit();
  }

  private hintFor(f: Figure, kind: LimbKind): Vector3 {
    const src = kind === 'arm' ? f.bones.chest : f.bones.hips;
    const v = kind === 'arm' ? new Vector3(0, -0.35, -1) : new Vector3(0, 0, 1);
    return v.applyQuaternion(src.getWorldQuaternion(new Quaternion())).normalize();
  }

  private pinFeetOf(f: Figure): void {
    if (!this.drag || !this.drag.pins) return;
    for (const p of this.drag.pins) {
      const L = LIMBS[p.k];
      solveLimb(f.bones[L.upper], f.bones[L.lower], f.bones[L.end], p.pos, this.hintFor(f, 'leg'), p.quat);
    }
  }

  // ---------- Gizmo events ----------

  private onDraggingChanged(dragging: boolean): void {
    this.stage.orbit.enabled = !dragging;
    if (dragging) {
      this.pushUndo(); this.drag = {};
      const sel = this.sel;
      if (!sel) return;
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
    const f = sel.fig;
    if (sel.kind === 'ik') {
      const L = LIMBS[sel.key];
      solveLimb(f.bones[L.upper], f.bones[L.lower], f.bones[L.end], this.handles.meshes[sel.key].position,
        this.hintFor(f, L.kind), this.drag && this.drag.endQuat);
    } else if (sel.kind === 'hips') {
      if (this.stage.tc.object === this.handles.meshes.hips) {
        f.root.updateMatrixWorld(true);
        f.bones.hips.position.copy(f.root.worldToLocal(this.handles.meshes.hips.position.clone()));
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
    const s = pickAt(this.ray, this.active, this.handles, this.figures);
    if (s && s.fig !== this.active) this.setActive(s.fig);
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
    if (this.sel && this.sel.fig === f) this.select(null);
    this.removeFigure(f);
    this.setActive(this.active === f ? (this.figures[0] || null) : this.active);
    this.save();
  }

  resetPose(): void {
    const a = this.active;
    if (!a) return;
    this.pushUndo();
    BONES.forEach(b => a.bones[b.name].quaternion.set(0, 0, 0, 1));
    a.bones.hips.position.fromArray(REST.hips);
    this.select(null); this.save();
  }

  dropToFloor(): void {
    const a = this.active;
    if (!a) return;
    this.pushUndo();
    a.root.updateMatrixWorld(true);
    const bb = new Box3().setFromObject(a.bones.hips);
    a.bones.hips.position.y -= bb.min.y;
    if (this.sel) this.select(this.sel);
    this.save();
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

  setPinFeet(on: boolean): void {
    this.pinFeet = on;
    this.emit();
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
