/**
 * core/provisionalScale.ts — l'échelle d'UNE seule frame, pour ne jamais
 * laisser l'écran vide.
 *
 * Le rendu provisoire doit emprunter EXACTEMENT la même chaîne géométrique que
 * la calibration définitive. La seule différence autorisée est le nombre
 * d'échantillons (1 ici, plusieurs dans AutoCalibrationEngine).
 */

import { calibrateAuto } from './autoCalibrate.js';
import type { AutoMeasures } from './autoMeasures.js';
import type { CameraProfile } from './cameraProfile.js';
import { faceWidthPx } from './faceMetrics.js';
import type { NormalizedLandmark } from './geom.js';
import { irisQualityOf } from './irisQuality.js';
import { eyePlaneScale, ocularPixelsOf } from './ocularScale.js';
import { pupilPixelsOf } from './pupillary.js';
import type { UserCalibration } from './calibration.js';

export interface ProvisionalScale {
  /** Utilisable par `frameMetrics` — pour DESSINER, jamais pour conclure. */
  cal: UserCalibration;
  /** Largeur d'iris retenue, en pixels : ce que le HUD doit montrer. */
  irisPx: number;
}

/**
 * L'échelle de CETTE frame, ou `null` si elle n'est pas exploitable.
 *
 * IMPORTANT audit 2026-08-21 : `storedProfile` doit être le MÊME profil caméra
 * que celui qui sera donné ensuite à `calibrateAuto` pour la calibration
 * définitive. L'ancienne version passait toujours `null` ici : sur un appareil
 * ayant déjà un profil d'objectif mesuré, l'aperçu utilisait donc le HFOV
 * supposé tandis que le résultat final utilisait la focale mesurée. Cela
 * réintroduisait exactement le saut aperçu → calibré que ce module était censé
 * supprimer.
 */
export function provisionalScale(
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
  discrepancyMax: number,
  nowMs: number,
  storedProfile: CameraProfile | null = null,
): ProvisionalScale | null {
  const eyes = ocularPixelsOf(lm, w, h);
  const iris = irisQualityOf(eyes.hvidLeftPx, eyes.hvidRightPx, discrepancyMax);
  if (!iris.ok) return null;

  const scale = eyePlaneScale(eyes);
  const pupils = pupilPixelsOf(lm, w, h);
  if (scale === null || pupils === null) return null;

  const measures: AutoMeasures = {
    mmPerPxEye: scale.mmPerPx,
    priorRelError: scale.relError,
    // Avec n = 1, l'erreur-type d'échantillonnage n'est pas mesurable : ne pas
    // annoncer artificiellement 0.
    scaleStandardError: scale.relError,
    // Les demi-écarts ne sont PAS publiés sur une frame.
    pdRightNearMm: NaN,
    pdLeftNearMm: NaN,
    pdRightSE: Infinity,
    pdLeftSE: Infinity,
    pdSumNearMm: (pupils.rightPx + pupils.leftPx) * scale.mmPerPx,
    pdSumSE: scale.relError,
    splitFrames: 0,
    faceWidthEyePlaneMm: faceWidthPx(lm, w, h) * scale.mmPerPx,
    hvidPx: iris.widthPx,
    usableFrames: 1,
    degraded: true,
  };

  try {
    // EXACTEMENT la même focale/profil que la calibration définitive.
    return { cal: calibrateAuto(measures, w, storedProfile, nowMs).cal, irisPx: iris.widthPx };
  } catch {
    // Grandeur hors plage anatomique sur cette frame : la suivante réessaiera.
    return null;
  }
}
