/**
 * tracking/detectionPlan.ts — la MACHINE D'ÉTAT de la détection (calcul pur).
 *
 * Refonte du guide de fiabilisation (2026-08-21, points 6, 11, 12) :
 *
 *   - la sonde FaceDetector est SORTIE du chemin produit : une seule Task
 *     MediaPipe lourde vit à la fois (mémoire, WASM, contention GPU — le
 *     second modèle pouvait même échouer à se créer sur l'appareil réel).
 *     Elle reste disponible pour les pages d'atelier (`tracking/faceProbe.ts`),
 *     qui ne sont pas le produit. Toutes les montées se font donc PAR
 *     ÉLIMINATION — et une élimination ne dépend d'aucun témoin ;
 *   - les seuils sont des DURÉES, plus des comptes de frames : 120 frames
 *     valaient 8 s à 15 fps et 2 s à 60 fps — le même code changeait de
 *     comportement avec la cadence (point 12). L'acquisition initiale monte
 *     vite (SWAP_MS) ; une stratégie qui a DÉJÀ suivi un visage n'est jamais
 *     quittée : sortir du champ n'est pas une panne (les deux machines du
 *     point 11 — acquisition initiale rapide, reprise de perte prudente).
 *
 *   WAITING_VALID_FRAME ──frame valide──▶ SEARCHING (stratégie 0)
 *   SEARCHING ──landmarks──▶ TRACKING (stratégie verrouillée)
 *   TRACKING ──perte──▶ SEARCHING, même stratégie (sortir du champ ≠ panne)
 *   SEARCHING ──muet SWAP_MS + assez de frames──▶ stratégie suivante
 *   dernière stratégie muette ──▶ on continue de chercher, honnêtement.
 *
 * Les frames INVALIDES (noires, 0×0) n'avancent aucune horloge.
 */

import type { Delegate } from './landmarker.js';

/**
 * Silence toléré sur une marche avant de monter, en millisecondes.
 * L'ancienne règle (120 frames) coûtait ~8 s par marche à 15 fps ; trois
 * marches ≈ 24 s avant la stratégie qui marche. À 2 500 ms, l'échelle entière
 * est parcourue en moins de 8 s, quelle que soit la cadence.
 */
export const SWAP_SILENT_MS = 2500;
/**
 * Nombre MINIMAL de frames valides muettes en plus de la durée : deux frames
 * espacées de 3 s ne prouvent pas qu'une stratégie est muette, elles prouvent
 * que la caméra est lente.
 */
export const SWAP_MIN_SILENT_FRAMES = 10;

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
   * la matière ; les landmarks X/Y sont ensuite DÉ-MAPPÉS exactement
   * (`unpadPoint`) : zéro effet sur les mesures.
   *
   * ⚠️ Le Z, lui, n'est PAS remappé (complément 9) : la sortie d'une stratégie
   * paddée est étiquetée `coordinateSpace: 'padded-remapped'` et aucun chemin
   * de production ne doit consommer son Z.
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

/** Comment les coordonnées de la frame ont été produites (complément 9). */
export type CoordinateSpace = 'direct' | 'padded-remapped';

export function coordinateSpaceOf(strategy: DetectionStrategy): CoordinateSpace {
  return strategy.padFraction === null ? 'direct' : 'padded-remapped';
}

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
  /** Début du silence courant (1re frame valide muette de la marche), en ms. */
  silentSinceMs: number | null;
  /** La stratégie courante a-t-elle déjà produit des landmarks ? */
  strategyEverTracked: boolean;
}

export interface DetectionObservation {
  frameValid: boolean;
  landmarksFound: boolean;
  /** Horloge de la frame — les décisions sont des durées, pas des comptes. */
  nowMs: number;
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
    silentSinceMs: null,
    strategyEverTracked: false,
  };
}

export function currentStrategy(plan: DetectionPlan): DetectionStrategy {
  return DETECTION_STRATEGIES[plan.strategyIndex] ?? DETECTION_STRATEGIES[0]!;
}

/** Avance la machine d'une frame. Mute `plan` et rend la transition éventuelle. */
export function planStep(plan: DetectionPlan, obs: DetectionObservation): DetectionTransition {
  if (!obs.frameValid) {
    plan.invalidFrames++;
    // Une entrée cassée ne dit RIEN sur les détecteurs : aucune horloge n'avance.
    return { advanceTo: null, reason: null };
  }
  plan.invalidFrames = 0;

  if (obs.landmarksFound) {
    plan.phase = 'tracking';
    plan.silentValidFrames = 0;
    plan.silentSinceMs = null;
    plan.strategyEverTracked = true;
    return { advanceTo: null, reason: null };
  }

  plan.phase = 'searching';
  plan.silentValidFrames++;
  plan.silentSinceMs ??= obs.nowMs;

  // Une stratégie qui a déjà suivi un visage n'est pas en panne : on cherche.
  const last = plan.strategyIndex >= DETECTION_STRATEGIES.length - 1;
  if (plan.strategyEverTracked || last) return { advanceTo: null, reason: null };

  const silentMs = obs.nowMs - plan.silentSinceMs;
  if (silentMs < SWAP_SILENT_MS || plan.silentValidFrames < SWAP_MIN_SILENT_FRAMES) {
    return { advanceTo: null, reason: null };
  }

  const from = currentStrategy(plan).label;
  const next = DETECTION_STRATEGIES[plan.strategyIndex + 1]!;
  plan.strategyIndex++;
  plan.silentValidFrames = 0;
  plan.silentSinceMs = null;
  return {
    advanceTo: plan.strategyIndex,
    reason:
      `rien détecté pendant ${(silentMs / 1000).toFixed(1)} s de frames valides ` +
      `(« ${from} ») → « ${next.label} » par élimination`,
  };
}
