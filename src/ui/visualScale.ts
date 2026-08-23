/**
 * ui/visualScale.ts — l'échelle VISUELLE de secours du rendu.
 *
 * ⚖️ ARBITRAGE HUMAIN 2026-08-23 (refonte « VTO autonome ») : quand l'iris est
 * refusé depuis le début (lunettes portées, reflet permanent, yeux trop
 * petits), le client ne reste PLUS devant une caméra sans monture. Le rendu
 * pose la monture sur une échelle provisoire honnête :
 *
 *     pxPerMm = largeur du visage en px ÷ refWidthMm
 *
 * 🔴 RÉ-AUDIT HUMAIN 2026-08-23 (soir) — `refWidthMm` est une RÉFÉRENCE FIGÉE
 * par session, JAMAIS la largeur de la monture en cours d'essayage. La
 * première version divisait par la monture sélectionnée : une petite monture
 * était zoomée, une grande réduite, et toutes finissaient par « couvrir le
 * visage » — l'adaptation cosmétique que le §1 bug #1 combat, revenue par la
 * fenêtre. Désormais l'échelle provisoire est une propriété de la SESSION
 * (figée à la première monture affichée, cf. renderScene) : à travers elle,
 * une monture de 150 mm reste 25 % plus large qu'une monture de 120 mm, et
 * chacune suit la distance (facePx est remesuré à chaque frame).
 *
 * 🔴 Ce que cette échelle n'est PAS, mécaniquement :
 *   - pas une calibration : jamais persistée, jamais convertie en mm de
 *     visage, jamais vue par la métrologie (le moteur lit les landmarks
 *     BRUTS via pump(), pas la pose filtrée) ;
 *   - pas un présupposé de taille du VISAGE (§0.0.3) : aucune constante
 *     anatomique n'entre — la référence est la cote RÉELLE d'une monture du
 *     catalogue, mesurée au réglet dans son spec.json ;
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
 *
 * `refWidthMm` : la référence de session FIGÉE (largeur totale en mm de la
 * première monture affichée) — la MÊME pour toutes les montures essayées
 * ensuite, sans quoi le rapport entre montures serait détruit (ré-audit).
 */
export function estimateVisualScale(
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
  refWidthMm: number,
): number | null {
  if (!Number.isFinite(refWidthMm) || refWidthMm <= 0) return null;
  if (lm[FACE_L] === undefined || lm[FACE_R] === undefined) return null; // repères absents : rien à poser
  const facePx = dist(px(at(lm, FACE_L), w, h), px(at(lm, FACE_R), w, h));
  if (!Number.isFinite(facePx) || facePx <= 0) return null;
  return facePx / refWidthMm;
}
