# Pose Reference Tool: handoff brief

A personal, browser-only tool for posing one or more 3D mannequins with inverse kinematics, used as drawing and photo reference. Poses can be started from a photograph and corrected by hand.

`pose-tool.html` (alongside this file) is a working single-file prototype. Port its behaviour into a proper local project, then add what it lacks.

## Decisions already made

- Personal use only. No backend in this version; everything runs in the browser.
- Stack: Vite, React, TypeScript, three.js, `@pixiv/three-vrm` for the mannequin.
- Desktop-first with mouse controls.
- Multiple figures in one scene is a first-version requirement.
- Out of scope for now: finger posing, sharing, camera and lighting controls.
- Photo import uses MediaPipe Pose Landmarker in the browser. A server-side mesh-recovery estimator may come later, so keep estimation behind an interface.

## What the prototype already does

- Procedural mannequin whose bones use VRM humanoid names (`hips`, `spine`, `chest`, `neck`, `head`, `left/rightUpperArm`, `LowerArm`, `Hand`, `UpperLeg`, `LowerLeg`, `Foot`), T-pose, facing +Z.
- Click a body part to rotate it with a gizmo (three.js `TransformControls`, local space).
- Analytic two-bone IK for arms and legs, driven by draggable handles on hands and feet. See `solveLimb`, `rotateWorld`, `setWorldQuat` between the `IK-BEGIN` and `IK-END` markers. The solver keeps the current bend direction and falls back to a hint vector when the limb is straight. This code is numerically tested; port it as is.
- Hips handle (move or rotate) with the feet optionally pinned by re-solving both legs.
- Multiple figures: add, duplicate, delete, select by click, floor ring to move or turn a figure.
- Scene state as plain JSON: per figure, a root transform, a hips position, and a map of bone name to quaternion. Undo is a stack of JSON snapshots. Autosaves to `localStorage`.

## Build steps

1. **Scaffold** the Vite, React and TypeScript project. Keep three.js code in plain modules (scene, figure, IK, selection) and use React only for the panel UI. Hold scene state in a serializable store, as the prototype does.
2. **Port the prototype** with the procedural mannequin first, and confirm feature parity in the browser before changing anything.
3. **Swap in a VRM mannequin.** Drive the pose through the humanoid's normalized bones so the same bone-name-to-quaternion data works. Keep the procedural mannequin as a fallback when no model is loaded. Add a file picker so a `.vrm` can be loaded from disk.
4. **Finish the rig.** Add per-bone joint limits applied after every solve, a chest handle that drives the spine as a short constrained chain, and a head look-at target.
5. **Photo import.**
   - Define `PoseEstimator`: takes an image, returns a list of people, each with bone rotations and a root position.
   - Implement it with MediaPipe Pose Landmarker (`@mediapipe/tasks-vision`), multiple poses enabled, using the world landmarks.
   - Convert landmarks to rotations: aim each bone along the parent-to-child landmark direction, solve twist separately (elbow bend plane for the upper arm, hand landmarks for the forearm), build torso orientation from the shoulder and hip pairs and spread it along the spine, then clamp to joint limits.
   - Spawn one figure per detected person at its estimated position, and show the photo as a backdrop for correcting by eye.
6. **Props with planar collision.** Simple furniture (chair, bed, stool, bench, table, box) that figures can sit, lie, stand and lean on. This is a posing aid, not physics: no per-frame simulation and no physics engine.
   - **Data.** Scene data version 3 adds `props: PropData[]`, each with `id`, `kind`, `root: { x, y, z, ry }` (`y` allows stacking) and optional `size` overrides. `migrateScene` adds `props: []` to version 2 scenes. Undo, autosave and the JSON sheet pick props up through `sceneData()` and `loadScene()`.
   - **Catalog** (`src/props/catalog.ts`). Each kind is a function of its size parameters that returns axis-aligned boxes in prop space: `{ center, half, solid }`. The same boxes drive both rendering and collision. Boxes that are visible but should not collide, such as chair legs, set `solid: false`.
   - **Prop objects** (`src/props/prop.ts`). Follow `figure.ts`: `createProp`, `disposeProp`, `propData`. Each prop is a root `Group` with one matte mesh per box, coloured to match the theme.
   - **Collision core** (`src/props/collide.ts`). Pure math with no editor dependencies, tested numerically like the IK. Each solid box is six planes. A sphere is pushed out of a box (inflated by the radius) along the axis of least penetration. `supportBelow(p)` returns the highest upward-facing surface under a point; the floor counts as the plane y = 0. `capsuleDepth` gives a capsule's penetration, used as a cost rather than a hard constraint. Query points are transformed into prop space, so rotated props are free.
   - **Body thickness.** Collision acts on the rig, not the body. Add `radii: Record<BoneName, number>` to `Body`: `MannequinBody` takes them from its geometry, and `VrmBody` from a fixed table scaled by the model's rest height.
   - **Where collision applies:**
     - Hand and foot IK targets are pushed out of solids before `reach()`, so a hand lands on a table.
     - The pelvis sphere is pushed out when the hips handle moves, before `pinFeetOf`. This is how a figure sits.
     - `settleLimb` takes an optional cost callback that adds limb capsule penetration to its swivel error, so knees and elbows clear seats when some swivel allows it.
     - "Drop to floor" becomes "drop to surface": lower the figure by the smallest gap between its low points (feet, hips, hands) and `supportBelow`.
     - Bone gizmo rotations and the chest handle are not collided in this version.
   - **Collisions toggle.** Sits next to "Joint limits". With it off, the editor behaves exactly as before this step.
   - **Editor and UI.**
     - `Selection` splits into figure and prop variants.
     - Clicking a prop gives a gizmo like the floor ring's: move across the floor (with a way to lift for stacking) or turn about Y.
     - In `pickAt`, handles still win; after that, props are tested in the same ray cast as bodies.
     - A "Props" section in the panel has an add dropdown, a list with select and delete, size sliders for the selected prop, and the Collisions checkbox.
     - `hintText` gets prop lines.
   - **Build order:**
     1. Static props (data, rendering, picking, gizmo, panel, undo).
     2. The collision core and its numeric tests.
     3. IK target and hips projection, drop to surface, the toggle. Check in the browser by sitting a figure on a chair with feet pinned, laying one on a bed, and putting a hand on a table.
     4. Limb clearance through `settleLimb`.
   - Later: figure-to-figure contact could reuse the capsule code, and photo import could suggest a seat when the hips sit near knee height.

## Things to check rather than assume

- Current versions and APIs of `@pixiv/three-vrm` and `@mediapipe/tasks-vision`. The prototype uses three.js r128 globals; the port should use the current three.js with ES module imports.
- VRM 0.x and 1.0 models face opposite directions; handle both.
- Where the MediaPipe WASM files and the pose model file are served from in a Vite project.
- A VRM model file is needed for step 3. Ask the user to supply one (for example, an export from VRoid Studio).

## Known weak spots

- Relative depth between people in a photo is rough; figure positions will need nudging.
- Figures in contact will interpenetrate.
- Single-photo depth is unreliable for foreshortened limbs, and occluded limbs get invented.
- The spine is the hardest part of the rig to make feel natural.
