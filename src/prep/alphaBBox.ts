/**
 * prep/alphaBBox.ts — ⭐ correctif B3 (CLAUDE.md §4).
 *
 * Calculé UNE FOIS, hors ligne, à l'export du sprite, puis stocké dans
 * spec.json. La chaîne de mesure ne doit jamais retomber sur `img.width`.
 */

import { CalibrationError } from '../core/geom.js';
import type { AlphaBBox } from '../core/frameSpec.js';

/** Sous-ensemble d'`ImageData` suffisant ici — évite de dépendre du DOM pour tester. */
export interface RgbaImage {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

/**
 * Plus petit rectangle contenant tout pixel d'alpha > seuil.
 *
 * Un détourage qui laisse 20 px de marge transparente sur un sprite à 12 px/mm
 * injecterait +1,7 mm dans la largeur de la monture — sans le moindre signe
 * extérieur, et sans qu'aucun test de rendu ne s'en aperçoive.
 */
export function computeAlphaBBox(img: RgbaImage, alphaThreshold = 8): AlphaBBox {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const alpha = img.data[(y * img.width + x) * 4 + 3];
      if (alpha === undefined || alpha <= alphaThreshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0 || maxY < 0) {
    throw new CalibrationError(
      `Sprite entièrement transparent : aucun pixel au-dessus du seuil alpha ${alphaThreshold}. ` +
        `Le détourage a probablement effacé la monture.`,
    );
  }

  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Pré-positionne les marques d'un nouveau coloris depuis le modèle de référence,
 * remises à l'échelle des dimensions de la nouvelle image (§11.1).
 *
 * ⚠️ Les marques pré-positionnées restent SOUMISES au même contrôle de
 * cohérence (§4). Un raccourci de saisie ne doit pas devenir un contournement
 * du garde-fou.
 */
export function scaleMarks<T extends Record<string, { x: number; y: number } | undefined>>(
  marks: T,
  refSize: { width: number; height: number },
  newSize: { width: number; height: number },
): T {
  const kx = newSize.width / refSize.width;
  const ky = newSize.height / refSize.height;
  const out: Record<string, { x: number; y: number } | undefined> = {};
  for (const [key, p] of Object.entries(marks)) {
    out[key] = p === undefined ? undefined : { x: p.x * kx, y: p.y * ky };
  }
  return out as T;
}
