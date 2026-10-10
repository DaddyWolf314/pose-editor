// Solvers layered on the rig: settling a limb after the two-bone IK, the spine chain behind the
// chest handle, and the head aim. All work in world space on rig bones and leave matrices current.
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { RigBones } from './body';
import { setWorldQuat } from './ik';
import { clampBone, hingeAxis, twistAbout } from './limits';
import type { Limb, LimbKind } from './skeleton';

const X = new Vector3(1, 0, 0);

/** Where a limb's middle joint should point: elbows back and down, knees forward. World space. */
export function poleFor(bones: RigBones, kind: LimbKind): Vector3 {
  const src = kind === 'arm' ? bones.chest : bones.hips;
  const v = kind === 'arm' ? new Vector3(0, -0.35, -1) : new Vector3(0, 0, 1);
  return v.applyQuaternion(src.getWorldQuaternion(new Quaternion())).normalize();
}

/**
 * After `solveLimb`, make the limb anatomical. The IK keeps whichever way the limb was bent, which from
 * a straight limb can be sideways or backwards, so several swivels of the limb about the line from its
 * root to the target are tried: the IK's own, the one that points the middle joint along `pole`, and
 * every 30 degrees. Swivelling moves no joint but the middle one. Each swivel scores the squared
 * distance its clamped result leaves the end bone from the goal, plus `cost` of the settled limb if
 * given (squared metres too, such as the square of how deep the limb sinks into a prop). The IK's
 * swivel wins whenever it scores nearly zero; otherwise the lowest score wins, the IK's on a tie.
 */
export function settleLimb(bones: RigBones, limb: Limb, endWorld: Quaternion, pole: Vector3, cost?: () => number): void {
  const upper = bones[limb.upper], lower = bones[limb.lower], end = bones[limb.end];
  const A = upper.getWorldPosition(new Vector3());
  const goal = end.getWorldPosition(new Vector3());
  const start = [upper.quaternion.clone(), lower.quaternion.clone(), end.quaternion.clone()];
  const restore = (q: Quaternion[]) => {
    upper.quaternion.copy(q[0]); lower.quaternion.copy(q[1]); end.quaternion.copy(q[2]);
    upper.updateMatrixWorld(true);
  };
  const err = () => end.getWorldPosition(new Vector3()).distanceToSquared(goal) + (cost ? cost() : 0);

  settleSide(bones, limb, endWorld);
  let best = [upper.quaternion.clone(), lower.quaternion.clone(), end.quaternion.clone()];
  let bestErr = err();
  const axis = goal.clone().sub(A);
  if (bestErr < 1e-6 || axis.lengthSq() < 1e-10) return;
  axis.normalize();

  // Swivel that puts the middle joint on the pole side.
  restore(start);
  const b = lower.getWorldPosition(new Vector3()).sub(A);
  b.addScaledVector(axis, -b.dot(axis));
  const p = pole.clone().addScaledVector(axis, -pole.dot(axis));
  const swivels = [];
  if (b.lengthSq() > 1e-10 && p.lengthSq() > 1e-10) swivels.push(Math.atan2(b.clone().cross(p).dot(axis), b.dot(p)));
  for (let k = 1; k < 12; k++) swivels.push((k * Math.PI) / 6);

  const qu = upper.getWorldQuaternion(new Quaternion());
  for (const psi of swivels) {
    restore(start);
    setWorldQuat(upper, new Quaternion().setFromAxisAngle(axis, psi).multiply(qu));
    settleSide(bones, limb, endWorld);
    const e = err();
    if (e < bestErr - 1e-8) { bestErr = e; best = [upper.quaternion.clone(), lower.quaternion.clone(), end.quaternion.clone()]; }
  }
  restore(best);
}

/**
 * Settle one bend side without moving the joints: turn the upper bone about its own axis so the bend
 * lies in the hinge plane, aim the lower bone with no roll, hand the end bone's roll to the forearm,
 * then clamp all three. `endWorld` is the orientation the end bone keeps.
 */
