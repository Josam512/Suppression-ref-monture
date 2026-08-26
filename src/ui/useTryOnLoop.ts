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

import type { CameraIdentity } from '../core/cameraProfile.js';
import type { CoordinateSpace } from '../tracking/detectionPlan.js';
import type { LostCause } from '../tracking/faceLoop.js';
import type { NormalizedLandmark } from '../core/geom.js';
import { drawOverlay } from '../render/overlay.js';
import { aliveTaskCount } from '../tracking/modelLifecycle.js';
import type { AutoCalibration } from './useAutoCalibration.js';
import type { Phase } from './CalibrationPanel.js';
import { stepCrossCheck, stepRotation } from './liveSteps.js';
import { paintLost, paintScene, sceneHint } from './renderScene.js';
import { useCameraLoop } from './useCameraLoop.js';
import { drawDevHud, hudEnabled } from './devHud.js';
import { devInvariant, invariantReport } from '../core/invariants.js';
import type { Live } from './liveState.js';

/**
 * Compteurs de SANTÉ, exposés en lecture seule pour les bancs (points 74–77 :
 * le chaos test doit pouvoir affirmer « la session récupère ou dit pourquoi »
 * sans fouiller le DOM). Passif : rien dans le produit ne le lit.
 */
function publishHealth(
  live: Live,
  stage: { metrology: number; render: number; lastMetrology: string; lastRender: string },
): void {
  try {
    const w = window as unknown as { __VTO_HEALTH__?: unknown };
    const s = live.loopStats?.() ?? null;
    // ⭐ Ré-audit AP — invariants runtime OBSERVÉS à chaque frame : une seule
    // Task MediaPipe vivante ; front et profil rendus du MÊME modèle.
    devInvariant(aliveTaskCount() <= 1, `plusieurs Tasks MediaPipe vivantes (${aliveTaskCount()})`);
    if (live.sprites.front.status === 'ready' && live.sprites.profile.status === 'ready') {
      devInvariant(
        live.sprites.front.sprite.spec.slug === live.sprites.profile.sprite.spec.slug,
        'front et profil de modèles différents',
      );
    }
    w.__VTO_HEALTH__ = {
      aliveTasks: aliveTaskCount(),
      frontSlug: live.sprites.front.status === 'ready' ? live.sprites.front.sprite.spec.slug : null,
      renderedFrames: live.renderedFrames,
      skippedRenderFrames: live.skippedRenderFrames,
      lastRenderedAtMs: live.lastRenderedAtMs,
      lastLandmarksAtMs: live.lastLandmarksAtMs,
      cameraFrames: s?.feed?.cameraFrames ?? 0,
      landmarkFrames: s?.landmarkFrames ?? 0,
      inferenceErrors: s?.inferenceErrors ?? 0,
      feedStalls: s?.feed?.stalls ?? 0,
      metrologyErrors: stage.metrology,
      renderErrors: stage.render,
      // Point 70 — les DERNIÈRES erreurs, conservées et nommées, jamais avalées.
      lastMetrologyError: stage.lastMetrology || null,
      lastRenderError: stage.lastRender || null,
      lastInferenceError: s?.lastInferenceError ?? null,
      // ⭐ Négociation (2026-08-22) — le DOSSIER complet en une capture : erreur
      // intégrale + contexte, stratégie vivante, tableau des éliminations.
      lastInferenceErrorFull: s?.lastInferenceErrorFull ?? null,
      inferenceContext: s?.lastInferenceContext ?? null,
      runningStrategy: s?.runningStrategy ?? null,
      trackerHealth: s?.trackerHealth ?? null,
      generation: s?.generation ?? 0,
      yawAgreement: s?.yawAgreement ?? null,
      negotiation: s?.negotiation ?? [],
      lastSnapshotError: s?.feed?.lastSnapshotError ?? null,
      engineAlive: live.auto !== null,
      calibrated: live.cal !== null,
      pdReady: live.cal?.pdMm !== undefined,
      provisional: live.provisional,
      // ⭐ Ré-audit A6 — l'attente de première échelle est OBSERVABLE : les
      // bancs peuvent affirmer « vivant, expliqué » au lieu de « muet ».
      waitingFirstScaleMs: live.firstScaleWaitSinceMs === null ? 0 : performance.now() - live.firstScaleWaitSinceMs,
      firstScaleRefusal: live.firstScaleRefusal,
      // ⚖️ 2026-08-23 — la monture est posée à l'échelle VISUELLE de secours.
      visualFallback: live.visualFallbackReason,
      // 🔴 Terrain 2026-08-26 — la POSE PEINTE, observable : le banc S20
      // oppose l'ancre dessinée à la position VRAIE du visage mobile.
      anchorRawPx: live.anchorRawPx,
      anchorFilteredPx: live.anchorFilteredPx,
      lastVideoTimeS: live.lastVideoTimeS,
      invariants: invariantReport(),
    };
  } catch {
    // Une télémétrie qui casse la boucle serait un comble.
  }
}

