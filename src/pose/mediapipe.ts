// PoseEstimator backed by MediaPipe Pose Landmarker, running in the browser.
//
// Assets: the WASM loader and binary are imported from the npm package with `?url`, so Vite serves
// them in dev and copies them (hashed) into the build. The model file is public/models/*.task.
//
// Placement: MediaPipe's world landmarks are metric but centred on each person's hips, so where each
// person stands is estimated separately. The camera is assumed level, with a typical phone-camera
// field of view; each person's distance comes from comparing metric bone lengths with their length in
// the image (the least foreshortened bones give the most reliable distance); the camera height puts
// the lowest feet on the floor.
import { PoseLandmarker, type Landmark, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { Vector3 } from 'three';
import type { EstimatedPerson, PoseEstimate, PoseEstimator } from './estimator';
import { poseFromPoints, type BodyPoints } from './landmarksToPose';

const MODEL_URL = import.meta.env.BASE_URL + 'models/pose_landmarker_heavy.task';
const MAX_PEOPLE = 6;
/** Assumed diagonal field of view: about a 28 mm (35 mm-equivalent) phone main camera. */
const DIAGONAL_FOV = 75;
/** Height of the ankle above the floor, metres. */
const ANKLE_HEIGHT = 0.07;

// MediaPipe pose landmark indices.
const LM = {
  nose: 0, leftEar: 7, rightEar: 8, leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16, leftPinky: 17, rightPinky: 18, leftIndex: 19, rightIndex: 20,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30, leftToe: 31, rightToe: 32,
} as const satisfies Record<keyof BodyPoints, number>;

/** Bones used to judge distance: torso sides, shoulders, hips, thighs, shins, upper arms. */
const RULERS: [number, number][] = [[11, 23], [12, 24], [11, 12], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [11, 13], [12, 14]];
const FEET = [27, 28, 29, 30, 31, 32];

/** MediaPipe world axes are x right, y down, z away from the camera; the scene's are x right, y up, z toward it. */
const toScene = (l: Landmark) => new Vector3(l.x, -l.y, -l.z);

export class MediaPipeEstimator implements PoseEstimator {
  private landmarker: PoseLandmarker;

  private constructor(landmarker: PoseLandmarker) {
    this.landmarker = landmarker;
  }

  static async create(): Promise<MediaPipeEstimator> {
    // FilesetResolver would look for the files under a base path; pass the bundled URLs directly.
    const fileset = { wasmLoaderPath, wasmBinaryPath };
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'IMAGE' as const,
      numPoses: MAX_PEOPLE,
      // Below the 0.5 defaults so stylized or partly hidden figures are still found.
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
    });
    try {
      return new MediaPipeEstimator(await PoseLandmarker.createFromOptions(fileset, options('GPU')));
    } catch (e) {
      console.warn('Pose Landmarker GPU delegate failed; using the CPU.', e);
      return new MediaPipeEstimator(await PoseLandmarker.createFromOptions(fileset, options('CPU')));
    }
  }

  async estimate(image: HTMLImageElement): Promise<PoseEstimate> {
    const W = image.naturalWidth, H = image.naturalHeight;
    const result = this.landmarker.detect(image);
    // Focal length in pixels from the assumed diagonal field of view.
    const f = Math.hypot(W, H) / 2 / Math.tan((DIAGONAL_FOV / 2) * Math.PI / 180);
    const fov = 2 * Math.atan(H / 2 / f) * 180 / Math.PI;

    // Each person in camera space: camera at the origin looking down -Z.
    const found = result.worldLandmarks.map((world, i) => {
      const img = result.landmarks[i];
      const px = (l: NormalizedLandmark) => [l.x * W, l.y * H];
      const ranges: number[] = [];
      for (const [a, b] of RULERS) {
        if ((img[a].visibility ?? 1) < 0.5 || (img[b].visibility ?? 1) < 0.5) continue;
        const [ax, ay] = px(img[a]), [bx, by] = px(img[b]);
        const li = Math.hypot(ax - bx, ay - by), lw = toScene(world[a]).distanceTo(toScene(world[b]));
        if (li > 1) ranges.push(f * lw / li);
      }
      ranges.sort((a, b) => a - b);
      // Foreshortening only ever shortens a bone in the image, so the nearest estimates are best.
      const D = ranges.length >= 3 ? ranges[1] : ranges[0] ?? 3;
      const [hx, hy] = px(img[LM.leftHip]).map((v, k) => (v + px(img[LM.rightHip])[k]) / 2);
      const hip = new Vector3((hx - W / 2) / f * D, -(hy - H / 2) / f * D, -D);
      const points = Object.fromEntries(
        Object.entries(LM).map(([k, idx]) => [k, toScene(world[idx]).add(hip)]),
      ) as unknown as BodyPoints;
      const feetY = Math.min(...FEET.map(k => toScene(world[k]).y + hip.y));
      const score = img.reduce((s, l) => s + (l.visibility ?? 0), 0) / img.length;
      return { hip, points, feetY, D, score };
    });

    // Level camera at the height that puts the median person's feet on the floor; then centre the people.
    const sorted = found.map(p => p.feetY).sort((a, b) => a - b);
    const camY = sorted.length ? -sorted[Math.floor(sorted.length / 2)] : 1.5;
    const cx = found.length ? found.reduce((s, p) => s + p.hip.x, 0) / found.length : 0;
    const cz = found.length ? found.reduce((s, p) => s + p.D, 0) / found.length : 3;
    const shift = new Vector3(-cx, camY, cz);

    const people: EstimatedPerson[] = found.map(p => {
      for (const v of Object.values(p.points)) v.add(shift);
      const { pose, ry } = poseFromPoints(p.points);
      const hip = p.hip.clone().add(shift);
      // Standing hip height from this person's own leg length, so a crouch reads as a drop in the hips.
      const leg = (s: 'left' | 'right') =>
        p.points[`${s}Hip`].distanceTo(p.points[`${s}Knee`]) + p.points[`${s}Knee`].distanceTo(p.points[`${s}Ankle`]);
      const standing = (leg('left') + leg('right')) / 2 + ANKLE_HEIGHT;
      return { pose, root: { x: hip.x, z: hip.z, ry }, hips: [0, hip.y - standing, 0], score: p.score };
    });

    const farthest = found.reduce((m, p) => Math.max(m, p.D), 0);
    return {
      people,
      camera: {
        position: [-cx, camY, cz],
        target: [-cx, camY, 0],
        fov,
        aspect: W / H,
        backdropDistance: farthest + 1.5,
      },
    };
  }

  dispose(): void {
    this.landmarker.close();
  }
}
