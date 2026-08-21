/**
 * core/autoStatus.ts — le CONTRAT D'ÉTAT de la collecte automatique.
 *
 * ⚠️ `AutoState` ne comporte PAS d'état d'échec côté MOTEUR : `failed`
 * verrouillait `offer()`, donc plus une seule frame n'était comptée, donc
 * jamais de calibration. `'unavailable'` existe pour la COUCHE UI seulement
 * (guide, point 69) : après trop de refus d'assemblage, elle publie un état
 * honnête (« mesure indisponible, voilà pourquoi, voilà les sorties ») au lieu
 * d'un faux `collecting` sans moteur — et le RENDU, lui, continue.
 *
 * Guide de fiabilisation (2026-08-21) :
 *   - complément 1 : `rejectedFramesAny` compte les FRAMES rejetées (une fois
 *     chacune) ; les compteurs par gate restent DIAGNOSTIQUES — une frame à la
 *     fois tournée et inclinée incrémente deux gates mais UNE frame ;
 *   - complément 19 : trois phases d'acquisition nommées, chacune avec son
 *     horloge — « aucun visage », « visage sans frame métrique », « converge » ;
 *   - complément 3 : les codes d'échec d'assemblage sont TYPÉS.
 */

import type { MetricFailureCode } from './geom.js';

export type AutoState = 'collecting' | 'calibrated' | 'unavailable';

export type WhyCode =
  | 'no-face'
  | 'eyes-too-small'
  | 'turn-to-front'
  | 'straighten-head'
  | 'need-more-frames'
  | 'unstable-scale'
  | MetricFailureCode;

export interface WhyNotDone {
  code: WhyCode;
  /** Phrase affichable telle quelle. */
  label: string;
}

/**
 * Compteurs INDÉPENDANTS, purement DIAGNOSTIQUES (complément 1) : leur somme
 * n'est PAS un nombre de frames — une même frame peut violer trois gates.
 * Toute logique « beaucoup de rejets » lit `rejectedFramesAny`, jamais cette
 * somme.
 */
export interface GateCounts {
  'no-face': number;
  'eyes-too-small': number;
  'turn-to-front': number;
  'straighten-head': number;
}

/** Où en est la TENTATIVE courante (complément 19) — trois états, trois horloges. */
export type AcquisitionPhase = 'no-face' | 'acquiring' | 'converging';

export interface AutoStatus {
  state: AutoState;
  usableFrames: number;
  neededFrames: number;
  /** Depuis la PREMIÈRE FRAME RETENUE de la tentative — l'horloge de convergence. */
  elapsedMs: number;
  /** Depuis le premier visage vu — informatif, ne décide de rien. */
  acquisitionMs: number;
  /** Depuis le DÉBUT de la tentative — c'est ELLE qui porte le délai (point 18). */
  attemptMs: number;
  phase: AcquisitionPhase;
  whyNotDone: WhyNotDone | null;
  /** Gates violés, comptés séparément — diagnostic. */
  rejected: GateCounts;
  /** ⭐ Frames rejetées, comptées UNE fois chacune (complément 1). */
  rejectedFramesAny: number;
  /** La cause à AFFICHER pour la dernière frame rejetée (une consigne à la fois). */
  primaryRejectReason: WhyCode | null;
  /** TOUS les gates violés par la dernière frame rejetée (complément 2 — HUD). */
  lastFrameViolations: readonly WhyCode[];
  /** Erreur-type courante de la médiane d'échelle (la vraie décision). */
  scaleStandardError: number;
  /** Nombre de fois où le délai est passé sans matière suffisante. */
  attempts: number;
  /** Ce que le dernier délai a nommé. La collecte continue malgré tout. */
  lastAttemptFailure: WhyNotDone | null;
  /** Génération de collecte (tentative courante) — c20–c21. */
  generation: number;
}

export const GATE_LABELS: Record<keyof GateCounts, string> = {
  'no-face': `Je ne vous ai pas vu : placez votre visage face à la caméra, bien éclairé.`,
  'eyes-too-small': `Vos yeux ne sont pas exploitables (trop petits à l'image, ou l'un des deux est masqué) : rapprochez-vous un peu.`,
  'turn-to-front': `Votre tête était trop tournée : regardez droit vers l'écran quelques secondes.`,
  'straighten-head': `Votre tête était trop inclinée : redressez-la quelques secondes.`,
};

export const UNSTABLE_SCALE_LABEL = `La mesure varie encore trop d'une image à l'autre : restez immobile un instant.`;

/**
 * Consignes des refus d'ASSEMBLAGE, par code typé (complément 3). Chacune dit
 * la vraie cause — plus jamais « rapprochez-vous » pour une distance invalide.
 */
export const FAILURE_LABELS: Record<MetricFailureCode, string> = {
  'pd-out-of-range': `L'écart pupillaire obtenu n'est pas anatomique — la détection des yeux a probablement décroché. Recommencez face à la caméra, sans lunettes.`,
  'face-width-out-of-range': `La largeur de visage obtenue n'est pas plausible — la mesure a probablement décroché. Recommencez face à la caméra, bien éclairé.`,
  'invalid-distance': `La distance à la caméra n'a pas pu être établie. Placez-vous à 40–60 cm de l'écran et recommencez.`,
  'insufficient-half-pd': `Pas assez d'images de face stricte pour séparer les demi-PD — regardez l'écran bien en face quelques secondes.`,
  'metric-assembly-error': `L'assemblage de la mesure a échoué. Recommencez ; si cela persiste, utilisez une carte.`,
  'internal-error': `Erreur interne pendant l'assemblage de la mesure. Recommencez ; si cela persiste, rechargez la page.`,
};

/**
 * Le gate le plus souvent violé — la consigne à afficher, une seule à la fois.
 * L'ORDRE ne décide de rien (complément 2) : c'est le COMPTE qui désigne, et
 * l'égalité se départage par une priorité EXPLICITE (l'obstacle le plus
 * bloquant d'abord), pas par l'ordre d'un `else if` historique.
 */
const DOMINANT_PRIORITY: ReadonlyArray<keyof GateCounts> = [
  'no-face',
  'eyes-too-small',
  'turn-to-front',
  'straighten-head',
];

export function dominantReason(counts: GateCounts): WhyNotDone {
  let top: keyof GateCounts = DOMINANT_PRIORITY[0]!;
  for (const k of DOMINANT_PRIORITY) {
    if (counts[k] > counts[top]) top = k;
  }
  return { code: top, label: GATE_LABELS[top] };
}

export function emptyGateCounts(): GateCounts {
  return { 'no-face': 0, 'eyes-too-small': 0, 'turn-to-front': 0, 'straighten-head': 0 };
}
