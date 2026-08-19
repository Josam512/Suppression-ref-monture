/**
 * core/autoCalibrate.ts — des mesures du moteur automatique à la calibration.
 *
 * ⚠️ Ce fichier est, avec `core/calibration.ts`, le SEUL à construire un
 * `UserCalibration` (source `'auto'`). Il n'en LIT jamais la source — la règle
 * du §4 (aucun branchement sur l'origine) reste entière.
 *
 * ## Les deux plans, et pourquoi la correction est indispensable
 *
 * L'échelle périoculaire vit AU PLAN DES YEUX. Les repères 234/454 — la
 * grandeur homologue de `faceWidthPx` au rendu — vivent ~45 mm EN ARRIÈRE.
 * En perspective, l'échelle varie en 1/z : convertir la largeur aux tempes
 * avec l'échelle des yeux la sous-estimerait de δz/D (≈ 9 % à 50 cm). C'est le
 * biais B4 de la carte, à l'identique — la V1 iris le laissait entier, il est
 * ici CORRIGÉ et son incertitude propagée.
 *
 * Provenance de chaque terme (RÈGLE ULTIME de la mission) :
 *   - `mmPerPxEye`, `pdNearMm`, `faceWidthEyePlaneMm`, `hvidPx` → MESURÉS ;
 *   - moyennes périoculaires → PRIOR ANTHROPOMÉTRIQUE (ocularScale) ;
 *   - distance caméra → DÉDUITE (iris + focale mesurée) ou HYPOTHÈSE (champ supposé) ;
 *   - profondeur yeux → tempes → HYPOTHÈSE dérivée de CARD_TO_TEMPLE_DEPTH_MM,
 *     à mesurer sur sujets réels (protocole : ETAT-DE-L-ART §16).
 */

import { assertPlausibleFaceWidth, type UserCalibration } from './calibration.js';
import { CARD_TO_TEMPLE_DEPTH_MM, CARD_TO_TEMPLE_DEPTH_SD_MM } from './cardOptics.js';
import { focalPxFor, isProfileUsable, type CameraProfile } from './cameraProfile.js';
import { CalibrationError } from './geom.js';
import { HVID_MEAN_MM, type AutoMeasures } from './autoCalibration.js';
import { convergenceRelError, distanceFromIrisMm, farPdFromNear } from './pupillary.js';

/**
 * Champ horizontal SUPPOSÉ quand aucun profil d'objectif n'est mémorisé.
 * 70° couvre le milieu de la plage réelle des caméras frontales (60–90°) ;
 * l'incertitude de ±30 % couvre les deux extrêmes. HYPOTHÈSE déclarée.
 */
export const AUTO_ASSUMED_HFOV_DEG = 70;
export const FOCAL_PRIOR_REL_ERROR = 0.3;

/**
 * Profondeur plan des yeux → plan des repères 234/454.
 *
 * Dérivée de `CARD_TO_TEMPLE_DEPTH_MM` (57 ± 8 mm, mesurée sur sujet réel via
 * la carte) moins le recul de la cornée derrière le plan front/carte
 * (~12 ± 9 mm, anatomie ; la cornée est en retrait de la glabelle).
 * HYPOTHÈSE à ±27 % — à mesurer au protocole sujets réels.
 */
export const EYEPLANE_TO_TEMPLE_DEPTH_MM = CARD_TO_TEMPLE_DEPTH_MM - 12;
export const EYEPLANE_TO_TEMPLE_DEPTH_SD_MM = Math.hypot(CARD_TO_TEMPLE_DEPTH_SD_MM, 9);

/** Plage de plausibilité du PD : enfant de 3 ans (~46 mm) → adulte hors norme. */
export const PD_MIN_MM = 40;
export const PD_MAX_MM = 80;

export interface AutoCalibrationOutput {
  cal: UserCalibration;
  /** À afficher tel quel : ce qui a été mesuré, déduit, supposé. */
  notes: string[];
}

/**
 * Assemble la calibration automatique. Lève `CalibrationError` UNIQUEMENT si
 * une grandeur sort de sa plage anatomique — le seul cas où recommencer répare.
 */
