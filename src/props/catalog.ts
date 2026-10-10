// Prop catalog: each kind is a function of its size parameters that returns axis-aligned boxes in
// prop space (metres, origin on the floor at the middle of the footprint, front facing +Z). The same
// boxes drive rendering and, later, collision.
import type { Vec3Tuple } from '../rig/skeleton';

export interface PropBox {
  center: Vec3Tuple;
  half: Vec3Tuple;
  /** Collides with figures. Parts that are only for show, such as chair legs, are not solid. */
  solid: boolean;
}

export interface SizeParam { key: string; label: string; min: number; max: number; value: number }

export type PropSize = Record<string, number>;

export interface PropDef {
  label: string;
  params: SizeParam[];
  boxes(s: PropSize): PropBox[];
}

export const PROP_KINDS = ['chair', 'stool', 'bench', 'table', 'bed', 'box'] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/** A box spanning x0..x1, y0..y1, z0..z1. */
function span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, solid = true): PropBox {
  return {
    center: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
    half: [Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2],
    solid,
  };
}

/** Four square legs under a top of `w` by `d`, reaching up to `h`. */
function legs(w: number, d: number, h: number, t: number): PropBox[] {
  const x = w / 2, z = d / 2;
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) =>
    span(sx * x, sx * (x - t), 0, h, sz * z, sz * (z - t), false));
}

const SEAT = 0.05, TOP = 0.04, LEG = 0.04;

export const PROPS: Record<PropKind, PropDef> = {
  chair: {
    label: 'Chair',
    params: [
      { key: 'seatHeight', label: 'Seat height', min: 0.3, max: 0.7, value: 0.45 },
      { key: 'width', label: 'Width', min: 0.35, max: 0.8, value: 0.46 },
      { key: 'depth', label: 'Depth', min: 0.35, max: 0.7, value: 0.44 },
      { key: 'backHeight', label: 'Back height', min: 0.1, max: 0.8, value: 0.45 },
    ],
    boxes: s => {
      const h = s.seatHeight, w = s.width / 2, d = s.depth / 2;
      return [
        span(-w, w, h - SEAT, h, -d, d),
        span(-w, w, h, h + s.backHeight, -d, -d + LEG),
        ...legs(s.width, s.depth, h - SEAT, LEG),
      ];
    },
  },
  stool: {
    label: 'Stool',
    params: [
      { key: 'height', label: 'Height', min: 0.3, max: 0.9, value: 0.65 },
      { key: 'width', label: 'Width', min: 0.25, max: 0.6, value: 0.36 },
    ],
    boxes: s => {
      const w = s.width / 2;
      return [span(-w, w, s.height - SEAT, s.height, -w, w), ...legs(s.width, s.width, s.height - SEAT, LEG)];
    },
  },
  bench: {
    label: 'Bench',
    params: [
      { key: 'height', label: 'Height', min: 0.3, max: 0.7, value: 0.45 },
      { key: 'length', label: 'Length', min: 0.8, max: 2.5, value: 1.4 },
      { key: 'depth', label: 'Depth', min: 0.25, max: 0.6, value: 0.38 },
    ],
    boxes: s => {
      const x = s.length / 2, d = s.depth / 2, h = s.height - SEAT, inset = 0.1;
      return [
        span(-x, x, h, s.height, -d, d),
        span(-x + inset, -x + inset + LEG, 0, h, -d + 0.03, d - 0.03, false),
        span(x - inset - LEG, x - inset, 0, h, -d + 0.03, d - 0.03, false),
      ];
    },
  },
  table: {
    label: 'Table',
    params: [
      { key: 'height', label: 'Height', min: 0.4, max: 1.1, value: 0.75 },
      { key: 'width', label: 'Width', min: 0.5, max: 2.4, value: 1.2 },
      { key: 'depth', label: 'Depth', min: 0.5, max: 1.2, value: 0.75 },
    ],
    boxes: s => {
      const w = s.width / 2, d = s.depth / 2;
      return [span(-w, w, s.height - TOP, s.height, -d, d), ...legs(s.width, s.depth, s.height - TOP, 0.05)];
    },
  },
  bed: {
    label: 'Bed',
    params: [
      { key: 'height', label: 'Mattress height', min: 0.2, max: 0.8, value: 0.55 },
      { key: 'width', label: 'Width', min: 0.8, max: 2.0, value: 1.4 },
      { key: 'length', label: 'Length', min: 1.8, max: 2.3, value: 2.0 },
      { key: 'headboard', label: 'Headboard', min: 0, max: 1.0, value: 0.5 },
    ],
    boxes: s => {
      // The head end is at -Z.
      const w = s.width / 2, l = s.length / 2, base = Math.max(s.height - 0.2, 0.05), board = 0.06;
      const out = [
        span(-w, w, 0, base, -l + board, l),
        span(-w + 0.02, w - 0.02, base, s.height, -l + board, l - 0.02),
      ];
      if (s.headboard > 0) out.push(span(-w, w, 0, s.height + s.headboard, -l, -l + board));
      return out;
    },
  },
  box: {
    label: 'Box',
    params: [
      { key: 'width', label: 'Width', min: 0.1, max: 3, value: 0.6 },
      { key: 'height', label: 'Height', min: 0.05, max: 2, value: 0.4 },
      { key: 'depth', label: 'Depth', min: 0.1, max: 3, value: 0.6 },
    ],
    boxes: s => [span(-s.width / 2, s.width / 2, 0, s.height, -s.depth / 2, s.depth / 2)],
  },
};

export function isPropKind(k: unknown): k is PropKind {
  return typeof k === 'string' && (PROP_KINDS as readonly string[]).includes(k);
}

/** A full, clamped size for `kind`: given values where valid, defaults elsewhere. */
export function propSize(kind: PropKind, given?: Partial<PropSize> | null): PropSize {
  const out: PropSize = {};
  for (const p of PROPS[kind].params) {
    const v = Number(given?.[p.key]);
    out[p.key] = Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.value;
  }
  return out;
}
