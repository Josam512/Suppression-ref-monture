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
import { currentStrategy, DETECTION_STRATEGIES, type DetectionPlan, type DetectionStrategy } from './detectionPlan.js';

/** Création d'une instance MediaPipe : au-delà, elle est réputée PENDUE. */
export const MODEL_CREATE_TIMEOUT_MS = 15_000;
/** Exceptions d'inférence consécutives avant recréation, puis descente. */
export const INFERENCE_ERROR_SWAP_AFTER = 10;
/** Tempête INDÉPASSABLE (échelle épuisée) : tentatives ESPACÉES à cette cadence.
 *  Marteler à la cadence caméra un moteur qui lève à CHAQUE appel a tué l'onglet
 *  du runner CI (S13, fuite native par appel). Un succès → plein régime. */
export const STORM_RETRY_MS = 250;

export type ModelState = 'creating' | 'ready' | 'failed';

/** Fabrique une instance pour UNE stratégie. Injectable (banc du ré-audit A1). */
export type LandmarkerFactory = (
  onProgress: (ratio: number) => void,
  strategy: DetectionStrategy,
) => Promise<FaceLandmarker>;

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
  const fresh = await createLandmarker(onProgress, strategy.delegate, strategy.minConfidence);
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

/** Course entre une création et son délai. Une résolution TARDIVE est fermée. */
function createWithWatchdog(
  factory: LandmarkerFactory,
  strategy: DetectionStrategy,
  onProgress: (r: number) => void,
): Promise<FaceLandmarker> {
  let settled = false;
  return new Promise<FaceLandmarker>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`création « ${strategy.label} » sans réponse après ${MODEL_CREATE_TIMEOUT_MS / 1000} s`));
    }, MODEL_CREATE_TIMEOUT_MS);
    factory(onProgress, strategy).then(
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
        // 2e repli — la marche suivante de l'échelle, même contrat.
        if (targetIndex < DETECTION_STRATEGIES.length - 1) {
          plan.strategyIndex = targetIndex + 1;
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
        plan.recoveryAttempts = 0;
        recreateTried = false;
        cb.onWarning(`l'inférence lève toujours — j'essaie « ${currentStrategy(plan).label} ».`);
        ensure();
      } else {
        stormExhausted = true; // plus rien à essayer : tentatives espacées (STORM_RETRY_MS)
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
