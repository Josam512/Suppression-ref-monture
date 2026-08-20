/**
 * core/autoMeasures.ts — le CONTRAT de sortie de la collecte automatique, et
 * ses statistiques robustes.
 *
 * Scindé de `core/autoCalibration.ts` le 2026-08-20 : le gate demi-PD de face
 * stricte et la garde de distance (mission « taille + demi-PD ») ont fait
 * franchir à ce fichier la règle des 300 lignes (§3), qui impose la scission.
 * Rien n'est renommé : `AutoMeasures` reste ré-exporté par autoCalibration.ts,
 * ses consommateurs sont inchangés.
 */

/** Les grandeurs MESURÉES, prêtes pour `calibrateAuto` (core/autoCalibrate.ts). */
export interface AutoMeasures {
  /** Échelle médiane au plan des yeux, mm par pixel. */
  mmPerPxEye: number;
  /** Borne du prior périoculaire utilisée (majorité des frames). */
  priorRelError: number;
  /** Erreur-type de la médiane d'échelle (bruit de détection, réduit en 1/√n). */
  scaleStandardError: number;
  /**
   * Demi-écarts pupillaires ANATOMIQUES médians (plan des pupilles, fixation
   * proche), en mm. Chacun est MESURÉ pupille ↔ pied du sellion projeté
   * (`core/pupillary.ts`) : aucun n'est jamais `pd / 2`. `right` = œil droit
   * du client (OD, côté landmarks 468) ; `left` = œil gauche (OG, côté 473).
   */
  pdRightNearMm: number;
  pdLeftNearMm: number;
  /** Erreurs-types RELATIVES de chaque demi-écart — différentes si un œil est
   *  moins bien détecté. S'ajoutent au prior, ne le remplacent jamais. */
  pdRightSE: number;
  pdLeftSE: number;
  /** ⭐ Somme des demi-écarts, accumulée au gate LARGE (8°) : invariante au
   *  yaw au premier ordre, c'est elle qui porte le PD total. Les demi-écarts
   *  ci-dessus ne s'accumulent qu'au regard de face strict (`MAX_SPLIT_YAW_RAD`)
   *  et valent NaN sans frame stricte — `splitFrames` dit combien l'ont permis. */
  pdSumNearMm: number;
  pdSumSE: number;
  splitFrames: number;
  /** Largeur 234↔454 apparente, convertie au plan des yeux (mm, SANS parallaxe). */
  faceWidthEyePlaneMm: number;
  /** Taille médiane de l'iris en pixels — porte l'estimation de distance. */
  hvidPx: number;
  usableFrames: number;
  /** Vrai si la conclusion vient du timeout, pas de la convergence. */
  degraded: boolean;
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? NaN) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Erreur-type RELATIVE de la médiane, par MAD — même choix que cardSweep. */
export function relStandardError(xs: readonly number[]): number {
  const m = median(xs);
  if (!(m > 0)) return Infinity;
  const mad = median(xs.map((x) => Math.abs(x - m))) * 1.4826;
  return mad / Math.sqrt(xs.length) / m;
}
