/**
 * ui/visualScale.ts — l'échelle VISUELLE de secours du rendu.
 *
 * ⚖️ ARBITRAGE HUMAIN 2026-08-23 (refonte « VTO autonome ») — il renverse la
 * lecture A6 antérieure (« on explique, on n'invente pas ») : quand l'iris est
 * refusé depuis le début (lunettes portées, reflet permanent, yeux trop
 * petits), le client ne reste PLUS devant une caméra sans monture. Le rendu
 * pose la monture choisie SUR la largeur du visage :
 *
 *     pxPerMm = largeur du visage en px ÷ largeur totale de la monture en mm
 *
 * — c'est-à-dire : « cette monture couvre ce visage ». Plausible à l'œil,
 * recalculée à chaque frame (elle SUIT la distance), et STRICTEMENT visuelle.
 *
 * 🔴 Ce que cette échelle n'est PAS, mécaniquement :
 *   - pas une calibration : jamais persistée, jamais convertie en mm de
 *     visage, jamais vue par la métrologie (le moteur lit les landmarks
 *     BRUTS via pump(), pas la pose filtrée) ;
 *   - pas un présupposé de taille du VISAGE (§0.0.3) : aucune constante
 *     anatomique n'entre — la seule cote utilisée est celle de la MONTURE,
 *     mesurée au réglet dans son spec.json ;
 *   - pas un verdict : la légende chiffrée reste gelée (`provisional`),
 *     l'écran dit « aperçu — taille en cours de mesure ».
 *
 * Aucun gate PD / demi-PD / plage anatomique / qualité d'iris n'a le droit
 * d'entrer ici : c'est précisément ce que l'arbitrage interdit.
 */

import { at, dist, px, type NormalizedLandmark } from '../core/geom.js';
import { FACE_L, FACE_R } from '../core/faceMetrics.js';

/**
 * L'échelle visuelle de CETTE frame (px/mm), ou null si les repères de largeur
 * sont dégénérés — le seul cas restant où rien d'honnête ne peut être posé.
 */
export function estimateVisualScale(
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
  frameTotalWidthMm: number,
): number | null {
  if (!Number.isFinite(frameTotalWidthMm) || frameTotalWidthMm <= 0) return null;
  if (lm[FACE_L] === undefined || lm[FACE_R] === undefined) return null; // repères absents : rien à poser
  const facePx = dist(px(at(lm, FACE_L), w, h), px(at(lm, FACE_R), w, h));
  if (!Number.isFinite(facePx) || facePx <= 0) return null;
  return facePx / frameTotalWidthMm;
}
