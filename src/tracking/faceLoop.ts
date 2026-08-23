/**
 * tracking/faceLoop.ts — l'orchestration des couches 1 à 4.
 *
 *   Couche 1-2  frameFeed.ts       → une frame caméra VALIDE, pixels normalisés
 *   Couche 4    landmarker.ts      → les 478 landmarks
 *   Vie du modèle modelLifecycle.ts → watchdog de création, UNE seule Task
 *   Décision    detectionPlan.ts   → catalogue + négociation de capacités
 *
 * 🔴 Négociation (arbitrage humain 2026-08-22, Samsung réel) : ce module
 * ROUTE l'entrée (vidéo directe ou canvas selon la stratégie), lit le yaw par
 * la matrice OU par les landmarks (stratégies sans matrice), consigne chaque
 * élimination dans `stats.negotiation` (le tableau qu'une seule capture du
 * HUD suffit à lire), conserve l'erreur d'inférence INTÉGRALE avec son
 * contexte, et notifie `onStrategyStable` quand une stratégie a prouvé
 * ≥ 478 landmarks validés sur NEGOTIATION_STABLE_FRAMES frames — c'est ce
 * signal qui mémorise la stratégie pour l'appareil. L'aval reçoit
 * (landmarks, yaw, espace) et ne sait JAMAIS quelle stratégie a gagné.
 */

import { attachFrameFeed, type FrameSnapshot } from './frameFeed.js';
import { createModelHost } from './modelLifecycle.js';
import { detectionInput, landmarksInvalidReason, unpadLandmarks } from './frameInput.js';
import {
  coordinateSpaceOf,
  currentStrategy,
  initialPlan,
  NEGOTIATION_STABLE_FRAMES,
  planStep,
  strategyIndexOf,
  type DetectionPlan,
  type NegotiationEntry,
} from './detectionPlan.js';

import {
  FULL_ERROR_MAX_CHARS,
  NEGOTIATION_HISTORY_MAX,
  type FaceLoopControl,
  type FaceLoopHandlers,
  type FaceLoopOptions,
  type FaceLoopStats,
} from './loopTypes.js';

export { MODEL_CREATE_TIMEOUT_MS } from './modelLifecycle.js';
export { CRITICAL_LANDMARKS, landmarksInvalidReason, MIN_LANDMARKS } from './frameInput.js';
export {
  FULL_ERROR_MAX_CHARS,
  NEGOTIATION_HISTORY_MAX,
  YAW_AGREEMENT_MIN_RAD,
  type FaceLoopControl,
  type FaceLoopHandlers,
  type FaceLoopOptions,
  type FaceLoopStats,
  type InferenceContext,
  type LostCause,
} from './loopTypes.js';

