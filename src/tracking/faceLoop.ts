/**
 * tracking/faceLoop.ts — l'orchestration des couches 1 à 4.
 *
 *   Couche 1-2  frameFeed.ts       → une frame caméra VALIDE, pixels normalisés
 *   Couche 4    landmarker.ts      → les 478 landmarks
 *   Vie du modèle modelLifecycle.ts → watchdog de création, UNE seule Task
 *                                     (fermer avant créer, ré-audit A1)
 *   Décision    detectionPlan.ts   → échelle de stratégies, montées temporelles
 *
 * Durci par le guide de fiabilisation (2026-08-21) :
 *
 *   - UNE seule Task MediaPipe lourde à la fois (point 6) : la sonde
 *     FaceDetector est sortie du chemin produit ; les montées se font par
 *     élimination temporelle ;
 *   - la sortie du modèle est VALIDÉE à la frontière (point 16) : longueur
 *     ≥ 478 et repères critiques finis, sinon la frame est `invalid-landmarks`
 *     et n'atteint jamais `at(473)` au milieu du rendu ou de la métrologie ;
 *   - chaque étage a son compteur (complément 10) : un écran figé dit
 *     immédiatement OÙ la chaîne s'est arrêtée ;
 *   - une exception d'inférence est NOMMÉE (`inference-error`), jamais
 *     confondue avec « visage non trouvé » (point 71).
 */

import { yawFromMatrix } from './landmarker.js';
import { attachFrameFeed, type FrameFeedStats, type FrameSnapshot } from './frameFeed.js';
import { createModelHost, type ModelState } from './modelLifecycle.js';
import {
  coordinateSpaceOf,
  currentStrategy,
  initialPlan,
  planStep,
  unpadPoint,
  type CoordinateSpace,
  type DetectionPlan,
  type DetectionStrategy,
} from './detectionPlan.js';

export type LostCause =
  | 'invalid-input'
  | 'no-face'
  | 'invalid-landmarks'
  | 'inference-error'
  | 'model-pending';

export { MODEL_CREATE_TIMEOUT_MS } from './modelLifecycle.js';

/** Longueur minimale d'une sortie FaceLandmarker exploitable (478 = avec iris). */
export const MIN_LANDMARKS = 478;
/** Repères sans lesquels ni pose, ni rendu, ni métrologie ne tiennent. */
export const CRITICAL_LANDMARKS = [1, 33, 133, 168, 234, 263, 362, 454, 468, 473, 162, 389] as const;

/** Compteurs par étage — le HUD lit ici « où la chaîne s'est arrêtée ». */
export interface FaceLoopStats {
  validFrames: number;
  inferenceAttempts: number;
  inferenceSuccess: number;
  inferenceErrors: number;
  landmarkFrames: number;
  invalidLandmarkFrames: number;
  lastLandmarkAt: number;
  lastInferenceError: string | null;
  modelState: ModelState;
  /** Stratégie de l'instance VIVANTE (l'index du plan peut viser plus loin). */
  runningStrategy: string | null;
  feed: Readonly<FrameFeedStats> | null;
}

export interface FaceLoopHandlers {
  /** Couche 4 OK : landmarks bruts de CETTE frame (coordonnées normalisées).
   *  `space` dit si le Z est exploitable : `padded-remapped` → X/Y dé-mappés,
   *  Z NON transformé, interdit de production (complément 9). */
  onLandmarks(
    lm: ReadonlyArray<{ x: number; y: number; z?: number }>,
    yawRad: number,
    space: CoordinateSpace,
  ): void;
  /** Pas de landmarks sur cette frame. `cause` nomme l'étage fautif (§11). */
  onLost(consecutive: number, cause: LostCause, reason: string | null): void;
  /** Montée de stratégie, avec sa raison (§17). */
  onTransition?(reason: string): void;
  onProgress?(ratio: number): void;
  /** Dégradation RÉCUPÉRABLE : la séance continue (guide, point 10). */
  onWarning?(message: string): void;
  /** FATAL : plus aucune stratégie ne peut continuer. */
  onError?(message: string): void;
}

export interface FaceLoopControl {
  stop(): void;
  plan(): Readonly<DetectionPlan>;
  stats(): Readonly<FaceLoopStats>;
  /**
   * ⭐ Ré-audit A3 — résout `true` quand une instance de détection est
   * RÉELLEMENT vivante (fin de la compilation WASM comprise), `false` si plus
   * aucune stratégie ne peut se créer (fatal déjà signalé par onError) ou si
   * la boucle est stoppée avant. L'IHM ne déclare « prêt » qu'après.
   */
  modelReady(): Promise<boolean>;
}

