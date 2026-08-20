/**
 * core/autoCalibration.ts — la calibration AUTOMATIQUE, sans carte.
 *
 * ## La règle d'architecture que ce fichier inaugure (mission §45)
 *
 * Toute opération finie possède explicitement : état initial, état actif,
 * condition de réussite, condition d'échec, dégradation au timeout, cleanup,
 * transition suivante. Ce moteur est une machine à états PURE (aucun React,
 * aucune caméra, temps injecté) :
 *
 *     collecting ──(succès : assez de frames stables)──▶ calibrated
 *         │
 *         ├──(timeout, assez de matière)──▶ calibrated  [marge élargie, dit]
 *         └──(timeout, pas assez)────────▶ failed(raison dominante)
 *
 * Les deux états terminaux sont des VERROUS : une seule transition, jamais
 * deux. La collecte s'arrête ; la caméra, elle, ne s'éteint jamais — c'est
 * l'essayage qui continue (audit §3).
 *
 * ## WHY_NOT_DONE
 *
 * À tout instant, `status()` rend la première raison qui empêche de conclure.
 * Il n'est plus possible que le système « tourne » sans qu'on sache pourquoi
 * (mission §9).
 */

import { median, relStandardError, type AutoMeasures } from './autoMeasures.js';
import { faceWidthPx } from './faceMetrics.js';
import type { NormalizedLandmark } from './geom.js';
import { eyePlaneScale, ocularPixelsOf, HVID_MEAN_MM } from './ocularScale.js';
import { pupilPixelsOf } from './pupillary.js';

/** En deçà, l'iris ne porte plus une mesure : reculer/avancer est requis. */
export const MIN_IRIS_PX = 8;
/** Frontal exigé pour l'échelle oculaire : au-delà, les iris se raccourcissent. */
export const MAX_AUTO_YAW_RAD = 0.14; // ~8°
export const MAX_AUTO_ROLL_RAD = 0.26; // ~15°

/**
 * Les DEMI-écarts ne s'accumulent qu'au regard de face STRICT. Mesuré sur le
 * sujet réel (2026-08-20, 161 images) : l'asymétrie OG−OD dérive de −1,1 mm/°
 * de yaw et s'inverse avec son signe — artefact de projection (le sellion sort
 * du plan des pupilles), pas une anatomie. Une collecte de face (regard sur
 * l'écran, yaw centré vers 0) ramène l'artefact MÉDIAN sous le bruit (~1 mm),
 * couvert par l'incertitude publiée par œil. La SOMME, invariante au premier
 * ordre, garde le gate large de 8°.
 */
export const MAX_SPLIT_YAW_RAD = 0.05; // ~2,9°
/** En deçà, les demi-PD ne sont pas publiées — la somme l'est toujours. */
export const MIN_SPLIT_FRAMES = 8;

/** Condition de réussite nominale. */
export const MIN_AUTO_FRAMES = 30;
export const MIN_AUTO_DURATION_MS = 2000;
/** Erreur-type de la médiane d'échelle sous laquelle la collecte a convergé. */
export const MAX_SCALE_STANDARD_ERROR = 0.005;

/** Dégradation/échec : au-delà, on conclut avec ce qu'on a, ou on dit pourquoi. */
export const AUTO_TIMEOUT_MS = 20_000;
export const MIN_AUTO_FRAMES_DEGRADED = 12;

export type AutoState = 'collecting' | 'calibrated' | 'failed';

export type WhyCode =
  | 'no-face'
  | 'eyes-too-small'
  | 'turn-to-front'
  | 'straighten-head'
  | 'need-more-frames'
  | 'unstable-scale';

export interface WhyNotDone {
  code: WhyCode;
  /** Phrase affichable telle quelle. */
  label: string;
}

export interface AutoStatus {
  state: AutoState;
  usableFrames: number;
  neededFrames: number;
  elapsedMs: number;
  whyNotDone: WhyNotDone | null;
  /** Compteurs de rejet, pour le mode diagnostic. */
  rejected: Record<Exclude<WhyCode, 'need-more-frames' | 'unstable-scale'>, number>;
}

/** Le contrat de sortie et ses statistiques robustes vivent dans
 *  `core/autoMeasures.ts` (scission §3) — ré-exporté pour les consommateurs. */
export type { AutoMeasures } from './autoMeasures.js';

export class AutoCalibrationEngine {
  private state_: AutoState = 'collecting';
  private startMs: number | null = null;
  private lastMs = 0;

  private readonly mmPerPx: number[] = [];
  private readonly relErrors: number[] = [];
  private readonly pdRightNear: number[] = [];
  private readonly pdLeftNear: number[] = [];
  private readonly pdSumNear: number[] = [];
  private readonly faceEye: number[] = [];
  private readonly hvid: number[] = [];

  private readonly rejects = {
    'no-face': 0,
    'eyes-too-small': 0,
    'turn-to-front': 0,
    'straighten-head': 0,
  };

  private measures_: AutoMeasures | null = null;
  private failure_: WhyNotDone | null = null;

