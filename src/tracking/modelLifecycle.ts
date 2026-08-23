/**
 * tracking/modelLifecycle.ts — le CYCLE DE VIE du backend de suivi.
 *
 * Porte les points 6 et 8–10 du guide, resserrés par A1/A3 et la refonte
 * FaceTracker (2026-08-23) :
 *
 *   - toute création est sous WATCHDOG (taskWatchdog) ; une résolution
 *     TARDIVE est éliminée, jamais laissée fuir ;
 *   - 🔴 UNE SEULE Task lourde vivante à tout instant : le remplacement
 *     ÉLIMINE le backend courant AVANT de créer la cible ; pendant la fenêtre,
 *     les frames sont `model-pending`, et c'est dit ;
 *   - 🔴 `init` réussi ne prouve RIEN : la SANTÉ vient d'une sonde réelle —
 *     PROBE_REQUIRED_SUCCESSES inférences propres après adoption → healthy ;
 *     une création qui réussit puis lève au premier detect = backend KO
 *     (négociation : 3 erreurs → suivant) ;
 *   - stratégie ÉPROUVÉE en tempête : recréer la même, puis avancer ;
 *     l'espacement STORM_RETRY_MS n'arrive qu'après TOUT le catalogue ;
 *   - `whenReady()` dit quand un backend est RÉELLEMENT vivant (A3).
 *
 * La FABRIQUE est injectable : les bancs comptent les backends vivants et
 * prouvent `maxAlive === 1` sur les séquences réelles.
 */

import { MediaPipeTracker } from './backends/MediaPipeTracker.js';
import { createWithWatchdog, type TrackerFactory } from './taskWatchdog.js';
import { PROBE_REQUIRED_SUCCESSES, type FaceTracker, type TrackerHealth } from './FaceTracker.js';
import {
  advanceStrategy,
  allStrategiesTried,
  currentStrategy,
  DETECTION_STRATEGIES,
  type DetectionPlan,
  type DetectionStrategy,
} from './detectionPlan.js';

export { createWithWatchdog, MODEL_CREATE_TIMEOUT_MS, type TrackerFactory } from './taskWatchdog.js';
export { PROBE_REQUIRED_SUCCESSES, type TrackerHealth } from './FaceTracker.js';

/** Stratégie ÉPROUVÉE : exceptions consécutives avant recréation, puis avance. */
export const INFERENCE_ERROR_SWAP_AFTER = 10;
/** 🔴 Négociation — stratégie JAMAIS éprouvée : élimination rapide. 3 erreurs
 *  d'inférence consécutives suffisent (Samsung réel : le graph lève à CHAQUE
 *  frame) ; le backend est éliminé et le suivant du catalogue est essayé. */
export const NEGOTIATION_ERROR_NEXT_AFTER = 3;
/** Tempête INDÉPASSABLE (catalogue épuisé) : tentatives ESPACÉES à cette cadence.
 *  Marteler à la cadence caméra un moteur qui lève à CHAQUE appel a tué l'onglet
 *  du runner CI (S13, fuite native par appel). Un succès → plein régime. */
export const STORM_RETRY_MS = 250;

export type ModelState = 'creating' | 'ready' | 'failed';

/**
 * ⭐ Ré-audit AP — le NOMBRE de backends vivants, compté à la source : la
 * fabrique par défaut incrémente à la création et décore `dispose()` pour
 * décrémenter. La santé (`__VTO_HEALTH__.aliveTasks`) et le soak affirment
 * `≤ 1` en continu — le contrat du point 6, observé.
 */
let aliveTasks = 0;

export function aliveTaskCount(): number {
  return aliveTasks;
}

const defaultFactory: TrackerFactory = async (onProgress, strategy) => {
  const fresh = new MediaPipeTracker(strategy);
  await fresh.init({ onProgress });
  aliveTasks++;
  const realDispose = fresh.dispose.bind(fresh);
  (fresh as { dispose(): void }).dispose = () => {
    aliveTasks = Math.max(0, aliveTasks - 1);
    realDispose();
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
  current(): FaceTracker | null;
  /** Stratégie de l'instance VIVANTE (l'index du plan peut viser plus loin). */
  runningStrategy(): DetectionStrategy | null;
  state(): ModelState;
  /** La santé PROUVÉE du backend courant — jamais déduite d'un init réussi. */
  health(): TrackerHealth;
  lastError(): string | null;
  /** Réconcilie l'instance vivante avec `plan.strategyIndex`. */
  ensure(force?: boolean): void;
  noteInferenceError(): void;
  noteInferenceSuccess(): void;
  /** Nouvelle instance depuis le dernier appel ? (l'appelant remet ses timestamps à zéro) */
  takeGenerationBump(): boolean;
  /** > 0 quand la tempête a épuisé le catalogue : la boucle ESPACE ses tentatives. */
  retryDelayMs(): number;
  /** ⭐ A3 — `true` à la PREMIÈRE instance vivante, `false` si fatal/démontage. */
  whenReady(): Promise<boolean>;
  dispose(): void;
}

const describeError = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).slice(0, 90);

