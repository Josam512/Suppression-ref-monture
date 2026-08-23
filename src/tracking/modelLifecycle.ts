/**
 * tracking/modelLifecycle.ts — le CYCLE DE VIE de l'instance FaceLandmarker.
 *
 * Scindé de `faceLoop.ts` (règle des 300 lignes, §3). Porte les points 6 et
 * 8–10 du guide de fiabilisation, resserrés par le ré-audit A1/A3 :
 *
 *   - toute création est sous WATCHDOG : `createFromOptions` peut réussir,
 *     rejeter… ou rester pendu — un `.catch()` ne couvre pas le troisième cas.
 *     Une résolution TARDIVE est fermée, jamais laissée fuir ;
 *   - 🔴 UNE SEULE Task MediaPipe vivante, à tout instant (point 6). Le
 *     remplacement ferme donc l'instance courante AVANT de créer la cible.
 *     L'ordre inverse (créer puis fermer) laissait DEUX FaceLandmarker vivants
 *     pendant toute la création — des secondes entières de WASM/GPU doublés.
 *     Pendant la fenêtre de création, les frames sont `model-pending`, et
 *     l'écran le DIT (paintLost) : une attente expliquée vaut mieux qu'un
 *     doublon de Task ;
 *   - si la cible échoue, la stratégie qui MARCHAIT est recréée sous le même
 *     watchdog ; si elle échoue aussi, l'échelle continue ; l'erreur ne
 *     devient fatale que quand AUCUNE stratégie ne peut plus se créer ;
 *   - une TEMPÊTE d'erreurs d'inférence (GPU perdu après avoir suivi un
 *     visage) recrée d'abord la même stratégie, puis descend l'échelle ;
 *   - `whenReady()` dit quand une instance est RÉELLEMENT vivante : l'IHM ne
 *     déclare « prêt » qu'à ce moment-là (ré-audit A3), jamais pendant la
 *     compilation WASM.
 *
 * La FABRIQUE d'instance est injectable : le banc (tests/lifecycle.test.ts)
 * compte les Tasks vivantes et prouve `maxAliveTasks === 1` sur les séquences
 * réelles — création, swap, échec, tempête, résolution tardive.
 */

import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { createLandmarker } from './landmarker.js';
import { createWithWatchdog, type LandmarkerFactory } from './taskWatchdog.js';
import {
  advanceStrategy,
  allStrategiesTried,
  currentStrategy,
  DETECTION_STRATEGIES,
  type DetectionPlan,
  type DetectionStrategy,
} from './detectionPlan.js';

export { createWithWatchdog, MODEL_CREATE_TIMEOUT_MS, type LandmarkerFactory } from './taskWatchdog.js';

/** Stratégie ÉPROUVÉE : exceptions consécutives avant recréation, puis avance. */
export const INFERENCE_ERROR_SWAP_AFTER = 10;
/** 🔴 Négociation — stratégie JAMAIS éprouvée : élimination rapide. 3 erreurs
 *  d'inférence consécutives suffisent (Samsung réel : le graph lève à CHAQUE
 *  frame — attendre 10 erreurs × 10 marches gaspillait la séance) ; la Task
 *  est fermée et la suivante du catalogue est essayée. */
export const NEGOTIATION_ERROR_NEXT_AFTER = 3;
/** Tempête INDÉPASSABLE (échelle épuisée) : tentatives ESPACÉES à cette cadence.
 *  Marteler à la cadence caméra un moteur qui lève à CHAQUE appel a tué l'onglet
 *  du runner CI (S13, fuite native par appel). Un succès → plein régime. */
export const STORM_RETRY_MS = 250;

export type ModelState = 'creating' | 'ready' | 'failed';

/**
 * ⭐ Ré-audit AP — le NOMBRE de FaceLandmarker vivants, compté à la source :
 * la fabrique par défaut incrémente à la création et décore `close()` pour
 * décrémenter. La santé (`__VTO_HEALTH__.aliveTasks`) et les bancs longue
 * durée (soak) affirment `≤ 1` en continu — le contrat du point 6, observé.
 */
