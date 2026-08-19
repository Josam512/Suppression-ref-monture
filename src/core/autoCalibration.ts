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

import { faceWidthPx } from './faceMetrics.js';
import type { NormalizedLandmark } from './geom.js';
import { eyePlaneScale, ocularPixelsOf, HVID_MEAN_MM } from './ocularScale.js';
import { pupilPixelsOf } from './pupillary.js';

/** En deçà, l'iris ne porte plus une mesure : reculer/avancer est requis. */
export const MIN_IRIS_PX = 8;
/** Frontal exigé pour l'échelle oculaire : au-delà, les iris se raccourcissent. */
export const MAX_AUTO_YAW_RAD = 0.14; // ~8°
export const MAX_AUTO_ROLL_RAD = 0.26; // ~15°

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

/** Les grandeurs MESURÉES, prêtes pour `calibrateAuto` (core/autoCalibrate.ts). */
export interface AutoMeasures {
  /** Échelle médiane au plan des yeux, mm par pixel. */
  mmPerPxEye: number;
  /** Borne du prior périoculaire utilisée (majorité des frames). */
  priorRelError: number;
  /** Erreur-type de la médiane d'échelle (bruit de détection, réduit en 1/√n). */
  scaleStandardError: number;
  /** PD apparent médian (plan des pupilles, fixation proche), en mm. */
  pdNearMm: number;
  /** Parts gauche/droite anatomiques du PD (fractions, somme = 1). */
  pdLeftFraction: number;
  pdRightFraction: number;
  /** Largeur 234↔454 apparente, convertie au plan des yeux (mm, SANS parallaxe). */
  faceWidthEyePlaneMm: number;
  /** Taille médiane de l'iris en pixels — porte l'estimation de distance. */
  hvidPx: number;
  usableFrames: number;
  /** Vrai si la conclusion vient du timeout, pas de la convergence. */
  degraded: boolean;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? NaN) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Erreur-type RELATIVE de la médiane, par MAD — même choix que cardSweep. */
function relStandardError(xs: readonly number[]): number {
  const m = median(xs);
  if (!(m > 0)) return Infinity;
  const mad = median(xs.map((x) => Math.abs(x - m))) * 1.4826;
  return mad / Math.sqrt(xs.length) / m;
}

export class AutoCalibrationEngine {
  private state_: AutoState = 'collecting';
  private startMs: number | null = null;
  private lastMs = 0;

  private readonly mmPerPx: number[] = [];
  private readonly relErrors: number[] = [];
  private readonly pdNear: number[] = [];
  private readonly leftFrac: number[] = [];
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
          this.pdNear.push(pupils.pdPx * scale.mmPerPx);
          this.leftFrac.push(pupils.leftPx / pupils.pdPx);
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
      pdNearMm: median(this.pdNear),
      pdLeftFraction: median(this.leftFrac),
      pdRightFraction: 1 - median(this.leftFrac),
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
