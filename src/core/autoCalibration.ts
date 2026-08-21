/**
 * core/autoCalibration.ts — la calibration AUTOMATIQUE, sans carte.
 * Refonte du guide de fiabilisation (2026-08-21) :
 *
 *  1. TROIS horloges (pt 18, c19) : `attemptStartedAt` — armée au PREMIER appel
 *     de la tentative — porte le délai. Zéro bonne frame pendant 20 s est une
 *     tentative ÉCHOUÉE nommée, plus jamais une mesure éternelle.
 *  2. FENÊTRE PROPRE par tentative (pt 19, c20–21) : tous les tampons vidés,
 *     `generation` incrémentée. Ce qui survit aux tentatives, ce sont les
 *     mesures PUBLIÉES (le store, pt 20), jamais les échantillons bruts.
 *  3. PD total = distance DIRECTE pupille↔pupille (pt 22) ; demi-écarts gardés
 *     par la projection anatomique du sellion (pt 23) ET la face stricte.
 *  4. ESTIMATEUR VERROUILLÉ (pt 29) : deux séries parallèles, un choix unique
 *     à la conclusion — plus de commutation frame par frame.
 *  5. `rejectedFramesAny` (c1) : les frames rejetées comptées UNE fois chacune.
 */

import { median, relStandardError, seriesStats, type AutoMeasures } from './autoMeasures.js';
import { DualSeries, gateFrame } from './autoSeries.js';
import type { NormalizedLandmark } from './geom.js';
import {
  dominantReason,
  emptyGateCounts,
  GATE_LABELS,
  UNSTABLE_SCALE_LABEL,
  type AcquisitionPhase,
  type AutoState,
  type AutoStatus,
  type GateCounts,
  type WhyCode,
  type WhyNotDone,
} from './autoStatus.js';
// prettier-ignore
import { AUTO_TIMEOUT_MS, ESTIMATOR_FULL_MIN_RATIO, IRIS_DISCREPANCY_MAX, MAX_AUTO_ROLL_RAD, MAX_AUTO_YAW_RAD, MAX_SCALE_STANDARD_ERROR, MAX_SPLIT_YAW_RAD, MIN_AUTO_DURATION_MS, MIN_AUTO_FRAMES, MIN_AUTO_FRAMES_DEGRADED } from './autoTuning.js';
import { HVID_MEAN_MM, HVID_ONLY_REL_ERROR, OCULAR_PRIOR_REL_ERROR } from './ocularScale.js';
import { halfPdUsable } from './pupillary.js';

/** Les seuils de la collecte vivent dans `core/autoTuning.ts` (§3). */
// prettier-ignore
export { AUTO_TIMEOUT_MS, ESTIMATOR_FULL_MIN_RATIO, IRIS_DISCREPANCY_MAX, MAX_AUTO_ROLL_RAD, MAX_AUTO_YAW_RAD, MAX_SCALE_STANDARD_ERROR, MAX_SPLIT_YAW_RAD, MIN_AUTO_DURATION_MS, MIN_AUTO_FRAMES, MIN_AUTO_FRAMES_DEGRADED, MIN_SPLIT_FRAMES } from './autoTuning.js';

export type { AcquisitionPhase, AutoState, WhyCode, WhyNotDone, GateCounts, AutoStatus } from './autoStatus.js';
export type { AutoMeasures } from './autoMeasures.js';

export class AutoCalibrationEngine {
  private state_: AutoState = 'collecting';
  private generation_ = 1;
  /** Début de la TENTATIVE — l'horloge qui porte le délai (point 18). */
  private attemptStartedMs: number | null = null;
  /** Premier visage vu — horloge d'ACQUISITION (informative). */
  private firstFaceMs: number | null = null;
  /** Première frame RETENUE — horloge de CONVERGENCE. */
  private firstUsefulMs: number | null = null;
  private lastMs = 0;
  private attempts_ = 0;
  private lastAttemptFailure_: WhyNotDone | null = null;
  private primary_: WhyCode | null = null;
  private lastViolations_: WhyCode[] = [];

  private scaleHvid: number[] = [];
  private scaleFull: number[] = [];
  private pdDirect = new DualSeries();
  private pdRight = new DualSeries();
  private pdLeft = new DualSeries();
  private faceEye = new DualSeries();
  private hvid: number[] = [];

  private rejects: GateCounts = emptyGateCounts();
  private rejectedAny_ = 0;

  private measures_: AutoMeasures | null = null;

