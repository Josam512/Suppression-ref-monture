/**
 * core/autoCalibrate.ts — des mesures du moteur automatique à la calibration.
 *
 * ## Assemblages SÉPARÉS (guide 2026-08-21, points 20–21, 26)
 *
 * Le PD et l'échelle de visage sont deux MESURES INDÉPENDANTES : un PD
 * anatomiquement impossible ne doit pas jeter une largeur valide, ni
 * l'inverse. `assemblePd` et `assembleFaceScale` échouent donc CHACUN POUR
 * SOI, avec un code typé (complément 3) ; `calibrateAuto` reste l'orchestrateur
 * « tout doit réussir » pour les chemins qui veulent la calibration entière.
 *
 * ## Les deux plans, et pourquoi la correction est indispensable
 *
 * L'échelle périoculaire vit AU PLAN DES YEUX. Les repères 234/454 vivent
 * ~45 mm EN ARRIÈRE. En perspective, l'échelle varie en 1/z : convertir la
 * largeur aux tempes avec l'échelle des yeux la sous-estimerait de δz/D
 * (≈ 9 % à 50 cm). La conversion `eyeToTemplePlane` est appliquée UNE fois,
 * ICI (point 37) — le renderer ne la recompte jamais.
 */

import { assertPlausibleFaceWidth, type UserCalibration } from './calibration.js';
import { CARD_TO_TEMPLE_DEPTH_MM, CARD_TO_TEMPLE_DEPTH_SD_MM } from './cardOptics.js';
import { focalPxFor, isProfileUsable, type CameraProfile } from './cameraProfile.js';
import { CalibrationError, failureCodeOf, type NormalizedLandmark } from './geom.js';
import { HVID_MEAN_MM, type AutoMeasures } from './autoCalibration.js';
import { assemblePd, pdFieldsOf } from './pdAssembly.js';
import { distanceFromIrisMm } from './pupillary.js';
import type { ImageBuffer } from './silhouette.js';
import { measureTemporalWidth } from './temporalWidth.js';

/** Ré-exports : l'assemblage du PD vit dans `core/pdAssembly.ts` (§3). */
export { assemblePd, pdFieldsOf, HALF_SUM_MAX_REL_GAP, PD_MAX_MM, PD_MIN_MM } from './pdAssembly.js';
export type { PdAssembly } from './pdAssembly.js';

/**
 * Champ horizontal SUPPOSÉ quand aucun profil d'objectif n'est mémorisé.
 * 70° couvre le milieu de la plage réelle des caméras frontales (60–90°) ;
 * l'incertitude de ±30 % couvre les deux extrêmes. HYPOTHÈSE déclarée.
 */
export const AUTO_ASSUMED_HFOV_DEG = 70;
export const FOCAL_PRIOR_REL_ERROR = 0.3;

/**
 * En deçà, le client est PRÈS de la caméra : la correction de plan yeux→tempes
 * domine et la marge sur la largeur s'élargit. NOTE de guidage, jamais un refus.
 */
export const CLOSE_DISTANCE_MM = 300;

/**
 * Profondeur plan des yeux → plan des repères 234/454.
 * Dérivée de `CARD_TO_TEMPLE_DEPTH_MM` (57 ± 8 mm, mesurée sur sujet réel via
 * la carte) moins le recul de la cornée derrière le plan front/carte
 * (~12 ± 9 mm, anatomie). HYPOTHÈSE à ±27 % — à mesurer au protocole sujets réels.
 */
export const EYEPLANE_TO_TEMPLE_DEPTH_MM = CARD_TO_TEMPLE_DEPTH_MM - 12;
export const EYEPLANE_TO_TEMPLE_DEPTH_SD_MM = Math.hypot(CARD_TO_TEMPLE_DEPTH_SD_MM, 9);

/** Dérive de série au-delà de laquelle une note « vous avez bougé » est émise. */
export const DRIFT_NOTE_REL = 0.02;

/** L'optique retenue pour un assemblage — la MÊME pour l'aperçu (renderPose). */
export interface FocalChoice {
  focalPx: number;
  focalRel: number;
  measured: boolean;
}

