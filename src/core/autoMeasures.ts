/**
 * core/autoMeasures.ts — le CONTRAT de sortie de la collecte automatique, et
 * ses statistiques robustes.
 *
 * Guide de fiabilisation (2026-08-21) :
 *   - point 22 : le PD total est la distance DIRECTE pupille ↔ pupille
 *     (`pdDirectNearMm`), jamais la somme des demi-écarts via le sellion — un
 *     sellion décroché fausserait la somme, pas la distance directe ;
 *   - point 32 : la médiane + MAD ne suffisent pas. Chaque série publie aussi
 *     ses quantiles (P10/P90), sa proportion d'outliers, et sa DÉRIVE
 *     (première moitié vs seconde) — une personne qui avance pendant la
 *     collecte se voit, une série « stable avec quelques frames folles » aussi.
 */

/** Statistiques d'une série de mesures (calcul pur, point 32). */
export interface SeriesStats {
  n: number;
  p10: number;
  p90: number;
  /** Fraction des points à plus de 3 MAD de la médiane. */
  outlierRatio: number;
  /** (médiane 2e moitié − médiane 1re moitié) / médiane globale. */
  driftRel: number;
}

/** Les grandeurs MESURÉES, prêtes pour l'assemblage (core/autoCalibrate.ts). */
export interface AutoMeasures {
  /** Échelle médiane au plan des yeux, mm par pixel. */
  mmPerPxEye: number;
  /** Borne du prior périoculaire de l'estimateur RETENU (verrouillé, point 29). */
  priorRelError: number;
  /** L'estimateur retenu pour la tentative — choisi UNE fois à la conclusion. */
  estimator: 'hvid' | 'hvid+pfl';
  /** Erreur-type de la médiane d'échelle (bruit de détection, réduit en 1/√n). */
  scaleStandardError: number;
  /** Statistiques complètes de la série d'échelle (point 32). */
  scaleStats: SeriesStats;
  /**
   * ⭐ PD apparent DIRECT médian (distance 468 ↔ 473 × échelle), en mm —
   * point 22. C'est LUI qui porte le PD total.
   */
  pdDirectNearMm: number;
  pdDirectSE: number;
  /**
   * Demi-écarts pupillaires ANATOMIQUES médians (plan des pupilles, fixation
   * proche), en mm. Chacun est MESURÉ pupille ↔ pied du sellion projeté
   * (`core/pupillary.ts`) : aucun n'est jamais `pd / 2`. Accumulés SEULEMENT
   * au regard de face strict ET quand la projection du sellion est anatomique
   * (`halfPdUsable`, guide 23) ; NaN sans frame stricte.
   */
  pdRightNearMm: number;
  pdLeftNearMm: number;
  pdRightSE: number;
  pdLeftSE: number;
  splitFrames: number;
  /** Largeur 234↔454 apparente, convertie au plan des yeux (mm, SANS parallaxe). */
  faceWidthEyePlaneMm: number;
  faceWidthStats: SeriesStats;
  /** Taille médiane de l'iris en pixels — porte l'estimation de distance. */
  hvidPx: number;
  usableFrames: number;
  /** Vrai si la conclusion vient du timeout, pas de la convergence. */
  degraded: boolean;
  /** Génération de collecte (tentative) dont ces mesures sortent (c20–c21). */
  generation: number;
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

export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[idx] ?? NaN;
}

/** Les statistiques complètes d'une série (point 32). Pur, testé sans DOM. */
export function seriesStats(xs: readonly number[]): SeriesStats {
  const n = xs.length;
  if (n === 0) return { n: 0, p10: NaN, p90: NaN, outlierRatio: 0, driftRel: 0 };
  const m = median(xs);
  const mad = median(xs.map((x) => Math.abs(x - m))) * 1.4826;
  const outliers = mad > 0 ? xs.filter((x) => Math.abs(x - m) > 3 * mad).length : 0;
  const half = Math.floor(n / 2);
  const firstHalf = xs.slice(0, half);
  const secondHalf = xs.slice(half);
  const driftRel =
    half > 0 && m !== 0 && Number.isFinite(m)
      ? (median(secondHalf) - median(firstHalf)) / m
      : 0;
  return {
    n,
    p10: quantile(xs, 0.1),
    p90: quantile(xs, 0.9),
    outlierRatio: outliers / n,
    driftRel,
  };
}
