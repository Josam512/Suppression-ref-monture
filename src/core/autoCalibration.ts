/**
 * core/autoCalibration.ts — calibration automatique sans carte.
 *
 * Machine d'état volontairement simple : `collecting` → `calibrated`.
 * Il n'existe plus d'état terminal d'échec ; une tentative ratée repart sur
 * une fenêtre fraîche au lieu de condamner toute la session.
 */

import { median, relStandardError, type AutoMeasures } from './autoMeasures.js';
import { faceWidthPx } from './faceMetrics.js';
import type { NormalizedLandmark } from './geom.js';
import { irisDiscrepancyMax, irisQualityOf } from './irisQuality.js';
import {
  dominantReason,
  emptyGateCounts,
  UNSTABLE_SCALE_LABEL,
  type AutoState,
  type AutoStatus,
  type GateCounts,
  type WhyCode,
  type WhyNotDone,
} from './autoStatus.js';
import { eyePlaneScale, ocularPixelsOf, HVID_MEAN_MM } from './ocularScale.js';
import { pupilPixelsOf } from './pupillary.js';

export const MAX_AUTO_YAW_RAD = 0.14; // ~8°
export const MAX_AUTO_ROLL_RAD = 0.26; // ~15°
export const IRIS_DISCREPANCY_MAX = irisDiscrepancyMax(MAX_AUTO_YAW_RAD);

export const MAX_SPLIT_YAW_RAD = 0.05; // ~2,9°
export const MIN_SPLIT_FRAMES = 8;

export const MIN_AUTO_FRAMES = 30;
export const MIN_AUTO_DURATION_MS = 2000;
export const MAX_SCALE_STANDARD_ERROR = 0.005;

export const AUTO_TIMEOUT_MS = 20_000;
export const MIN_AUTO_FRAMES_DEGRADED = 12;

export type {
  AutoState,
  WhyCode,
  WhyNotDone,
  GateCounts,
  AutoStatus,
} from './autoStatus.js';
export type { AutoMeasures } from './autoMeasures.js';

export class AutoCalibrationEngine {
  private state_: AutoState = 'collecting';
  private firstFaceMs: number | null = null;
  /** Première frame utile de la TENTATIVE COURANTE. */
  private firstUsefulMs: number | null = null;
  private lastMs = 0;
  private attempts_ = 0;
  private lastAttemptFailure_: WhyNotDone | null = null;
  private primary_: WhyCode | null = null;

  private readonly mmPerPx: number[] = [];
  private readonly relErrors: number[] = [];
  private readonly pdRightNear: number[] = [];
  private readonly pdLeftNear: number[] = [];
  private readonly pdSumNear: number[] = [];
  private readonly faceEye: number[] = [];
  private readonly hvid: number[] = [];

  /** Compteurs de la tentative COURANTE, pas toute l'histoire de la session. */
  private readonly rejects: GateCounts = emptyGateCounts();

  private measures_: AutoMeasures | null = null;

  offer(
    lm: readonly NormalizedLandmark[] | null,
    yawRad: number,
    rollRad: number,
    w: number,
    h: number,
    nowMs: number,
  ): void {
    if (this.state_ === 'calibrated') return;
    this.lastMs = nowMs;
    this.primary_ = null;

    if (lm === null) {
      this.rejects['no-face']++;
      this.primary_ = 'no-face';
      this.evaluate(nowMs);
      return;
    }
    this.firstFaceMs ??= nowMs;

    const yawFail = Math.abs(yawRad) > MAX_AUTO_YAW_RAD;
    const rollFail = Math.abs(rollRad) > MAX_AUTO_ROLL_RAD;
    const eyes = ocularPixelsOf(lm, w, h);
    const iris = irisQualityOf(eyes.hvidLeftPx, eyes.hvidRightPx, IRIS_DISCREPANCY_MAX);
    const scale = iris.ok ? eyePlaneScale(eyes) : null;
    const pupils = iris.ok ? pupilPixelsOf(lm, w, h) : null;
    const eyesFail = !iris.ok || scale === null || pupils === null;

    if (yawFail) this.rejects['turn-to-front']++;
    if (rollFail) this.rejects['straighten-head']++;
    if (eyesFail) this.rejects['eyes-too-small']++;

    if (yawFail || rollFail || eyesFail) {
      this.primary_ = eyesFail ? 'eyes-too-small' : yawFail ? 'turn-to-front' : 'straighten-head';
      this.evaluate(nowMs);
      return;
    }

    this.firstUsefulMs ??= nowMs;
    const s = scale as NonNullable<typeof scale>;
    const p = pupils as NonNullable<typeof pupils>;
    this.mmPerPx.push(s.mmPerPx);
    this.relErrors.push(s.relError);
    this.pdSumNear.push((p.rightPx + p.leftPx) * s.mmPerPx);
    if (Math.abs(yawRad) <= MAX_SPLIT_YAW_RAD) {
      this.pdRightNear.push(p.rightPx * s.mmPerPx);
      this.pdLeftNear.push(p.leftPx * s.mmPerPx);
    }
    this.faceEye.push(faceWidthPx(lm, w, h) * s.mmPerPx);
    this.hvid.push(iris.widthPx);

    this.evaluate(nowMs);
  }