export function focalChoiceFor(
  imageWidthPx: number,
  storedProfile: CameraProfile | null,
  nowMs: number,
): FocalChoice {
  const usable = isProfileUsable(storedProfile, nowMs);
  return {
    focalPx: usable
      ? focalPxFor(storedProfile as CameraProfile, imageWidthPx)
      : imageWidthPx / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180)),
    focalRel: usable ? (storedProfile as CameraProfile).relError : FOCAL_PRIOR_REL_ERROR,
    measured: usable,
  };
}

/** Distance caméra ↔ yeux depuis l'iris médian et l'optique retenue. */
export function assembleDistanceMm(m: AutoMeasures, focal: FocalChoice): number {
  const d = distanceFromIrisMm(m.hvidPx, focal.focalPx, HVID_MEAN_MM);
  if (!Number.isFinite(d) || d <= 0) {
    throw new CalibrationError(
      `Distance caméra ↔ yeux incalculable (iris médian ${m.hvidPx.toFixed(1)} px).`,
      'invalid-distance',
    );
  }
  return d;
}

/** L'échelle de visage assemblée — indépendante du PD (points 21, 26). */
export interface FaceScaleAssembly {
  faceWidthMm: number;
  relError: number;
  distanceMm: number;
  /** Conversion plan des yeux → plan des tempes appliquée (UNE fois, point 37). */
  depthCorrection: number;
  notes: string[];
}

/** FROM plan des yeux → TO plan des tempes : la SEULE application (points 36–37). */
export function eyeToTemplePlane(valueEyePlaneMm: number, distanceMm: number): number {
  return valueEyePlaneMm * (1 + EYEPLANE_TO_TEMPLE_DEPTH_MM / distanceMm);
}

export function assembleFaceScale(m: AutoMeasures, focal: FocalChoice, distanceMm: number): FaceScaleAssembly {
  const notes: string[] = [];
  const depthCorrection = 1 + EYEPLANE_TO_TEMPLE_DEPTH_MM / distanceMm;
  const depthRel =
    (EYEPLANE_TO_TEMPLE_DEPTH_MM / distanceMm) *
    Math.hypot(EYEPLANE_TO_TEMPLE_DEPTH_SD_MM / EYEPLANE_TO_TEMPLE_DEPTH_MM, focal.focalRel);
  const faceWidthMm = eyeToTemplePlane(m.faceWidthEyePlaneMm, distanceMm);
  const relError = Math.hypot(m.priorRelError, m.scaleStandardError, depthRel);
  assertPlausibleFaceWidth(faceWidthMm, 'auto');
  notes.push(
    `Largeur de visage : ${faceWidthMm.toFixed(0)} mm ± ${(faceWidthMm * relError).toFixed(0)} mm — ` +
      `dont ${((depthCorrection - 1) * 100).toFixed(1)} % de correction de plan (yeux → tempes), ` +
      `corrigée au lieu d'être supposée nulle.`,
  );
  // ⭐ Point 32 — la dérive de série se DIT : une personne qui avance pendant
  // la collecte élargit la réalité derrière la médiane.
  if (Math.abs(m.faceWidthStats.driftRel) > DRIFT_NOTE_REL) {
    notes.push(
      `Vous avez bougé pendant la mesure (dérive ${(m.faceWidthStats.driftRel * 100).toFixed(1)} % ` +
        `entre le début et la fin) : la marge le couvre, mais immobile la mesure serait plus fine.`,
    );
  }
  return { faceWidthMm, relError, distanceMm, depthCorrection, notes };
}

export interface AutoCalibrationOutput {
  cal: UserCalibration;
  /** À afficher tel quel : ce qui a été mesuré, déduit, supposé. */
  notes: string[];
}

/** Les notes de PROVENANCE de la distance — mesurée, héritée ou supposée. */
export function distanceNotes(focal: FocalChoice, distanceMm: number): string[] {
  const notes: string[] = [];
  if (distanceMm < CLOSE_DISTANCE_MM) {
    notes.push(
      `Vous teniez l'appareil près du visage (~${(distanceMm / 10).toFixed(0)} cm estimés) : ` +
        `la mesure est faite, avec une marge élargie. À 40–60 cm elle serait plus fine.`,
    );
  }
  notes.push(
    focal.measured
      ? `Distance déduite de vos iris et de votre objectif — MESURÉ lors d'une séance ` +
          `carte précédente sur cet appareil : ${(distanceMm / 10).toFixed(0)} cm (±${(focal.focalRel * 100).toFixed(0)} %). ` +
          `Sans cet héritage, la marge serait un peu plus large ; la mesure, elle, resterait la même.`
      : `Distance déduite de vos iris avec un champ de caméra supposé (${AUTO_ASSUMED_HFOV_DEG}°) : ${(distanceMm / 10).toFixed(0)} cm (±${(focal.focalRel * 100).toFixed(0)} %). Elle ne pèse que sur des termes du second ordre.`,
  );
  return notes;
}

