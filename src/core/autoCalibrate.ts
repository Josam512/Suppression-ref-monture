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
import { CalibrationError, type NormalizedLandmark } from './geom.js';
import { HVID_MEAN_MM, MIN_SPLIT_FRAMES, type AutoMeasures } from './autoCalibration.js';
import { convergenceRelError, distanceFromIrisMm, farPdFromNear } from './pupillary.js';
import type { ImageBuffer } from './silhouette.js';
import { measureTemporalWidth } from './temporalWidth.js';

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
 * ⭐ Ce que la séance filmée fournit — quand elle le fournit — pour mesurer
 * l'ÉCART TEMPORAL sur la silhouette (§14.2, câblé au parcours sans carte le
 * 2026-08-19). L'image frontale est UNE frame figée pendant la collecte, avec
 * SES landmarks (mêmes pixels, mêmes repères — la leçon de `ui/freezeFrame.ts`) ;
 * le masque de mouvement vient des vues tournées, ou vaut null sans rotation —
 * et sans lui la silhouette n'est PAS tentée : rien ne distingue alors un bord
 * de tête d'un montant de porte.
 */
export interface AutoTemporalScene {
  frontal: ImageBuffer;
  motion: Uint8Array | null;
  lm: readonly NormalizedLandmark[];
  w: number;
  h: number;
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
  temporal: AutoTemporalScene | null = null,
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

  // — PD : correction de convergence (fixation proche → loin).
  //
  // Le TOTAL vient de `pdSumNearMm`, accumulé au gate large (8°) : la somme des
  // deux demi-écarts est invariante au yaw au premier ordre. Les DEMI-écarts,
  // eux, ne sont publiés que si assez de frames de face STRICTE les portent
  // (`MIN_SPLIT_FRAMES`) : au-delà de ~3° de yaw, l'artefact de projection
  // mesuré sur sujet réel (−1,1 mm/°) fabriquerait une fausse asymétrie.
  //
  // Le facteur (D + 13,5)/(D + 3,05) est le même pour les deux yeux tant que la
  // fixation est sur l'axe médian (HYPOTHÈSE : le client regarde son reflet) :
  // l'appliquer à chaque demi-écart MESURÉ préserve donc l'asymétrie mesurée —
  // jamais de retour déguisé à « PD/2 de chaque côté ».
  const convergence = convergenceRelError(distanceMm, focalRel);
  const pdMm = farPdFromNear(m.pdSumNearMm, distanceMm);
  const pdRelError = Math.hypot(m.priorRelError, m.pdSumSE, convergence);
  if (!(pdMm >= PD_MIN_MM && pdMm <= PD_MAX_MM)) {
    throw new CalibrationError(
      `Écart pupillaire obtenu : ${pdMm.toFixed(1)} mm, hors plage anatomique. ` +
        `La détection des yeux a probablement échoué — recommencez face à la caméra, sans lunettes.`,
    );
  }

  const splitUsable = m.splitFrames >= MIN_SPLIT_FRAMES;
  let halfFields: Pick<UserCalibration, 'pdLeftMm' | 'pdRightMm' | 'pdHalfUncertaintyMm'> = {};
  if (splitUsable) {
    const pdRightMm = farPdFromNear(m.pdRightNearMm, distanceMm);
    const pdLeftMm = farPdFromNear(m.pdLeftNearMm, distanceMm);
    // Chaque demi-écart porte SON bruit de détection : un œil moins net, plus
    // près du bord ou partiellement occulté a une erreur-type plus large.
    const halfUnc = (halfMm: number, se: number): number =>
      halfMm * Math.hypot(m.priorRelError, se, convergence);
    const pdHalfUncertaintyMm = {
      right: halfUnc(pdRightMm, m.pdRightSE),
      left: halfUnc(pdLeftMm, m.pdLeftSE),
    };
    halfFields = { pdLeftMm, pdRightMm, pdHalfUncertaintyMm };
    notes.push(
      `Écart pupillaire : ${pdMm.toFixed(1)} mm ± ${(pdMm * pdRelError).toFixed(1)} mm — ` +
        `demi-PD droite ${pdRightMm.toFixed(1)} ± ${pdHalfUncertaintyMm.right.toFixed(1)} mm, ` +
        `demi-PD gauche ${pdLeftMm.toFixed(1)} ± ${pdHalfUncertaintyMm.left.toFixed(1)} mm, ` +
        `mesurées sur ${m.splitFrames} images de face stricte ` +
        `(dont correction de convergence +${(pdMm - m.pdSumNearMm).toFixed(1)} mm, déduite de la distance).`,
    );
  } else {
    notes.push(
      `Écart pupillaire : ${pdMm.toFixed(1)} mm ± ${(pdMm * pdRelError).toFixed(1)} mm. ` +
        `Demi-PD non séparées : pas assez d'images de face stricte (${m.splitFrames}/${MIN_SPLIT_FRAMES}) — ` +
        `regardez l'écran bien en face quelques secondes pour les obtenir. Rien n'est deviné.`,
    );
  }

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

  // — Écart temporal : MESURÉ sur la silhouette quand la séance l'a permis,
  //   sinon DIT absent — jamais deviné, jamais remplacé par une constante cachée
  //   (§14.2 : son absence élargit la marge affichée, rien de plus).
  //
  //   L'échelle passée est celle du plan des tempes : l'échelle des yeux (le
  //   médian de la collecte) corrigée du même 1/z que la largeur ci-dessus.
  //   La frame figée est l'une des frames collectées : une dérive de distance
  //   entre elle et le médian est couverte par `relError`, déjà propagée.
  let temporalFields: Pick<UserCalibration, 'temporalWidthMm' | 'temporalRelError'> = {};
  if (temporal !== null) {
    const t = measureTemporalWidth({
      frontal: temporal.frontal,
      motion: temporal.motion,
      lm: [...temporal.lm],
      w: temporal.w,
      h: temporal.h,
      pxPerMm: 1 / (m.mmPerPxEye * depthCorrection),
      scaleRelError: relError,
    });
    if (t.measured) {
      temporalFields = { temporalWidthMm: t.widthMm, temporalRelError: t.relError };
      notes.push(
        `Écart temporal MESURÉ sur votre silhouette : ${t.widthMm.toFixed(0)} mm ` +
          `± ${(t.widthMm * t.relError).toFixed(0)} mm — c'est lui que la légende compare à la monture.`,
      );
    } else {
      notes.push(
        `Écart temporal non mesuré (${t.reason ?? 'raison inconnue'}). ` +
          `La légende s'appuiera sur la largeur aux repères, avec sa marge — rien n'est deviné.`,
      );
    }
  } else {
    notes.push(
      `Écart temporal non mesuré : montrez brièvement vos deux profils pendant la mesure ` +
        `pour qu'il le soit. En attendant, la légende s'appuie sur la largeur aux repères, avec sa marge.`,
    );
  }

  const cal: UserCalibration = {
    faceWidthMm,
    source: 'auto',
    relError,
    measuredAt: nowMs,
    pdMm,
    pdRelError,
    ...halfFields,
    ...temporalFields,
  };
  return { cal, notes };
}
