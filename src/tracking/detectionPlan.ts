/**
 * tracking/detectionPlan.ts — la MACHINE D'ÉTAT de la détection (calcul pur).
 *
 * Remplace le « retry aveugle » (GPU → canvas → CPU au hasard). Chaque
 * transition a une PREUVE et une raison nommée, affichable telle quelle :
 *
 *   WAITING_VALID_FRAME ──frame valide──▶ SEARCHING (délégué GPU)
 *   SEARCHING ──landmarks──▶ TRACKING
 *   TRACKING ──perte──▶ SEARCHING (même délégué — perdre un visage n'est pas
 *                        une panne de délégué)
 *   SEARCHING(GPU) ──sonde OUI, landmarker muet──▶ SEARCHING(CPU)   [preuve]
 *   SEARCHING(GPU) ──les deux muets, longtemps──▶ SEARCHING(CPU)    [élimination]
 *
 * Les frames INVALIDES (noires, 0×0) n'avancent aucun compteur : une entrée
 * cassée n'est pas « 0 visage », et ne justifie aucune bascule de délégué.
 * Un délégué qui a DÉJÀ produit des landmarks n'est jamais accusé : quelqu'un
 * qui sort du champ n'est pas une panne GPU.
 */

import type { Delegate } from './landmarker.js';

/** La sonde tourne toutes les N frames valides muettes — assez pour prouver. */
export const PROBE_EVERY = 10;
/** Sonde OUI + landmarker muet pendant N frames valides → bascule PROUVÉE. */
export const SWAP_WITH_EVIDENCE_AFTER = 30;
/** Les deux muets pendant N frames valides → un essai CPU par élimination. */
export const SWAP_BLIND_AFTER = 120;

export type DetectionPhase = 'waiting-frame' | 'searching' | 'tracking';

export interface DetectionPlan {
  phase: DetectionPhase;
  delegate: Delegate;
  /** Frames VALIDES consécutives sans landmarks (les invalides ne comptent pas). */
  silentValidFrames: number;
  invalidFrames: number;
  probeTried: number;
  probeHits: number;
  /** Le délégué courant a-t-il déjà produit des landmarks ? */
  delegateEverTracked: boolean;
  cpuTried: boolean;
}

export interface DetectionObservation {
  frameValid: boolean;
  landmarksFound: boolean;
  /** Résultat de la sonde sur CETTE frame, si elle a tourné. */
  probeFound: boolean | null;
}

export interface DetectionTransition {
  action: 'swap-to-cpu' | null;
  /** Raison nommée, affichable telle quelle (§17 : savoir POURQUOI). */
  reason: string | null;
}

export function initialPlan(): DetectionPlan {
  return {
    phase: 'waiting-frame',
    delegate: 'GPU',
    silentValidFrames: 0,
    invalidFrames: 0,
    probeTried: 0,
    probeHits: 0,
    delegateEverTracked: false,
    cpuTried: false,
  };
}

/** La sonde doit-elle tourner sur la prochaine frame valide muette ? */
export function shouldProbe(plan: DetectionPlan): boolean {
  return (
    plan.phase === 'searching' &&
    !plan.delegateEverTracked &&
    plan.silentValidFrames > 0 &&
    plan.silentValidFrames % PROBE_EVERY === 0
  );
}

/** Avance la machine d'une frame. Mute `plan` et rend la transition éventuelle. */
export function planStep(plan: DetectionPlan, obs: DetectionObservation): DetectionTransition {
  if (!obs.frameValid) {
    plan.invalidFrames++;
    // Une entrée cassée ne dit RIEN sur les détecteurs : aucun compteur n'avance.
    return { action: null, reason: null };
  }
  plan.invalidFrames = 0;

  if (obs.landmarksFound) {
    plan.phase = 'tracking';
    plan.silentValidFrames = 0;
    plan.delegateEverTracked = true;
    return { action: null, reason: null };
  }

  plan.phase = 'searching';
  plan.silentValidFrames++;
  if (obs.probeFound !== null) {
    plan.probeTried++;
    if (obs.probeFound) plan.probeHits++;
  }

  // Un délégué qui a déjà suivi un visage n'est pas en panne : on cherche.
  if (plan.delegateEverTracked || plan.delegate === 'CPU' || plan.cpuTried) {
    return { action: null, reason: null };
  }

  if (plan.probeHits > 0 && plan.silentValidFrames >= SWAP_WITH_EVIDENCE_AFTER) {
    plan.delegate = 'CPU';
    plan.cpuTried = true;
    plan.silentValidFrames = 0;
    return {
      action: 'swap-to-cpu',
      reason: `FaceDetector voit un visage (${plan.probeHits}×), FaceLandmarker GPU muet → délégué CPU`,
    };
  }
  if (plan.probeTried > 0 && plan.silentValidFrames >= SWAP_BLIND_AFTER) {
    plan.delegate = 'CPU';
    plan.cpuTried = true;
    plan.silentValidFrames = 0;
    return {
      action: 'swap-to-cpu',
      reason: `aucun des deux détecteurs ne voit de visage sur ${SWAP_BLIND_AFTER} frames valides — essai CPU par élimination`,
    };
  }
  return { action: null, reason: null };
}
