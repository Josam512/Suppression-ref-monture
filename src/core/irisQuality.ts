/**
 * core/irisQuality.ts — gate iris en qualité métrologique, pas en taille brute.
 */

export const IRIS_ABSOLUTE_FLOOR_PX = 3;
export const IRIS_DISCREPANCY_MARGIN = 10;

/**
 * Écart maximal admis entre les deux iris sur la même frame.
 * Le seuil est exprimé relativement à leur MOYENNE, comme l'indique la
 * dérivation. À ~8° : 10 × (1-cos 8°) ≈ 9,8 %.
 */
export function irisDiscrepancyMax(frontalGateRad: number): number {
  return IRIS_DISCREPANCY_MARGIN * (1 - Math.cos(frontalGateRad));
}

export interface IrisQuality {
  widthPx: number;
  /** |L-R| / moyenne(L,R). */
  discrepancy: number;
  ok: boolean;
  reason: 'quantification' | 'iris-aberrant' | null;
}

export function irisQualityOf(
  leftPx: number,
  rightPx: number,
  discrepancyMax: number,
): IrisQuality {
  const widthPx = (leftPx + rightPx) / 2;
  const sum = leftPx + rightPx;

  // Audit 2026-08-21 : l'ancienne formule utilisait |L-R|/(L+R), soit la
  // MOITIÉ de l'écart relatif à la moyenne, alors que le seuil et les
  // commentaires étaient dérivés en pourcentage de la moyenne. Résultat : un
  // seuil annoncé à ~9,8 % acceptait en pratique ~20 % d'écart entre les yeux.
  // Ce facteur 2 corrige l'unité du gate sans retoucher la constante dérivée.
  const discrepancy = sum > 0 ? (2 * Math.abs(leftPx - rightPx)) / sum : 1;

  if (Math.min(leftPx, rightPx) < IRIS_ABSOLUTE_FLOOR_PX) {
    return { widthPx, discrepancy, ok: false, reason: 'quantification' };
  }
  if (discrepancy > discrepancyMax) {
    return { widthPx, discrepancy, ok: false, reason: 'iris-aberrant' };
  }
  return { widthPx, discrepancy, ok: true, reason: null };
}
