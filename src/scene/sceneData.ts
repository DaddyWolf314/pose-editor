// Plain-JSON scene state. This is what is autosaved, exported, and pushed onto the undo stack.
import type { BoneName } from '../rig/skeleton';

export type QuatTuple = [number, number, number, number];

export interface FigureData {
  id: string;
  name: string;
  color: string;
  /** Floor placement: position on the ground plane and turn about +Y. */
  root: { x: number; z: number; ry: number };
  /** Hips position in figure-root space. */
  hips: [number, number, number];
  pose: Partial<Record<BoneName, QuatTuple>>;
}

export interface SceneData {
  version: 1;
  figures: FigureData[];
}

/** Input accepted when loading: every field is optional and checked at load time, as in the prototype. */
export type FigureInput = Partial<FigureData>;

export const STORAGE_KEY = 'posetool.v1';
