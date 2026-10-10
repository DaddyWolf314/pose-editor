// Skeleton definition: VRM humanoid bone names, T-pose, facing +Z, metres.

export const BONE_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

export type Vec3Tuple = [number, number, number];
export interface BoneDef { name: BoneName; parent: BoneName | null; offset: Vec3Tuple }

export const BONES: readonly BoneDef[] = [
  { name: 'hips', parent: null, offset: [0, 0.98, 0] },
  { name: 'spine', parent: 'hips', offset: [0, 0.10, 0] },
  { name: 'chest', parent: 'spine', offset: [0, 0.15, 0] },
  { name: 'neck', parent: 'chest', offset: [0, 0.26, 0] },
  { name: 'head', parent: 'neck', offset: [0, 0.09, 0] },
  { name: 'leftUpperArm', parent: 'chest', offset: [0.19, 0.20, 0] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', offset: [0.28, 0, 0] },
  { name: 'leftHand', parent: 'leftLowerArm', offset: [0.26, 0, 0] },
  { name: 'rightUpperArm', parent: 'chest', offset: [-0.19, 0.20, 0] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', offset: [-0.28, 0, 0] },
  { name: 'rightHand', parent: 'rightLowerArm', offset: [-0.26, 0, 0] },
  { name: 'leftUpperLeg', parent: 'hips', offset: [0.095, -0.05, 0] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', offset: [0, -0.43, 0] },
  { name: 'leftFoot', parent: 'leftLowerLeg', offset: [0, -0.43, 0] },
  { name: 'rightUpperLeg', parent: 'hips', offset: [-0.095, -0.05, 0] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', offset: [0, -0.43, 0] },
  { name: 'rightFoot', parent: 'rightLowerLeg', offset: [0, -0.43, 0] },
];

/** Each bone's offset from its parent in the rest (T) pose, in figure-root axes. */
export type RestOffsets = Record<BoneName, Vec3Tuple>;

/** Rest offsets of the procedural mannequin. A VRM model supplies its own. */
export const REST: RestOffsets = Object.fromEntries(BONES.map(b => [b.name, b.offset])) as RestOffsets;

export type LimbEnd = 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot';
export type LimbKind = 'arm' | 'leg';
export interface Limb { upper: BoneName; lower: BoneName; end: BoneName; kind: LimbKind }

export const LIMBS: Record<LimbEnd, Limb> = {
  leftHand: { upper: 'leftUpperArm', lower: 'leftLowerArm', end: 'leftHand', kind: 'arm' },
  rightHand: { upper: 'rightUpperArm', lower: 'rightLowerArm', end: 'rightHand', kind: 'arm' },
  leftFoot: { upper: 'leftUpperLeg', lower: 'leftLowerLeg', end: 'leftFoot', kind: 'leg' },
  rightFoot: { upper: 'rightUpperLeg', lower: 'rightLowerLeg', end: 'rightFoot', kind: 'leg' },
};

export const LABEL: Record<BoneName, string> = {
  hips: 'hips', spine: 'lower spine', chest: 'chest', neck: 'neck', head: 'head',
  leftUpperArm: 'left upper arm', leftLowerArm: 'left forearm', leftHand: 'left hand',
  rightUpperArm: 'right upper arm', rightLowerArm: 'right forearm', rightHand: 'right hand',
  leftUpperLeg: 'left thigh', leftLowerLeg: 'left shin', leftFoot: 'left foot',
  rightUpperLeg: 'right thigh', rightLowerLeg: 'right shin', rightFoot: 'right foot',
};

/** Pastel figure colours, offered in the panel and given to new figures in turn. */
export const COLORS = [
  { name: 'Peach', hex: '#f6c3a1' },
  { name: 'Baby blue', hex: '#a9c8ec' },
  { name: 'Mint', hex: '#b5e2b8' },
  { name: 'Lavender', hex: '#c9b8e8' },
  { name: 'Rose', hex: '#f3b3c6' },
  { name: 'Aqua', hex: '#a6dcd6' },
  { name: 'Butter', hex: '#f4e1a1' },
  { name: 'Coral', hex: '#f2a99f' },
  { name: 'Lilac', hex: '#e2b6e4' },
  { name: 'Sage', hex: '#cad7b0' },
] as const;
export const PALETTE: readonly string[] = COLORS.map(c => c.hex);