  /**
   * Propose une frame. `lm` vaut null quand la détection est perdue.
   * Sans effet une fois `calibrated` : la collecte est FINIE. Dans tous les
   * autres cas la frame est comptée — il n'existe plus d'état qui refuse tout.
   */
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
    this.attemptStartedMs ??= nowMs; // ⭐ le délai court dès la première frame VUE
    this.primary_ = null;
    this.lastViolations_ = [];

    if (lm === null) {
      this.rejects['no-face']++;
      this.rejectedAny_++;
      this.primary_ = 'no-face';
      this.lastViolations_ = ['no-face'];
      this.evaluate(nowMs);
      return;
    }
    this.firstFaceMs ??= nowMs;

    // Les gates sont évalués et comptés SÉPARÉMENT (diagnostic) ; la frame
    // rejetée compte UNE fois (complément 1).
    const g = gateFrame(lm, yawRad, rollRad, w, h, MAX_AUTO_YAW_RAD, MAX_AUTO_ROLL_RAD, IRIS_DISCREPANCY_MAX);

    if (g.yawFail) this.rejects['turn-to-front']++;
    if (g.rollFail) this.rejects['straighten-head']++;
    if (g.eyesFail) this.rejects['eyes-too-small']++;

    if (g.yawFail || g.rollFail || g.eyesFail) {
      this.rejectedAny_++;
      this.lastViolations_ = [
        ...(g.eyesFail ? (['eyes-too-small'] as const) : []),
        ...(g.yawFail ? (['turn-to-front'] as const) : []),
        ...(g.rollFail ? (['straighten-head'] as const) : []),
      ];
      // La consigne AFFICHÉE reste unique : on ne demande qu'une chose à la fois.
      this.primary_ = this.lastViolations_[0] ?? null;
      this.evaluate(nowMs);
      return;
    }

    // — Frame retenue : c'est ELLE qui arme l'horloge de convergence.
    this.firstUsefulMs ??= nowMs;
    const s = g.scales as NonNullable<typeof g.scales>;
    const p = g.pupils as NonNullable<typeof g.pupils>;
    const sHvid = s.base.mmPerPx;
    const sFull = s.full?.mmPerPx ?? null;
    this.scaleHvid.push(sHvid);
    if (sFull !== null) this.scaleFull.push(sFull);
    // ⭐ Point 22 — le PD total est la distance DIRECTE pupille ↔ pupille.
    this.pdDirect.push(p.pdPx, sHvid, sFull);
    // ⭐ Point 23 — demi-écarts : face stricte ET projection du sellion anatomique.
    if (Math.abs(yawRad) <= MAX_SPLIT_YAW_RAD && halfPdUsable(p.t)) {
      this.pdRight.push(p.rightPx, sHvid, sFull);
      this.pdLeft.push(p.leftPx, sHvid, sFull);
    }
    // ⭐ Point 31 — la largeur a SON cycle : illisible, elle ne prive ni le PD
    // ni l'échelle de cette frame.
    if (Number.isFinite(g.faceWidthPx)) this.faceEye.push(g.faceWidthPx, sHvid, sFull);
    this.hvid.push((g.iris as NonNullable<typeof g.iris>).widthPx);

