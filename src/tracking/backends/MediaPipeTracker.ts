/**
 * tracking/backends/MediaPipeTracker.ts — LE backend MediaPipe, derrière
 * l'abstraction FaceTracker (refonte 2026-08-23).
 *
 * 🔴 SEUL fichier du produit (avec `landmarker.ts` qui le fabrique) à toucher
 * FaceLandmarker/`detectForVideo`. Il encapsule pour UNE stratégie :
 *   - la création (modèle vendorisé, délégué, seuils, matrices ON/OFF) ;
 *   - l'inférence synchrone ;
 *   - l'extraction du yaw — matrice quand la stratégie la produit, paire
 *     symétrique des landmarks sinon (arbitrage 2026-08-22, tracking/yaw.ts) —
 *     et l'observation de l'ACCORD des deux voies aux angles francs ;
 *   - le roll (ligne des yeux), aux dimensions RÉELLES de la source.
 *
 * `detect` rend null quand aucun visage n'est vu, LÈVE quand le graph casse.
 * La santé n'est jamais déclarée ici : c'est la sonde de modelLifecycle qui
 * compte les inférences propres.
 */

import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { createLandmarker } from '../landmarker.js';
import { yawFromLandmarks, yawFromMatrix } from '../yaw.js';
import { rollRadOf } from '../../core/faceMetrics.js';
import { YAW_AGREEMENT_MIN_RAD } from '../loopTypes.js';
import type { DetectionStrategy } from '../strategyCatalog.js';
import { MEDIAPIPE_FACE_TOPOLOGY } from '../faceTopology.js';
import type { FaceTracker, FaceTrackingResult, TrackerInitContext, VideoFrameSource } from '../FaceTracker.js';

function sourceDims(frame: VideoFrameSource): { w: number; h: number } {
  if (frame instanceof HTMLVideoElement) return { w: frame.videoWidth, h: frame.videoHeight };
  return { w: frame.width, h: frame.height };
}

export class MediaPipeTracker implements FaceTracker {
  readonly id: string;
  readonly strategy: DetectionStrategy;
  /** Le maillage FaceLandmarker (478 pts, iris) — déclaré par CE backend. */
  readonly topology = MEDIAPIPE_FACE_TOPOLOGY;
  private landmarker: FaceLandmarker | null = null;

  constructor(strategy: DetectionStrategy) {
    this.id = strategy.id;
    this.strategy = strategy;
  }

  async init(ctx: TrackerInitContext): Promise<void> {
    this.landmarker = await createLandmarker(
      ctx.onProgress ?? (() => {}),
      this.strategy.delegate,
      this.strategy.minConfidence,
      this.strategy.matrices,
    );
  }

  detect(frame: VideoFrameSource, timestampMs: number): FaceTrackingResult | null {
    if (this.landmarker === null) throw new Error(`backend « ${this.id} » non initialisé`);
    const res = this.landmarker.detectForVideo(frame, timestampMs);
    const lm = res.faceLandmarks[0];
    if (lm === undefined || lm.length === 0) return null;

    let yaw: number;
    let yawAgreement: boolean | null = null;
    const mat = res.facialTransformationMatrixes?.[0];
    if (mat !== undefined) {
      yaw = yawFromMatrix(mat.data);
      // Les deux voies coexistent : l'accord de SIGNE est observé aux angles
      // francs — un repli au signe inversé serait VISIBLE, jamais tu.
      if (Math.abs(yaw) > YAW_AGREEMENT_MIN_RAD) {
        const alt = yawFromLandmarks(lm);
        if (Math.abs(alt) > YAW_AGREEMENT_MIN_RAD / 2) yawAgreement = Math.sign(alt) === Math.sign(yaw);
      }
    } else {
      yaw = yawFromLandmarks(lm); // stratégie sans matrice : rotation par les landmarks
    }

    const { w, h } = sourceDims(frame);
    return {
      timestampMs,
      landmarks: lm,
      yawRad: yaw,
      rollRad: w > 0 && h > 0 ? rollRadOf(lm, w, h) : 0,
      confidence: 1, // FaceLandmarker (VIDEO) n'expose pas de score — cf. FaceTracker.ts
      backend: this.id,
      yawAgreement,
    };
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
