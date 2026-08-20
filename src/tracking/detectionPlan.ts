/**
 * tracking/detectionPlan.ts — la MACHINE D'ÉTAT de la détection (calcul pur).
 *
 * Remplace le « retry aveugle » : une ÉCHELLE de stratégies, gravie marche par
 * marche, chaque montée portée par une PREUVE et une raison nommée. Constat qui
 * a imposé l'échelle (Samsung réel, Chrome 151, 2026-08-20) : sur la même
 * frame figée, FaceDetector trouve le visage à 0,91 et FaceLandmarker rend 0 —
 * les pixels sont innocents, c'est le landmarker qu'il faut reconfigurer.
 *
 *   WAITING_VALID_FRAME ──frame valide──▶ SEARCHING (stratégie 0)
 *   SEARCHING ──landmarks──▶ TRACKING (stratégie verrouillée)
 *   TRACKING ──perte──▶ SEARCHING, même stratégie (sortir du champ ≠ panne)
 *   SEARCHING ──sonde OUI, landmarker muet──▶ stratégie suivante  [preuve]
 *   SEARCHING ──tous muets, longtemps──▶ stratégie suivante       [élimination]
 *   dernière stratégie muette ──▶ on continue de chercher, honnêtement.
 *
 * Les frames INVALIDES (noires, 0×0) n'avancent aucun compteur. Une stratégie
 * qui a DÉJÀ produit des landmarks n'est jamais quittée pour une perte.
 */

import type { Delegate } from './landmarker.js';

/** La sonde tourne toutes les N frames valides muettes — assez pour prouver. */
export const PROBE_EVERY = 10;
/** Sonde OUI + landmarker muet pendant N frames valides → montée PROUVÉE. */
export const SWAP_WITH_EVIDENCE_AFTER = 30;
/** Tous muets pendant N frames valides → montée par élimination. */
export const SWAP_BLIND_AFTER = 120;

/** Une marche de l'échelle : comment configurer le landmarker. */
export interface DetectionStrategy {
  id: 'gpu' | 'cpu' | 'cpu-marge' | 'cpu-seuils';
  delegate: Delegate;
  /**
   * Marge (letterbox) ajoutée autour de la frame avant détection, en fraction
   * de chaque dimension (null = aucune). Mécanisme identifié dans le graphe
   * MediaPipe (face_landmarks_detector_graph.cc) : le crop interne est élargi
   * ×1,5 et mis au carré — sur un visage occupant 60-80 % du cadre il déborde
   * massivement hors image, le score de présence s'effondre sous 0,5 et le
   * visage est SUPPRIMÉ du résultat, sans erreur. La marge redonne au crop de
   * la matière ; les landmarks sont ensuite DÉ-MAPPÉS exactement
   * (`unpadPoint`) : zéro effet sur les mesures.
   */
  padFraction: number | null;
  /** Seuils detection/presence/tracking abaissés (null = défauts 0,5). */
  minConfidence: number | null;
  label: string;
}

export const DETECTION_STRATEGIES: readonly DetectionStrategy[] = [
  { id: 'gpu', delegate: 'GPU', padFraction: null, minConfidence: null, label: 'délégué GPU, pleine résolution' },
  { id: 'cpu', delegate: 'CPU', padFraction: null, minConfidence: null, label: 'délégué CPU (XNNPACK), pleine résolution' },
  {
    id: 'cpu-marge',
    delegate: 'CPU',
    padFraction: 0.25,
    minConfidence: null,
    label: 'CPU, marge de 25 % autour du cadre (visage très proche)',
  },
  {
    id: 'cpu-seuils',
    delegate: 'CPU',
    padFraction: 0.25,
    minConfidence: 0.25,
    label: 'CPU, marge 25 % + seuils de confiance abaissés à 0,25',
  },
];

/**
 * Dé-mappe une coordonnée normalisée depuis le cadre AVEC marge vers le cadre
 * d'origine. Un point du centre revient exactement au centre : la marge est
 * connue au pixel près, elle n'introduit AUCUNE approximation dans la chaîne
 * d'échelle (livePxPerMm inchangé).
 */
export function unpadPoint(xNorm: number, padFraction: number): number {
  return xNorm * (1 + 2 * padFraction) - padFraction;
}

export type DetectionPhase = 'waiting-frame' | 'searching' | 'tracking';

export interface DetectionPlan {
  phase: DetectionPhase;
  strategyIndex: number;
  /** Frames VALIDES consécutives sans landmarks (les invalides ne comptent pas). */
  silentValidFrames: number;
  invalidFrames: number;
  probeTried: number;
  probeHits: number;
  /** La stratégie courante a-t-elle déjà produit des landmarks ? */
  strategyEverTracked: boolean;
}

export interface DetectionObservation {
  frameValid: boolean;
  landmarksFound: boolean;
  /** Résultat de la sonde sur CETTE frame, si elle a tourné. */
  probeFound: boolean | null;
}

export interface DetectionTransition {
  /** Index de la nouvelle stratégie à instancier, ou null. */
  advanceTo: number | null;
  /** Raison nommée, affichable telle quelle (§17 : savoir POURQUOI). */
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
  };
}

export function currentStrategy(plan: DetectionPlan): DetectionStrategy {
  return DETECTION_STRATEGIES[plan.strategyIndex] ?? DETECTION_STRATEGIES[0]!;
}

/** La sonde doit-elle tourner sur la prochaine frame valide muette ? */
export function shouldProbe(plan: DetectionPlan): boolean {
  return (
    plan.phase === 'searching' &&
    !plan.strategyEverTracked &&
    plan.silentValidFrames > 0 &&
    plan.silentValidFrames % PROBE_EVERY === 0
  );
}

/** Avance la machine d'une frame. Mute `plan` et rend la transition éventuelle. */
export function planStep(plan: DetectionPlan, obs: DetectionObservation): DetectionTransition {
  if (!obs.frameValid) {
    plan.invalidFrames++;
    // Une entrée cassée ne dit RIEN sur les détecteurs : aucun compteur n'avance.
    return { advanceTo: null, reason: null };
  }
  plan.invalidFrames = 0;

  if (obs.landmarksFound) {
    plan.phase = 'tracking';
    plan.silentValidFrames = 0;
    plan.strategyEverTracked = true;
    return { advanceTo: null, reason: null };
  }

  plan.phase = 'searching';
  plan.silentValidFrames++;
  if (obs.probeFound !== null) {
    plan.probeTried++;
    if (obs.probeFound) plan.probeHits++;
  }

  // Une stratégie qui a déjà suivi un visage n'est pas en panne : on cherche.
  const last = plan.strategyIndex >= DETECTION_STRATEGIES.length - 1;
  if (plan.strategyEverTracked || last) return { advanceTo: null, reason: null };

  const from = currentStrategy(plan).label;
  const next = DETECTION_STRATEGIES[plan.strategyIndex + 1]!;

  if (plan.probeHits > 0 && plan.silentValidFrames >= SWAP_WITH_EVIDENCE_AFTER) {
    advance(plan);
    return {
      advanceTo: plan.strategyIndex,
      reason:
        `FaceDetector voit un visage (${plan.probeHits}×) mais le landmarker est muet ` +
        `(« ${from} ») → « ${next.label} »`,
    };
  }
  if (plan.probeTried > 0 && plan.silentValidFrames >= SWAP_BLIND_AFTER) {
    advance(plan);
    return {
      advanceTo: plan.strategyIndex,
      reason:
        `aucun des deux détecteurs ne voit de visage sur ${SWAP_BLIND_AFTER} frames valides ` +
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
}
