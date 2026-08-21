/**
 * tracking/faceLoop.ts — orchestration acquisition → FaceLandmarker.
 *
 * La boucle PRODUIT ne maintient qu'UNE Task MediaPipe à la fois. La sonde
 * FaceDetector reste réservée aux bancs diagnostics.
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
  onLandmarks(lm: ReadonlyArray<{ x: number; y: number; z?: number }>, yawRad: number): void;
  onLost(consecutive: number, cause: LostCause, reason: string | null): void;
  onTransition?(reason: string): void;
  onProgress?(ratio: number): void;
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

  // Audit prédictif 2026-08-21 : auparavant l'INITIALISATION appelait le GPU
  // directement AVANT que la machine de stratégies n'existe réellement. Si la
  // création GPU échouait sur un appareil, `startFaceLoop()` rejetait et l'UI
  // passait en erreur fatale sans jamais tenter le CPU — alors que toute la
  // ladder GPU→CPU était justement là pour ça.
  let landmarker: FaceLandmarker | null = null;
  try {
    landmarker = await createLandmarker(
      (r) => handlers.onProgress?.(r),
      currentStrategy(plan).delegate,
      currentStrategy(plan).minConfidence,
    );
  } catch (gpuErr) {
    plan.strategyIndex = 1; // CPU pleine résolution
    handlers.onTransition?.(
      `initialisation GPU impossible (${gpuErr instanceof Error ? gpuErr.message.slice(0, 90) : String(gpuErr).slice(0, 90)}) → essai CPU`,
    );
    landmarker = await createLandmarker(
      (r) => handlers.onProgress?.(r),
      currentStrategy(plan).delegate,
      currentStrategy(plan).minConfidence,
    );
  }

  let swapping = false;
  let disposed = false;
  let modelError: string | null = null;
  let lostStreak = 0;
  let lastTs = -1;
  const scratch = document.createElement('canvas');

  const onSnapshot = (s: FrameSnapshot): void => {
    if (disposed) return;

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
          plan.strategyIndex = targetIndex - 1;
          handlers.onTransition?.(`${modelError} → repli vers « ${currentStrategy(plan).label} »`);
        } else {
          // À l'initialisation, GPU→CPU est déjà tenté ci-dessus. Ici, index 0
          // signifie qu'une stratégie auparavant vivante n'est plus recréable.
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

export type { FaceProbeResult };
