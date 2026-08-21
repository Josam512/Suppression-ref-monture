/**
 * tracking/faceLoop.ts — l'orchestration des couches 1 à 4.
 *
 *   Couche 1-2  frameFeed.ts      → une frame caméra VALIDE, pixels normalisés
 *   Couche 3    faceProbe.ts      → diagnostic séparé uniquement
 *   Couche 4    landmarker.ts     → les 478 landmarks
 *   Décision    detectionPlan.ts  → échelle de stratégies
 *
 * IMPORTANT (audit 2026-08-21) : la boucle PRODUIT ne maintient plus deux
 * Tasks MediaPipe en parallèle. Sur l'appareil réel, le FaceLandmarker VIDEO
 * fonctionne, tandis que la création d'un second modèle MediaPipe (FaceDetector
 * de sonde) peut échouer. La sonde reste disponible aux pages de diagnostic,
 * mais la boucle produit monte par élimination après des frames valides muettes.
 * Cela supprime une source de contention WASM/GPU/XNNPACK sans affaiblir la
 * métrologie : la sonde n'a jamais mesuré quoi que ce soit.
 *
 * Concurrence : une seule inférence MediaPipe à la fois. Pendant une montée de
 * stratégie (asynchrone), les frames sont nommées comme perdues ; aucun état
 * silencieux ne peut figer la session.
 */

import { createLandmarker, yawFromMatrix } from './landmarker.js';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { attachFrameFeed, type FrameSnapshot } from './frameFeed.js';
import type { FaceProbeResult } from './faceProbe.js';
import {
  currentStrategy,
  initialPlan,
  planStep,
  unpadPoint,
  type DetectionPlan,
  type DetectionStrategy,
} from './detectionPlan.js';

export type LostCause = 'invalid-input' | 'no-face';

export interface FaceLoopHandlers {
  /** Couche 4 OK : landmarks bruts de CETTE frame (coordonnées normalisées). */
  onLandmarks(lm: ReadonlyArray<{ x: number; y: number; z?: number }>, yawRad: number): void;
  /** Pas de landmarks sur cette frame. */
  onLost(consecutive: number, cause: LostCause, reason: string | null): void;
  /** Transition ou avertissement récupérable. */
  onTransition?(reason: string): void;
  onProgress?(ratio: number): void;
  /** Erreur fatale : aucune stratégie fonctionnelle ne peut être recréée. */
  onError?(message: string): void;
}

export interface FaceLoopControl {
  stop(): void;
  plan(): Readonly<DetectionPlan>;
}

function inputFor(
  s: FrameSnapshot,
  strategy: DetectionStrategy,
  scratch: HTMLCanvasElement,
): HTMLCanvasElement {
  const pad = strategy.padFraction;
  if (pad === null) return s.source;
  const w = Math.round(s.w * (1 + 2 * pad));
  const h = Math.round(s.h * (1 + 2 * pad));
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const g = scratch.getContext('2d')!;
  g.fillStyle = '#7f7f7f';
  g.fillRect(0, 0, w, h);
  g.drawImage(s.source, Math.round(s.w * pad), Math.round(s.h * pad));
  return scratch;
}

function unpadLandmarks(
  lm: ReadonlyArray<{ x: number; y: number; z?: number }>,
  pad: number,
): ReadonlyArray<{ x: number; y: number; z?: number }> {
  return lm.map((q) => ({ ...q, x: unpadPoint(q.x, pad), y: unpadPoint(q.y, pad) }));
}

