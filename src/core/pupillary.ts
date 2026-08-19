/**
 * core/pupillary.ts — l'écart pupillaire depuis la webcam, sans objet externe.
 *
 * ## La chaîne, maillon par maillon, avec la provenance de chaque terme
 *
 *   1. PD apparent en pixels (centres d'iris 468/473)          → MESURÉ
 *   2. × échelle du plan des yeux (`core/ocularScale.ts`)      → MESURÉ × PRIOR
 *      Iris et pupilles sont dans le même plan au premier ordre : le rapport
 *      PD/iris est INVARIANT À LA DISTANCE (pas de parallaxe B4 ici, contrairement
 *      à la largeur aux tempes). C'est le point fort de cette mesure.
 *   3. correction de CONVERGENCE                               → DÉDUIT GÉOMÉTRIQUEMENT
 *      Le client fixe son écran à 30–80 cm : ses yeux convergent, les pupilles
 *      se rapprochent. Un PD mesuré ainsi est un PD DE PRÈS. La correction vers
 *      le PD de loin utilise le centre de rotation de l'œil (13,5 mm derrière
 *      la cornée) et la pupille d'entrée (3,05 mm derrière la cornée) :
 *
 *          PD_loin = PD_mesuré × (D + 13,5) / (D + 3,05)
 *
 *      soit +2,1 mm à 30 cm, +1,1 mm à 60 cm sur un PD de 63 mm. Ne pas la
 *      confondre avec la règle d'atelier « PD_près = PD_loin − 4 mm », qui
 *      concerne la centration au plan des verres, pas la géométrie oculaire.
 *      Source : ETAT-DE-L-ART §3.4.
 *   4. distance caméra ↔ yeux                                  → DÉDUIT (iris + focale)
 *      D = focale_px × HVID / iris_px. La focale vient du profil d'objectif
 *      mesuré lors d'une séance carte antérieure quand il existe ; sinon d'un
 *      a priori de champ (HYPOTHÈSE, incertitude propagée). La correction de
 *      convergence étant petite (~3 %), une focale à ±25 % ne coûte que ~0,8 %
 *      sur elle, soit < 0,1 mm sur le PD.
 *
 * ## Hypothèse déclarée
 *
 * Le client regarde son propre reflet, donc une cible à peu près à la distance
 * de la caméra. Un regard ailleurs (second écran) fausserait la correction de
 * convergence de quelques dixièmes de millimètre. HYPOTHÈSE, non vérifiée.
 */

import { at, px, type NormalizedLandmark, type Pt } from './geom.js';
import { SELLION } from './faceMetrics.js';
import { IRIS_L_CENTER, IRIS_R_CENTER } from './ocularScale.js';

/** Cornée → centre de rotation de l'œil, mm. Gullstrand/Fry, valeur classique. */
export const CORNEA_TO_ROTATION_MM = 13.5;
/** Cornée → pupille d'entrée, mm (l'image de la pupille que la caméra voit). */
export const CORNEA_TO_ENTRANCE_PUPIL_MM = 3.05;

/** PD apparent et demi-écarts, en pixels, sur une frame. */
export interface PupilPixels {
  pdPx: number;
  /** Demi-écart GAUCHE ANATOMIQUE (œil gauche du client ↔ milieu du nez). */
  leftPx: number;
  rightPx: number;
}

/**
 * Lit l'écart pupillaire en pixels : centres d'iris, découpés au pied du
 * sellion PROJETÉ SUR LA LIGNE DES PUPILLES — jamais un mélange d'axes, qui
 * fausserait les demi-écarts dès que la tête roule.
 */
export function pupilPixelsOf(
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
): PupilPixels | null {
  const l = px(at(lm, IRIS_L_CENTER), w, h);
  const r = px(at(lm, IRIS_R_CENTER), w, h);
  const s = px(at(lm, SELLION), w, h);

  const dx = r.x - l.x;
  const dy = r.y - l.y;
  const pdPx = Math.hypot(dx, dy);
  if (!(pdPx > 1)) return null;

  // Projection du sellion sur la droite (l → r) : t ∈ [0;1] au milieu du nez.
  const t = ((s.x - l.x) * dx + (s.y - l.y) * dy) / (pdPx * pdPx);
  const foot: Pt = { x: l.x + t * dx, y: l.y + t * dy };

  return {
    pdPx,
    leftPx: Math.hypot(foot.x - l.x, foot.y - l.y),
    rightPx: Math.hypot(r.x - foot.x, r.y - foot.y),
  };
}

/** Distance caméra ↔ plan des yeux, depuis la taille angulaire de l'iris. */
export function distanceFromIrisMm(
  hvidMeanPx: number,
  focalPx: number,
  hvidMm: number,
): number {
  return (focalPx * hvidMm) / hvidMeanPx;
}

/**
 * PD de loin depuis le PD mesuré en fixation proche.
 *
 * @param pdNearMm PD apparent (plan des pupilles d'entrée), en mm.
 * @param fixationDistanceMm distance de l'objet fixé (≈ la caméra).
 */
export function farPdFromNear(pdNearMm: number, fixationDistanceMm: number): number {
  return (
    (pdNearMm * (fixationDistanceMm + CORNEA_TO_ROTATION_MM)) /
    (fixationDistanceMm + CORNEA_TO_ENTRANCE_PUPIL_MM)
  );
}

/**
 * Incertitude RELATIVE ajoutée par la correction de convergence quand la
 * distance de fixation est connue à `distanceRelError` près.
 *
 * d(correction)/correction ≈ correction × Δ D / D : le terme est du second
 * ordre — c'est pourquoi une focale supposée suffit ici.
 */
export function convergenceRelError(
  fixationDistanceMm: number,
  distanceRelError: number,
): number {
  const correction =
    (CORNEA_TO_ROTATION_MM - CORNEA_TO_ENTRANCE_PUPIL_MM) /
    (fixationDistanceMm + CORNEA_TO_ENTRANCE_PUPIL_MM);
  return correction * distanceRelError;
}
