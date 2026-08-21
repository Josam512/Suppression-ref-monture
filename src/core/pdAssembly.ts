/**
 * core/pdAssembly.ts — l'ASSEMBLAGE du PD, sous-système indépendant.
 *
 * Scindé de `core/autoCalibrate.ts` (règle des 300 lignes, §3) — et c'est une
 * scission qui dit l'architecture (guide, points 21–26) : le PD réussit ou
 * échoue POUR SOI, avec ses codes typés. Aucune largeur de visage n'entre ici.
 */

import { CalibrationError } from './geom.js';
import { devInvariant } from './invariants.js';
import { MIN_SPLIT_FRAMES, type AutoMeasures } from './autoCalibration.js';
import { convergenceRelError, farPdFromNear } from './pupillary.js';
import type { UserCalibration } from './calibration.js';
import type { FocalChoice } from './autoCalibrate.js';

/** Plage de plausibilité du PD : enfant de 3 ans (~46 mm) → adulte hors norme. */
export const PD_MIN_MM = 40;
export const PD_MAX_MM = 80;

/**
 * Cohérence demi-écarts ↔ PD direct (complément 13) : |OD + OG − PD| au-delà
 * de cette part du PD trahit un sellion décroché — les demi-PD sont
 * invalidées, le PD DIRECT est conservé tel quel, jamais « recalé ».
 */
export const HALF_SUM_MAX_REL_GAP = 0.04;

/** Le PD assemblé — indépendant de la largeur de visage (points 21–22, 26). */
export interface PdAssembly {
  pdMm: number;
  pdRelError: number;
  pdLeftMm?: number;
  pdRightMm?: number;
  pdHalfUncertaintyMm?: { left: number; right: number };
  splitFrames: number;
  notes: string[];
}

export function assemblePd(m: AutoMeasures, focal: FocalChoice, distanceMm: number): PdAssembly {
  const notes: string[] = [];
  const convergence = convergenceRelError(distanceMm, focal.focalRel);
  // ⭐ Point 22 — le TOTAL vient de la distance DIRECTE pupille ↔ pupille.
  const pdMm = farPdFromNear(m.pdDirectNearMm, distanceMm);
  const pdRelError = Math.hypot(m.priorRelError, m.pdDirectSE, convergence);
  if (!(pdMm >= PD_MIN_MM && pdMm <= PD_MAX_MM)) {
    throw new CalibrationError(
      `Écart pupillaire obtenu : ${pdMm.toFixed(1)} mm, hors plage anatomique. ` +
        `La détection des yeux a probablement échoué — recommencez face à la caméra, sans lunettes.`,
      'pd-out-of-range',
    );
  }

  const out: PdAssembly = { pdMm, pdRelError, splitFrames: m.splitFrames, notes };
  if (m.splitFrames < MIN_SPLIT_FRAMES) {
    notes.push(
      `Écart pupillaire : ${pdMm.toFixed(1)} mm ± ${(pdMm * pdRelError).toFixed(1)} mm. ` +
        `Demi-PD non séparées : pas assez d'images de face stricte (${m.splitFrames}/${MIN_SPLIT_FRAMES}) — ` +
        `regardez l'écran bien en face quelques secondes pour les obtenir. Rien n'est deviné.`,
    );
    return out;
  }

  const pdRightMm = farPdFromNear(m.pdRightNearMm, distanceMm);
  const pdLeftMm = farPdFromNear(m.pdLeftNearMm, distanceMm);

  // ⭐ Complément 13 — OD + OG doit recouper le PD direct. Sinon : sellion
  // décroché → les demi-PD tombent, le total reste, RIEN n'est recalé.
  const gap = Math.abs(pdRightMm + pdLeftMm - pdMm) / pdMm;
  if (gap > HALF_SUM_MAX_REL_GAP) {
    notes.push(
      `Écart pupillaire : ${pdMm.toFixed(1)} mm ± ${(pdMm * pdRelError).toFixed(1)} mm. ` +
        `Demi-PD écartées : OD + OG (${(pdRightMm + pdLeftMm).toFixed(1)} mm) ne recoupe pas le total ` +
        `(écart ${(gap * 100).toFixed(1)} %) — le repère du nez a probablement décroché. Le total, lui, est sûr.`,
    );
    return out;
  }

  // ⭐ Complément 45 — l'invariant du contrat des demi-PD, vérifié en dev.
  devInvariant(
    m.splitFrames >= MIN_SPLIT_FRAMES,
    `demi-PD publiées avec ${m.splitFrames} frames strictes (< ${MIN_SPLIT_FRAMES})`,
  );
  const halfUnc = (halfMm: number, se: number): number =>
    halfMm * Math.hypot(m.priorRelError, se, convergence);
  out.pdRightMm = pdRightMm;
  out.pdLeftMm = pdLeftMm;
  out.pdHalfUncertaintyMm = { right: halfUnc(pdRightMm, m.pdRightSE), left: halfUnc(pdLeftMm, m.pdLeftSE) };
  notes.push(
    `Écart pupillaire : ${pdMm.toFixed(1)} mm ± ${(pdMm * pdRelError).toFixed(1)} mm — ` +
      `demi-PD droite ${pdRightMm.toFixed(1)} ± ${out.pdHalfUncertaintyMm.right.toFixed(1)} mm, ` +
      `demi-PD gauche ${pdLeftMm.toFixed(1)} ± ${out.pdHalfUncertaintyMm.left.toFixed(1)} mm, ` +
      `mesurées sur ${m.splitFrames} images de face stricte ` +
      `(dont correction de convergence +${(pdMm - m.pdDirectNearMm).toFixed(1)} mm, déduite de la distance).`,
  );
  return out;
}

/** Les champs PD d'une calibration, depuis un assemblage — ou rien. */
export function pdFieldsOf(pd: PdAssembly | null): Partial<UserCalibration> {
  if (pd === null) return {};
  return {
    pdMm: pd.pdMm,
    pdRelError: pd.pdRelError,
    ...(pd.pdRightMm !== undefined && pd.pdLeftMm !== undefined && pd.pdHalfUncertaintyMm !== undefined
      ? { pdRightMm: pd.pdRightMm, pdLeftMm: pd.pdLeftMm, pdHalfUncertaintyMm: pd.pdHalfUncertaintyMm }
      : {}),
  };
}