/** Ajoute la marge (letterbox) de la stratégie autour de la frame : le crop
 *  interne du landmarker (×1,5, mis au carré) cesse de déborder hors image sur
 *  un visage très proche. Les landmarks sont dé-mappés par `unpadPoint`. */
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
  g.fillStyle = '#7f7f7f'; // remplissage neutre, comme le letterbox interne de MediaPipe
  g.fillRect(0, 0, w, h);
  g.drawImage(s.source, Math.round(s.w * pad), Math.round(s.h * pad));
  return scratch;
}

/** Dé-mappe les landmarks du cadre AVEC marge vers le cadre d'origine (X/Y seuls). */
function unpadLandmarks(
  lm: ReadonlyArray<{ x: number; y: number; z?: number }>,
  pad: number,
): ReadonlyArray<{ x: number; y: number; z?: number }> {
  return lm.map((q) => ({ ...q, x: unpadPoint(q.x, pad), y: unpadPoint(q.y, pad) }));
}

/**
 * ⭐ Guide point 16 — la sortie du modèle est validée ICI, à la frontière.
 * Rend la raison du rejet, ou null si la frame est exploitable.
 */
export function landmarksInvalidReason(
  lm: ReadonlyArray<{ x: number; y: number }> | undefined,
): string | null {
  if (lm === undefined || lm.length === 0) return null; // « aucun visage » n'est pas « sortie invalide »
  if (lm.length < MIN_LANDMARKS) {
    return `sortie partielle : ${lm.length} landmarks au lieu de ${MIN_LANDMARKS}`;
  }
  for (const i of CRITICAL_LANDMARKS) {
    const p = lm[i];
    if (p === undefined || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return `landmark critique ${i} non fini`;
    }
  }
  return null;
}

export async function startFaceLoop(
  video: HTMLVideoElement,
  handlers: FaceLoopHandlers,
): Promise<FaceLoopControl> {
  const plan = initialPlan();
  let disposed = false;
  let lostStreak = 0;
  let lastTs = -1;
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
    modelState: 'creating',
    runningStrategy: null,
    feed: null,
  };

  const host = createModelHost(plan, {
    onProgress: (r) => handlers.onProgress?.(r),
    onWarning: (m) => handlers.onWarning?.(m),
    onError: (m) => handlers.onError?.(m),
  });
  host.ensure();

  const onSnapshot = (s: FrameSnapshot): void => {
    if (disposed) return;
    stats.modelState = host.state();
    stats.runningStrategy = host.runningStrategy()?.id ?? null;

    const landmarker = host.current();
    if (landmarker === null) {
      lostStreak++;
      handlers.onLost(lostStreak, 'model-pending', host.lastError() ?? 'modèle de détection en cours de création');
      host.ensure();
      return;
    }
    if (host.takeGenerationBump()) lastTs = -1; // nouvelle instance → nouveaux timestamps

    if (!s.validity.valid) {
      lostStreak++;
      planStep(plan, { frameValid: false, landmarksFound: false, nowMs: performance.now() });
      handlers.onLost(lostStreak, 'invalid-input', s.validity.reason);
      return;
    }
    stats.validFrames++;

    const ts = Math.max(performance.now(), lastTs + 1);
    lastTs = ts;

    let lm: ReadonlyArray<{ x: number; y: number; z?: number }> | undefined;
    let yaw = 0;
    const strategy = host.runningStrategy() ?? currentStrategy(plan);
    stats.inferenceAttempts++;
    try {
      const res = landmarker.detectForVideo(inputFor(s, strategy, scratch), ts);
      lm = res.faceLandmarks[0];
      const mat = res.facialTransformationMatrixes[0];
      if (mat !== undefined) yaw = yawFromMatrix(mat.data); // rotation : insensible à la marge
      stats.inferenceSuccess++;
      host.noteInferenceSuccess();
    } catch (err) {
      // ⭐ Point 71 — une exception d'inférence n'est PAS « visage non trouvé ».
      stats.inferenceErrors++;
      stats.lastInferenceError = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
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
      planStep(plan, { frameValid: true, landmarksFound: true, nowMs: performance.now() });
      handlers.onLandmarks(lm, yaw, coordinateSpaceOf(strategy));
      return;
    }

    lostStreak++;
    const t = planStep(plan, { frameValid: true, landmarksFound: false, nowMs: performance.now() });
    handlers.onLost(lostStreak, 'no-face', strategy.label);
    if (t.advanceTo !== null) {
      handlers.onTransition?.(t.reason ?? currentStrategy(plan).label);
      // Une seule Task (A1) : l'ancienne est fermée, la création court sous
      // watchdog — les frames de la fenêtre sont `model-pending`, et c'est dit.
      host.ensure();
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
  };
}