  /**
   * Propose une frame. `lm` vaut null quand la détection est perdue.
   * Sans effet une fois l'état terminal atteint : la collecte est FINIE.
   */
  offer(
    lm: readonly NormalizedLandmark[] | null,
    yawRad: number,
    rollRad: number,
    w: number,
    h: number,
    nowMs: number,
  ): void {
    if (this.state_ !== 'collecting') return;
    this.startMs ??= nowMs;
    this.lastMs = nowMs;

    if (lm === null) this.rejects['no-face']++;
    else if (Math.abs(yawRad) > MAX_AUTO_YAW_RAD) this.rejects['turn-to-front']++;
    else if (Math.abs(rollRad) > MAX_AUTO_ROLL_RAD) this.rejects['straighten-head']++;
    else {
      const eyes = ocularPixelsOf(lm, w, h);
      if (Math.min(eyes.hvidLeftPx, eyes.hvidRightPx) < MIN_IRIS_PX) {
        this.rejects['eyes-too-small']++;
      } else {
        const scale = eyePlaneScale(eyes);
        const pupils = pupilPixelsOf(lm, w, h);
        if (scale === null || pupils === null) this.rejects['eyes-too-small']++;
        else {
          this.mmPerPx.push(scale.mmPerPx);
          this.relErrors.push(scale.relError);
          this.pdSumNear.push((pupils.rightPx + pupils.leftPx) * scale.mmPerPx);
          // Les demi-écarts, EUX, exigent le regard de face strict (artefact
          // de −1,1 mm/° au-delà, mesuré sur sujet réel — cf. MAX_SPLIT_YAW_RAD).
          if (Math.abs(yawRad) <= MAX_SPLIT_YAW_RAD) {
            this.pdRightNear.push(pupils.rightPx * scale.mmPerPx);
            this.pdLeftNear.push(pupils.leftPx * scale.mmPerPx);
          }
          this.faceEye.push(faceWidthPx(lm, w, h) * scale.mmPerPx);
          this.hvid.push((eyes.hvidLeftPx + eyes.hvidRightPx) / 2);
        }
      }
    }

    this.evaluate(nowMs);
  }

  /** Succès, dégradation ou échec — LES conditions de sortie, en un endroit. */
  private evaluate(nowMs: number): void {
    const elapsed = nowMs - (this.startMs ?? nowMs);
    const n = this.mmPerPx.length;
    const converged =
      n >= MIN_AUTO_FRAMES &&
      elapsed >= MIN_AUTO_DURATION_MS &&
      relStandardError(this.mmPerPx) <= MAX_SCALE_STANDARD_ERROR;

    if (converged) return this.conclude(false);

    if (elapsed >= AUTO_TIMEOUT_MS) {
      if (n >= MIN_AUTO_FRAMES_DEGRADED) return this.conclude(true);
      this.state_ = 'failed';
      this.failure_ = this.dominantReason();
    }
  }

  /** UNE transition, verrouillée : `measures_` n'est écrit qu'ici, une fois. */
  private conclude(degraded: boolean): void {
    this.state_ = 'calibrated';
    this.measures_ = {
      mmPerPxEye: median(this.mmPerPx),
      priorRelError: median(this.relErrors),
      scaleStandardError: relStandardError(this.mmPerPx),
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

  private dominantReason(): WhyNotDone {
    const r = this.rejects;
    const top = (Object.keys(r) as Array<keyof typeof r>).reduce((a, b) => (r[a] >= r[b] ? a : b));
    const labels: Record<keyof typeof r, string> = {
      'no-face': `Je ne vous ai pas vu : placez votre visage face à la caméra, bien éclairé.`,
      'eyes-too-small': `Vos yeux sont trop petits à l'image : rapprochez-vous de la caméra.`,
      'turn-to-front': `Votre tête était trop tournée : regardez droit vers l'écran quelques secondes.`,
      'straighten-head': `Votre tête était trop inclinée : redressez-la quelques secondes.`,
    };
    return { code: top, label: labels[top] };
  }

  get state(): AutoState {
    return this.state_;
  }

  /** Les mesures, une fois calibré. `null` avant. */
  measures(): AutoMeasures | null {
    return this.measures_;
  }

  /** La raison de l'échec, une fois échoué. `null` sinon. */
  failure(): WhyNotDone | null {
    return this.failure_;
  }

  /** L'état complet, dont WHY_NOT_DONE — publiable tel quel à l'écran. */
  status(): AutoStatus {
    const elapsed = this.startMs === null ? 0 : this.lastMs - this.startMs;
    const n = this.mmPerPx.length;

    let why: WhyNotDone | null = null;
    if (this.state_ === 'collecting') {
      if (n < MIN_AUTO_FRAMES) {
        const r = this.rejects;
        const rejected = r['no-face'] + r['eyes-too-small'] + r['turn-to-front'] + r['straighten-head'];
        // La consigne dominante d'abord, si les rejets dominent la collecte.
        why =
          rejected > n && rejected > 10
            ? this.dominantReason()
            : { code: 'need-more-frames', label: `Mesure en cours : ${n}/${MIN_AUTO_FRAMES} images utiles.` };
      } else {
        why = {
          code: 'unstable-scale',
          label: `La mesure varie encore trop d'une image à l'autre : restez immobile un instant.`,
        };
      }
    }
    if (this.state_ === 'failed') why = this.failure_;

    return {
      state: this.state_,
      usableFrames: n,
      neededFrames: MIN_AUTO_FRAMES,
      elapsedMs: elapsed,
      whyNotDone: why,
      rejected: { ...this.rejects },
    };
  }
}

/** Ré-export : l'étalon de l'estimation de distance vit avec l'échelle. */
export { HVID_MEAN_MM };
