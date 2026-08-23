/**
 * tracking/planState.ts — l'ÉTAT du plan de détection et son avance circulaire.
 *
 * Extrait de `detectionPlan.ts` (règle des 300 lignes, §3). C'est ici que vit
 * la mécanique de NÉGOCIATION (arbitrage humain 2026-08-22) : le plan peut
 * démarrer sur une stratégie MÉMORISÉE (appareil déjà négocié), l'avance
 * boucle sur le catalogue, et « tout essayé » ne devient vrai qu'après avoir
 * VISITÉ chaque stratégie du tour courant.
 *
 * 🔴 Ré-audit humain 2026-08-23 (soir) — la PREUVE est consécutive et c'est
 * ELLE qui confère les égards :
 *   - `stableFrames` est remis à zéro par toute frame valide SANS visage :
 *     5 frames éparses sur 2 minutes ne sont pas « 5 frames stables » ;
 *   - `strategyProven` (ex-`strategyEverTracked`, requalifié) n'est vrai
 *     qu'après NEGOTIATION_STABLE_FRAMES frames CONSÉCUTIVES : une frame
 *     chanceuse ne confère ni la fenêtre prudente de 20 s, ni le ré-ancrage
 *     du tour — un backend qui donne une frame puis se tait est éliminé
 *     VITE, comme un backend qui n'a jamais rien donné ;
 *   - `anyStrategyProven` (session) : tant qu'il est faux, un catalogue
 *     entièrement muet est RENÉGOCIÉ par tours périodiques (detectionPlan).
 */

import { DETECTION_STRATEGIES, type DetectionStrategy } from './strategyCatalog.js';

/**
 * Frames de landmarks VALIDÉS (478 pts, repères finis) CONSÉCUTIVES exigées
 * avant de déclarer une stratégie STABLE — donc de la mémoriser pour cet
 * appareil, de lui accorder la fenêtre prudente et de ré-ancrer le tour.
 * `createFromOptions` réussi ne compte pas ; une frame chanceuse non plus.
 */
export const NEGOTIATION_STABLE_FRAMES = 5;

export type DetectionPhase = 'waiting-frame' | 'searching' | 'tracking';

/** Une ligne du tableau de négociation, publiée dans la santé et au HUD. */
export interface NegotiationEntry {
  id: string;
  outcome: 'erreurs' | 'muette' | 'création-KO' | 'stable';
  detail: string;
}

export interface DetectionPlan {
  phase: DetectionPhase;
  strategyIndex: number;
  /** Frames VALIDES consécutives sans landmarks (les invalides ne comptent pas). */
  silentValidFrames: number;
  invalidFrames: number;
  /** Début du silence courant (1re frame valide muette de la marche), en ms. */
  silentSinceMs: number | null;
  /** 🔴 La stratégie courante a PROUVÉ sa stabilité (5 frames consécutives). */
  strategyProven: boolean;
  /** Une stratégie a-t-elle été prouvée DANS CETTE SESSION ? (jamais remis à
   *  faux par l'avance : gate des tours de renégociation silencieuse.) */
  anyStrategyProven: boolean;
  /** Recréations déjà tentées dans l'ÉPISODE de silence courant (A2). */
  recoveryAttempts: number;
  /** Stratégies VISITÉES dans le tour courant (1 = celle en cours). */
  visitedStrategies: number;
  /** Frames de landmarks validés CONSÉCUTIVES de la stratégie courante. */
  stableFrames: number;
  /** `stableReached` déjà émis pour cette stratégie (une mémorisation suffit). */
  stableNotified: boolean;
}

export function initialPlan(startIndex = 0): DetectionPlan {
  const bounded = startIndex >= 0 && startIndex < DETECTION_STRATEGIES.length ? startIndex : 0;
  return {
    phase: 'waiting-frame',
    strategyIndex: bounded,
    silentValidFrames: 0,
    invalidFrames: 0,
    silentSinceMs: null,
    strategyProven: false,
    anyStrategyProven: false,
    recoveryAttempts: 0,
    visitedStrategies: 1,
    stableFrames: 0,
    stableNotified: false,
  };
}

export function currentStrategy(plan: DetectionPlan): DetectionStrategy {
  return DETECTION_STRATEGIES[plan.strategyIndex] ?? DETECTION_STRATEGIES[0]!;
}

/**
 * Avance CIRCULAIRE vers la stratégie suivante du catalogue. Remet à zéro tout
 * l'état propre à la marche quittée. Employée par la montée temporelle, la
 * reprise A2 ET la négociation par erreurs (modelLifecycle) : une seule
 * définition de « suivante », donc un seul comptage de « tout essayé ».
 */
export function advanceStrategy(plan: DetectionPlan): void {
  plan.strategyIndex = (plan.strategyIndex + 1) % DETECTION_STRATEGIES.length;
  plan.visitedStrategies = Math.min(plan.visitedStrategies + 1, DETECTION_STRATEGIES.length);
  plan.strategyProven = false;
  plan.recoveryAttempts = 0;
  plan.silentValidFrames = 0;
  plan.silentSinceMs = null;
  plan.stableFrames = 0;
  plan.stableNotified = false;
}

/**
 * 🔴 Ré-audit 2026-08-23 — NOUVEAU TOUR de négociation : reprendre le
 * catalogue à `startIndex` avec un compteur de visite vierge. Employé après
 * épuisement (tempête d'erreurs — modelLifecycle — ou silence intégral —
 * detectionPlan) une fois le cooldown écoulé : l'état du navigateur/GPU a pu
 * changer, une stratégie déjà visitée peut désormais marcher.
 */
export function restartRound(plan: DetectionPlan, startIndex: number): void {
  plan.strategyIndex =
    startIndex >= 0 && startIndex < DETECTION_STRATEGIES.length ? startIndex : 0;
  plan.visitedStrategies = 1;
  plan.strategyProven = false;
  plan.recoveryAttempts = 0;
  plan.silentValidFrames = 0;
  plan.silentSinceMs = null;
  plan.stableFrames = 0;
  plan.stableNotified = false;
}

/** Vrai quand le tour courant a visité TOUT le catalogue sans succès. */
export function allStrategiesTried(plan: DetectionPlan): boolean {
  return plan.visitedStrategies >= DETECTION_STRATEGIES.length;
}