let aliveTasks = 0;

export function aliveTaskCount(): number {
  return aliveTasks;
}

const defaultFactory: LandmarkerFactory = async (onProgress, strategy) => {
  const fresh = await createLandmarker(onProgress, strategy.delegate, strategy.minConfidence, strategy.matrices);
  aliveTasks++;
  const realClose = fresh.close.bind(fresh);
  (fresh as { close(): void }).close = () => {
    aliveTasks = Math.max(0, aliveTasks - 1);
    realClose();
  };
  return fresh;
};

export interface ModelHostCallbacks {
  onProgress(ratio: number): void;
  /** Dégradation RÉCUPÉRABLE : la séance continue (guide, point 10). */
  onWarning(message: string): void;
  /** FATAL : plus aucune stratégie ne peut se créer. */
  onError(message: string): void;
  /** 🔴 Négociation — une stratégie vient d'être ÉLIMINÉE (tableau du HUD). */
  onAdvance?(fromId: string, outcome: 'erreurs' | 'création-KO', detail: string): void;
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
  /** > 0 quand la tempête a épuisé l'échelle : la boucle ESPACE ses tentatives. */
  retryDelayMs(): number;
  /**
   * ⭐ Ré-audit A3 — résout `true` à la PREMIÈRE instance vivante, `false` si
   * plus aucune stratégie ne peut se créer (fatal, déjà signalé par onError)
   * ou si l'hôte est démonté avant. Ne rejette jamais.
   */
  whenReady(): Promise<boolean>;
  dispose(): void;
}

const describeError = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).slice(0, 90);

