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

/**
 * Jonction haut de l'oreille ↔ crâne — là où une branche se coude.
 *
 * ⚠️ Indices IDENTIFIÉS PAR LA MESURE, pas de mémoire : sonde MediaPipe sur une
 * photo réelle, les 32 candidats du contour annotés puis lus à l'œil. 389 tombe
 * exactement à la racine de l'hélix ; 162 est son miroir. Le journal du projet
 * retient déjà une erreur de ce type (234/454 pris pour des points physiques
 * alors qu'ils glissent) — d'où la mesure plutôt que le souvenir.
 */
export const EAR_L = 162;
export const EAR_R = 389;

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

/**
 * Les quatre canthi. Ils définissent la LIGNE DES YEUX, qui est la hauteur à
 * laquelle une monture bien portée place ses centres optiques.
 *
 * 🔴 Ce sont les COINS des yeux, jamais les centres d'iris (468 / 473). Un iris
 * se déplace de plusieurs millimètres quand la personne regarde en haut ou en
 * bas ; ancrer la monture dessus la ferait glisser sur le nez au gré du regard.
 * Les canthi, eux, sont accrochés au crâne. C'est la même discipline qu'au §4 :
 * on ancre sur ce qui ne bouge pas avec autre chose que la tête.
 */
export const CANTHI = [EYE_L, EYE_L_INNER, EYE_R, EYE_R_INNER] as const;

/** Ordonnée écran de la ligne des yeux. Exportée : l'atelier la mesure aussi. */
export function eyeLineY(lm: readonly NormalizedLandmark[], w: number, h: number): number {
  let sum = 0;
  for (const i of CANTHI) sum += px(at(lm, i), w, h).y;
  return sum / CANTHI.length;
}

/**
 * ⭐ Point d'ancrage de la pose — remplace `VERTICAL_OFFSET_MM` (voir §6.3).
 *
 * Il combine les deux seules références défendables, chacune sur SON axe :
 *
 *   - **horizontalement, le sellion** : le pont enjambe le nez, la monture ne
 *     peut pas coulisser latéralement. Un écart pupille ↔ centre optique en X
 *     est donc une VRAIE mesure — c'est le décentrement du §5, règle 2.
 *   - **verticalement, la ligne des yeux** : la monture, elle, coulisse sur
 *     l'arête du nez, et l'opticien règle justement les plaquettes pour amener
 *     le centre optique à hauteur de pupille. La hauteur n'est donc pas une
 *     constante d'anatomie : c'est la cible du réglage.
 *
 * C'est ce qui rendait `VERTICAL_OFFSET_MM` incalibrable : elle figeait un degré
 * de liberté qui, dans la réalité, est ajusté personne par personne.
 *
 * ⚠️ Construit dans le repère du visage (base `u` le long de la ligne des yeux),
 * et non en mélangeant un x d'un point et un y d'un autre : sous roulis, ce
 * mélange déplacerait la monture latéralement sans raison physique.
 */
export function poseAnchorOf(
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
  rollRad: number,
): Pt {
  let sx = 0;
  let sy = 0;
  for (const i of CANTHI) {
    const p = px(at(lm, i), w, h);
    sx += p.x;
    sy += p.y;
  }
  const canthiMid = { x: sx / CANTHI.length, y: sy / CANTHI.length };
  const sellion = px(at(lm, SELLION), w, h);

  // Glisser le milieu des canthi LE LONG de la ligne des yeux jusqu'à la
  // médiane du nez : la composante perpendiculaire — la hauteur — est conservée.
  const ux = Math.cos(rollRad);
  const uy = Math.sin(rollRad);
  const t = (sellion.x - canthiMid.x) * ux + (sellion.y - canthiMid.y) * uy;
  return { x: canthiMid.x + ux * t, y: canthiMid.y + uy * t };
}

export interface FrameMetrics {
  livePxPerMm: number;
  rollRad: number;
  /** ⭐ T2 : était consommé par drawFrame et par le §5 sans jamais être renvoyé. */
  yawRad: number;
  /**
   * ⭐ Ancre de pose (`poseAnchorOf`). Le champ s'appelait `anchor` et valait le
   * seul sellion : renommé pour qu'aucun appelant ne continue de compiler avec
   * l'ancienne sémantique sans s'en apercevoir.
   */
  poseAnchor: Pt;
  /**
   * ⭐ Jonction oreille ↔ crâne, à l'écran, des deux côtés. C'est là que la
   * branche doit ABOUTIR. Mesurée sur ce visage-ci au lieu d'être déduite d'une
   * longueur de branche nominale, connue à ±20 % seulement.
   */
  ear: { left: Pt; right: Pt };
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
    poseAnchor: poseAnchorOf(lm, w, h, rollRadOf(lm, w, h)),
    ear: { left: px(at(lm, EAR_L), w, h), right: px(at(lm, EAR_R), w, h) },
  };
}
// ⚠️ NE PAS ajouter `faceWidthMm` au retour : ce serait une simple recopie de la
// calibration, qui ressemble à une mesure sans en être une. La largeur du visage
// se lit sur `cal`, sa seule source légitime.
