/**
 * core/autoCalibration.ts — la calibration AUTOMATIQUE, sans carte.
 *
 * ## Refonte du 2026-08-21 (audit humain du code, 3 défauts structurels)
 *
 * 1. **Le chrono partait trop tôt.** `startMs` était armé au PREMIER appel,
 *    même sans visage : les 20 secondes s'écoulaient pendant que la personne
 *    se plaçait. Il y a désormais DEUX horloges distinctes — acquisition
 *    (depuis le premier visage vu) et convergence (depuis la première frame
 *    réellement RETENUE) — et seule la seconde décide de conclure.
 *
 * 2. **Le timeout tuait la séance.** L'état `failed` verrouillait `offer()` :
 *    plus une seule frame comptée pour le reste de la session, donc jamais de
 *    calibration, donc jamais de monture ni de PD (`renderScene.ts` sort avant
 *    de dessiner quand `cal === null`). Il n'existe plus d'état terminal
 *    d'échec : au délai, le moteur DIT pourquoi, compte une tentative, et
 *    continue. Les échantillons déjà acquis sont CONSERVÉS — les jeter serait
 *    punir une personne qui a bougé trois secondes.
 *
 * 3. **Les compteurs de rejet mentaient.** Une cascade `else if` n'attribuait
 *    qu'UNE cause par frame, la première de la liste. Une frame à la fois
 *    tournée ET inclinée ne comptait que « tournée ». Chaque gate est
 *    maintenant évalué et compté INDÉPENDAMMENT ; `primaryRejectReason` reste
 *    publié à part, pour la consigne affichée à la personne.
 *
 * ## La machine à états
 *
 *     collecting ──(n suffisant ET échelle stable)──────────▶ calibrated
 *         │
 *         ├──(délai de convergence, matière suffisante)─────▶ calibrated [dégradé, dit]
 *         └──(délai, matière insuffisante)──▶ collecting, tentative + 1, raison publiée
 *
 * `calibrated` est le SEUL état terminal, et c'est un verrou : une transition,
 * jamais deux. La caméra, elle, ne s'éteint jamais.
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

/** Frontal exigé pour l'échelle oculaire : au-delà, les iris se raccourcissent. */
export const MAX_AUTO_YAW_RAD = 0.14; // ~8°
export const MAX_AUTO_ROLL_RAD = 0.26; // ~15°

/** Seuil d'aberration inter-yeux, DÉRIVÉ du gate frontal (`core/irisQuality.ts`). */
export const IRIS_DISCREPANCY_MAX = irisDiscrepancyMax(MAX_AUTO_YAW_RAD);

/**
 * Les DEMI-écarts ne s'accumulent qu'au regard de face STRICT. Mesuré sur le
 * sujet réel (2026-08-20, 161 images) : l'asymétrie OG−OD dérive de −1,1 mm/°
 * de yaw et s'inverse avec son signe — artefact de projection, pas une
 * anatomie. La SOMME, invariante au premier ordre, garde le gate large de 8°.
 */
export const MAX_SPLIT_YAW_RAD = 0.05; // ~2,9°
/** En deçà, les demi-PD ne sont pas publiées — la somme l'est toujours. */
export const MIN_SPLIT_FRAMES = 8;

/** Condition de réussite nominale. */
export const MIN_AUTO_FRAMES = 30;
export const MIN_AUTO_DURATION_MS = 2000;
/** Erreur-type de la médiane d'échelle sous laquelle la collecte a convergé.
 *  ⭐ C'est LUI qui porte la décision de précision, parce que lui seul connaît
 *  n : le bruit de détection s'atténue en 1/√n (cf. `core/irisQuality.ts`). */
export const MAX_SCALE_STANDARD_ERROR = 0.005;

/** Délai de CONVERGENCE, compté depuis la première frame retenue. */
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
  /** Premier visage vu — horloge d'ACQUISITION (informative). */
  private firstFaceMs: number | null = null;
  /** Première frame RETENUE — horloge de CONVERGENCE (décisionnelle). */
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

  private readonly rejects: GateCounts = emptyGateCounts();

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
    this.primary_ = null;

    if (lm === null) {
      this.rejects['no-face']++;
      this.primary_ = 'no-face';
      this.evaluate(nowMs);
      return;
    }
    this.firstFaceMs ??= nowMs;

    // ⭐ Audit 2 — les trois gates sont évalués et comptés SÉPARÉMENT.
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
      // La consigne AFFICHÉE reste unique : on ne demande qu'une chose à la fois.
      this.primary_ = eyesFail ? 'eyes-too-small' : yawFail ? 'turn-to-front' : 'straighten-head';
      this.evaluate(nowMs);
      return;
    }

    // — Frame retenue : c'est ELLE qui arme l'horloge de convergence (audit 1).
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

  /** Succès, dégradation, ou nouvelle tentative — LES sorties, en un endroit. */
  private evaluate(nowMs: number): void {
    const n = this.mmPerPx.length;
    // ⭐ Audit 1 — tant qu'aucune frame n'a été retenue, aucun délai ne court.
    if (this.firstUsefulMs === null) return;
    const elapsed = nowMs - this.firstUsefulMs;

    if (n >= MIN_AUTO_FRAMES && elapsed >= MIN_AUTO_DURATION_MS && this.scaleSE() <= MAX_SCALE_STANDARD_ERROR) {
      return this.conclude(false);
    }
    if (elapsed < AUTO_TIMEOUT_MS) return;

    if (n >= MIN_AUTO_FRAMES_DEGRADED) return this.conclude(true);

    // ⭐ Audit 2 bis — le délai n'est plus une mort : on dit pourquoi, on compte
    // la tentative, on RE-ARME l'horloge, et la collecte continue avec ce
    // qu'elle a déjà. Une tentative par période de délai : pas de boucle folle.
    this.attempts_++;
    this.lastAttemptFailure_ = dominantReason(this.rejects);
    this.firstUsefulMs = nowMs;
  }

  /** UNE transition, verrouillée : `measures_` n'est écrit qu'ici, une fois. */
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


/** Ré-export : l'étalon de l'estimation de distance vit avec l'échelle. */
export { HVID_MEAN_MM };