/**
 * Micro-perte repeinte (rendu SEUL), en MILLISECONDES — guide point 49 : cinq
 * frames valaient 83 ms à 60 fps et 333 ms à 15 fps, le même code changeait de
 * comportement avec la cadence. Au-delà, l'alarme brute reprend (§1 bug #3).
 */
export const RENDER_HOLD_MS = 180;

/**
 * 🔴 Ré-audit 2026-08-23 — cadence MAXIMALE de la métrologie (~15 Hz).
 *
 * La métrologie (pump : captures plein cadre, getImageData, collectes) tournait
 * AVANT le rendu, dans le même tick, à la cadence caméra : une métrologie
 * lente ne tuait plus le rendu (enveloppes) mais le RETARDAIT à chaque frame.
 * Désormais : tracking → RENDU immédiat → métrologie ensuite, décimée. À
 * 15 Hz, le film de carte (§14.7) garde largement sa matière : ~100+ vues sur
 * un aller-retour, pour un plancher MIN_SWEEP_VIEWS de 8 — la leçon du §14.7
 * (relever à chaque image, pas aux tranches) reste respectée en esprit : on
 * relève à cadence FIXE, jamais aux moments qui arrangent.
 */
export const METROLOGY_MIN_INTERVAL_MS = 66;

export interface TryOnLoopDeps {
  live: MutableRefObject<Live>;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  phaseRef: MutableRefObject<Phase['kind']>;
  pump: AutoCalibration['pump'];
  setPhase(phase: Phase): void;
  pushNotice(message: string): void;
  /** L'identité de l'objectif ouvert (points 39–40) — remontée telle quelle. */
  onCameraIdentity?(identity: CameraIdentity): void;
  /** Décidé par TryOn : essayage direct, gel V2, ou mesure automatique. */
  onReadyAction(): void;
  /** 🔴 Ré-audit 2026-08-23 — premier visage VALIDÉ : les collectes
   *  métrologiques d'arrière-plan (startMissing) démarrent ICI, jamais avant. */
  onProvenAction?(): void;
  onFatalError(message: string): void;
}

