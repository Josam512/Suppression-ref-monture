/**
 * core/provisionalScale.ts — l'échelle d'UNE seule frame, pour ne jamais
 * laisser l'écran vide.
 *
 * ## Pourquoi ce fichier existe (audit humain, 2026-08-21, point 4)
 *
 * `renderScene.ts` sortait avant de dessiner tant que `cal === null`. Le suivi
 * du visage pouvait être parfait — 478 landmarks stables — et l'écran restait
 * vide parce que la mesure MÉTRIQUE n'avait pas convergé. Deux choses
 * distinctes étaient liées par une seule condition :
 *
 *     suivi visuel (tracking)      ≠      métrologie absolue (mm certifiés)
 *
 * ## 🔴 Le défaut de PLAN, mesuré puis corrigé (audit du 2026-08-21, point 2)
 *
 * Première version : `faceWidthMm = faceWidthPx(234↔454) × mmPerPx(plan des
 * YEUX)`. Or 234/454 vivent au plan des TEMPES, plus loin de l'objectif. La
 * largeur sortait donc trop petite, `livePxPerMm` trop grand, et le sprite
 * était peint TROP LARGE — puis rétrécissait d'un coup à la calibration :
 *
 *     distance    sprite aperçu → calibré
 *      400 mm            −10,1 %
 *      500 mm             −8,3 %
 *      700 mm             −6,0 %
 *
 * Un saut visible, et dans le mauvais sens : l'aperçu flattait la monture.
 *
 * ## Ce qui le supprime — par CONSTRUCTION, pas par un facteur correctif
 *
 * L'aperçu emprunte exactement la même chaîne d'assemblage que la mesure
 * définitive (`calibrateAuto`) : même passage du plan des yeux au plan des
 * tempes, même estimation de distance, même arithmétique. La seule différence
 * est le nombre d'échantillons — 1 au lieu de 30. Il ne peut donc PLUS y avoir
 * de discontinuité de plan entre l'aperçu et la calibration : ce qui reste est
 * l'écart entre une valeur brute et une médiane, c'est-à-dire du bruit, borné
 * et vérifié par un test.
 *
 * ## Ce que ce n'est PAS
 *
 * 🔴 Ni un slider (§1 bug #1), ni un présupposé de taille (§0.0.3) : aucune
 * constante de largeur de visage n'entre ici. L'échelle vient du MÊME étalon
 * biologique — l'iris — simplement lu sur une image au lieu de trente.
 *
 * ## Ce que ça oblige l'IHM à faire
 *
 * Une échelle d'une seule frame porte tout le bruit de détection : elle suffit
 * à POSER l'image, jamais à AFFIRMER un millimètre. L'appelant doit donc
 * dessiner la monture (§0.0.2) et GELER la légende chiffrée — `verdict` reste
 * `null`, comme la règle 3 gèle les chiffres sans interrompre l'essayage (§5).
 * Le nom `provisional` est là pour qu'aucun appelant ne l'oublie.
 */

import { calibrateAuto } from './autoCalibrate.js';
import type { AutoMeasures } from './autoMeasures.js';
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
 * `null` n'est pas une erreur : c'est « je ne peux pas encore poser l'image
 * honnêtement », et l'appelant l'affiche comme tel plutôt que de dessiner une
 * monture à une taille inventée.
 */
export function provisionalScale(
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
  discrepancyMax: number,
  nowMs: number,
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
    // ⚠️ Avec n = 1, l'erreur-type d'échantillonnage n'est pas mesurable : la
    // formule rendrait 0, ce qui annoncerait une précision qui n'existe pas.
    // On la borne par le prior lui-même — honnête et conservateur.
    scaleStandardError: scale.relError,
    // Les demi-écarts ne sont PAS publiés sur une frame : `splitFrames = 0`
    // suffit à l'aval pour les taire (architecture demi-PD inchangée).
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
    // ⭐ LA MÊME chaîne que la mesure définitive : aucun saut de plan possible.
    return { cal: calibrateAuto(measures, w, null, nowMs).cal, irisPx: iris.widthPx };
  } catch {
    // Grandeur hors plage anatomique sur cette frame-là : on ne pose rien
    // plutôt que de poser une taille absurde. La frame suivante réessaiera.
    return null;
  }
}
