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

/**
 * ⭐ Ré-audit A8 — le mode DÉGRADÉ (délai atteint) tolère le DOUBLE de
 * l'erreur-type nominale : la précision moindre est ASSUMÉE et portée par
 * l'incertitude publiée. Il ne tolère JAMAIS l'instabilité structurelle
 * (dispersion, dérive, outliers ci-dessous) : conclure sur une série bimodale
 * n'est pas une dégradation, c'est une invention.
 */
export const MAX_SCALE_SE_DEGRADED = 2 * MAX_SCALE_STANDARD_ERROR;

/**
 * ⭐ Ré-audit A10 — dispersion PAR FRAME maximale (MAD/médiane). Elle ne
 * s'améliore pas en √n : c'est ELLE qui refuse une série BIMODALE que
 * l'erreur-type finit par laisser passer à grand n. Dérivation : la
 * convergence nominale (SE ≤ 0,5 % à 30 frames) implique ~2,7 % de dispersion
 * par frame — le seuil laisse ×1,85 de marge au bruit honnête. Un aller-retour
 * entre deux distances donne MAD ≈ 0,74 × l'écart des modes : refusé dès ~7 %
 * d'écart.
 */
export const MAX_SCALE_SPREAD_REL = 0.05;
/**
 * ⭐ A10 — dérive 1re → 2e moitié maximale, bornée au plancher biologique de
 * l'étalon iris (4,3 %, §4) : au-delà, la médiane mélange deux distances et
 * n'appartient à aucune.
 */
export const MAX_SCALE_DRIFT_REL = 0.043;
/** ⭐ A10 — au-delà de 10 % de points à >3 MAD, la série est CONTAMINÉE : sa
 *  MAD (donc son erreur-type) ment. Un bruit sain en produit moins de 1 %. */
export const MAX_SCALE_OUTLIER_RATIO = 0.1;

/** Part minimale de frames où PFL a concordé pour retenir l'estimateur complet. */
export const ESTIMATOR_FULL_MIN_RATIO = 0.7;
