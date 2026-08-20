/**
 * tracking/faceProbe.ts — Couche 3 : « y a-t-il un visage ? », SECOND AVIS.
 *
 * Détecteur facial simple de MediaPipe (BlazeFace short-range), indépendant du
 * FaceLandmarker. Son rôle est d'ISOLER la couche fautive quand le landmarker
 * ne rend rien :
 *
 *   - sonde OUI + landmarker NON  → le problème est le landmarker (délégué,
 *     modèle, runtime) — la bascule CPU est alors JUSTIFIÉE par une preuve ;
 *   - sonde NON + landmarker NON  → le problème est plus probablement dans les
 *     pixels fournis (orientation, canvas, vidéo, environnement) ;
 *   - les deux OUI                → la chaîne d'entrée fonctionne.
 *
 * Modèle VENDORISÉ (public/models/blaze_face_short_range.tflite, 225 Ko) —
 * zéro CDN au runtime, comme le landmarker (§1 bug #4). Délégué CPU par
 * défaut : la sonde doit rester valide quand c'est précisément le GPU qu'on
 * soupçonne.
 */

import { FaceDetector } from '@mediapipe/tasks-vision';
import { visionFileset, type Delegate } from './landmarker.js';
import { assetUrl } from '../ui/assetUrl.js';

export const FACE_PROBE_MODEL = 'models/blaze_face_short_range.tflite';

export interface FaceProbeResult {
  found: boolean;
  /** Score du meilleur visage, 0 si aucun. */
  score: number;
}

export interface FaceProbe {
  /** Source = canvas du snapshot (couche 2). Timestamps monotones par instance. */
  probe(source: HTMLCanvasElement | HTMLVideoElement, tsMs: number): FaceProbeResult;
  close(): void;
}

export async function createFaceProbe(delegate: Delegate = 'CPU'): Promise<FaceProbe> {
  const fileset = await visionFileset();
  const detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: assetUrl(FACE_PROBE_MODEL), delegate },
    runningMode: 'VIDEO',
  });

  let lastTs = -1;
  return {
    probe(source, tsMs): FaceProbeResult {
      const ts = Math.max(tsMs, lastTs + 1);
      lastTs = ts;
      try {
        const res = detector.detectForVideo(source, ts);
        const best = res.detections[0]?.categories[0]?.score ?? 0;
        return { found: res.detections.length > 0, score: best };
      } catch {
        return { found: false, score: 0 };
      }
    },
    close(): void {
      detector.close();
    },
  };
}
