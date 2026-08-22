/**
 * core/scaleStability.ts — LA définition de « série d'échelle STABLE », et le
 * choix d'estimateur qui en découle (ré-audit A8/A9/A10).
 *
 * Quatre portes, aucune décorative (seuils documentés dans `autoTuning.ts`) :
 *
 *   - l'ERREUR-TYPE de la médiane — le bruit, qui s'améliore en 1/√n ;
 *   - la DISPERSION PAR FRAME (MAD/médiane) — elle ne s'améliore PAS en √n :
 *     c'est elle qui refuse une série BIMODALE (aller-retour entre deux
 *     distances) que l'erreur-type finirait par laisser passer à grand n ;
 *   - la DÉRIVE 1re → 2e moitié — une personne qui avance pendant la collecte
 *     produit une médiane qui n'appartient à aucune distance réelle ;
 *   - le taux d'OUTLIERS (>3 MAD) — une série contaminée ment sur sa MAD.
 *
 * ⭐ A9 — l'estimateur est choisi AVANT le jugement : on juge la série que
 * l'on PUBLIERAIT. Si la série complète (HVID+PFL) échoue mais que la série
 * HVID seule est stable, le repli est pris et DIT (`fallback`) — jamais un
 * jugement sur une série et une publication d'une autre.
 */

import { relStandardError, seriesStats } from './autoMeasures.js';
import {
  ESTIMATOR_FULL_MIN_RATIO,
  MAX_SCALE_DRIFT_REL,
  MAX_SCALE_OUTLIER_RATIO,
  MAX_SCALE_SPREAD_REL,
} from './autoTuning.js';

export type ScaleEstimator = 'hvid' | 'hvid+pfl';

/** L'estimateur que la conclusion retiendrait (règle du point 29, inchangée). */
export function candidateEstimatorOf(hvidLength: number, fullLength: number): ScaleEstimator {
  return fullLength >= ESTIMATOR_FULL_MIN_RATIO * hvidLength ? 'hvid+pfl' : 'hvid';
}

/** Une série d'échelle est-elle PUBLIABLE ? Les quatre portes (A8/A10). */
export function scaleSeriesStable(series: readonly number[], maxStandardError: number): boolean {
  if (series.length === 0) return false;
  const stats = seriesStats(series);
  return (
    relStandardError(series) <= maxStandardError &&
    stats.madRel <= MAX_SCALE_SPREAD_REL &&
    Math.abs(stats.driftRel) <= MAX_SCALE_DRIFT_REL &&
    stats.outlierRatio <= MAX_SCALE_OUTLIER_RATIO
  );
}

export interface EstimatorPick {
  /** L'estimateur PUBLIABLE, ou null si aucune série n'est stable. */
  estimator: ScaleEstimator | null;
  /** Vrai quand la série complète a échoué et que HVID seul est retenu (A9). */
  fallback: boolean;
}

/** ⭐ A9 — le candidat d'abord, la stabilité de SA série ensuite, repli dit. */
export function pickStableEstimator(
  hvid: readonly number[],
  full: readonly number[],
  maxStandardError: number,
): EstimatorPick {
  const candidate = candidateEstimatorOf(hvid.length, full.length);
  const series = candidate === 'hvid' ? hvid : full;
  if (scaleSeriesStable(series, maxStandardError)) return { estimator: candidate, fallback: false };
  if (candidate === 'hvid+pfl' && scaleSeriesStable(hvid, maxStandardError)) {
    return { estimator: 'hvid', fallback: true };
  }
  return { estimator: null, fallback: false };
}
