/**
 * core/autoTuning.ts — les SEUILS de la collecte automatique, en un endroit.
 *
 * Scindé de `core/autoCalibration.ts` (règle des 300 lignes, §3). Chaque
 * constante est documentée là où elle vit ; `autoCalibration.ts` les ré-exporte
 * pour ne casser aucun consommateur.
 */

import { irisDiscrepancyMax } from './irisQuality.js';

/** Frontal exigé pour l'échelle oculaire : au-delà, les iris se raccourcissent. */
export const MAX_AUTO_YAW_RAD = 0.14; // ~8°
export const MAX_AUTO_ROLL_RAD = 0.26; // ~15°

/** Seuil d'aberration inter-yeux, DÉRIVÉ du gate frontal (`core/irisQuality.ts`). */
export const IRIS_DISCREPANCY_MAX = irisDiscrepancyMax(MAX_AUTO_YAW_RAD);

/**
 * Les DEMI-écarts ne s'accumulent qu'au regard de face STRICT. Mesuré sur le
 * sujet réel (2026-08-20, 161 images) : l'asymétrie OG−OD dérive de −1,1 mm/°
 * de yaw et s'inverse avec son signe — artefact de projection, pas une
 * anatomie. Le PD DIRECT, invariant au premier ordre, garde le gate large de 8°.
 */
export const MAX_SPLIT_YAW_RAD = 0.05; // ~2,9°
/** En deçà, les demi-PD ne sont pas publiées — le PD total l'est toujours. */
export const MIN_SPLIT_FRAMES = 8;

/** Condition de réussite nominale. */
export const MIN_AUTO_FRAMES = 30;
export const MIN_AUTO_DURATION_MS = 2000;
/** Erreur-type de la médiane d'échelle sous laquelle la collecte a convergé. */
export const MAX_SCALE_STANDARD_ERROR = 0.005;

/** Délai de TENTATIVE, compté depuis le DÉBUT de la tentative (point 18). */
export const AUTO_TIMEOUT_MS = 20_000;
export const MIN_AUTO_FRAMES_DEGRADED = 12;

/** Part minimale de frames où PFL a concordé pour retenir l'estimateur complet. */
export const ESTIMATOR_FULL_MIN_RATIO = 0.7;
