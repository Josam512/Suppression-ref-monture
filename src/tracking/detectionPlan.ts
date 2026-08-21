/**
 * tracking/detectionPlan.ts — machine d'état pure de la détection.
 */

import type { Delegate } from './landmarker.js';

export const PROBE_EVERY = 10;
export const SWAP_WITH_EVIDENCE_AFTER = 30;
export const SWAP_BLIND_AFTER = 120;
export const RESTART_TRACKED_AFTER = 240;

export interface DetectionStrategy {
  id: 'gpu' | 'cpu' | 'cpu-marge' | 'cpu-seuils';
  delegate: Delegate;
  padFraction: number | null;
  minConfidence: number | null;
  label: string;
}

export const DETECTION_STRATEGIES: readonly DetectionStrategy[] = [
  { id: 'gpu', delegate: 'GPU', padFraction: null, minConfidence: null, label: 'délégué GPU, pleine résolution' },
  { id: 'cpu', delegate: 'CPU', padFraction: null, minConfidence: null, label: 'délégué CPU (XNNPACK), pleine résolution' },
  {
    id: 'cpu-marge', delegate: 'CPU', padFraction: 0.25, minConfidence: null,
    label: 'CPU, marge de 25 % autour du cadre (visage très proche)',
  },
  {
    id: 'cpu-seuils', delegate: 'CPU', padFraction: 0.25, minConfidence: 0.25,
    label: 'CPU, marge 25 % + seuils de confiance abaissés à 0,25',
  },
];

export function unpadPoint(xNorm: number, padFraction: number): number {
  return xNorm * (1 + 2 * padFraction) - padFraction;
}

export type DetectionPhase = 'waiting-frame' | 'searching' | 'tracking';

export interface DetectionPlan {
  phase: DetectionPhase;
  strategyIndex: number;
  silentValidFrames: number;
  invalidFrames: number;
  probeTried: number;
  probeHits: number;
  strategyEverTracked: boolean;
  /** Évite de recréer le graph toutes les 8 s si l'utilisateur quitte le champ. */
  restartedSinceTrack: boolean;
}

export interface DetectionObservation {
  frameValid: boolean;
  landmarksFound: boolean;
  probeFound: boolean | null;
}

export interface DetectionTransition {
  advanceTo: number | null;
  restartCurrent?: boolean;
  reason: string | null;
}

export function initialPlan(): DetectionPlan {
  return {
    phase: 'waiting-frame',
    strategyIndex: 0,
    silentValidFrames: 0,
    invalidFrames: 0,
    probeTried: 0,
    probeHits: 0,
    strategyEverTracked: false,
    restartedSinceTrack: false,
  };
}

export function currentStrategy(plan: DetectionPlan): DetectionStrategy {
  return DETECTION_STRATEGIES[plan.strategyIndex] ?? DETECTION_STRATEGIES[0]!;
}

export function shouldProbe(plan: DetectionPlan): boolean {
  return (
    plan.phase === 'searching' &&
    !plan.strategyEverTracked &&
    plan.silentValidFrames > 0 &&
    plan.silentValidFrames % PROBE_EVERY === 0
  );
}

export function planStep(plan: DetectionPlan, obs: DetectionObservation): DetectionTransition {
  if (!obs.frameValid) {
    plan.invalidFrames++;
    return { advanceTo: null, reason: null };
  }
  plan.invalidFrames = 0;

  if (obs.landmarksFound) {
    plan.phase = 'tracking';
    plan.silentValidFrames = 0;
    plan.strategyEverTracked = true;
    plan.restartedSinceTrack = false;
    return { advanceTo: null, reason: null };
  }

  plan.phase = 'searching';
  plan.silentValidFrames++;
  if (obs.probeFound !== null) {
    plan.probeTried++;
    if (obs.probeFound) plan.probeHits++;
  }

  if (plan.strategyEverTracked) {
    if (!plan.restartedSinceTrack && plan.silentValidFrames >= RESTART_TRACKED_AFTER) {
      plan.silentValidFrames = 0;
      plan.restartedSinceTrack = true;
      return {
        advanceTo: null,
        restartCurrent: true,
        reason: `la stratégie « ${currentStrategy(plan).label} » avait déjà suivi un visage mais reste muette depuis ${RESTART_TRACKED_AFTER} frames valides → redémarrage unique de la même stratégie`,
      };
    }
    return { advanceTo: null, reason: null };
  }

  const last = plan.strategyIndex >= DETECTION_STRATEGIES.length - 1;
  if (last) return { advanceTo: null, reason: null };

  const from = currentStrategy(plan).label;
  const next = DETECTION_STRATEGIES[plan.strategyIndex + 1]!;

  if (plan.probeHits > 0 && plan.silentValidFrames >= SWAP_WITH_EVIDENCE_AFTER) {
    advance(plan);
    return {
      advanceTo: plan.strategyIndex,
      reason: `FaceDetector voit un visage (${plan.probeHits}×) mais le landmarker est muet (« ${from} ») → « ${next.label} »`,
    };
  }

  if (plan.silentValidFrames >= SWAP_BLIND_AFTER) {
    advance(plan);
    return {
      advanceTo: plan.strategyIndex,
      reason:
        (plan.probeTried > 0
          ? `aucun des deux détecteurs ne voit de visage sur ${SWAP_BLIND_AFTER} frames valides `
          : `sonde indisponible, et rien détecté sur ${SWAP_BLIND_AFTER} frames valides `) +
        `(« ${from} ») → « ${next.label} » par élimination`,
    };
  }
  return { advanceTo: null, reason: null };
}

function advance(plan: DetectionPlan): void {
  plan.strategyIndex++;
  plan.silentValidFrames = 0;
  plan.probeHits = 0;
  plan.probeTried = 0;
  plan.restartedSinceTrack = false;
}
