// Numeric tests for the collision core. Run with `npm test` (Node's own runner, which strips types).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { Colliders, boxDistance, type Box, type Solid } from './collide.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
const nearV = (v: Vector3, x: number, y: number, z: number, eps = 1e-9) => { near(v.x, x, eps); near(v.y, y, eps); near(v.z, z, eps); };

const box = (center: [number, number, number], half: [number, number, number], solid = true): Box => ({ center, half, solid });

/** Prop-to-world matrix: turn `ry` about +Y, then move to (x, y, z). */
const place = (x: number, y: number, z: number, ry = 0) =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ry), new Vector3(1, 1, 1));

// A chair like the catalog's: seat top at 0.45, 0.46 wide, 0.44 deep; backrest at -Z up to 0.9; one leg that does not collide.
const SEAT = box([0, 0.425, 0], [0.23, 0.025, 0.22]);
const BACK = box([0, 0.675, -0.2], [0.23, 0.225, 0.02]);
const LEG = box([0.21, 0.2, 0.2], [0.02, 0.2, 0.02], false);
const chair = (m = new Matrix4()): Solid => ({ matrix: m, boxes: [SEAT, BACK, LEG] });

describe('boxDistance', () => {
  const unit = box([0, 0, 0], [1, 1, 1]);
  const n = new Vector3();

  test('outside a face: distance to the plane, normal along it', () => {
    near(boxDistance(new Vector3(0, 1.5, 0.3), unit, n), 0.5);
    nearV(n, 0, 1, 0);
  });

  test('outside an edge: distance to the edge, normal diagonal', () => {
    near(boxDistance(new Vector3(2, 2, 0), unit, n), Math.SQRT2);
    nearV(n, Math.SQRT1_2, Math.SQRT1_2, 0);
  });

  test('inside: negative depth to the nearest face', () => {
    near(boxDistance(new Vector3(0.2, -0.9, 0), unit, n), -0.1);
    nearV(n, 0, -1, 0);
  });

  test('off-centre box', () => {
    near(boxDistance(new Vector3(0, 0.5, 0), SEAT, n), 0.05);
    nearV(n, 0, 1, 0);
  });
});

describe('Colliders.resolveSphere', () => {
  const c = new Colliders([chair()]);

  test('a clear sphere does not move', () => {
    nearV(c.resolveSphere(new Vector3(0, 0.6, 0.05), 0.1), 0, 0.6, 0.05);
  });

  test('a sphere sunk into the seat rests on top of it', () => {
    nearV(c.resolveSphere(new Vector3(0.05, 0.5, 0.05), 0.1), 0.05, 0.55, 0.05);
  });

  test('a sphere wedged into seat and backrest clears both', () => {
    const r = 0.1;
    const out = c.resolveSphere(new Vector3(0, 0.5, -0.12), r);
    const n = new Vector3();
    assert.ok(boxDistance(out, SEAT, n) >= r - 1e-9);
    assert.ok(boxDistance(out, BACK, n) >= r - 1e-9);
    // Least movement: up off the seat and forward off the backrest, no sideways drift.
    nearV(out, 0, 0.55, -0.08);
  });

  test('non-solid boxes are ignored', () => {
    nearV(c.resolveSphere(new Vector3(0.21, 0.2, 0.2), 0.03), 0.21, 0.2, 0.2);
  });

  test('the floor pushes up', () => {
    nearV(c.resolveSphere(new Vector3(1, 0.02, 1), 0.05), 1, 0.05, 1);
    nearV(new Colliders([chair()], false).resolveSphere(new Vector3(1, 0.02, 1), 0.05), 1, 0.02, 1);
  });

  test('a turned and moved chair pushes along its own axes', () => {
    // Turned 90 degrees, the chair's front faces +X and its backrest spans world x 1.78 to 1.82.
    const t = new Colliders([chair(place(2, 0, 1, Math.PI / 2))], false);
    nearV(t.resolveSphere(new Vector3(1.85, 0.7, 1), 0.05), 1.87, 0.7, 1, 1e-9);
    nearV(t.resolveSphere(new Vector3(2.1, 0.47, 1.05), 0.05), 2.1, 0.5, 1.05, 1e-9);
  });

  test('a lifted prop collides where it is', () => {
    const t = new Colliders([{ matrix: place(0, 0.5, 0), boxes: [box([0, 0.2, 0], [0.3, 0.2, 0.3])] }], false);
    nearV(t.resolveSphere(new Vector3(0, 0.88, 0), 0.05), 0, 0.95, 0);
    nearV(t.resolveSphere(new Vector3(0, 0.3, 0), 0.05), 0, 0.3, 0);
  });
});