export function createModelHost(
  plan: DetectionPlan,
  cb: ModelHostCallbacks,
  factory: LandmarkerFactory = defaultFactory,
): ModelHost {
  let landmarker: FaceLandmarker | null = null;
  let runningIndex = -1;
  let creating = false;
  let disposed = false;
  let state: ModelState = 'creating';
  let modelError: string | null = null;
  let generationBump = false;
  let consecutiveErrors = 0;
  let recreateTried = false;
  let stormExhausted = false;

  let readyOutcome: boolean | null = null;
  let readyResolvers: Array<(ok: boolean) => void> = [];
  function settleReady(ok: boolean): void {
    if (readyOutcome !== null) return; // seule la PREMIÈRE conclusion compte
    readyOutcome = ok;
    for (const r of readyResolvers) r(ok);
    readyResolvers = [];
  }

  /** L'instance fraîche devient LA Task — l'unique, l'ancienne étant déjà fermée. */
  function adopt(fresh: FaceLandmarker, index: number): void {
    landmarker = fresh;
    runningIndex = index;
    generationBump = true; // nouvelle instance → nouveau domaine de timestamps
    state = 'ready';
    modelError = null;
    settleReady(true);
  }

  function ensure(force = false): void {
    if (disposed || creating) return;
    if (state === 'failed' && !force) return; // fatal déjà dit : le bouton Réessayer remonte tout
    if (!force && landmarker !== null && runningIndex === plan.strategyIndex) return;
    creating = true;
    state = 'creating';
    const targetIndex = plan.strategyIndex;
    const target = DETECTION_STRATEGIES[targetIndex] ?? DETECTION_STRATEGIES[0]!;

    // 🔴 Ré-audit A1 — le contrat « une seule Task » prime : l'instance
    // courante est FERMÉE avant toute création. La stratégie qui marchait est
    // mémorisée pour être recréée si la cible échoue.
    const fallbackIndex = landmarker !== null && runningIndex !== targetIndex ? runningIndex : -1;
    if (landmarker !== null) {
      landmarker.close();
      landmarker = null;
      runningIndex = -1;
    }

    void createWithWatchdog(factory, target, cb.onProgress)
      .then((fresh) => {
        if (disposed) {
          fresh.close();
          return;
        }
        adopt(fresh, targetIndex);
      })
      .catch(async (err: unknown) => {
        modelError = `modèle « ${target.label} » indisponible : ${describeError(err)}`;
        // 1er repli — recréer la stratégie qui MARCHAIT, sous le même watchdog.
        const fallback = fallbackIndex >= 0 ? DETECTION_STRATEGIES[fallbackIndex] : undefined;
        if (fallback !== undefined && !disposed) {
          cb.onWarning(`${modelError} — je recrée « ${fallback.label} ».`);
          try {
            const back = await createWithWatchdog(factory, fallback, cb.onProgress);
            if (disposed) {
              back.close();
              return;
            }
            plan.strategyIndex = fallbackIndex;
            adopt(back, fallbackIndex);
            return;
          } catch (err2: unknown) {
            modelError = `recréation « ${fallback.label} » impossible : ${describeError(err2)}`;
          }
        }
        if (disposed) return;
        // 2e repli — la stratégie suivante du catalogue (avance circulaire) ;
        // fatal seulement quand TOUT le catalogue a été visité sans succès.
        cb.onAdvance?.(target.id, 'création-KO', modelError);
        if (!allStrategiesTried(plan)) {
          if (plan.strategyIndex === targetIndex) advanceStrategy(plan);
          state = 'creating';
          cb.onWarning(`${modelError} — j'essaie « ${currentStrategy(plan).label} ».`);
        } else {
          state = 'failed';
          settleReady(false);
          cb.onError(
            `Aucune stratégie de détection n'a pu se créer (dernier échec : ${describeError(err)}). ` +
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
      // 🔴 Négociation — une stratégie JAMAIS éprouvée qui lève est éliminée
      // VITE : fermer la Task, essayer la suivante du catalogue. Une stratégie
      // qui A suivi garde la règle prudente (recréer d'abord) : une perte GPU
      // transitoire ne condamne pas une marche qui marchait.
      if (!plan.strategyEverTracked && !allStrategiesTried(plan)) {
        if (consecutiveErrors < NEGOTIATION_ERROR_NEXT_AFTER) return;
        consecutiveErrors = 0;
        recreateTried = false;
        const from = currentStrategy(plan);
        advanceStrategy(plan);
        cb.onAdvance?.(from.id, 'erreurs', `${NEGOTIATION_ERROR_NEXT_AFTER} erreurs d'inférence consécutives`);
        cb.onWarning(`« ${from.label} » lève à l'inférence — j'essaie « ${currentStrategy(plan).label} ».`);
        ensure();
        return;
      }
      if (consecutiveErrors < INFERENCE_ERROR_SWAP_AFTER) return;
      consecutiveErrors = 0;
      if (!recreateTried) {
        recreateTried = true;
        cb.onWarning(`l'inférence lève en continu — je recrée « ${currentStrategy(plan).label} ».`);
        ensure(true);
        return;
      }
      if (!allStrategiesTried(plan)) {
        recreateTried = false;
        const from = currentStrategy(plan);
        advanceStrategy(plan);
        cb.onAdvance?.(from.id, 'erreurs', 'lève encore après recréation');
        cb.onWarning(`l'inférence lève toujours — j'essaie « ${currentStrategy(plan).label} ».`);
        ensure();
      } else {
        stormExhausted = true; // TOUT le catalogue essayé : tentatives espacées (STORM_RETRY_MS)
      }
    },
    noteInferenceSuccess(): void {
      consecutiveErrors = 0;
      recreateTried = false;
      stormExhausted = false;
    },
    retryDelayMs: () => (stormExhausted ? STORM_RETRY_MS : 0),
    takeGenerationBump(): boolean {
      const b = generationBump;
      generationBump = false;
      return b;
    },
    whenReady(): Promise<boolean> {
      if (readyOutcome !== null) return Promise.resolve(readyOutcome);
      return new Promise<boolean>((res) => readyResolvers.push(res));
    },
    dispose(): void {
      disposed = true;
      settleReady(false);
      landmarker?.close();
      landmarker = null;
    },
  };
}
