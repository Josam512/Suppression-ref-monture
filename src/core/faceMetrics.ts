/**
 * core/faceMetrics.ts — Échelle 3 : chaque frame (CLAUDE.md §4).
 *
 * La carte a disparu, mais le visage est maintenant connu en mm. Il suffit de
 * mesurer sa largeur en pixels sur l'image courante pour retrouver l'échelle,
 * image par image.
 */

import { at, dist, px, type NormalizedLandmark, type Pt } from './geom.js';
import type { UserCalibration } from './calibration.js';

// MediaPipe FaceLandmarker renvoie 478 points.
export const FACE_L = 234;
export const FACE_R = 454; // contour externe, niveau tempes/joues
export const EYE_L = 33;
export const EYE_R = 263; // coins externes des yeux → inclinaison
export const EYE_L_INNER = 133; // coin interne de l'œil gauche → centre de l'œil
export const EYE_R_INNER = 362; // coin interne de l'œil droit
export const SELLION = 168; // creux du nez, entre les yeux → ancrage

// Contours d'iris (points 468–477) : c'est la raison d'être du modèle à 478 points.
export const IRIS_L_OUTER = 469;
export const IRIS_L_INNER = 471; // extrêmes HORIZONTAUX de l'iris gauche
export const IRIS_R_OUTER = 474;
export const IRIS_R_INNER = 476; // extrêmes horizontaux de l'iris droit

/** Au-delà, cos(yaw) devient instable et la dé-projection amplifierait le bruit. */
export const MAX_YAW_FOR_SCALE_RAD = 0.7; // ~40°

/**
 * Diamètre horizontal de l'iris, moyenné sur les DEUX yeux.
 *
 * ⚠️ Moyenner sur davantage de frames tue le bruit de détection, pas la
 * variabilité biologique : celle-ci est un biais fixe propre à la personne.
 * Ne jamais en déduire une précision meilleure que IRIS_REL_ERROR.
 */
export function irisWidthPx(lm: readonly NormalizedLandmark[], w: number, h: number): number {
  const left = dist(px(at(lm, IRIS_L_OUTER), w, h), px(at(lm, IRIS_L_INNER), w, h));
  const right = dist(px(at(lm, IRIS_R_OUTER), w, h), px(at(lm, IRIS_R_INNER), w, h));
  return (left + right) / 2;
}

export interface FrameMetrics {
  livePxPerMm: number;
  rollRad: number;
  /** ⭐ T2 : était consommé par drawFrame et par le §5 sans jamais être renvoyé. */
  yawRad: number;
  anchor: Pt;
}

/** Largeur apparente du visage, en pixels image. Exportée car les tests en ont besoin. */
export function faceWidthPx(lm: readonly NormalizedLandmark[], w: number, h: number): number {
  return dist(px(at(lm, FACE_L), w, h), px(at(lm, FACE_R), w, h));
}

/**
 * Inclinaison de la tête seule, sans calibration.
 *
 * Exportée parce que la COLLECTE des vues tournées (§4, parade B4 n°2) doit
 * juger de l'inclinaison avant qu'aucune échelle n'existe. Fabriquer une
 * calibration bidon juste pour appeler `frameMetrics` mettrait dans le code un
 * objet qui ressemble à une mesure sans en être une — exactement ce que ce
 * projet cherche à éviter.
 */
export function rollRadOf(lm: readonly NormalizedLandmark[], w: number, h: number): number {
  const eL = px(at(lm, EYE_L), w, h);
  const eR = px(at(lm, EYE_R), w, h);
  return Math.atan2(eR.y - eL.y, eR.x - eL.x);
}

export function frameMetrics(
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
  cal: UserCalibration,
  yawRad: number,
): FrameMetrics {
  const raw = faceWidthPx(lm, w, h);

  // ⭐ Correctif S1, moitié 1/2 — DÉ-projeter avant de convertir.
  //
  // 234/454 sont deux points d'un segment quasi frontal : quand la tête tourne
  // de `yaw`, leur écartement apparent est déjà réduit d'un facteur cos(yaw).
  // Sans cette compensation, `livePxPerMm` chute avec le yaw et le sprite
  // rétrécit sans raison physique — puis le cos est appliqué une SECONDE fois
  // au rendu, d'où le cos² du bug d'origine.
  const cosYaw = Math.cos(Math.min(Math.abs(yawRad), MAX_YAW_FOR_SCALE_RAD));
  const faceWidthPxFrontal = raw / cosYaw;

  // ⭐ LA conversion : largeur frontale à l'écran ÷ largeur réelle mémorisée.
  //
  // DÉCISION FIGÉE : la calibration est faite UNE FOIS, au démarrage. On ne
  // recalcule PAS l'échelle depuis l'iris à chaque image : ce serait plus
  // bruité, et cela rendrait les sources divergentes.
  //
  // Cette échelle est ISOTROPE : elle vaut pour les X comme pour les Y.
  const livePxPerMm = faceWidthPxFrontal / cal.faceWidthMm;

  return {
    livePxPerMm,
    rollRad: rollRadOf(lm, w, h),
    yawRad,
    anchor: px(at(lm, SELLION), w, h),
  };
}
// ⚠️ NE PAS ajouter `faceWidthMm` au retour : ce serait une simple recopie de la
// calibration, qui ressemble à une mesure sans en être une. La largeur du visage
// se lit sur `cal`, sa seule source légitime.
