/**
 * ui/measurementStore.ts — l'état PAR MÉTRIQUE, survivant aux tentatives.
 *
 * Guide de fiabilisation (points 20–21, 26–27, 68–69) : le PD, l'échelle de
 * visage et l'écart temporal sont des mesures INDÉPENDANTES, chacune avec son
 * cycle. Un PD validé SURVIT à un échec de largeur (et réciproquement) ; le
 * panneau de mesures lit ici, en permanence — pas dans des notices éphémères.
 *
 * `phase` dit la vérité de CHAQUE métrique :
 *   - `collecting`   : un moteur tourne pour elle (invariant : jamais publié
 *                      sans moteur vivant — point 68) ;
 *   - `ready`        : assemblée et publiée ; la valeur est là ;
 *   - `retrying`     : le dernier assemblage a refusé (code typé), un moteur
 *                      neuf recommence ;
 *   - `unavailable`  : après trop de refus, on cesse de boucler et on le DIT —
 *                      le rendu, lui, continue (point 69).
 */

import type { FaceScaleAssembly, PdAssembly } from '../core/autoCalibrate.js';
import { FAILURE_LABELS, type AutoStatus, type WhyNotDone } from '../core/autoStatus.js';
import { failureCodeOf } from '../core/geom.js';

export type MetricPhase = 'idle' | 'collecting' | 'ready' | 'retrying' | 'unavailable';

export interface MetricSlot<T> {
  phase: MetricPhase;
  /** Présente en `ready` — et CONSERVÉE si une autre métrique échoue (pt 20). */
  value: T | null;
  /** Le dernier refus, typé (complément 3). Présent en retrying/unavailable. */
  failure: WhyNotDone | null;
  /** Génération de collecte dont vient `value` (compléments 20–21). */
  generation: number;
}

export interface TemporalValue {
  widthMm: number;
  relError: number;
}

export interface MeasurementSnapshot {
  pd: MetricSlot<PdAssembly>;
  faceScale: MetricSlot<FaceScaleAssembly>;
  temporal: MetricSlot<TemporalValue>;
}

export function emptySlot<T>(): MetricSlot<T> {
  return { phase: 'idle', value: null, failure: null, generation: 0 };
}

export function emptyMeasurements(): MeasurementSnapshot {
  return { pd: emptySlot(), faceScale: emptySlot(), temporal: emptySlot() };
}

/** Copie superficielle pour publication React (les valeurs sont immuables). */
export function snapshotOf(s: MeasurementSnapshot): MeasurementSnapshot {
  return { pd: { ...s.pd }, faceScale: { ...s.faceScale }, temporal: { ...s.temporal } };
}

/** Un refus, TYPÉ, prêt à afficher (complément 3). */
export function failureOf(err: unknown): WhyNotDone {
  const code = failureCodeOf(err);
  return { code, label: FAILURE_LABELS[code] };
}

/**
 * L'état publié quand la mesure S'ARRÊTE d'essayer (point 69) : `unavailable`,
 * la cause typée, les sorties offertes — et jamais un faux `collecting` sans
 * moteur (point 68). Le rendu, lui, continue en aperçu.
 */
export function unavailableStatus(failure: WhyNotDone | null, attempts: number): AutoStatus {
  return {
    state: 'unavailable',
    usableFrames: 0,
    neededFrames: 0,
    elapsedMs: 0,
    acquisitionMs: 0,
    attemptMs: 0,
    phase: 'no-face',
    whyNotDone: failure,
    rejected: { 'no-face': 0, 'eyes-too-small': 0, 'turn-to-front': 0, 'straighten-head': 0 },
    rejectedFramesAny: 0,
    primaryRejectReason: null,
    lastFrameViolations: [],
    scaleStandardError: 0,
    candidateEstimator: 'hvid',
    scaleSpreadRel: 0,
    scaleDriftRel: 0,
    scaleOutlierRatio: 0,
    attempts,
    lastAttemptFailure: failure,
    generation: 0,
  };
}