export function useTryOnLoop(deps: TryOnLoopDeps): { retryCamera(): void } {
  const { live, videoRef, canvasRef, phaseRef, pump, setPhase, pushNotice, onCameraIdentity, onReadyAction, onProvenAction, onFatalError } =
    deps;

  /** Erreurs par enveloppe — comptées et NOMMÉES, jamais avalées (point 70). */
  const stageErrors = useRef({ metrology: 0, render: 0, lastMetrology: '', lastRender: '' });

  /** Horloge de décimation métrologique — partagée frame/perte (ré-audit). */
  const lastPumpAtMs = useRef(0);

  /**
   * ── Enveloppe MÉTROLOGIE (point 17), décimée à ~15 Hz (ré-audit
   * 2026-08-23) : une exception ici est un diagnostic, jamais la mort du
   * rendu ni du tracking — et une métrologie lente ne retarde plus le rendu,
   * qui est peint AVANT l'appel.
   */
  const pumpDecimated = useCallback(
    (lm: readonly NormalizedLandmark[] | null, yawRad: number, w: number, h: number): void => {
      const now = performance.now();
      if (now - lastPumpAtMs.current < METROLOGY_MIN_INTERVAL_MS) return;
      lastPumpAtMs.current = now;
      const s = live.current;
      try {
        pump(lm, yawRad, w, h);
        if (lm !== null && phaseRef.current !== 'mesure-carte') {
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
    },
    [live, phaseRef, pump, setPhase, pushNotice],
  );

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
      // 🔴 Terrain 2026-08-26 — l'instant vidéo de la frame rendue (banc S20).
      s.lastVideoTimeS = videoRef.current?.currentTime ?? 0;

      // Étape carte (diagnostic) : rien ne mesure, la vidéo passe sous un
      // canvas vide — le client lit la consigne et appuie quand il veut.
      if (phaseRef.current === 'mesure-carte') {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        pumpDecimated(lm, yawRad, w, h);
        return;
      }

      // ── Enveloppe RENDU (point 17) : une frame ratée est une frame ratée,
      // le tracking continue à la suivante. 🔴 Ré-audit 2026-08-23 — le rendu
      // passe EN PREMIER : la monture est peinte avant tout travail
      // métrologique du tick, une métrologie lente ne la retarde plus.
      try {
        paintScene(ctx, s, lm, yawRad, videoRef.current);
        drawOverlay(ctx, { verdict: s.verdict, consecutiveFailures: 0, hint: sceneHint(s) });
        if (hudEnabled()) drawDevHud(ctx, s);
      } catch (err) {
        stageErrors.current.render++;
        stageErrors.current.lastRender = err instanceof Error ? err.message : String(err);
        console.error('Rendu —', err);
      }

      // ── Métrologie ENSUITE, décimée (~15 Hz) — voir pumpDecimated.
      pumpDecimated(lm, yawRad, w, h);
      publishHealth(s, stageErrors.current);
    },
    [live, videoRef, phaseRef, pumpDecimated],
  );

  const renderLost = useCallback(
    (ctx: CanvasRenderingContext2D, n: number, cause: LostCause, reason: string | null): void => {
      const s = live.current;
      const heldMs = performance.now() - s.lastLandmarksAtMs;
      // 🔴 Ré-audit 2026-08-23 — le RENDU d'abord (maintien ou alarme), la
      // perte nourrit ENSUITE le moteur automatique (« je ne vous vois pas »),
      // décimée comme le reste de la métrologie. Le maintien ne mesure rien.
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
          pumpDecimated(null, 0, ctx.canvas.width, ctx.canvas.height);
          return;
        }
        s.verdict = null;
        s.poseFilter.noteLossAt(performance.now());
        paintLost(ctx, n, cause, reason);
        if (hudEnabled()) drawDevHud(ctx, s);
      } catch (err) {
        stageErrors.current.render++;
        stageErrors.current.lastRender = err instanceof Error ? err.message : String(err);
      }
      pumpDecimated(null, 0, ctx.canvas.width, ctx.canvas.height);
      publishHealth(s, stageErrors.current);
    },
    [live, videoRef, phaseRef, pumpDecimated],
  );

  /** Après une erreur caméra/modèle, tout se remonte : plus de cul-de-sac (audit E1). */
  const [attempt, setAttempt] = useState(0);

  useCameraLoop(
    videoRef,
    canvasRef,
    {
      onFrame: renderFrame,
      onLost: renderLost,
      // ⚠️ La progression ne peut RÉGRESSER personne : un swap de stratégie
      // relit le modèle en cache et ré-émet `onProgress(1)` — sans cette
      // garde, il écrasait la phase active par « Chargement : 100 % » et
      // l'écran de mesure disparaissait (constaté au banc, 2026-08-21).
      onProgress: (ratio) => {
        if (phaseRef.current === 'loading') setPhase({ kind: 'loading', ratio });
      },
      onReady: (stats) => {
        live.current.loopStats = stats;
        onReadyAction();
      },
      ...(onProvenAction !== undefined ? { onTrackerProven: onProvenAction } : {}),
      ...(onCameraIdentity !== undefined ? { onCameraIdentity } : {}),
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
