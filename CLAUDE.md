# Pose editor

`HANDOFF.md` is the brief and the numbered build plan; read it before starting a build step. `pose-tool.html` is the prototype and the reference for behaviour.

## Architecture

- three.js code lives in plain modules (`src/rig/`, `src/scene/`). React (`src/ui/`, `App.tsx`) renders only the panel, hint and JSON sheet, reading `Editor`'s UI snapshot through `useSyncExternalStore`.
- Each figure has a **pose rig**: one `Group` per bone, identity rotations in the T-pose, facing +Z. IK, gizmos, picking results and scene data act on the rig only. The **body** (`src/rig/body.ts`: `MannequinBody` or `VrmBody`) follows the rig in `update()`, called every frame. New body types implement `Body`, leaving the rig untouched.
- `VrmBody` drives three-vrm's *normalized* bones. VRM 0.x scenes are rotated 180° about Y, so rig rotations are conjugated into model axes (`r⁻¹·q·r`). Each figure gets a `SkeletonUtils.clone` of a loaded template with a fresh `VRMHumanoid`; geometry, materials and textures are shared, so only the cloned skeletons are disposed.
- Scene state is three.js objects, serialized on demand to `SceneData` (`src/scene/sceneData.ts`, version 2). Undo is a stack of those JSON snapshots. `hips` is an offset from the body's rest hips position, so a pose survives a body swap. Bump the version and extend `migrateScene` when changing the format.
- `src/rig/ik.ts` between `IK-BEGIN` and `IK-END` is the prototype's numerically tested solver. Keep that block verbatim; add new solvers or constraints outside it.
- Joint limits (`src/rig/limits.ts`) are swing/twist ranges per bone in rig axes, defined for the left side and mirrored. With limits on, every limb solve runs `settleLimb` (`src/rig/chains.ts`) after `solveLimb`. It aligns the hinge, picks the limb swivel, then clamps. Gizmo rotations clamp the rotated bone. The chest handle (`solveSpine`) and look target (`aimHead`, applied every frame) clamp as they go. With "Joint limits" off, limbs behave exactly like the prototype.

- Photo import (`src/pose/`): `PoseEstimator` returns people in scene-data terms (`pose`, `root`, `hips`) plus the assumed `PhotoCamera`, so another estimator can replace MediaPipe without touching the editor. `MediaPipeEstimator` handles detection and placement (level camera, assumed field of view, distance from bone lengths, feet on the floor). `poseFromPoints` turns 3D body points into rig rotations on a bare mannequin rig, reusing `settleLimb` for twist and limits. MediaPipe loads lazily on first import.

## Conventions and gotchas

- `tsconfig` has `erasableSyntaxOnly`: write explicit fields instead of constructor parameter properties, and avoid enums.
- three.js is r186: `TransformControls` is added via `getHelper()`; lights are physically based, so prototype intensities are multiplied by π.
- MediaPipe's WASM comes from the npm package via `?url` imports; the model file is in `public/models/`. `vite.config.ts` pre-bundles `@mediapipe/tasks-vision`, since a lazily imported dependency otherwise triggers a full page reload in dev.
- `Stage` creates `TransformControls` before `Editor` adds its canvas pointer listeners, so `tc.axis` is current when click-picking runs. Keep that order.

## Verifying

`npm run build` type-checks and builds. For behaviour, run `npm run dev` and check the change in the browser against the prototype; console errors count as failures.