export async function startFaceLoop(
  video: HTMLVideoElement,
  handlers: FaceLoopHandlers,
  options: FaceLoopOptions = {},
): Promise<FaceLoopControl> {
  const plan = initialPlan(strategyIndexOf(options.initialStrategyId ?? null) ?? 0);
  let disposed = false;
  let lostStreak = 0;
  let lastTs = -1;
  let lastAttemptAtMs = 0;
  const scratch = document.createElement('canvas');
  const stats: FaceLoopStats = {
    validFrames: 0,
    inferenceAttempts: 0,
    inferenceSuccess: 0,
    inferenceErrors: 0,
    landmarkFrames: 0,
    invalidLandmarkFrames: 0,
    lastLandmarkAt: 0,
    lastInferenceError: null,
    lastInferenceErrorFull: null,
    lastInferenceContext: null,
    yawAgreement: null,
    trackerHealth: { state: 'idle' },
    generation: 0,
    negotiation: [],
    modelState: 'creating',
    runningStrategy: null,
    feed: null,
  };
  const pushNegotiation = (entry: NegotiationEntry): void => {
    stats.negotiation.push(entry);
    if (stats.negotiation.length > NEGOTIATION_HISTORY_MAX) stats.negotiation.shift();
  };

  const host = createModelHost(plan, {
    onProgress: (r) => handlers.onProgress?.(r),
    onWarning: (m) => handlers.onWarning?.(m),
    onError: (m) => handlers.onError?.(m),
    onAdvance: (id, outcome, detail) => pushNegotiation({ id, outcome, detail }),
  });
  host.ensure();

  const onSnapshot = (s: FrameSnapshot): void => {
    if (disposed) return;
    stats.modelState = host.state();
    stats.trackerHealth = host.health();
    stats.runningStrategy = host.runningStrategy()?.id ?? null;

    const tracker = host.current();
    if (tracker === null) {
      lostStreak++;
      handlers.onLost(lostStreak, 'model-pending', host.lastError() ?? 'modèle de détection en cours de création');
      host.ensure();
      return;
    }
    if (host.takeGenerationBump()) {
      lastTs = -1; // nouvelle instance → nouveaux timestamps (jamais ≤ dans SA génération)
      stats.generation++;
    }

    if (!s.validity.valid) {
      lostStreak++;
      planStep(plan, { frameValid: false, landmarksFound: false, nowMs: performance.now() });
      handlers.onLost(lostStreak, 'invalid-input', s.validity.reason);
      return;
    }
    stats.validFrames++;

    // Tempête indépassable (TOUT le catalogue essayé) : on n'attaque plus le
    // moteur à la cadence caméra — la frame reste une perte « inference-error »
    // DITE, sans appel natif. Une tentative espacée sonde le retour du pilote.
    const retryDelayMs = host.retryDelayMs();
    if (retryDelayMs > 0 && performance.now() - lastAttemptAtMs < retryDelayMs) {
      lostStreak++;
      handlers.onLost(lostStreak, 'inference-error', stats.lastInferenceError);
      return;
    }

    const ts = Math.max(performance.now(), lastTs + 1);
    lastTs = ts;
    lastAttemptAtMs = ts;

    let lm: ReadonlyArray<{ x: number; y: number; z?: number }> | undefined;
    let yaw = 0;
    const strategy = host.runningStrategy() ?? currentStrategy(plan);
    const din = detectionInput(s, video, strategy, scratch);
    stats.inferenceAttempts++;
    try {
      // 🔴 Refonte FaceTracker — la boucle ne touche plus MediaPipe : elle
      // consomme un FaceTrackingResult (landmarks, yaw, accord des voies).
      const res = tracker.detect(din.input, ts);
      if (res !== null) {
        lm = res.landmarks;
        yaw = res.yawRad;
        if (res.yawAgreement !== undefined && res.yawAgreement !== null) stats.yawAgreement = res.yawAgreement;
      }
      stats.inferenceSuccess++;
      // 🔴 Ré-audit 2026-08-23 — une inférence propre efface les erreurs mais
      // ne PROUVE rien : seul un visage VALIDÉ (plus bas) avance la sonde.
      host.noteInferenceCompleted();
    } catch (err) {
      // ⭐ Point 71 — une exception d'inférence n'est PAS « visage non trouvé ».
      const msg = err instanceof Error ? err.message : String(err);
      stats.inferenceErrors++;
      stats.lastInferenceError = msg.slice(0, 120);
      stats.lastInferenceErrorFull = msg.slice(0, FULL_ERROR_MAX_CHARS);
      stats.lastInferenceContext = {
        strategyId: strategy.id,
        delegate: strategy.delegate,
        source: strategy.padFraction !== null ? 'canvas' : strategy.source,
        matrices: strategy.matrices,
        inputW: din.w,
        inputH: din.h,
        videoW: video.videoWidth,
        videoH: video.videoHeight,
        tsMs: ts,
        videoTimeS: s.videoTimeS,
        generation: stats.generation,
      };
      lostStreak++;
      handlers.onLost(lostStreak, 'inference-error', stats.lastInferenceError);
      host.noteInferenceError();
      return;
    }

    const invalidReason = landmarksInvalidReason(lm);
    if (invalidReason !== null) {
      stats.invalidLandmarkFrames++;
      lostStreak++;
      handlers.onLost(lostStreak, 'invalid-landmarks', invalidReason);
      return;
    }

    if (lm !== undefined && lm.length > 0) {
      if (strategy.padFraction !== null) lm = unpadLandmarks(lm, strategy.padFraction);
      lostStreak = 0;
      stats.landmarkFrames++;
      stats.lastLandmarkAt = performance.now();
      host.noteValidFace(); // 🔴 la sonde de santé n'avance QUE sur un visage validé
      const t = planStep(plan, { frameValid: true, landmarksFound: true, nowMs: performance.now() });
      if (t.stableReached === true) {
        // 🔴 La SEULE preuve de compatibilité : des landmarks réels, plusieurs
        // frames — jamais « createFromOptions a réussi ».
        pushNegotiation({
          id: strategy.id,
          outcome: 'stable',
          detail: `${NEGOTIATION_STABLE_FRAMES} frames de landmarks validés`,
        });
        handlers.onStrategyStable?.(strategy.id);
      }
      handlers.onLandmarks(lm, yaw, coordinateSpaceOf(strategy));
      return;
    }

    lostStreak++;
    const t = planStep(plan, { frameValid: true, landmarksFound: false, nowMs: performance.now() });
    handlers.onLost(lostStreak, 'no-face', strategy.label);
    if (t.advanceTo !== null) {
      if (t.recreate !== true) pushNegotiation({ id: strategy.id, outcome: 'muette', detail: t.reason ?? '' });
      handlers.onTransition?.(t.reason ?? currentStrategy(plan).label);
      // Une seule Task (A1) : l'ancienne est fermée, la création court sous
      // watchdog — les frames de la fenêtre sont `model-pending`, et c'est dit.
      // `recreate` (A2) force la recréation de la MÊME stratégie.
      host.ensure(t.recreate === true);
    }
  };

  const feed = attachFrameFeed(video, onSnapshot, (code, detail) => {
    handlers.onWarning?.(`flux caméra : ${code} — ${detail}`);
  });
  stats.feed = feed.stats();

  return {
    stop(): void {
      disposed = true;
      feed.stop();
      host.dispose();
    },
    plan(): Readonly<DetectionPlan> {
      return plan;
    },
    stats(): Readonly<FaceLoopStats> {
      return stats;
    },
    modelReady(): Promise<boolean> {
      return host.whenReady();
    },
    trackerProven(): Promise<boolean> {
      return host.whenProven();
    },
  };
}