    this.evaluate(nowMs);
  }

  /** Succès, dégradation, ou nouvelle tentative — LES sorties, en un endroit. */
  private evaluate(nowMs: number): void {
    const n = this.scaleHvid.length;
    if (this.firstUsefulMs !== null) {
      const converged = nowMs - this.firstUsefulMs;
      if (n >= MIN_AUTO_FRAMES && converged >= MIN_AUTO_DURATION_MS && this.scaleSE() <= MAX_SCALE_STANDARD_ERROR) {
        return this.conclude(false);
      }
    }
    // ⭐ Point 18 — le délai se juge sur l'horloge de TENTATIVE : il court
    // même quand aucune frame utile n'est jamais arrivée.
    if (this.attemptStartedMs === null || nowMs - this.attemptStartedMs < AUTO_TIMEOUT_MS) return;

    if (n >= MIN_AUTO_FRAMES_DEGRADED) return this.conclude(true);

    // Tentative échouée : on la nomme, on compte, et on REPART SUR UNE FENÊTRE
    // PROPRE (point 19) — génération suivante, tous tampons vidés.
    this.attempts_++;
    this.lastAttemptFailure_ =
      this.firstUsefulMs === null || this.rejectedAny_ > n
        ? this.firstFaceMs === null
          ? { code: 'no-face', label: GATE_LABELS['no-face'] }
          : dominantReason(this.rejects)
        : { code: 'need-more-frames', label: `Trop peu d'images utiles (${n}) dans le délai — je recommence.` };
    this.resetAttempt(nowMs);
  }

  /** ⭐ Complément 20 — le reset est ATOMIQUE : tout part ensemble. */
  private resetAttempt(nowMs: number): void {
    this.generation_++;
    this.attemptStartedMs = nowMs;
    this.firstFaceMs = null;
    this.firstUsefulMs = null;
    this.scaleHvid = [];
    this.scaleFull = [];
    this.pdDirect = new DualSeries();
    this.pdRight = new DualSeries();
    this.pdLeft = new DualSeries();
    this.faceEye = new DualSeries();
    this.hvid = [];
    this.rejects = emptyGateCounts();
    this.rejectedAny_ = 0;
  }

  /** UNE transition, verrouillée : `measures_` n'est écrit qu'ici, une fois. */
  private conclude(degraded: boolean): void {
    this.state_ = 'calibrated';
    // ⭐ Point 29 — l'estimateur est choisi ICI, une fois pour toute la tentative.
    const estimator: 'hvid' | 'hvid+pfl' =
      this.scaleFull.length >= ESTIMATOR_FULL_MIN_RATIO * this.scaleHvid.length ? 'hvid+pfl' : 'hvid';
    const scaleSeries = estimator === 'hvid' ? this.scaleHvid : this.scaleFull;
    const right = this.pdRight.pick(estimator);
    const left = this.pdLeft.pick(estimator);
    const splitFrames = Math.min(right.length, left.length);
    const pd = this.pdDirect.pick(estimator);
    const face = this.faceEye.pick(estimator);

    this.measures_ = {
      mmPerPxEye: median(scaleSeries),
      priorRelError: estimator === 'hvid' ? HVID_ONLY_REL_ERROR : OCULAR_PRIOR_REL_ERROR,
      estimator,
      scaleStandardError: relStandardError(scaleSeries),
      scaleStats: seriesStats(scaleSeries),
      pdDirectNearMm: median(pd),
      pdDirectSE: relStandardError(pd),
      pdRightNearMm: splitFrames > 0 ? median(right) : NaN,
      pdLeftNearMm: splitFrames > 0 ? median(left) : NaN,
      pdRightSE: relStandardError(right),
      pdLeftSE: relStandardError(left),
      splitFrames,
      faceWidthEyePlaneMm: median(face),
      faceWidthStats: seriesStats(face),
      hvidPx: median(this.hvid),
      usableFrames: this.scaleHvid.length,
      degraded,
      generation: this.generation_,
    };
  }

  private scaleSE(): number {
    return relStandardError(this.scaleHvid);
  }

  get state(): AutoState {
    return this.state_;
  }

  get generation(): number {
    return this.generation_;
  }

  /** Les mesures, une fois calibré. `null` avant. */
  measures(): AutoMeasures | null {
    return this.measures_;
  }

  /** Ce que le dernier délai a nommé — la collecte, elle, n'est jamais arrêtée. */
  failure(): WhyNotDone | null {
    return this.lastAttemptFailure_;
  }

  /** L'état complet, dont WHY_NOT_DONE — publiable tel quel à l'écran. */
  status(): AutoStatus {
    const n = this.scaleHvid.length;
    const phase: AcquisitionPhase =
      this.firstFaceMs === null ? 'no-face' : this.firstUsefulMs === null ? 'acquiring' : 'converging';
    let why: WhyNotDone | null = null;
    if (this.state_ === 'collecting') {
      if (n >= MIN_AUTO_FRAMES) {
        why = { code: 'unstable-scale', label: UNSTABLE_SCALE_LABEL };
      } else if (this.rejectedAny_ > n && this.rejectedAny_ > 3) {
        // ⭐ Complément 1 — la décision lit les FRAMES rejetées, pas la somme des gates.
        why = dominantReason(this.rejects);
      } else if (n === 0 && this.attempts_ > 0 && this.lastAttemptFailure_ !== null) {
        // Fenêtre neuve encore vide : l'obstacle NOMMÉ par la tentative
        // précédente reste la consigne — pas un neutre « mesure en cours ».
        why = this.lastAttemptFailure_;
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
      attemptMs: this.attemptStartedMs === null ? 0 : this.lastMs - this.attemptStartedMs,
      phase,
      whyNotDone: why,
      rejected: { ...this.rejects },
      rejectedFramesAny: this.rejectedAny_,
      primaryRejectReason: this.primary_,
      lastFrameViolations: [...this.lastViolations_],
      scaleStandardError: this.scaleSE(),
      attempts: this.attempts_,
      lastAttemptFailure: this.lastAttemptFailure_,
      generation: this.generation_,
    };
  }
}

/** Ré-export : l'étalon de l'estimation de distance vit avec l'échelle. */
export { HVID_MEAN_MM };