export function createModelHost(
  plan: DetectionPlan,
  cb: ModelHostCallbacks,
  factory: TrackerFactory = defaultFactory,
): ModelHost {
  let active: FaceTracker | null = null;
  let runningIndex = -1;
  let creating = false;
  let disposed = false;
  let state: ModelState = 'creating';
  let modelError: string | null = null;
  let generationBump = false;
  let consecutiveErrors = 0;
  let recreateTried = false;
  let stormExhausted = false;
  let probeSuccesses = 0;
  let healthySinceMs = 0;

  let readyOutcome: boolean | null = null;
  let readyResolvers: Array<(ok: boolean) => void> = [];
  function settleReady(ok: boolean): void {
    if (readyOutcome !== null) return; // seule la PREMIÈRE conclusion compte
    readyOutcome = ok;
    for (const r of readyResolvers) r(ok);
    readyResolvers = [];
  }

  /** L'instance fraîche devient LE backend — l'unique, l'ancien déjà éliminé. */
  function adopt(fresh: FaceTracker, index: number): void {
    active = fresh;
    runningIndex = index;
    generationBump = true; // nouvelle instance → nouveau domaine de timestamps
    state = 'ready';
    modelError = null;
    probeSuccesses = 0; // 🔴 la santé se REPROUVE : init réussi n'est pas sain
    settleReady(true);
  }

  function ensure(force = false): void {
    if (disposed || creating) return;
    if (state === 'failed' && !force) return; // fatal déjà dit : le bouton Réessayer remonte tout
    if (!force && active !== null && runningIndex === plan.strategyIndex) return;
    creating = true;
    state = 'creating';
    const targetIndex = plan.strategyIndex;
    const target = DETECTION_STRATEGIES[targetIndex] ?? DETECTION_STRATEGIES[0]!;

    // 🔴 Ré-audit A1 — le contrat « une seule Task » prime : l'instance
    // courante est ÉLIMINÉE avant toute création. La stratégie qui marchait
    // est mémorisée pour être recréée si la cible échoue.
    const fallbackIndex = active !== null && runningIndex !== targetIndex ? runningIndex : -1;
    if (active !== null) {
      active.dispose();
      active = null;
      runningIndex = -1;
    }

    void createWithWatchdog(factory, target, cb.onProgress)
      .then((fresh) => {
        if (disposed) {
          fresh.dispose();
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
              back.dispose();
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
        if (!disposed && (state === 'creating' || (active !== null && runningIndex !== plan.strategyIndex))) {
          ensure();
        }
      });
  }

  return {
    current: () => active,
    runningStrategy: () => (runningIndex >= 0 ? (DETECTION_STRATEGIES[runningIndex] ?? null) : null),
    state: () => state,
    health(): TrackerHealth {
      if (state === 'failed') return { state: 'failed', reason: modelError ?? 'aucune stratégie ne se crée' };
      if (stormExhausted) return { state: 'degraded', reason: 'tempête d’inférence — tout le catalogue épuisé, tentatives espacées' };
      if (state === 'creating' || active === null) return { state: 'initializing' };
      if (probeSuccesses < PROBE_REQUIRED_SUCCESSES) return { state: 'probing', successes: probeSuccesses };
      return { state: 'healthy', sinceMs: healthySinceMs };
    },
    lastError: () => modelError,
    ensure,
    noteInferenceError(): void {
      consecutiveErrors++;
      // 🔴 Négociation — une stratégie JAMAIS éprouvée qui lève est éliminée
      // VITE : le backend est fermé, le suivant du catalogue essayé. Une
      // stratégie qui A suivi garde la règle prudente (recréer d'abord).
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
      if (probeSuccesses < PROBE_REQUIRED_SUCCESSES) {
        probeSuccesses++;
        if (probeSuccesses === PROBE_REQUIRED_SUCCESSES) healthySinceMs = performance.now();
      }
    },
    takeGenerationBump(): boolean {
      const b = generationBump;
      generationBump = false;
      return b;
    },
    retryDelayMs: () => (stormExhausted ? STORM_RETRY_MS : 0),
    whenReady(): Promise<boolean> {
      if (readyOutcome !== null) return Promise.resolve(readyOutcome);
      return new Promise<boolean>((res) => readyResolvers.push(res));
    },
    dispose(): void {
      disposed = true;
      settleReady(false);
      active?.dispose();
      active = null;
    },
  };
}
