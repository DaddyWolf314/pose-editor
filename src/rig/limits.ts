// Joint limits on rig bones. A bone's rotation relative to the T-pose is split into swing and twist:
// twist turns the bone about one rig axis, swing tilts it about the other two. Each axis has a range
// in degrees, as rotations about the positive rig axes (X = character's left, Y = up, Z = forward).
// Swing is clamped to an elliptical cone with a separate radius per direction; twist to its range.
import { Quaternion, Vector3, type Object3D } from 'three';
import type { BoneName } from './skeleton';

type Axis = 'x' | 'y' | 'z';
type Range = [number, number];
export interface JointLimit { twist: Axis; x: Range; y: Range; z: Range }

const AXES: Record<Axis, Vector3> = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
const OTHER: Record<Axis, [Axis, Axis]> = { x: ['y', 'z'], y: ['x', 'z'], z: ['x', 'y'] };

// Left side and centre line. Every range includes 0, the T-pose.
const BASE: Partial<Record<BoneName, JointLimit>> = {
  spine: { twist: 'y', x: [-20, 45], y: [-30, 30], z: [-25, 25] },
  chest: { twist: 'y', x: [-20, 35], y: [-30, 30], z: [-20, 20] },
  neck: { twist: 'y', x: [-35, 45], y: [-45, 45], z: [-30, 30] },
  head: { twist: 'y', x: [-35, 35], y: [-50, 50], z: [-25, 25] },
  // Arm along +X. -Y swings it forward, +Z raises it.
  leftUpperArm: { twist: 'x', x: [-90, 90], y: [-135, 40], z: [-90, 150] },
  // Elbow: a hinge about -Y (forearm folds forward) plus forearm roll.
  leftLowerArm: { twist: 'x', x: [-90, 90], y: [-150, 0], z: [0, 0] },
  leftHand: { twist: 'x', x: [-20, 20], y: [-30, 30], z: [-80, 70] },
  // Leg along -Y. -X swings it forward, +Z out to the side.
  leftUpperLeg: { twist: 'y', x: [-120, 30], y: [-45, 45], z: [-30, 70] },
  // Knee: a hinge about +X (shin folds back).
  leftLowerLeg: { twist: 'y', x: [0, 150], y: [-10, 10], z: [0, 0] },
  // Foot along +Z. +X points the toes down.
  leftFoot: { twist: 'z', x: [-25, 50], y: [-20, 20], z: [-25, 25] },
};

// Mirroring across the body's centre plane keeps rotations about X and negates those about Y and Z.
const neg = ([lo, hi]: Range): Range => [-hi, -lo];
const mirror = (l: JointLimit): JointLimit => ({ twist: l.twist, x: l.x, y: neg(l.y), z: neg(l.z) });

export const LIMITS: Partial<Record<BoneName, JointLimit>> = { ...BASE };
for (const [name, l] of Object.entries(BASE)) {
  if (name.startsWith('left')) LIMITS[name.replace(/^left/, 'right') as BoneName] = mirror(l);
}

const DEG = Math.PI / 180;
const _t = new Quaternion(), _s = new Quaternion(), _v = new Vector3();

/** The twist part of `q` about a unit `axis`, written into `out`. */
export function twistAbout(q: Quaternion, axis: Vector3, out = new Quaternion()): Quaternion {
  const p = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  out.set(axis.x * p, axis.y * p, axis.z * p, q.w);
  return out.lengthSq() < 1e-12 ? out.identity() : out.normalize();
}

/** Clamp a rig-local rotation to `l` in place. */
export function clampRotation(q: Quaternion, l: JointLimit): Quaternion {
  const t = AXES[l.twist];
  twistAbout(q, t, _t);
  if (_t.w < 0) _t.set(-_t.x, -_t.y, -_t.z, -_t.w);
  _s.copy(q).multiply(_t.clone().invert());
  if (_s.w < 0) _s.set(-_s.x, -_s.y, -_s.z, -_s.w);

  // Swing as a rotation vector, measured along the two swing axes.
  const half = Math.acos(Math.min(1, _s.w));
  const sinHalf = Math.sin(half);
  _v.set(_s.x, _s.y, _s.z);
  if (sinHalf > 1e-9) _v.multiplyScalar((2 * half) / sinHalf); else _v.set(0, 0, 0);
  const [a, b] = OTHER[l.twist];
  let sa = _v.dot(AXES[a]), sb = _v.dot(AXES[b]);
  const ra = (sa >= 0 ? l[a][1] : -l[a][0]) * DEG;
  const rb = (sb >= 0 ? l[b][1] : -l[b][0]) * DEG;
  if (ra < 1e-6) sa = 0;
  if (rb < 1e-6) sb = 0;
  const e = (ra > 1e-6 ? (sa / ra) ** 2 : 0) + (rb > 1e-6 ? (sb / rb) ** 2 : 0);
  if (e > 1) { const k = 1 / Math.sqrt(e); sa *= k; sb *= k; }

  const tw = Math.min(Math.max(2 * Math.atan2(_t.x * t.x + _t.y * t.y + _t.z * t.z, _t.w), l[l.twist][0] * DEG), l[l.twist][1] * DEG);
  _v.copy(AXES[a]).multiplyScalar(sa).addScaledVector(AXES[b], sb);
  const ang = _v.length();
  if (ang > 1e-9) _s.setFromAxisAngle(_v.divideScalar(ang), ang); else _s.identity();
  _t.setFromAxisAngle(t, tw);
  return q.copy(_s).multiply(_t);
}

/** Clamp a rig bone to its limit, if it has one. */
export function clampBone(bone: Object3D, name: BoneName): void {
  const l = LIMITS[name];
  if (!l) return;
  clampRotation(bone.quaternion, l);
  bone.updateMatrixWorld(true);
}

/** The hinge axis of a hinge joint in its parent's frame: the swing axis with a non-zero range, signed to bend. */
export function hingeAxis(name: BoneName): Vector3 | null {
  const l = LIMITS[name];
  if (!l) return null;
  for (const ax of OTHER[l.twist]) {
    const [lo, hi] = l[ax];
    if (hi > 0 && lo === 0) return AXES[ax].clone();
    if (lo < 0 && hi === 0) return AXES[ax].clone().negate();
  }
  return null;
}
