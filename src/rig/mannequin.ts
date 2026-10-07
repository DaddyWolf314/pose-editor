// Procedural mannequin: simple primitives parented to each rig bone.
import {
  BoxGeometry, CylinderGeometry, Mesh, MeshStandardMaterial, SphereGeometry, Vector3, type Box3, type Intersection,
} from 'three';
import { MANNEQUIN_ID, type Body, type RigBones } from './body';
import { BONES, REST, type BoneName, type Vec3Tuple } from './skeleton';

function cyl(r0: number, r1: number, to: Vec3Tuple): Mesh {
  const v = new Vector3(to[0], to[1], to[2]), len = v.length();
  const m = new Mesh(new CylinderGeometry(r1, r0, len, 18));
  m.position.copy(v).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), v.clone().normalize());
  return m;
}
function ball(r: number, at?: Vec3Tuple | null, scale?: Vec3Tuple): Mesh {
  const m = new Mesh(new SphereGeometry(r, 22, 16));
  if (at) m.position.set(at[0], at[1], at[2]);
  if (scale) m.scale.set(scale[0], scale[1], scale[2]);
  return m;
}
function box(size: Vec3Tuple, at: Vec3Tuple): Mesh {
  const m = new Mesh(new BoxGeometry(size[0], size[1], size[2]));
  m.position.set(at[0], at[1], at[2]);
  return m;
}

function partsFor(name: BoneName): Mesh[] {
  const s = name.startsWith('right') ? -1 : 1;
  switch (name.replace(/^(left|right)/, '')) {
    case 'hips': return [ball(0.13, null, [1.3, 0.85, 0.95])];
    case 'spine': { const c = cyl(0.10, 0.11, [0, 0.15, 0]); c.scale.x = 1.25; return [c]; }
    case 'chest': return [ball(0.16, [0, 0.12, 0], [1.25, 1.05, 0.8])];
    case 'neck': return [cyl(0.045, 0.04, [0, 0.09, 0])];
    case 'head': return [ball(0.105, [0, 0.12, 0], [0.88, 1.12, 1]), box([0.025, 0.03, 0.03], [0, 0.10, 0.105])];
    case 'UpperArm': return [ball(0.055), cyl(0.05, 0.04, [s * 0.28, 0, 0])];
    case 'LowerArm': return [ball(0.042), cyl(0.04, 0.032, [s * 0.26, 0, 0])];
    case 'Hand': return [ball(0.034), box([0.10, 0.03, 0.075], [s * 0.065, 0, 0])];
    case 'UpperLeg': return [ball(0.075), cyl(0.072, 0.052, [0, -0.43, 0])];
    case 'LowerLeg': return [ball(0.054), cyl(0.052, 0.04, [0, -0.43, 0])];
    case 'Foot': return [ball(0.044), box([0.095, 0.06, 0.24], [0, -0.04, 0.07])];
  }
  return [];
}

/** The procedural mannequin: primitives parented straight to the rig bones. */
export class MannequinBody implements Body {
  readonly modelId = MANNEQUIN_ID;
  readonly rest = REST;
  readonly pickables: Mesh[] = [];
  private meshes = {} as Record<BoneName, Mesh[]>;
  private mat: MeshStandardMaterial;
  private matSel: MeshStandardMaterial;

  constructor(bones: RigBones, color: string) {
    this.mat = new MeshStandardMaterial({ color, roughness: 0.78, metalness: 0 });
    this.matSel = new MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, emissive: 0xffb000, emissiveIntensity: 0.45 });
    for (const def of BONES) {
      this.meshes[def.name] = partsFor(def.name);
      for (const m of this.meshes[def.name]) {
        m.material = this.mat;
        m.userData.bone = def.name;
        bones[def.name].add(m); this.pickables.push(m);
      }
    }
  }

  boneAt(hit: Intersection): BoneName | null {
    return (hit.object.userData.bone as BoneName | undefined) ?? null;
  }

  setHighlight(bone: BoneName | null): void {
    for (const def of BONES) this.meshes[def.name].forEach(m => { m.material = def.name === bone ? this.matSel : this.mat; });
  }

  update(): void {}

  bounds(target: Box3): Box3 {
    target.makeEmpty();
    this.pickables.forEach(m => target.expandByObject(m));
    return target;
  }

  dispose(): void {
    this.pickables.forEach(m => { m.removeFromParent(); m.geometry.dispose(); });
    this.mat.dispose(); this.matSel.dispose();
  }
}
