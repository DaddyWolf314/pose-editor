# Pose editor

A personal, browser-only tool for posing one or more 3D figures as drawing and photo reference. Figures are posed with analytic two-bone IK on the arms and legs, plus direct rotation of any bone. Each figure wears either a procedural mannequin or a VRM model.

Built with Vite, React, TypeScript, three.js and [`@pixiv/three-vrm`](https://github.com/pixiv/three-vrm). There is no backend; the scene autosaves to `localStorage`.

## Running

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check and production build
```

## Using it

- **Click a body part** to rotate it with the gizmo.
- **Drag the yellow handles** on the hands and feet; the limb bends to follow. The hips handle moves or rotates the hips. With "Keep feet planted" ticked, the feet stay put. The diamond at the base of the neck bends the spine.
- **Joint limits** keep elbows, knees and the other joints in a natural range; untick it for free posing.
- **Head follows a look target** adds a wireframe target the head turns toward.
- **Click a floor ring** to move or turn a whole figure.
- **Figures panel**: add, duplicate, delete and select figures. **Body** picks the mannequin, a bundled model, or a `.vrm` loaded from disk.
- **Pose from photo** detects the people in a photo (MediaPipe Pose Landmarker, in the browser) and replaces the scene with one posed figure each. The photo appears as a backdrop that lines up with the figures from the photo's camera; **View from photo** returns there after orbiting. Distances between people, limbs pointing at the camera, and hidden limbs are guesses to correct by eye. The photo is not saved with the scene.
- **Undo**: Ctrl/Cmd+Z. **Esc**: deselect.
- **Scene JSON**: export or paste the whole scene (figures, positions, and one quaternion per bone).

`pose-tool.html` is the original single-file prototype, kept as the behaviour reference. `HANDOFF.md` is the project brief and build plan.

## Models

The bundled VRM models in `public/models/` (`Base_Female.vrm`, `Base_Male.vrm`) are the VRoid Studio CC0 models from OpenGameArt: <https://opengameart.org/content/vroid-studio-cc0-models>.

To add another bundled model, put the `.vrm` in `public/models/` and add an entry to `BUILTIN` in `src/rig/models.ts`.

`public/models/pose_landmarker_heavy.task` is MediaPipe's Pose Landmarker (heavy) model from <https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker>, under the Apache 2.0 licence.
