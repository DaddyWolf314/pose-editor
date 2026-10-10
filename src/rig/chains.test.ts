// Numeric tests for limb clearance: settleLimb's cost steering the elbow out of a prop. Run with `npm test`.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import { Colliders } from '../props/collide.ts';
import { limbDepth } from '../props/contact.ts';
import { MANNEQUIN_RADII, type RigBones } from './body.ts';
import { poleFor, settleLimb } from './chains.ts';
import { solveLimb } from './ik.ts';
import { BONES, LIMBS, REST } from './skeleton.ts';

/** A bare mannequin rig in the T-pose at the origin. */
function rig(): RigBones {
  const root = new Group();
  const bones = {} as RigBones;
  for (const def of BONES) {
    const b = new Group();
    b.position.fromArray(REST[def.name]);
    (def.parent ? bones[def.parent] : root).add(b);
    bones[def.name] = b;
  }
  root.updateMatrixWorld(true);
  return bones;
}

const ARM = LIMBS.leftHand;

/** What the editor's `reach` does with limits on, with an optional collider for the cost. */
function reach(bones: RigBones, target: Vector3, solids?: Colliders): void {
  const keep = bones.leftHand.getWorldQuaternion(new Quaternion());
  const hint = poleFor(bones, 'arm');
  solveLimb(bones[ARM.upper], bones[ARM.lower], bones[ARM.end], target, hint);
  settleLimb(bones, ARM, keep, hint, solids ? () => limbDepth(bones, MANNEQUIN_RADII, ARM, solids) ** 2 : undefined);
}

const pos = (bones: RigBones, k: keyof RigBones) => bones[k].getWorldPosition(new Vector3());

/** A reachable target in front of and below the left shoulder, so the elbow bends. */
function target(bones: RigBones): Vector3 {
  return pos(bones, 'leftUpperArm').add(new Vector3(0.15, -0.25, 0.3));
}

/** A small solid cube centred on `c`, with no floor. */
function cubeAt(c: Vector3, half: number): Colliders {
  return new Colliders([{ matrix: new Matrix4().makeTranslation(c), boxes: [{ center: [0, 0, 0], half: [half, half, half], solid: true }] }], false);
}

describe('settleLimb with a clearance cost', () => {
  test('a cost that is always zero changes nothing', () => {
    const a = rig(), b = rig();
    reach(a, target(a));
    reach(b, target(b), new Colliders([], false));
    for (const k of [ARM.upper, ARM.lower, ARM.end] as const) {
      assert.ok(a[k].quaternion.angleTo(b[k].quaternion) < 1e-9, k);
    }
  });

  test('the elbow swivels out of a box where it would have been, and the hand still reaches', () => {
    const free = rig();
    const goal = target(free);
    reach(free, goal);
    const elbow = pos(free, 'leftLowerArm');
    assert.ok(pos(free, 'leftHand').distanceTo(goal) < 1e-3, 'reaches without the box');

    // A 10 cm cube on the elbow, clear of the shoulder and the hand.
    const solids = cubeAt(elbow, 0.05);
    assert.ok(limbDepth(free, MANNEQUIN_RADII, ARM, solids) > 0.05, 'the free pose is inside the box');

    const steered = rig();
    reach(steered, goal, solids);
    assert.equal(limbDepth(steered, MANNEQUIN_RADII, ARM, solids), 0, 'the arm clears the box');
    assert.ok(pos(steered, 'leftHand').distanceTo(goal) < 1e-3, 'the hand still reaches');
    assert.ok(pos(steered, 'leftLowerArm').distanceTo(elbow) > 0.1, 'the elbow moved');
  });

  test('with no clear swivel, the shallowest one wins', () => {
    const free = rig();
    const goal = target(free);
    reach(free, goal);
    // A cube around the whole arm leaves every swivel inside; the result must be no deeper than the IK's.
    const solids = cubeAt(pos(free, 'leftLowerArm'), 0.6);
    const before = limbDepth(free, MANNEQUIN_RADII, ARM, solids);
    const steered = rig();
    reach(steered, goal, solids);
    assert.ok(limbDepth(steered, MANNEQUIN_RADII, ARM, solids) <= before + 1e-9);
  });
});
