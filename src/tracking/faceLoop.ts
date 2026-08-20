/**
 * tracking/faceLoop.ts — l'orchestration des couches 1 à 4.
 *
 *   Couche 1-2  frameFeed.ts      → une frame caméra VALIDE, pixels normalisés
 *   Couche 3    faceProbe.ts      → « y a-t-il un visage ? » (second avis)
 *   Couche 4    landmarker.ts     → les 478 landmarks
 *   Décision    detectionPlan.ts  → machine d'état, transitions PROUVÉES
 *
 * Remplace l'ancien `startLoop` : même garantie « la boucle ne meurt jamais »
 * (§1 bug #3), plus la séparation stricte entre « entrée invalide », « visage
 * non trouvé » et « pose inadaptée » — cette dernière n'existe pas ici : elle
 * appartient aux couches de MESURE (règle 3, gates de calibration), jamais à
 * la détection.
 *
 * Concurrence (§16) : une seule inférence à la fois — les rappels de snapshot
 * sont sériels et `detectForVideo` est synchrone ; pendant une bascule de
 * délégué (asynchrone), les frames sont ignorées, aucun compteur n'avance.
 */

import { createLandmarker, yawFromMatrix } from './landmarker.js';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { attachFrameFeed, type FrameSnapshot } from './frameFeed.js';
import { createFaceProbe, type FaceProbe, type FaceProbeResult } from './faceProbe.js';
import { initialPlan, planStep, shouldProbe, type DetectionPlan } from './detectionPlan.js';

export type LostCause = 'invalid-input' | 'no-face';

export interface FaceLoopHandlers {
  /** Couche 4 OK : landmarks bruts de CETTE frame. */
  onLandmarks(lm: ReadonlyArray<{ x: number; y: number; z?: number }>, yawRad: number): void;
  /**
   * Pas de landmarks sur cette frame. `cause` sépare « entrée caméra cassée »
   * (reason nommée) de « frame valide, visage non trouvé » (§11 : deux états).
   */
  onLost(consecutive: number, cause: LostCause, reason: string | null): void;
  /** Transition de la machine d'état, avec sa raison (§17). */
  onTransition?(reason: string): void;
  onProgress?(ratio: number): void;
  /** Erreur fatale (création de délégué impossible…) — la boucle s'arrête. */
  onError?(message: string): void;
}

export interface FaceLoopControl {
  stop(): void;
  plan(): Readonly<DetectionPlan>;
}

export async function startFaceLoop(
  video: HTMLVideoElement,
  handlers: FaceLoopHandlers,
): Promise<FaceLoopControl> {
  const plan = initialPlan();
  let landmarker: FaceLandmarker | null = await createLandmarker(
    (r) => handlers.onProgress?.(r),
    'GPU',
  );
  let probe: FaceProbe | null = null;
  let probeLoading = false;
  let swapping = false;
  let disposed = false;
  let lostStreak = 0;
  let lastTs = -1;

  const closeAll = (): void => {
    landmarker?.close();
    landmarker = null;
    probe?.close();
    probe = null;
  };

  const onSnapshot = (s: FrameSnapshot): void => {
    if (disposed || swapping || landmarker === null) return;

    if (!s.validity.valid) {
      lostStreak++;
      planStep(plan, { frameValid: false, landmarksFound: false, probeFound: null });
      handlers.onLost(lostStreak, 'invalid-input', s.validity.reason);
      return;
    }

    const ts = Math.max(performance.now(), lastTs + 1);
    lastTs = ts;

    let lm: ReadonlyArray<{ x: number; y: number; z?: number }> | undefined;
    let yaw = 0;
    try {
      const res = landmarker.detectForVideo(s.source, ts);
      lm = res.faceLandmarks[0];
      const mat = res.facialTransformationMatrixes[0];
      if (mat !== undefined) yaw = yawFromMatrix(mat.data);
    } catch (err) {
      console.error('Detection error:', err);
    }

    if (lm !== undefined && lm.length > 0) {
      lostStreak = 0;
      planStep(plan, { frameValid: true, landmarksFound: true, probeFound: null });
      handlers.onLandmarks(lm, yaw);
      return;
    }

    lostStreak++;
    // — Second avis, seulement quand la machine le demande (couche 3).
    let probeFound: boolean | null = null;
    if (shouldProbe(plan)) {
      if (probe !== null) probeFound = probe.probe(s.source, ts + 0.5).found;
      else if (!probeLoading) {
        probeLoading = true;
        void createFaceProbe('CPU')
          .then((p) => {
            if (disposed) p.close();
            else probe = p;
          })
          .catch(() => {}); // sonde indisponible : la machine basculera par élimination
      }
    }

    const t = planStep(plan, { frameValid: true, landmarksFound: false, probeFound });
    handlers.onLost(lostStreak, 'no-face', null);

    if (t.action === 'swap-to-cpu') {
      swapping = true;
      handlers.onTransition?.(t.reason ?? 'bascule CPU');
      landmarker.close();
      landmarker = null;
      void createLandmarker(() => {}, 'CPU')
        .then((cpu) => {
          if (disposed) cpu.close();
          else {
            landmarker = cpu;
            swapping = false;
          }
        })
        .catch((err) => {
          handlers.onError?.(err instanceof Error ? err.message : String(err));
        });
    }
  };

  const feed = attachFrameFeed(video, onSnapshot);
  return {
    stop(): void {
      disposed = true;
      feed.stop();
      closeAll();
    },
    plan(): Readonly<DetectionPlan> {
      return plan;
    },
  };
}

/** Résultat de sonde ré-exporté pour les pages de diagnostic. */
export type { FaceProbeResult };
