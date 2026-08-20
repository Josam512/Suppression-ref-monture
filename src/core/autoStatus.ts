/**
 * core/autoStatus.ts — le CONTRAT D'ÉTAT de la collecte automatique.
 *
 * Scindé de `core/autoCalibration.ts` le 2026-08-21 : l'audit humain a fait
 * grossir le statut (compteurs de gate indépendants, deux horloges, tentatives)
 * et le fichier a franchi la règle des 300 lignes (§3), qui impose la scission.
 * Rien n'est renommé : tout est ré-exporté par `autoCalibration.ts`.
 *
 * ⚠️ `AutoState` ne comporte PLUS d'état d'échec. C'était le défaut n°2 de
 * l'audit : `failed` verrouillait `offer()`, donc plus une seule frame n'était
 * comptée, donc jamais de calibration — et sans calibration `renderScene.ts`
 * sort avant de dessiner. Vingt secondes décidaient de toute la session.
 */

export type AutoState = 'collecting' | 'calibrated';

export type WhyCode =
  | 'no-face'
  | 'eyes-too-small'
  | 'turn-to-front'
  | 'straighten-head'
  | 'need-more-frames'
  | 'unstable-scale';

export interface WhyNotDone {
  code: WhyCode;
  /** Phrase affichable telle quelle. */
  label: string;
}

/**
 * Compteurs INDÉPENDANTS — défaut n°3 de l'audit.
 *
 * L'ancienne cascade `else if` n'attribuait qu'UNE cause par frame, la première
 * de la liste : une frame à la fois tournée ET inclinée ne comptait que
 * « tournée », et le diagnostic affichait le premier `else if` au lieu de la
 * réalité. Chaque gate violé incrémente désormais son propre compteur.
 */
export interface GateCounts {
  'no-face': number;
  'eyes-too-small': number;
  'turn-to-front': number;
  'straighten-head': number;
}

export interface AutoStatus {
  state: AutoState;
  usableFrames: number;
  neededFrames: number;
  /** Depuis la PREMIÈRE FRAME RETENUE — l'horloge qui décide (défaut n°1). */
  elapsedMs: number;
  /** Depuis le premier visage vu — informatif, ne décide de rien. */
  acquisitionMs: number;
  whyNotDone: WhyNotDone | null;
  /** Gates violés, comptés séparément. */
  rejected: GateCounts;
  /** La cause à AFFICHER pour la dernière frame rejetée. */
  primaryRejectReason: WhyCode | null;
  /** Erreur-type courante de la médiane d'échelle (la vraie décision). */
  scaleStandardError: number;
  /** Nombre de fois où le délai est passé sans matière suffisante. */
  attempts: number;
  /** Ce que le dernier délai a nommé. La collecte continue malgré tout. */
  lastAttemptFailure: WhyNotDone | null;
}

export const GATE_LABELS: Record<keyof GateCounts, string> = {
  'no-face': `Je ne vous ai pas vu : placez votre visage face à la caméra, bien éclairé.`,
  'eyes-too-small': `Vos yeux ne sont pas exploitables (trop petits à l'image, ou l'un des deux est masqué) : rapprochez-vous un peu.`,
  'turn-to-front': `Votre tête était trop tournée : regardez droit vers l'écran quelques secondes.`,
  'straighten-head': `Votre tête était trop inclinée : redressez-la quelques secondes.`,
};

export const UNSTABLE_SCALE_LABEL = `La mesure varie encore trop d'une image à l'autre : restez immobile un instant.`;

/** Le gate le plus souvent violé — la consigne à afficher, une seule à la fois. */
export function dominantReason(counts: GateCounts): WhyNotDone {
  const keys = Object.keys(counts) as Array<keyof GateCounts>;
  const top = keys.reduce((a, b) => (counts[a] >= counts[b] ? a : b));
  return { code: top, label: GATE_LABELS[top] };
}

export function emptyGateCounts(): GateCounts {
  return { 'no-face': 0, 'eyes-too-small': 0, 'turn-to-front': 0, 'straighten-head': 0 };
}
