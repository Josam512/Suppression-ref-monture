/**
 * tracking/inferenceNotes.ts — la machine des NOTES d'inférence du cycle de
 * vie (extraite de modelLifecycle.ts, règle des 300 lignes §3).
 *
 * Trois notes, trois vérités distinctes (🔴 ré-audit humain 2026-08-23) :
 *   - `noteError`     : le graph a LEVÉ — négociation (3 erreurs → suivante
 *     tant que rien n'est prouvé), prudence (10 + recréation pour une
 *     stratégie PROUVÉE), tempête espacée, et TOURS de renégociation ;
 *   - `noteCompleted` : inférence PROPRE — efface erreurs et tempête, mais ne
 *     prouve RIEN (un detect() vide n'avance jamais la sonde) ;
 *   - `noteValidFace` : un visage VALIDÉ — la SEULE preuve : elle avance la
 *     sonde vers healthy et mémorise la stratégie « historiquement saine ».
 */

import { PROBE_REQUIRED_SUCCESSES } from './FaceTracker.js';
import {
  advanceStrategy,
  allStrategiesTried,
  currentStrategy,
  restartRound,
  type DetectionPlan,
} from './detectionPlan.js';

/** Stratégie ÉPROUVÉE : exceptions consécutives avant recréation, puis avance. */
export const INFERENCE_ERROR_SWAP_AFTER = 10;
/** 🔴 Négociation — stratégie JAMAIS prouvée : élimination rapide. 3 erreurs
 *  d'inférence consécutives suffisent (Samsung réel : le graph lève à CHAQUE
 *  frame) ; le backend est éliminé et le suivant du catalogue est essayé. */
export const NEGOTIATION_ERROR_NEXT_AFTER = 3;
/** Tempête INDÉPASSABLE (catalogue épuisé) : tentatives ESPACÉES à cette cadence.
 *  Marteler à la cadence caméra un moteur qui lève à CHAQUE appel a tué l'onglet
 *  du runner CI (S13, fuite native par appel). Un succès → plein régime. */
export const STORM_RETRY_MS = 250;
/** 🔴 Ré-audit 2026-08-23 — la tempête ne fige plus la DERNIÈRE stratégie pour
 *  toujours : ce cooldown écoulé, un NOUVEAU TOUR du catalogue repart (depuis
 *  la dernière stratégie historiquement saine, sinon le début) — l'état
 *  GPU/navigateur a pu changer. Le tour reste ESPACÉ (STORM_RETRY_MS). */
export const STORM_RENEGOTIATE_MS = 20_000;

/** L'état mutable des notes — possédé par le host, lu par sa santé. */
export interface InferenceNotes {
  consecutiveErrors: number;
  recreateTried: boolean;
  stormExhausted: boolean;
  /** Début de l'épuisement courant (cooldown de renégociation). */
  stormSinceMs: number;
  probeSuccesses: number;
  healthySinceMs: number;
  /** Dernière stratégie ayant atteint la sonde complète (« historiquement saine »). */
  lastProvenIndex: number;
}

export function initialNotes(): InferenceNotes {
  return {
    consecutiveErrors: 0,
    recreateTried: false,
    stormExhausted: false,
    stormSinceMs: 0,
    probeSuccesses: 0,
    healthySinceMs: 0,
    lastProvenIndex: -1,
  };
}

/** Ce que la machine des notes a le droit de déclencher chez le host. */
export interface NoteHooks {
  onWarning(message: string): void;
  onAdvance?(fromId: string, outcome: 'erreurs' | 'création-KO', detail: string): void;
  ensure(force?: boolean): void;
}

export function noteError(n: InferenceNotes, plan: DetectionPlan, hooks: NoteHooks): void {
  n.consecutiveErrors++;
  // 🔴 Ré-audit 2026-08-23 — catalogue épuisé DEPUIS un cooldown entier : on
  // ne reste pas collé sur la dernière stratégie. NOUVEAU TOUR depuis la
  // dernière stratégie historiquement saine (sinon le début), toujours
  // ESPACÉ (stormExhausted reste vrai jusqu'à une inférence propre).
  if (n.stormExhausted && performance.now() - n.stormSinceMs >= STORM_RENEGOTIATE_MS) {
    n.stormSinceMs = performance.now();
    n.consecutiveErrors = 0;
    n.recreateTried = false;
    restartRound(plan, n.lastProvenIndex >= 0 ? n.lastProvenIndex : 0);
    hooks.onWarning(
      `la tempête d'inférence persiste — nouveau tour du catalogue depuis « ${currentStrategy(plan).label} ».`,
    );
    hooks.ensure(true);
    return;
  }
  // 🔴 Négociation — une stratégie JAMAIS prouvée (ré-audit : 5 landmarks
  // consécutifs) qui lève est éliminée VITE : le backend est fermé, le
  // suivant essayé. Une stratégie PROUVÉE garde la règle prudente.
  if (!plan.strategyProven && !allStrategiesTried(plan)) {
    if (n.consecutiveErrors < NEGOTIATION_ERROR_NEXT_AFTER) return;
    n.consecutiveErrors = 0;
    n.recreateTried = false;
    const from = currentStrategy(plan);
    advanceStrategy(plan);
    hooks.onAdvance?.(from.id, 'erreurs', `${NEGOTIATION_ERROR_NEXT_AFTER} erreurs d'inférence consécutives`);
    hooks.onWarning(`« ${from.label} » lève à l'inférence — j'essaie « ${currentStrategy(plan).label} ».`);
    hooks.ensure();
    return;
  }
  if (n.consecutiveErrors < INFERENCE_ERROR_SWAP_AFTER) return;
  n.consecutiveErrors = 0;
  if (!n.recreateTried) {
    n.recreateTried = true;
    hooks.onWarning(`l'inférence lève en continu — je recrée « ${currentStrategy(plan).label} ».`);
    hooks.ensure(true);
    return;
  }
  if (!allStrategiesTried(plan)) {
    n.recreateTried = false;
    const from = currentStrategy(plan);
    advanceStrategy(plan);
    hooks.onAdvance?.(from.id, 'erreurs', 'lève encore après recréation');
    hooks.onWarning(`l'inférence lève toujours — j'essaie « ${currentStrategy(plan).label} ».`);
    hooks.ensure();
  } else if (!n.stormExhausted) {
    n.stormExhausted = true; // TOUT le catalogue essayé : tentatives espacées (STORM_RETRY_MS)
    n.stormSinceMs = performance.now(); // …et le cooldown de renégociation démarre
  }
}

/** Inférence PROPRE : efface erreurs et tempête. 🔴 Ne prouve RIEN. */
export function noteCompleted(n: InferenceNotes): void {
  n.consecutiveErrors = 0;
  n.recreateTried = false;
  n.stormExhausted = false;
}

/** 🔴 Un visage VALIDÉ : la SEULE avance de la sonde de santé. */
export function noteValidFace(n: InferenceNotes, runningIndex: number): void {
  if (n.probeSuccesses < PROBE_REQUIRED_SUCCESSES) {
    n.probeSuccesses++;
    if (n.probeSuccesses === PROBE_REQUIRED_SUCCESSES) {
      n.healthySinceMs = performance.now();
      n.lastProvenIndex = runningIndex; // « historiquement saine » pour les tours
    }
  }
}
