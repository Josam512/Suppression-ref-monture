/**
 * tracking/modelLifecycle.ts — le CYCLE DE VIE de l'instance FaceLandmarker.
 *
 * Scindé de `faceLoop.ts` (règle des 300 lignes, §3). Porte les points 8–10 du
 * guide de fiabilisation :
 *
 *   - toute création est sous WATCHDOG : `createFromOptions` peut réussir,
 *     rejeter… ou rester pendu — un `.catch()` ne couvre pas le troisième cas.
 *     Une résolution TARDIVE est fermée, jamais laissée fuir ;
 *   - le remplacement est TRANSACTIONNEL : la nouvelle instance est créée
 *     AVANT que l'ancienne soit fermée. Un échec laisse l'ancienne en service
 *     et se dit comme une dégradation RÉCUPÉRABLE ; l'erreur ne devient fatale
 *     que quand AUCUNE stratégie ne peut plus se créer ;
 *   - une TEMPÊTE d'erreurs d'inférence (GPU perdu après avoir suivi un
 *     visage) recrée d'abord la même stratégie, puis descend l'échelle — le
 *     seul cas où une stratégie déjà victorieuse est quittée.
 */

import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { createLandmarker } from './landmarker.js';
import { currentStrategy, DETECTION_STRATEGIES, type DetectionPlan, type DetectionStrategy } from './detectionPlan.js';

/** Création d'une instance MediaPipe : au-delà, elle est réputée PENDUE. */
export const MODEL_CREATE_TIMEOUT_MS = 15_000;
/** Exceptions d'inférence consécutives avant recréation, puis descente. */
export const INFERENCE_ERROR_SWAP_AFTER = 10;

export type ModelState = 'creating' | 'ready' | 'failed';

export interface ModelHostCallbacks {
  onProgress(ratio: number): void;
  /** Dégradation RÉCUPÉRABLE : la séance continue (guide, point 10). */
  onWarning(message: string): void;
  /** FATAL : plus aucune stratégie ne peut se créer. */
  onError(message: string): void;
}

export interface ModelHost {
  current(): FaceLandmarker | null;
  /** Stratégie de l'instance VIVANTE (l'index du plan peut viser plus loin). */
  runningStrategy(): DetectionStrategy | null;
  state(): ModelState;
  lastError(): string | null;
  /** Réconcilie l'instance vivante avec `plan.strategyIndex`. */
  ensure(force?: boolean): void;
  noteInferenceError(): void;
  noteInferenceSuccess(): void;
  /** Nouvelle instance depuis le dernier appel ? (l'appelant remet ses timestamps à zéro) */
  takeGenerationBump(): boolean;
  dispose(): void;
}

/** Course entre une création et son délai. Une résolution TARDIVE est fermée. */
function createWithWatchdog(strategy: DetectionStrategy, onProgress: (r: number) => void): Promise<FaceLandmarker> {
  let settled = false;
  return new Promise<FaceLandmarker>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`création « ${strategy.label} » sans réponse après ${MODEL_CREATE_TIMEOUT_MS / 1000} s`));
    }, MODEL_CREATE_TIMEOUT_MS);
    createLandmarker(onProgress, strategy.delegate, strategy.minConfidence).then(
      (fresh) => {
        if (settled) {
          fresh.close(); // arrivée après le délai : ne pas laisser fuir une Task
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(fresh);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export function createModelHost(plan: DetectionPlan, cb: ModelHostCallbacks): ModelHost {
  let landmarker: FaceLandmarker | null = null;
  let runningIndex = -1;
  let creating = false;
  let disposed = false;
  let state: ModelState = 'creating';
  let modelError: string | null = null;
  let generationBump = false;
  let consecutiveErrors = 0;
  let recreateTried = false;

  function ensure(force = false): void {
    if (disposed || creating) return;
    if (!force && landmarker !== null && runningIndex === plan.strategyIndex) return;
    creating = true;
    state = 'creating';
    const targetIndex = plan.strategyIndex;
    const target = DETECTION_STRATEGIES[targetIndex] ?? DETECTION_STRATEGIES[0]!;

    void createWithWatchdog(target, cb.onProgress)
      .then((fresh) => {
        if (disposed) {
          fresh.close();
          return;
        }
        const old = landmarker;
        landmarker = fresh;
        runningIndex = targetIndex;
        generationBump = true; // nouvelle instance → nouveau domaine de timestamps
        state = 'ready';
        modelError = null;
        old?.close(); // l'ancienne ne meurt qu'ICI, la neuve étant en service
      })
      .catch((err: unknown) => {
        const detail = err instanceof Error ? err.message.slice(0, 90) : String(err).slice(0, 90);
        modelError = `modèle « ${target.label} » indisponible : ${detail}`;
        if (landmarker !== null) {
          // L'ancienne stratégie vit toujours : on la garde, on le DIT (point 10).
          plan.strategyIndex = runningIndex;
          state = 'ready';
          cb.onWarning(`${modelError} — je continue avec « ${currentStrategy(plan).label} ».`);
        } else if (targetIndex < DETECTION_STRATEGIES.length - 1) {
          plan.strategyIndex = targetIndex + 1;
          state = 'creating';
          cb.onWarning(`${modelError} — j'essaie « ${currentStrategy(plan).label} ».`);
        } else {
          state = 'failed';
          cb.onError(
            `Aucune stratégie de détection n'a pu se créer (dernier échec : ${detail}). ` +
              `Rechargez la page ; si cela persiste, essayez un autre navigateur.`,
          );
        }
      })
      .finally(() => {
        creating = false;
        // Un échec intermédiaire a pu viser une nouvelle marche, ou une
        // transition a pu être décidée PENDANT la création : réconcilier.
        if (!disposed && (state === 'creating' || (landmarker !== null && runningIndex !== plan.strategyIndex))) {
          ensure();
        }
      });
  }

  return {
    current: () => landmarker,
    runningStrategy: () => (runningIndex >= 0 ? (DETECTION_STRATEGIES[runningIndex] ?? null) : null),
    state: () => state,
    lastError: () => modelError,
    ensure,
    noteInferenceError(): void {
      consecutiveErrors++;
      if (consecutiveErrors < INFERENCE_ERROR_SWAP_AFTER) return;
      consecutiveErrors = 0;
      if (!recreateTried) {
        recreateTried = true;
        cb.onWarning(`l'inférence lève en continu — je recrée « ${currentStrategy(plan).label} ».`);
        ensure(true);
        return;
      }
      if (plan.strategyIndex < DETECTION_STRATEGIES.length - 1) {
        plan.strategyIndex++;
        plan.strategyEverTracked = false;
        plan.silentSinceMs = null;
        plan.silentValidFrames = 0;
        recreateTried = false;
        cb.onWarning(`l'inférence lève toujours — j'essaie « ${currentStrategy(plan).label} ».`);
        ensure();
      }
    },
    noteInferenceSuccess(): void {
      consecutiveErrors = 0;
      recreateTried = false;
    },
    takeGenerationBump(): boolean {
      const b = generationBump;
      generationBump = false;
      return b;
    },
    dispose(): void {
      disposed = true;
      landmarker?.close();
      landmarker = null;
    },
  };
}