  private evaluate(nowMs: number): void {
    const n = this.mmPerPx.length;
    if (this.firstUsefulMs === null) return;
    const elapsed = nowMs - this.firstUsefulMs;
    const scaleSE = this.scaleSE();

    if (n >= MIN_AUTO_FRAMES && elapsed >= MIN_AUTO_DURATION_MS && scaleSE <= MAX_SCALE_STANDARD_ERROR) {
      this.conclude(false);
      return;
    }
    if (elapsed < AUTO_TIMEOUT_MS) return;

    // Audit prédictif 2026-08-21 : l'ancienne branche dégradée concluait dès
    // qu'elle avait 12 frames, même si ces 12 frames se contredisaient fortement.
    // Une calibration "dégradée" peut avoir moins de matière ; elle ne peut pas
    // abolir le critère de stabilité métrologique.
    if (n >= MIN_AUTO_FRAMES_DEGRADED && scaleSE <= MAX_SCALE_STANDARD_ERROR) {
      this.conclude(true);
      return;
    }

    this.attempts_++;
    this.lastAttemptFailure_ =
      n >= MIN_AUTO_FRAMES_DEGRADED && scaleSE > MAX_SCALE_STANDARD_ERROR
        ? { code: 'unstable-scale', label: UNSTABLE_SCALE_LABEL }
        : dominantReason(this.rejects);

    // IMPORTANT : ne JAMAIS mélanger des mesures vieilles de 20 s avec celles
    // d'une nouvelle position/distance. L'ancienne version conservait les
    // échantillons lors du réarmement ; une personne qui reculait ou avançait
    // pouvait donc faire médianer deux échelles physiques différentes et finir
    // par obtenir une calibration "dégradée" mais fausse.
    this.resetAttemptData();
  }

  private resetAttemptData(): void {
    this.firstUsefulMs = null;
    this.mmPerPx.length = 0;
    this.relErrors.length = 0;
    this.pdRightNear.length = 0;
    this.pdLeftNear.length = 0;
    this.pdSumNear.length = 0;
    this.faceEye.length = 0;
    this.hvid.length = 0;
    this.rejects['no-face'] = 0;
    this.rejects['eyes-too-small'] = 0;
    this.rejects['turn-to-front'] = 0;
    this.rejects['straighten-head'] = 0;
    this.primary_ = null;
  }

  private conclude(degraded: boolean): void {
    this.state_ = 'calibrated';
    this.measures_ = {
      mmPerPxEye: median(this.mmPerPx),
      priorRelError: median(this.relErrors),
      scaleStandardError: this.scaleSE(),
      pdRightNearMm: this.pdRightNear.length > 0 ? median(this.pdRightNear) : NaN,
      pdLeftNearMm: this.pdLeftNear.length > 0 ? median(this.pdLeftNear) : NaN,
      pdRightSE: relStandardError(this.pdRightNear),
      pdLeftSE: relStandardError(this.pdLeftNear),
      pdSumNearMm: median(this.pdSumNear),
      pdSumSE: relStandardError(this.pdSumNear),
      splitFrames: this.pdRightNear.length,
      faceWidthEyePlaneMm: median(this.faceEye),
      hvidPx: median(this.hvid),
      usableFrames: this.mmPerPx.length,
      degraded,
    };
  }

  private scaleSE(): number {
    return relStandardError(this.mmPerPx);
  }

  get state(): AutoState {
    return this.state_;
  }

  measures(): AutoMeasures | null {
    return this.measures_;
  }

  failure(): WhyNotDone | null {
    return this.lastAttemptFailure_;
  }

  status(): AutoStatus {
    const n = this.mmPerPx.length;
    let why: WhyNotDone | null = null;
    if (this.state_ === 'collecting') {
      const r = this.rejects;
      const rejected = r['no-face'] + r['eyes-too-small'] + r['turn-to-front'] + r['straighten-head'];
      if (n >= MIN_AUTO_FRAMES) {
        why = { code: 'unstable-scale', label: UNSTABLE_SCALE_LABEL };
      } else if (rejected > n && rejected > 10) {
        why = dominantReason(this.rejects);
      } else {
        why = { code: 'need-more-frames', label: `Mesure en cours : ${n}/${MIN_AUTO_FRAMES} images utiles.` };
      }
    }

    return {
      state: this.state_,
      usableFrames: n,
      neededFrames: MIN_AUTO_FRAMES,
      elapsedMs: this.firstUsefulMs === null ? 0 : this.lastMs - this.firstUsefulMs,
      acquisitionMs: this.firstFaceMs === null ? 0 : this.lastMs - this.firstFaceMs,
      whyNotDone: why,
      rejected: { ...this.rejects },
      primaryRejectReason: this.primary_,
      scaleStandardError: this.scaleSE(),
      attempts: this.attempts_,
      lastAttemptFailure: this.lastAttemptFailure_,
    };
  }
}

export { HVID_MEAN_MM };
