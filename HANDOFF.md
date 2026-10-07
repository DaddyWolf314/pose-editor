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