describe('Colliders.sweepSphere', () => {
  const c = new Colliders([chair()]);

  test('a free path ends at the target', () => {
    nearV(c.sweepSphere(new Vector3(0.6, 1, 0), new Vector3(0.8, 0.5, 0.3), 0.1), 0.8, 0.5, 0.3, 1e-9);
  });

  test('does not pass through the thin seat, where resolveSphere alone would', () => {
    const from = new Vector3(0, 0.7, 0.05), to = new Vector3(0, 0.15, 0.05);
    nearV(c.resolveSphere(to, 0.1), 0, 0.15, 0.05);
    nearV(c.sweepSphere(from, to, 0.1), 0, 0.55, 0.05, 1e-9);
  });

  test('slides along the seat toward a target inside it', () => {
    // Pushed down and forward into the seat: ends on top of the seat as far forward as the target.
    nearV(c.sweepSphere(new Vector3(0, 0.7, -0.05), new Vector3(0, 0.4, 0.1), 0.1), 0, 0.55, 0.1, 1e-4);
  });

  test('stops at the backrest', () => {
    const out = c.sweepSphere(new Vector3(0, 0.75, 0.2), new Vector3(0, 0.75, -0.6), 0.1);
    nearV(out, 0, 0.75, -0.08, 1e-9);
  });
});

describe('Colliders.supportBelow', () => {
  const c = new Colliders([chair()]);

  test('over the seat: the seat top', () => near(c.supportBelow(new Vector3(0.1, 0.9, 0.1)), 0.45));
  test('beside the chair: the floor', () => near(c.supportBelow(new Vector3(0.5, 0.9, 0)), 0));
  test('under the seat: the floor', () => near(c.supportBelow(new Vector3(0, 0.2, 0)), 0));
  test('over the backrest: its top', () => near(c.supportBelow(new Vector3(0, 1.2, -0.2)), 0.9));
  test('just past the edge counts with a margin', () => {
    near(c.supportBelow(new Vector3(0.26, 0.9, 0)), 0);
    near(c.supportBelow(new Vector3(0.26, 0.9, 0), 0.05), 0.45);
  });
  test('no floor and nothing under: -Infinity', () => {
    assert.equal(new Colliders([chair()], false).supportBelow(new Vector3(3, 1, 3)), -Infinity);
  });

  test('a turned footprint', () => {
    const long = { matrix: place(0, 0, 0, Math.PI / 2), boxes: [box([0, 0.2, 0], [1, 0.2, 0.1])] };
    const t = new Colliders([long]);
    near(t.supportBelow(new Vector3(0, 1, 0.8)), 0.4);
    near(t.supportBelow(new Vector3(0.8, 1, 0)), 0);
  });

  test('a stacked prop adds its lift', () => {
    const t = new Colliders([chair(), { matrix: place(0, 0.45, 0), boxes: [box([0, 0.1, 0], [0.15, 0.1, 0.15])] }]);
    near(t.supportBelow(new Vector3(0, 1, 0)), 0.65);
    near(t.supportBelow(new Vector3(0.2, 1, 0)), 0.45);
  });
});

describe('Colliders.capsuleDepth', () => {
  const c = new Colliders([chair()]);

  test('clear of everything: 0', () => {
    near(c.capsuleDepth(new Vector3(0.6, 0.5, 0), new Vector3(0.6, 0.1, 0), 0.05), 0);
  });

  test('a shin through the seat: at least the radius', () => {
    // The axis crosses the 5 cm seat. Samples 5 cm apart land on its faces, not its middle (2.5 cm in),
    // so the sampled depth is between r and r + 2.5 cm.
    const d = c.capsuleDepth(new Vector3(0, 0.7, 0), new Vector3(0, 0.15, 0), 0.05);
    assert.ok(d >= 0.05 - 1e-9 && d <= 0.075 + 1e-9, String(d));
  });

  test('a capsule lying on the floor touches but does not sink', () => {
    near(c.capsuleDepth(new Vector3(1, 0.05, 0), new Vector3(1.5, 0.05, 0), 0.05), 0);
    near(c.capsuleDepth(new Vector3(1, 0.03, 0), new Vector3(1.5, 0.05, 0), 0.05), 0.02, 1e-9);
  });
});
