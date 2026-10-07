// A body is what a figure looks like. The figure owns a pose rig (one Group per bone, identity
// rotations in the T-pose, facing +Z) and the body follows it. IK, gizmos and scene data only ever
// touch the rig, so the same pose data drives the procedural mannequin and any VRM model.
import {
  CylinderGeometry, Mesh, MeshBasicMaterial, Vector3, type Box3, type Group, type Intersection, type Object3D,
} from 'three';
import type { BoneName, RestOffsets, Vec3Tuple } from './skeleton';

export const MANNEQUIN_ID = 'mannequin';

export type RigBones = Record<BoneName, Group>;

export interface Body {
  /** Model id this body shows: MANNEQUIN_ID or a model library id. */
  readonly modelId: string;
  readonly rest: RestOffsets;
  /** Meshes a click can hit. */
  readonly pickables: Object3D[];
  /** Which rig bone a ray hit on one of `pickables` belongs to. */
  boneAt(hit: Intersection): BoneName | null;
  setHighlight(bone: BoneName | null): void;
  /** Copy the rig pose into the body. Called every frame and before raycasts or bounds. */
  update(): void;
  /** World-space bounds of the posed body. Call `update` first. */
  bounds(target: Box3): Box3;
  dispose(): void;
}

// The bone a marker points along: its main child, or a fixed stub for end bones.
const MARKER_TO: Record<BoneName, BoneName | Vec3Tuple> = {
  hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head', head: [0, 0.2, 0],
  leftUpperArm: 'leftLowerArm', leftLowerArm: 'leftHand', leftHand: [0.1, 0, 0],
  rightUpperArm: 'rightLowerArm', rightLowerArm: 'rightHand', rightHand: [-0.1, 0, 0],
  leftUpperLeg: 'leftLowerLeg', leftLowerLeg: 'leftFoot', leftFoot: [0, -0.06, 0.14],
  rightUpperLeg: 'rightLowerLeg', rightLowerLeg: 'rightFoot', rightFoot: [0, -0.06, 0.14],
};

/** An always-on-top capsule along a rig bone, for bodies that cannot tint one body part. */
export class BoneMarker {
  private mesh = new Mesh(new CylinderGeometry(0.028, 0.028, 1, 12),
    new MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.55, depthTest: false }));

  private bones: RigBones;
  private rest: RestOffsets;

  constructor(bones: RigBones, rest: RestOffsets) {
    this.bones = bones; this.rest = rest;
    this.mesh.renderOrder = 9;
    this.mesh.raycast = () => {};
  }

  show(bone: BoneName | null): void {
    this.mesh.removeFromParent();
    if (!bone) return;
    const to = MARKER_TO[bone];
    const v = new Vector3(...(typeof to === 'string' ? this.rest[to] : to));
    const len = Math.max(v.length(), 0.02);
    this.mesh.scale.set(1, len, 1);
    this.mesh.position.copy(v).multiplyScalar(0.5);
    this.mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), v.normalize());
    this.bones[bone].add(this.mesh);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
  }
}