export function calibrateAuto(
  m: AutoMeasures,
  imageWidthPx: number,
  storedProfile: CameraProfile | null,
  nowMs: number,
): AutoCalibrationOutput {
  const notes: string[] = [];

  // — Distance caméra ↔ yeux : focale mesurée si on en a une, supposée sinon.
  const usable = isProfileUsable(storedProfile, nowMs);
  const focalPx = usable
    ? focalPxFor(storedProfile as CameraProfile, imageWidthPx)
    : imageWidthPx / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
  const focalRel = usable ? (storedProfile as CameraProfile).relError : FOCAL_PRIOR_REL_ERROR;

  const distanceMm = distanceFromIrisMm(m.hvidPx, focalPx, HVID_MEAN_MM);
  notes.push(
    usable
      ? `Distance déduite de vos iris et de votre objectif — MESURÉ lors d'une séance ` +
          `carte précédente sur cet appareil : ${(distanceMm / 10).toFixed(0)} cm (±${(focalRel * 100).toFixed(0)} %). ` +
          `Sans cet héritage, la marge serait un peu plus large ; la mesure, elle, resterait la même.`
      : `Distance déduite de vos iris avec un champ de caméra supposé (${AUTO_ASSUMED_HFOV_DEG}°) : ${(distanceMm / 10).toFixed(0)} cm (±${(focalRel * 100).toFixed(0)} %). Elle ne pèse que sur des termes du second ordre.`,
  );

  // — PD : correction de convergence (fixation proche → loin), PAR ŒIL.
  //
  // Le facteur (D + 13,5)/(D + 3,05) est le même pour les deux yeux tant que la
  // fixation est sur l'axe médian (HYPOTHÈSE : le client regarde son reflet) :
  // l'appliquer à chaque demi-écart MESURÉ préserve donc l'asymétrie mesurée —
  // jamais de retour déguisé à « PD/2 de chaque côté ».
  const convergence = convergenceRelError(distanceMm, focalRel);
  const pdRightMm = farPdFromNear(m.pdRightNearMm, distanceMm);
  const pdLeftMm = farPdFromNear(m.pdLeftNearMm, distanceMm);
  const pdMm = pdRightMm + pdLeftMm;
  const pdRelError = Math.hypot(m.priorRelError, m.scaleStandardError, convergence);
  // Chaque demi-écart porte SON bruit de détection : un œil moins net, plus
  // près du bord ou partiellement occulté a une erreur-type plus large.
  const halfUnc = (halfMm: number, se: number): number =>
    halfMm * Math.hypot(m.priorRelError, se, convergence);
  const pdHalfUncertaintyMm = {
    right: halfUnc(pdRightMm, m.pdRightSE),
    left: halfUnc(pdLeftMm, m.pdLeftSE),
  };
  if (!(pdMm >= PD_MIN_MM && pdMm <= PD_MAX_MM)) {
    throw new CalibrationError(
      `Écart pupillaire obtenu : ${pdMm.toFixed(1)} mm, hors plage anatomique. ` +
        `La détection des yeux a probablement échoué — recommencez face à la caméra, sans lunettes.`,
    );
  }
  notes.push(
    `Écart pupillaire : ${pdMm.toFixed(1)} mm ± ${(pdMm * pdRelError).toFixed(1)} mm — ` +
      `demi-PD droite ${pdRightMm.toFixed(1)} ± ${pdHalfUncertaintyMm.right.toFixed(1)} mm, ` +
      `demi-PD gauche ${pdLeftMm.toFixed(1)} ± ${pdHalfUncertaintyMm.left.toFixed(1)} mm ` +
      `(dont correction de convergence +${(pdMm - m.pdRightNearMm - m.pdLeftNearMm).toFixed(1)} mm, déduite de la distance).`,
  );

  // — Largeur 234↔454 : échelle des yeux ramenée au plan des tempes (1/z).
  const depthCorrection = 1 + EYEPLANE_TO_TEMPLE_DEPTH_MM / distanceMm;
  const depthRel =
    (EYEPLANE_TO_TEMPLE_DEPTH_MM / distanceMm) *
    Math.hypot(EYEPLANE_TO_TEMPLE_DEPTH_SD_MM / EYEPLANE_TO_TEMPLE_DEPTH_MM, focalRel);
  const faceWidthMm = m.faceWidthEyePlaneMm * depthCorrection;
  const relError = Math.hypot(m.priorRelError, m.scaleStandardError, depthRel);
  assertPlausibleFaceWidth(faceWidthMm, 'auto');
  notes.push(
    `Largeur de visage : ${faceWidthMm.toFixed(0)} mm ± ${(faceWidthMm * relError).toFixed(0)} mm — ` +
      `dont ${((depthCorrection - 1) * 100).toFixed(1)} % de correction de plan (yeux → tempes), ` +
      `corrigée au lieu d'être supposée nulle.`,
  );
  if (m.degraded) {
    notes.push(
      `Mesure conclue au délai maximal (${m.usableFrames} images utiles) : la marge est plus large que d'habitude.`,
    );
  }

  const cal: UserCalibration = {
    faceWidthMm,
    source: 'auto',
    relError,
    measuredAt: nowMs,
    pdMm,
    pdRelError,
    pdLeftMm,
    pdRightMm,
    pdHalfUncertaintyMm,
  };
  return { cal, notes };
}
