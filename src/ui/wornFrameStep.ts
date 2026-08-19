/**
 * ui/wornFrameStep.ts — V2, la monture PORTÉE sert d'étalon (§11.3).
 *
 * Extrait de `TryOn.tsx` pour tenir la règle des 300 lignes (§3). C'est du
 * calcul pur : il reçoit des pixels mesurés, rend une calibration et les
 * phrases à afficher, ou lève. Aucun état, aucun DOM.
 *
 * ⚠️ Il ne teste AUCUN mode (§11.4). C'est l'appelant qui sait qu'on est en
 * magasin ; ici on ne voit qu'une largeur en pixels et une fiche de monture.
 */

import { calibrateWithWornFrame, type UserCalibration } from '../core/calibration.js';
import type { FrameSpec } from '../core/frameSpec.js';
import { CalibrationError, type NormalizedLandmark } from '../core/geom.js';

export interface WornFrameOutcome {
  cal: UserCalibration;
  notices: string[];
}

/** Câblage IHM du même étalonnage : rend le gestionnaire prêt à brancher. */
export function wornFrameHandlerOf(deps: {
  canvasWidth(): number | null;
  canvasHeight(): number | null;
  onDone(out: WornFrameOutcome, worn: FrameSpec): void;
  onError(message: string): void;
}): (widthPx: number, worn: FrameSpec, lm: readonly NormalizedLandmark[]) => void {
  return (widthPx, worn, lm) => {
    const w = deps.canvasWidth();
    const h = deps.canvasHeight();
    if (w === null || h === null) return;
    try {
      // ⚠️ `lm` vient de l'image FIGÉE, pas de la boucle live — la monture et le
      // visage se mesurent sur les mêmes pixels, sinon leur rapport est faux.
      deps.onDone(wornFrameCalibration(widthPx, worn, lm, w, h), worn);
    } catch (err) {
      deps.onError(err instanceof Error ? err.message : String(err));
    }
  };
}

export function wornFrameCalibration(
  widthPx: number,
  worn: FrameSpec,
  lm: readonly NormalizedLandmark[] | null,
  w: number,
  h: number,
): WornFrameOutcome {
  if (lm === null) throw new CalibrationError('Visage perdu pendant l’étalonnage.');
  return {
    cal: calibrateWithWornFrame(widthPx, worn, lm, w, h),
    notices: [
      `Étalonné sur « ${worn.slug} » — précision 2 %.`,
      `Choisissez un autre coloris : c'est la monture que vous portez qui sera repeinte, ` +
        `avec sa lumière, ses reflets et sa perspective réels.`,
    ],
  };
}
