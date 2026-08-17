/**
 * prep/detectOnImage.ts — FaceLandmarker en mode IMAGE, pour l'atelier.
 *
 * ⚠️ Outil hors ligne. L'application client, elle, travaille exclusivement sur
 * le flux vidéo (§0.0.2) ; ce module ne doit jamais y être importé.
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { NormalizedLandmark } from '../core/geom.js';
import { assetUrl } from '../ui/assetUrl.js';

let cached: FaceLandmarker | null = null;

export async function imageLandmarker(): Promise<FaceLandmarker> {
  if (cached !== null) return cached;
  const fileset = await FilesetResolver.forVisionTasks(assetUrl('wasm'));
  cached = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: assetUrl('models/face_landmarker.task'), delegate: 'CPU' },
    runningMode: 'IMAGE',
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
  });
  return cached;
}

export interface PhotoDetection {
  landmarks: NormalizedLandmark[];
  yawRad: number;
}

export async function detectOnImage(img: HTMLImageElement): Promise<PhotoDetection | null> {
  const landmarker = await imageLandmarker();
  const res = landmarker.detect(img);
  const lm = res.faceLandmarks[0];
  if (lm === undefined || lm.length === 0) return null;

  const mat = res.facialTransformationMatrixes[0];
  const r02 = mat?.data[8];
  const r22 = mat?.data[10];
  const yawRad = r02 !== undefined && r22 !== undefined ? Math.atan2(r02, r22) : 0;

  return { landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })), yawRad };
}