/**
 * ⭐ Ce que la séance filmée fournit — quand elle le fournit — pour mesurer
 * l'ÉCART TEMPORAL sur la silhouette. L'image frontale est UNE frame figée
 * pendant la collecte, avec SES landmarks ; le masque de mouvement vient des
 * vues tournées, ou vaut null sans rotation — et sans lui la silhouette n'est
 * PAS tentée.
 */
export interface AutoTemporalScene {
  frontal: ImageBuffer;
  motion: Uint8Array | null;
  lm: readonly NormalizedLandmark[];
  w: number;
  h: number;
}

/** L'écart temporal, mesuré sur la scène — ne touche QUE ses deux champs (pt 46). */
export function assembleTemporal(
  temporal: AutoTemporalScene,
  templePlanePxPerMm: number,
  scaleRelError: number,
): { fields: Pick<UserCalibration, 'temporalWidthMm' | 'temporalRelError'>; note: string } {
  const t = measureTemporalWidth({
    frontal: temporal.frontal,
    motion: temporal.motion,
    lm: [...temporal.lm],
    w: temporal.w,
    h: temporal.h,
    pxPerMm: templePlanePxPerMm,
    scaleRelError,
  });
  if (t.measured) {
    return {
      fields: { temporalWidthMm: t.widthMm, temporalRelError: t.relError },
      note:
        `Écart temporal MESURÉ sur votre silhouette : ${t.widthMm.toFixed(0)} mm ` +
        `± ${(t.widthMm * t.relError).toFixed(0)} mm — c'est lui que la légende compare à la monture.`,
    };
  }
  return {
    fields: {},
    note:
      `Écart temporal non mesuré (${t.reason ?? 'raison inconnue'}). ` +
      `La légende s'appuiera sur la largeur aux repères, avec sa marge — rien n'est deviné.`,
  };
}

/**
 * Assemble la calibration automatique COMPLÈTE (PD et largeur exigés tous
 * deux). Lève `CalibrationError` TYPÉE si une grandeur sort de sa plage —
 * l'appelant qui veut la survie par métrique passe par les assemblages
 * séparés ci-dessus (c'est ce que fait l'IHM).
 */
export function calibrateAuto(
  m: AutoMeasures,
  imageWidthPx: number,
  storedProfile: CameraProfile | null,
  nowMs: number,
  temporal: AutoTemporalScene | null = null,
): AutoCalibrationOutput {
  const focal = focalChoiceFor(imageWidthPx, storedProfile, nowMs);
  const distanceMm = assembleDistanceMm(m, focal);
  const notes: string[] = distanceNotes(focal, distanceMm);

  const pd = assemblePd(m, focal, distanceMm);
  notes.push(...pd.notes);
  const face = assembleFaceScale(m, focal, distanceMm);
  notes.push(...face.notes);
  if (m.degraded) {
    notes.push(
      `Mesure conclue au délai maximal (${m.usableFrames} images utiles) : la marge est plus large que d'habitude.`,
    );
  }

  let temporalFields: Pick<UserCalibration, 'temporalWidthMm' | 'temporalRelError'> = {};
  if (temporal !== null) {
    const t = assembleTemporal(temporal, 1 / (m.mmPerPxEye * face.depthCorrection), face.relError);
    temporalFields = t.fields;
    notes.push(t.note);
  } else {
    notes.push(
      `Écart temporal non mesuré : montrez brièvement vos deux profils pendant la mesure ` +
        `pour qu'il le soit. En attendant, la légende s'appuie sur la largeur aux repères, avec sa marge.`,
    );
  }

  const cal: UserCalibration = {
    faceWidthMm: face.faceWidthMm,
    source: 'auto',
    relError: face.relError,
    measuredAt: nowMs,
    distanceMm,
    ...pdFieldsOf(pd),
    ...temporalFields,
  };
  return { cal, notes };
}

/** Ré-export pratique pour l'IHM : le code typé d'un refus (complément 3). */
export { failureCodeOf };