export async function startFaceLoop(
  video: HTMLVideoElement,
  handlers: FaceLoopHandlers,
): Promise<FaceLoopControl> {
  const plan = initialPlan();
  let landmarker: FaceLandmarker | null = await createLandmarker(
    (r) => handlers.onProgress?.(r),
    currentStrategy(plan).delegate,
    currentStrategy(plan).minConfidence,
  );
  let swapping = false;
  let disposed = false;
  let modelError: string | null = null;
  let lostStreak = 0;
  let lastTs = -1;
  const scratch = document.createElement('canvas');

  const onSnapshot = (s: FrameSnapshot): void => {
    if (disposed) return;

    // Jamais de return muet : une création asynchrone doit rester observable.
    if (swapping || landmarker === null) {
      lostStreak++;
      handlers.onLost(
        lostStreak,
        'no-face',
        modelError ?? (swapping ? 'changement de stratégie en cours' : 'modèle indisponible, nouvelle tentative'),
      );
      if (landmarker === null && !swapping) ensureLandmarker();
      return;
    }

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
    const strategy = currentStrategy(plan);
    try {
      const res = landmarker.detectForVideo(inputFor(s, strategy, scratch), ts);
      lm = res.faceLandmarks[0];
      const mat = res.facialTransformationMatrixes[0];
      if (mat !== undefined) yaw = yawFromMatrix(mat.data);
    } catch (err) {
      modelError = `inférence « ${strategy.label} » : ${
        err instanceof Error ? err.message.slice(0, 90) : String(err).slice(0, 90)
      }`;
      handlers.onTransition?.(modelError);
    }

    if (lm !== undefined && strategy.padFraction !== null) {
      lm = unpadLandmarks(lm, strategy.padFraction);
    }

    if (lm !== undefined && lm.length > 0) {
      lostStreak = 0;
      modelError = null;
      planStep(plan, { frameValid: true, landmarksFound: true, probeFound: null });
      handlers.onLandmarks(lm, yaw);
      return;
    }

    lostStreak++;

    // Produit = UNE seule Task MediaPipe. Le second avis FaceDetector reste dans
    // les bancs de diagnostic ; ici la machine monte par élimination après 120
    // frames valides muettes. Aucune ressource concurrente ne peut empêcher le
    // swap du landmarker.
    const t = planStep(plan, { frameValid: true, landmarksFound: false, probeFound: null });
    handlers.onLost(
      lostStreak,
      'no-face',
      `${strategy.label} · sonde diagnostic désactivée dans la boucle produit`,
    );

    if (t.advanceTo !== null) {
      handlers.onTransition?.(t.reason ?? currentStrategy(plan).label);
      landmarker.close();
      landmarker = null;
      ensureLandmarker();
    }
  };

  /**
   * (Re)crée le modèle de la stratégie courante.
   *
   * Un échec d'une marche > 0 est RÉCUPÉRABLE : retour à la dernière marche
   * connue et nouvel essai, sans basculer l'UI en erreur fatale. Seul l'échec
   * de la marche 0, alors qu'aucun landmarker n'est vivant, est fatal.
   */
  function ensureLandmarker(): void {
    if (disposed || swapping || landmarker !== null) return;
    swapping = true;
    const targetIndex = plan.strategyIndex;
    const target = currentStrategy(plan);
    void createLandmarker(() => {}, target.delegate, target.minConfidence)
      .then((fresh) => {
        if (disposed) fresh.close();
        else {
          landmarker = fresh;
          modelError = null;
          lastTs = -1;
        }
      })
      .catch((err: unknown) => {
        modelError = `modèle « ${target.label} » indisponible : ${
          err instanceof Error ? err.message.slice(0, 90) : String(err).slice(0, 90)
        }`;

        if (targetIndex > 0) {
          // Repli récupérable : ne PAS appeler le callback fatal `onError`.
          plan.strategyIndex = targetIndex - 1;
          handlers.onTransition?.(
            `${modelError} → repli vers « ${currentStrategy(plan).label} »`,
          );
        } else {
          handlers.onError?.(modelError);
        }
      })
      .finally(() => {
        swapping = false;
      });
  }

  const feed = attachFrameFeed(video, onSnapshot);
  return {
    stop(): void {
      disposed = true;
      feed.stop();
      landmarker?.close();
      landmarker = null;
    },
    plan(): Readonly<DetectionPlan> {
      return plan;
    },
  };
}

/** Résultat de sonde ré-exporté pour les pages de diagnostic. */
export type { FaceProbeResult };
