/**
 * core/renderPose.ts — l'échelle de POSE d'une frame : de quoi dessiner,
 * jamais de quoi conclure.
 *
 * ## Ce qui remplace quoi (guide de fiabilisation, point 3)
 *
 * L'ancien aperçu (`core/provisionalScale.ts`, supprimé) fabriquait une FAUSSE
 * calibration complète en appelant `calibrateAuto()` : la frame passait alors
 * les validations anatomiques (PD 40–80 mm, visage 95–175 mm) — et quand une
 * seule de ces grandeurs sortait de sa plage SUR CETTE FRAME, la monture
 * disparaissait de l'écran. Le rendu était l'otage de la métrologie.
 *
 * Ici : AUCUNE validation anatomique. L'échelle de pose est l'échelle du plan
 * des yeux (iris, le même étalon biologique), ramenée au plan des tempes par
 * la MÊME formule 1/z que l'assemblage définitif — même distance, même profil
 * d'objectif (complément 5 : l'aperçu et le final partagent leur optique, le
 * saut aperçu→calibré ne peut plus venir d'un chemin divergent).
 *
 * ## Ce que c'est, et ce que ce n'est pas
 *
 * 🔴 Ni un slider (§1 bug #1), ni un présupposé de taille (§0.0.3) : aucune
 * constante de largeur de visage n'entre ici. Une échelle d'une seule frame
 * suffit à POSER l'image, jamais à AFFIRMER un millimètre : la légende reste
 * gelée tant que la mesure n'a pas convergé (§5, règle 3).
 *
 * Un iris momentanément douteux rend `scale: null` — et l'appelant GARDE la
 * dernière échelle connue au lieu de retirer la monture (point 30 : l'iris est
 * un critère de MÉTROLOGIE, pas de tracking).
 */

import { EYEPLANE_TO_TEMPLE_DEPTH_MM, AUTO_ASSUMED_HFOV_DEG } from './autoCalibrate.js';
import { focalPxFor, isProfileUsable, type CameraProfile } from './cameraProfile.js';
import type { NormalizedLandmark } from './geom.js';
import { irisQualityOf, type IrisQuality } from './irisQuality.js';
import { eyePlaneScale, ocularPixelsOf } from './ocularScale.js';
import { HVID_MEAN_MM } from './ocularScale.js';
import { distanceFromIrisMm } from './pupillary.js';

export interface RenderPoseScale {
  /** px par mm AU PLAN DES TEMPES — la grandeur homologue de `livePxPerMm`. */
  templePlanePxPerMm: number;
  /** px par mm au plan des yeux, telle que mesurée sur CETTE frame. */
  eyePlanePxPerMm: number;
  /** Distance caméra ↔ yeux déduite (iris + focale), en mm. */
  distanceMm: number;
  /** Largeur d'iris retenue, en pixels : ce que le HUD doit montrer. */
  irisPx: number;
  /** Qualité iris de la frame — diagnostic, jamais un veto de rendu. */
  iris: IrisQuality;
}

/**
 * Focale en pixels pour cette image : le profil d'objectif mesuré s'il est
 * utilisable, sinon le champ supposé — EXACTEMENT le choix que fait
 * l'assemblage définitif (`calibrateAuto`), pour que l'aperçu et le final
 * vivent dans la même optique (complément 5).
 */
export function renderFocalPx(
  imageWidthPx: number,
  storedProfile: CameraProfile | null,
  nowMs: number,
): number {
  return isProfileUsable(storedProfile, nowMs)
    ? focalPxFor(storedProfile as CameraProfile, imageWidthPx)
    : imageWidthPx / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
}

/**
 * L'échelle de pose de CETTE frame, ou `null` si les iris ne la portent pas —
 * auquel cas l'appelant conserve la dernière échelle connue : la monture ne
 * disparaît pas parce qu'une frame est mauvaise.
 */
export function renderPoseScale(
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
  discrepancyMax: number,
  storedProfile: CameraProfile | null,
  nowMs: number,
): RenderPoseScale | null {
  const eyes = ocularPixelsOf(lm, w, h);
  const iris = irisQualityOf(eyes.hvidLeftPx, eyes.hvidRightPx, discrepancyMax);
  if (!iris.ok) return null;

  const scale = eyePlaneScale(eyes);
  if (scale === null || !Number.isFinite(scale.mmPerPx) || scale.mmPerPx <= 0) return null;

  const focalPx = renderFocalPx(w, storedProfile, nowMs);
  const distanceMm = distanceFromIrisMm(iris.widthPx, focalPx, HVID_MEAN_MM);
  if (!Number.isFinite(distanceMm) || distanceMm <= 0) return null;

  // ⭐ LA même conversion de plan que l'assemblage définitif — une fois.
  const depthCorrection = 1 + EYEPLANE_TO_TEMPLE_DEPTH_MM / distanceMm;
  const eyePlanePxPerMm = 1 / scale.mmPerPx;
  const templePlanePxPerMm = eyePlanePxPerMm / depthCorrection;
  if (!Number.isFinite(templePlanePxPerMm) || templePlanePxPerMm <= 0) return null;

  return { templePlanePxPerMm, eyePlanePxPerMm, distanceMm, irisPx: iris.widthPx, iris };
}
