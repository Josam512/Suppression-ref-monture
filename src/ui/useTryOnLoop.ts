/**
 * ui/useTryOnLoop.ts — le branchement de la boucle caméra sur l'essayage.
 *
 * Extrait de `TryOn.tsx` (règle des 300 lignes, §3). C'est ici que vivent les
 * trois enveloppes du guide (point 17) : TRACKING, MÉTROLOGIE et RENDU ont
 * chacun leur `try/catch`. Une monture PNG cassée ne stoppe pas la PD ; une PD
 * cassée ne stoppe pas le rendu ; et aucune des deux ne remonte jusqu'au
 * scheduler de frames (le feed a son propre `finally`, ceinture ET bretelles).
 */

import { useCallback, useRef, useState, type MutableRefObject, type RefObject } from 'react';

import type { CoordinateSpace } from '../tracking/detectionPlan.js';
import type { LostCause } from '../tracking/faceLoop.js';
import type { NormalizedLandmark } from '../core/geom.js';
import { drawOverlay } from '../render/overlay.js';
import type { AutoCalibration } from './useAutoCalibration.js';
import type { Phase } from './CalibrationPanel.js';
import { stepCrossCheck, stepRotation } from './liveSteps.js';
import { paintLost, paintScene, sceneHint } from './renderScene.js';
import { useCameraLoop } from './useCameraLoop.js';
import type { Live } from './liveState.js';

/**
 * Micro-perte repeinte (rendu SEUL), en MILLISECONDES — guide point 49 : cinq
 * frames valaient 83 ms à 60 fps et 333 ms à 15 fps, le même code changeait de
 * comportement avec la cadence. Au-delà, l'alarme brute reprend (§1 bug #3).
 */
export const RENDER_HOLD_MS = 180;

export interface TryOnLoopDeps {
  live: MutableRefObject<Live>;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  phaseRef: MutableRefObject<Phase['kind']>;
  pump: AutoCalibration['pump'];
  setPhase(phase: Phase): void;
  pushNotice(message: string): void;
  /** Décidé par TryOn : essayage direct, gel V2, ou mesure automatique. */
  onReadyAction(): void;
  onFatalError(message: string): void;
}

export function useTryOnLoop(deps: TryOnLoopDeps): { retryCamera(): void } {
  const { live, videoRef, canvasRef, phaseRef, pump, setPhase, pushNotice, onReadyAction, onFatalError } = deps;

  /** Erreurs par enveloppe — comptées et NOMMÉES, jamais avalées (point 70). */
  const stageErrors = useRef({ metrology: 0, render: 0, lastMetrology: '', lastRender: '' });

  const renderFrame = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      lm: readonly NormalizedLandmark[],
      yawRad: number,
      space: CoordinateSpace,
    ): void => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const s = live.current;
      s.lastLandmarks = lm;
      s.lastYawRad = yawRad;
      s.lastLandmarksAtMs = performance.now();
      s.coordinateSpace = space;

      // ── Enveloppe MÉTROLOGIE (point 17) : une exception ici est un
      // diagnostic, jamais la mort du rendu ni du tracking.
      try {
        pump(lm, yawRad, w, h);

        if (phaseRef.current !== 'mesure-carte') {
          // 🔴 Compte rendu de la séance filmée : seul « J'ai fini » déclenche le calcul.
          const rot = stepRotation(s, lm, yawRad, w, h);
          if (rot !== null) {
            setPhase({ kind: 'mesure-rotation', degrees: rot.degrees, cardViews: rot.cardViews });
          }
          const warn = stepCrossCheck(s, lm, w, h);
          if (warn !== null) pushNotice(warn);
        }
      } catch (err) {
        stageErrors.current.metrology++;
        stageErrors.current.lastMetrology = err instanceof Error ? err.message : String(err);
        console.error('Métrologie —', err);
      }

      // Étape carte (diagnostic) : rien ne mesure, la vidéo passe sous un
      // canvas vide — le client lit la consigne et appuie quand il veut.
      if (phaseRef.current === 'mesure-carte') {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        return;
      }

      // ── Enveloppe RENDU (point 17) : une frame ratée est une frame ratée,
      // le tracking continue à la suivante.
      try {
        paintScene(ctx, s, lm, yawRad, videoRef.current);
        drawOverlay(ctx, { verdict: s.verdict, consecutiveFailures: 0, hint: sceneHint(s) });
      } catch (err) {
        stageErrors.current.render++;
        stageErrors.current.lastRender = err instanceof Error ? err.message : String(err);
        console.error('Rendu —', err);
      }
    },
    [live, videoRef, phaseRef, pump, setPhase, pushNotice],
  );

  const renderLost = useCallback(
    (ctx: CanvasRenderingContext2D, n: number, cause: LostCause, reason: string | null): void => {
      // La perte nourrit le moteur automatique (« je ne vous vois pas »),
      // JAMAIS le maintien de rendu ci-dessous, qui ne mesure rien.
      try {
        pump(null, 0, ctx.canvas.width, ctx.canvas.height);
      } catch (err) {
        stageErrors.current.metrology++;
        stageErrors.current.lastMetrology = err instanceof Error ? err.message : String(err);
      }
      const s = live.current;
      const heldMs = performance.now() - s.lastLandmarksAtMs;
      try {
        if (
          cause !== 'invalid-input' &&
          heldMs <= RENDER_HOLD_MS &&
          s.lastLandmarks !== null &&
          phaseRef.current === 'essayage'
        ) {
          // Micro-perte : repeindre la dernière pose connue au lieu de faire
          // clignoter la monture. Au-delà de RENDER_HOLD_MS, l'alarme brute.
          paintScene(ctx, s, s.lastLandmarks, s.lastYawRad, videoRef.current);
          return;
        }
        s.verdict = null;
        paintLost(ctx, n, cause, reason);
      } catch (err) {
        stageErrors.current.render++;
        stageErrors.current.lastRender = err instanceof Error ? err.message : String(err);
      }
    },
    [live, videoRef, phaseRef, pump],
  );

  /** Après une erreur caméra/modèle, tout se remonte : plus de cul-de-sac (audit E1). */
  const [attempt, setAttempt] = useState(0);

  useCameraLoop(
    videoRef,
    canvasRef,
    {
      onFrame: renderFrame,
      onLost: renderLost,
      onProgress: (ratio) => setPhase({ kind: 'loading', ratio }),
      onReady: (stats) => {
        live.current.loopStats = stats;
        onReadyAction();
      },
      // ⭐ Guide point 10 — une dégradation RÉCUPÉRABLE (GPU KO → CPU vivant,
      // flux rVFC replié sur RAF…) est un bandeau, jamais une phase d'erreur.
      onWarning: pushNotice,
      onError: onFatalError,
    },
    attempt,
  );

  return {
    retryCamera(): void {
      setPhase({ kind: 'loading', ratio: 0 });
      setAttempt((a) => a + 1);
    },
  };
}
