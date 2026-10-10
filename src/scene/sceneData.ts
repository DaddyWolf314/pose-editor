// Plain-JSON scene state. This is what is autosaved, exported, and pushed onto the undo stack.
import { MANNEQUIN_ID } from '../rig/body';
import { REST, type BoneName } from '../rig/skeleton';

export type QuatTuple = [number, number, number, number];

export interface FigureData {
  id: string;
  name: string;
  color: string;
  /** Body to show: 'mannequin' or a model library id. Falls back to the mannequin while unavailable. */
  model: string;
  /** Floor placement: position on the ground plane and turn about +Y. */
  root: { x: number; z: number; ry: number };
  /** Hips offset from the body's rest hips position, in figure-root space, so poses survive a body swap. */
  hips: [number, number, number];
  /** Rotation of each rig bone relative to the T-pose. */
  pose: Partial<Record<BoneName, QuatTuple>>;
  /** Point the head looks at, in figure-root space. Absent when the head is posed by hand. */
  look?: [number, number, number];
}

export interface PropData {
  id: string;
  name: string;
  /** Catalog kind (`PROP_KINDS`). Unknown kinds load as a box. */
  kind: string;
  /** Position (`y` lifts it, for stacking) and turn about +Y. The prop's front faces +Z. */
  root: { x: number; y: number; z: number; ry: number };
  /** The kind's size parameters in metres. Missing or out-of-range values take the catalog default or limit. */
  size: Record<string, number>;
}

export interface SceneData {
  version: 3;
  figures: FigureData[];
  props: PropData[];
}

/** Input accepted when loading: every field is optional and checked at load time, as in the prototype. */
export type FigureInput = Partial<FigureData>;
export type PropInput = Partial<PropData>;

export const STORAGE_KEY = 'posetool.v2';
/** Key used by the prototype and step 2, read once if there is no v2 save. */
export const LEGACY_STORAGE_KEY = 'posetool.v1';

/**
 * Bring older scene JSON up to version 3. Version 1 (the prototype) stored absolute hips positions for
 * the procedural mannequin and had no model field. Version 2 had no props.
 */
export function migrateScene(data: unknown): unknown {
  data = migrateV1(data);
  if (!data || typeof data !== 'object') return data;
  const d = data as { version?: number; figures?: unknown };
  if (d.version !== 2 || !Array.isArray(d.figures)) return data;
  return { ...d, version: 3, props: [] };
}

function migrateV1(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const d = data as { version?: number; figures?: unknown };
  if (d.version !== 1 || !Array.isArray(d.figures)) return data;
  return {
    version: 2,
    figures: d.figures.map((f: FigureInput | null) => {
      if (!f) return f;
      const out: FigureInput = { ...f, model: MANNEQUIN_ID };
      if (Array.isArray(f.hips) && f.hips.length === 3) {
        out.hips = f.hips.map((v, i) => Number(v) - REST.hips[i]) as FigureData['hips'];
      }
      return out;
    }),
  };
}
