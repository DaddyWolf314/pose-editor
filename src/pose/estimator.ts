// Pose estimation from a photo, behind an interface so another estimator (for example a server-side
// mesh-recovery model) can replace MediaPipe later.
import type { FigureData } from '../scene/sceneData';

/** One person found in the photo, in the same terms as a figure's scene data. */
export interface EstimatedPerson {
  /** Rig-local bone rotations relative to the T-pose. */
  pose: FigureData['pose'];
  /** Floor position and facing of the figure root. */
  root: FigureData['root'];
  /** Hips offset from a standing rest pose, in figure-root space (negative y for crouching). */
  hips: FigureData['hips'];
  /** Detection confidence, 0 to 1. */
  score: number;
}

/** The camera the photo is assumed to have been taken with, in scene coordinates. */
export interface PhotoCamera {
  position: [number, number, number];
  /** A point on the view axis; the camera looks straight at it. */
  target: [number, number, number];
  /** Vertical field of view in degrees. */
  fov: number;
  /** Image width over height. */
  aspect: number;
  /** Distance along the view axis at which to show the photo, behind every figure. */
  backdropDistance: number;
}

export interface PoseEstimate {
  people: EstimatedPerson[];
  camera: PhotoCamera;
}

export interface PoseEstimator {
  estimate(image: HTMLImageElement): Promise<PoseEstimate>;
  dispose(): void;
}
