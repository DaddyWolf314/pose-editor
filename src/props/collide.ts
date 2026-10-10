// Planar collision against props: every solid catalog box is a convex solid bounded by six planes, and
// the floor is the plane y = 0. Pure math on three.js vectors, for posing aids rather than physics.
// Props turn about +Y only, so a box's top face stays a horizontal support surface in world space.
// Imports nothing relative, so `node --test` can load it directly (see collide.test.ts).
import { Matrix4, Vector3 } from 'three';

/** An axis-aligned box in prop space. Catalog `PropBox`es fit this shape. */
export interface Box {
  readonly center: readonly [number, number, number];
  readonly half: readonly [number, number, number];
  readonly solid: boolean;
}

/** A prop's boxes and its prop-to-world matrix (rigid, turned about +Y only). */
export interface Solid {
  matrix: Matrix4;
  boxes: readonly Box[];
}

interface Placed { toWorld: Matrix4; toLocal: Matrix4; boxes: Box[] }

const sign = (v: number) => (v < 0 ? -1 : 1);

/**
 * Signed distance from `q` to box `b` (negative inside), both in prop space, and the outward unit
 * normal at the nearest surface point written to `normal`. Inside, that is the face of least
 * penetration; ties go to x, then y, then z.
 */
export function boxDistance(q: Vector3, b: Box, normal: Vector3): number {
  const rx = q.x - b.center[0], ry = q.y - b.center[1], rz = q.z - b.center[2];
  const dx = Math.abs(rx) - b.half[0], dy = Math.abs(ry) - b.half[1], dz = Math.abs(rz) - b.half[2];
  if (dx > 0 || dy > 0 || dz > 0) {
    normal.set(Math.max(dx, 0) * sign(rx), Math.max(dy, 0) * sign(ry), Math.max(dz, 0) * sign(rz));
    const len = normal.length();
    normal.divideScalar(len);
    return len;
  }
  if (dx >= dy && dx >= dz) { normal.set(sign(rx), 0, 0); return dx; }
  if (dy >= dz) { normal.set(0, sign(ry), 0); return dy; }
  normal.set(0, 0, sign(rz)); return dz;
}

const PASSES = 4;
const EPS = 1e-9;

export class Colliders {
  private placed: Placed[];
  private floor: boolean;

  /** Matrices are copied: rebuild when a prop moves, turns or is resized. */
  constructor(solids: readonly Solid[], floor = true) {
    this.floor = floor;
    this.placed = solids
      .map(s => ({ toWorld: s.matrix.clone(), toLocal: s.matrix.clone().invert(), boxes: s.boxes.filter(b => b.solid) }))
      .filter(p => p.boxes.length);
  }

  /** Signed distance from a world point to the nearest solid or the floor, with the outward normal. */
  distance(p: Vector3, normal = new Vector3()): number {
    let best = Infinity;
    if (this.floor) { best = p.y; normal.set(0, 1, 0); }
    const q = new Vector3(), n = new Vector3();
    for (const s of this.placed) {
      q.copy(p).applyMatrix4(s.toLocal);
      for (const b of s.boxes) {
        const d = boxDistance(q, b, n);
        if (d < best) { best = d; normal.copy(n).transformDirection(s.toWorld); }
      }
    }
    return best;
  }

  /**
   * Move a sphere's centre the least distance that takes it out of every solid and above the floor.
   * Boxes are resolved one at a time, a few passes over all of them, so a sphere wedged between two
   * boxes (seat and backrest) settles against both. Returns a new vector.
   */
  resolveSphere(c: Vector3, r: number): Vector3 {
    const out = c.clone(), q = new Vector3(), n = new Vector3();
    for (let pass = 0; pass < PASSES; pass++) {
      let moved = false;
      for (const s of this.placed) {
        for (const b of s.boxes) {
          q.copy(out).applyMatrix4(s.toLocal);
          const d = boxDistance(q, b, n);
          if (d < r - EPS) { out.addScaledVector(n.transformDirection(s.toWorld), r - d); moved = true; }
        }
      }
      if (this.floor && out.y < r - EPS) { out.y = r; moved = true; }
      if (!moved) break;
    }
    return out;
  }

  /**
   * Move a sphere from `from` toward `to` in steps of at most half its radius, resolving after each,
   * so it stops at the first surface in its way and slides along it rather than passing through a
   * thin part such as a seat. `from` should be clear; it is resolved first if not. Returns a new vector.
   */
  sweepSphere(from: Vector3, to: Vector3, r: number): Vector3 {
    let p = this.resolveSphere(from, r);
    const step = Math.max(r * 0.5, 1e-3);
    // Sliding gains less than a full step each time, so allow several times the straight-line count.
    const steps = 4 * Math.ceil(p.distanceTo(to) / step) + 8;
    const d = new Vector3();
    for (let i = 0; i < steps; i++) {
      // Head for the target from wherever the last step left the sphere, so blocked motion becomes sliding.
      d.subVectors(to, p);
      const len = d.length();
      if (len < 1e-9) break;
      const next = this.resolveSphere(d.multiplyScalar(Math.min(1, step / len)).add(p), r);
      const moved = next.distanceToSquared(p);
      p = next;
      if (moved < 1e-14) break;
    }
    return p;
  }

  /**
   * Height of the highest support surface under `p`: the top of a solid box whose footprint, widened
   * by `margin`, contains `p` and whose top is at or below `p`; else the floor (0), or -Infinity
   * without one.
   */
  supportBelow(p: Vector3, margin = 0): number {
    let best = this.floor ? 0 : -Infinity;
    const q = new Vector3(), top = new Vector3();
    for (const s of this.placed) {
      q.copy(p).applyMatrix4(s.toLocal);
      for (const b of s.boxes) {
        if (Math.abs(q.x - b.center[0]) > b.half[0] + margin || Math.abs(q.z - b.center[2]) > b.half[2] + margin) continue;
        const y = b.center[1] + b.half[1];
        if (y > q.y + EPS) continue;
        best = Math.max(best, top.set(q.x, y, q.z).applyMatrix4(s.toWorld).y);
      }
    }
    return best;
  }

  /**
   * How deep a capsule from `a` to `b` with radius `r` sinks into the solids or the floor; 0 when
   * clear. Sampled along the segment at most `r` apart, so it is a cost for choosing between poses,
   * not an exact contact.
   */
  capsuleDepth(a: Vector3, b: Vector3, r: number): number {
    const steps = Math.max(1, Math.ceil(a.distanceTo(b) / Math.max(r, 1e-3)));
    const p = new Vector3(), n = new Vector3();
    let depth = 0;
    for (let i = 0; i <= steps; i++) {
      p.lerpVectors(a, b, i / steps);
      depth = Math.max(depth, r - this.distance(p, n));
    }
    return depth;
  }
}
