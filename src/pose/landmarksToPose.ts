// Turn 3D body landmarks into rig rotations: aim each bone along its parent-to-child landmark
// direction, take twist from the elbow/knee bend plane and the hand and foot landmarks, build the
// torso from the shoulder and hip pairs and spread it along the spine, then clamp to joint limits.
import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import type { RigBones } from '../rig/body';
import { poleFor, settleLimb } from '../rig/chains';
import { rotateWorld, setWorldQuat } from '../rig/ik';
import { clampBone } from '../rig/limits';
import { BONES, LIMBS, REST, type BoneName, type LimbEnd } from '../rig/skeleton';
import type { FigureData, QuatTuple } from '../scene/sceneData';

/** Body points in scene axes (X = the person's left when facing +Z, Y up), in metres. */
export interface BodyPoints {
  nose: Vector3;
  leftEar: Vector3; rightEar: Vector3;
  leftShoulder: Vector3; rightShoulder: Vector3;
  leftElbow: Vector3; rightElbow: Vector3;
  leftWrist: Vector3; rightWrist: Vector3;
  leftIndex: Vector3; rightIndex: Vector3;
  leftPinky: Vector3; rightPinky: Vector3;
  leftHip: Vector3; rightHip: Vector3;
  leftKnee: Vector3; rightKnee: Vector3;
  leftAnkle: Vector3; rightAnkle: Vector3;
  leftHeel: Vector3; rightHeel: Vector3;
  leftToe: Vector3; rightToe: Vector3;
}

export interface PoseFromPoints {
  pose: FigureData['pose'];
  /** Facing of the figure root about +Y, from the hips. */
  ry: number;
}

/** Rotation with X along `x`, Z = X cross `up` (forward when `up` is up), and Y completing the frame. */
function frame(x: Vector3, up: Vector3): Quaternion {
  const X = x.clone().normalize();
  const Z = X.clone().cross(up).normalize();
  const Y = Z.clone().cross(X);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(X, Y, Z));
}

const mid = (a: Vector3, b: Vector3) => a.clone().add(b).multiplyScalar(0.5);

function bareRig(): { root: Group; bones: RigBones } {
  const root = new Group();
  const bones = {} as RigBones;
  for (const def of BONES) {
    const b = new Group();
    b.position.fromArray(REST[def.name]);
    (def.parent ? bones[def.parent] : root).add(b);
    bones[def.name] = b;
  }
  root.updateMatrixWorld(true);
  return { root, bones };
}

export function poseFromPoints(p: BodyPoints): PoseFromPoints {
  const { root, bones } = bareRig();
  const hipMid = mid(p.leftHip, p.rightHip), shoulderMid = mid(p.leftShoulder, p.rightShoulder);
  const up = shoulderMid.clone().sub(hipMid);

  // Torso: chest from the shoulder pair, hips from the hip pair, spine halfway between. Hip landmarks
  // sit inside the body and their depth is poor, so the hips' facing is blended with the shoulders';
  // their tilt (one hip higher than the other) is kept as detected.
  const shoulderX = p.leftShoulder.clone().sub(p.rightShoulder);
  const hipX = p.leftHip.clone().sub(p.rightHip);
  const flat = (v: Vector3) => new Vector3(v.x, 0, v.z).normalize();
  const hipFlat = Math.hypot(hipX.x, hipX.z);
  const hipFacing = flat(flat(hipX).add(flat(shoulderX))).multiplyScalar(hipFlat).setY(hipX.y);
  const qHips = frame(hipFacing, up);
  const qChest = frame(shoulderX, up);
  const fwd = new Vector3(0, 0, 1).applyQuaternion(qHips);
  const ry = Math.atan2(fwd.x, fwd.z);
  root.rotation.y = ry;
  root.updateMatrixWorld(true);
  setWorldQuat(bones.hips, qHips);
  setWorldQuat(bones.spine, qHips.clone().slerp(qChest, 0.5));
  clampBone(bones.spine, 'spine');
  setWorldQuat(bones.chest, qChest);
  clampBone(bones.chest, 'chest');

  // Head from the ears and nose; the neck takes half of the turn from the chest.
  const earAxis = p.leftEar.clone().sub(p.rightEar);
  const faceFwd = p.nose.clone().sub(mid(p.leftEar, p.rightEar));
  const qHead = frame(earAxis, faceFwd.cross(earAxis));
  setWorldQuat(bones.neck, bones.chest.getWorldQuaternion(new Quaternion()).slerp(qHead, 0.5));
  clampBone(bones.neck, 'neck');
  setWorldQuat(bones.head, qHead);
  clampBone(bones.head, 'head');

  const aim = (bone: BoneName, child: BoneName, from: Vector3, to: Vector3) => {
    const b = bones[bone];
    const cur = bones[child].getWorldPosition(new Vector3()).sub(b.getWorldPosition(new Vector3()));
    const want = to.clone().sub(from);
    if (cur.lengthSq() > 1e-10 && want.lengthSq() > 1e-10) rotateWorld(b, cur.normalize(), want.normalize());
  };

  const limb = (end: LimbEnd, a: Vector3, b: Vector3, c: Vector3, endWorld: Quaternion) => {
    const L = LIMBS[end];
    aim(L.upper, L.lower, a, b);
    aim(L.lower, L.end, b, c);
    settleLimb(bones, L, endWorld, poleFor(bones, L.kind));
  };

  for (const side of ['left', 'right'] as const) {
    const s = side === 'left' ? 1 : -1;
    const P = (k: string) => p[(side + k) as keyof BodyPoints];
    // Hand: fingers along the bone (+X on the left, -X on the right), back of the hand up in the T-pose.
    const wrist = P('Wrist'), index = P('Index'), pinky = P('Pinky');
    const fingers = mid(index, pinky).sub(wrist);
    const back = index.clone().sub(wrist).cross(pinky.clone().sub(wrist)).multiplyScalar(s);
    const handX = fingers.multiplyScalar(s);
    limb((side + 'Hand') as LimbEnd, P('Shoulder'), P('Elbow'), wrist, frame(handX, back));
    // Foot: heel to toe is forward, sideways from the hips.
    const toeDir = P('Toe').clone().sub(P('Heel'));
    const hipX = new Vector3(1, 0, 0).applyQuaternion(qHips);
    const footUp = toeDir.clone().cross(hipX);
    limb((side + 'Foot') as LimbEnd, P('Hip'), P('Knee'), P('Ankle'), frame(footUp.clone().cross(toeDir), footUp));
  }

  // The root carries the facing, so the hips keep only their tilt relative to it.
  const pose: FigureData['pose'] = {};
  for (const def of BONES) pose[def.name] = bones[def.name].quaternion.toArray() as QuatTuple;
  return { pose, ry };
}
