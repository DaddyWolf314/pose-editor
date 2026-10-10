// Figures meeting props: a figure is covered by spheres on its rig, using the body's radii, and the
// collision core decides how they touch. World space throughout; call `updateMatrixWorld` first.
import { Quaternion, Vector3 } from 'three';
import type { BoneRadii, RigBones } from '../rig/body';
import { BONES } from '../rig/skeleton';
import type { Prop } from './prop';
import { Colliders } from './collide';

export interface Sphere { c: Vector3; r: number }

/** Colliders for the props as they are now, with the floor. */
export function collidersFor(props: readonly Prop[]): Colliders {
  return new Colliders(props.map(p => {
    p.root.updateMatrixWorld();
    return { matrix: p.root.matrixWorld, boxes: p.boxes };
  }));
}

/**
 * Spheres over a posed figure: one on each joint, one halfway along each bone (sized for the bone it
 * runs along), and one at the middle of the head, which sits above its joint.
 */
export function bodySpheres(bones: RigBones, radii: BoneRadii): Sphere[] {
  const out: Sphere[] = [];
  for (const def of BONES) {
    const c = bones[def.name].getWorldPosition(new Vector3());
    out.push({ c, r: radii[def.name] });
    if (def.parent) {
      const from = bones[def.parent].getWorldPosition(new Vector3());
      out.push({ c: from.lerp(c, 0.5), r: radii[def.parent] });
    }
  }
  const head = bones.head, r = radii.head;
  out.push({ c: new Vector3(0, r, 0).applyQuaternion(head.getWorldQuaternion(new Quaternion())).add(head.getWorldPosition(new Vector3())), r });
  return out;
}

/**
 * How far the figure can move straight down before a sphere rests on a prop under it; Infinity when no
 * prop is under any sphere. The floor is left out: the body's exact bounds meet it better than spheres.
 * Negative when a sphere already sits below its surface. A sphere whose centre has sunk past a top face
 * no longer finds that face, so this suits figures that are roughly clear, as the contact hooks keep them.
 */
export function dropGap(spheres: readonly Sphere[], colliders: Colliders): number {
  let gap = Infinity;
  for (const s of spheres) {
    const top = colliders.supportBelow(s.c);
    if (top > 0) gap = Math.min(gap, s.c.y - s.r - top);
  }
  return gap;
}
