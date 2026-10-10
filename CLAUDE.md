# Pose editor

`HANDOFF.md` is the brief and the numbered build plan; read it before starting a build step. `pose-tool.html` is the prototype and the reference for behaviour.

## Architecture

- three.js code lives in plain modules (`src/rig/`, `src/scene/`). React (`src/ui/`, `App.tsx`) renders only the panel, hint and JSON sheet, reading `Editor`'s UI snapshot through `useSyncExternalStore`.
- Each figure has a **pose rig**: one `Group` per bone, identity rotations in the T-pose, facing +Z. IK, gizmos, picking results and scene data act on the rig only. The **body** (`src/rig/body.ts`: `MannequinBody` or `VrmBody`) follows the rig in `update()`, called every frame. New body types implement `Body`, leaving the rig untouched.
- `VrmBody` drives three-vrm's *normalized* bones. VRM 0.x scenes are rotated 180° about Y, so rig rotations are conjugated into model axes (`r⁻¹·q·r`). Each figure gets a `SkeletonUtils.clone` of a loaded template with a fresh `VRMHumanoid`; geometry is shared, so only the cloned skeletons and the figure's own material are disposed. Every VRM is drawn in one matte material in the figure's colour; model textures are deliberately unused. Bundled models are pre-stripped by `scripts/strip-vrm.mjs`, which must keep the file a valid VRM 0.x (it rewrites the GLB by hand, since generic glTF tools drop the `VRM` extension).
- Scene state is three.js objects, serialized on demand to `SceneData` (`src/scene/sceneData.ts`, version 3). Undo is a stack of those JSON snapshots. `hips` is an offset from the body's rest hips position, so a pose survives a body swap. Bump the version and extend `migrateScene` when changing the format.
- `src/rig/ik.ts` between `IK-BEGIN` and `IK-END` is the prototype's numerically tested solver. Keep that block verbatim; add new solvers or constraints outside it.
- Joint limits (`src/rig/limits.ts`) are swing/twist ranges per bone in rig axes, defined for the left side and mirrored. With limits on, every limb solve runs `settleLimb` (`src/rig/chains.ts`) after `solveLimb`. It aligns the hinge, picks the limb swivel, then clamps. Gizmo rotations clamp the rotated bone. The chest handle (`solveSpine`) and look target (`aimHead`, applied every frame) clamp as they go. With "Joint limits" off, limbs behave exactly like the prototype.

- Props (`src/props/`): `catalog.ts` defines each kind as size parameters plus a function returning axis-aligned boxes in prop space (origin on the floor, front facing +Z); the same boxes are meant to drive rendering and collision. All props share one unit `BoxGeometry` and one theme-coloured material (`PropKit`), so disposing a prop only detaches it. A selection is either a figure selection or `{ kind: 'prop' }`; selecting a prop leaves the active figure alone. `collide.ts` is the collision core: signed distances to solid boxes and the floor, sphere push-out, support height and capsule depth. It imports nothing relative so Node can run its tests directly. With "Collisions" on, `contact.ts` covers a figure with spheres sized by `Body.radii` (measured for the mannequin, scaled by hip height for VRMs). Hand, foot and hips handles drive their joint by `sweepSphere` from where the joint is, so it stops on a surface instead of passing through a thin seat; pinned feet are not projected. "Drop to surface" takes the smaller of the body-bounds gap to the floor and the sphere gap to prop tops. Rebuild the cached `Colliders` (`Editor.solids = null`) whenever a prop moves, resizes, or is added or removed.

- Photo import (`src/pose/`): `PoseEstimator` returns people in scene-data terms (`pose`, `root`, `hips`) plus the assumed `PhotoCamera`, so another estimator can replace MediaPipe without touching the editor. `MediaPipeEstimator` handles detection and placement (level camera, assumed field of view, distance from bone lengths, feet on the floor). `poseFromPoints` turns 3D body points into rig rotations on a bare mannequin rig, reusing `settleLimb` for twist and limits. MediaPipe loads lazily on first import.

## Conventions and gotchas

- `tsconfig` has `erasableSyntaxOnly`: write explicit fields instead of constructor parameter properties, and avoid enums.
- three.js is r186: `TransformControls` is added via `getHelper()`; lights are physically based, so prototype intensities are multiplied by π.
- MediaPipe's WASM comes from the npm package via `?url` imports; the model file is in `public/models/`. `vite.config.ts` pre-bundles `@mediapipe/tasks-vision`, since a lazily imported dependency otherwise triggers a full page reload in dev.
- `Stage` creates `TransformControls` before `Editor` adds its canvas pointer listeners, so `tc.axis` is current when click-picking runs. Keep that order.

## Verifying

`npm run build` type-checks and builds. `npm test` runs `src/**/*.test.ts` with Node's own runner (no extra dependencies). Test files are type-checked by `tsconfig.node.json`, and must import with `.ts` extensions. For behaviour, run `npm run dev` and check the change in the browser against the prototype; console errors count as failures.