function settleSide(bones: RigBones, limb: Limb, endWorld: Quaternion): void {
  const upper = bones[limb.upper], lower = bones[limb.lower], end = bones[limb.end];
  const A = upper.getWorldPosition(new Vector3()), B = lower.getWorldPosition(new Vector3()), C = end.getWorldPosition(new Vector3());
  const u = B.clone().sub(A).normalize(), f = C.clone().sub(B).normalize();

  const h = hingeAxis(limb.lower);
  const n = u.clone().cross(f);
  if (h && n.lengthSq() > 1e-8) {
    n.normalize();
    const qu = upper.getWorldQuaternion(new Quaternion());
    const hw = h.applyQuaternion(qu);
    hw.addScaledVector(u, -hw.dot(u)).normalize();
    const phi = Math.atan2(hw.clone().cross(n).dot(u), hw.dot(n));
    setWorldQuat(upper, new Quaternion().setFromAxisAngle(u, phi).multiply(qu));
  }

  // The lower bone's rest direction in its parent's frame is the end bone's rest offset.
  const fl = f.clone().applyQuaternion(upper.getWorldQuaternion(new Quaternion()).invert());
  lower.quaternion.setFromUnitVectors(end.position.clone().normalize(), fl);
  lower.updateMatrixWorld(true);
  setWorldQuat(end, endWorld);
  if (limb.kind === 'arm') {
    // Forearm roll (pronation) lives in the forearm, not the wrist.
    lower.quaternion.multiply(twistAbout(end.quaternion, X));
    lower.updateMatrixWorld(true);
    setWorldQuat(end, endWorld);
  }

  clampBone(upper, limb.upper);
  clampBone(lower, limb.lower);
  setWorldQuat(end, endWorld);
  clampBone(end, limb.end);
}

const _id = new Quaternion();

/**
 * Bend spine and chest so the base of the neck moves toward `target`, hips fixed. Damped CCD: each
 * pass turns each bone halfway toward the target, which spreads the bend over both.
 */
export function solveSpine(bones: RigBones, target: Vector3, limits: boolean): void {
  const J = new Vector3(), E = new Vector3();
  for (let it = 0; it < 12; it++) {
    for (const name of ['chest', 'spine'] as const) {
      const bone = bones[name];
      bone.getWorldPosition(J); bones.neck.getWorldPosition(E);
      const from = E.clone().sub(J), to = target.clone().sub(J);
      if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) continue;
      const q = new Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
      const step = _id.clone().slerp(q, 0.5);
      setWorldQuat(bone, step.multiply(bone.getWorldQuaternion(new Quaternion())));
      if (limits) clampBone(bone, name);
    }
    if (bones.neck.getWorldPosition(E).distanceToSquared(target) < 1e-8) break;
  }
}

/** Eye height above the head bone, roughly, in metres. */
const EYE = 0.08;
const NECK_SHARE = 0.4;

/** Turn neck and head so the face looks at `target`, sharing the turn 40/60 and keeping the chest's up. */
export function aimHead(bones: RigBones, target: Vector3, limits: boolean): void {
  const neck = bones.neck, head = bones.head;
  for (let it = 0; it < 2; it++) {
    const qc = bones.chest.getWorldQuaternion(new Quaternion());
    const eye = new Vector3(0, EYE, 0).applyQuaternion(head.getWorldQuaternion(new Quaternion())).add(head.getWorldPosition(new Vector3()));
    const z = target.clone().sub(eye);
    if (z.lengthSq() < 1e-6) return;
    z.normalize();
    const up = new Vector3(0, 1, 0).applyQuaternion(qc);
    const x = up.clone().cross(z);
    if (x.lengthSq() < 1e-8) return;
    x.normalize();
    const y = z.clone().cross(x);
    const qd = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    // Rotation of neck and head together, relative to the chest.
    const delta = qc.invert().multiply(qd);
    neck.quaternion.copy(_id).slerp(delta, NECK_SHARE);
    neck.updateMatrixWorld(true);
    if (limits) clampBone(neck, 'neck');
    head.quaternion.copy(neck.quaternion).invert().multiply(delta);
    head.updateMatrixWorld(true);
    if (limits) clampBone(head, 'head');
  }
}
