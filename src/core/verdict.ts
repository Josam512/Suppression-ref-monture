/**
 * core/verdict.ts — légende chiffrée. Ne filtre ni ne recommande rien.
 */

import { at, midpoint, px, type NormalizedLandmark } from './geom.js';
import type { UserCalibration, CalSource } from './calibration.js';
import { totalFrameWidthMm, type FrameSpec } from './frameSpec.js';
import {
  EYE_L,
  EYE_L_INNER,
  EYE_R,
  EYE_R_INNER,
  frameMetrics,
  type FrameMetrics,
} from './faceMetrics.js';
import { spriteToScreen } from './transform.js';
import { BRIDGE_AHEAD_MM, planeScale } from './framePlane.js';

export type Status = 'sous-taillee' | 'correcte' | 'surtaillee' | 'indetermine';

export interface SizeVerdict {
  frameWidthMm: number;
  faceWidthMm: number;
  faceWidthUncertaintyMm: number;
  deltaMm: number;
  thresholdMm: number;
  status: Status;
  decentrementMm: { left: number; right: number } | null;
  source: CalSource;
}

export const THRESHOLD_RATIO = 0.03;
export const THRESHOLD_MIN_MM = 3;
export const THRESHOLD_MAX_MM = 5;

export function thresholdFor(faceWidthMm: number): number {
  return Math.min(THRESHOLD_MAX_MM, Math.max(THRESHOLD_MIN_MM, faceWidthMm * THRESHOLD_RATIO));
}

export function classify(deltaMm: number, cal: UserCalibration): Status {
  const t = thresholdFor(cal.faceWidthMm);
  const u = cal.faceWidthMm * cal.relError;
  const lo = deltaMm - u;
  const hi = deltaMm + u;

  if (hi < -t) return 'sous-taillee';
  if (lo > t) return 'surtaillee';
  if (lo > -t && hi < t) return 'correcte';
  return 'indetermine';
}

export const DECENTREMENT_THRESHOLD_MM = 3;

export function decentrementUncertaintyMm(spec: FrameSpec, cal: UserCalibration): number {
  const leverPx = Math.abs(spec.lensCenterL.x - spec.bridgeCenter.x);
  const leverMm = leverPx / spec.spritePxPerMm;
  return leverMm * cal.relError;
}

function horizontalOffsetMm(
  eyeOuter: NormalizedLandmark,
  eyeInner: NormalizedLandmark,
  lensCenterSprite: { x: number; y: number },
  spec: FrameSpec,
  m: FrameMetrics,
  w: number,
  h: number,
): number {
  const eye = midpoint(px(eyeOuter, w, h), px(eyeInner, w, h));
  const lens = spriteToScreen(lensCenterSprite, spec, m);
  const ux = Math.cos(m.rollRad);
  const uy = Math.sin(m.rollRad);
  const dxPx = (eye.x - lens.x) * ux + (eye.y - lens.y) * uy;
  return Math.abs(dxPx) / planeScale(m.livePxPerMm, BRIDGE_AHEAD_MM);
}

export const MAX_YAW_RAD = (12 * Math.PI) / 180;
export const MAX_ROLL_RAD = (15 * Math.PI) / 180;

/**
 * Ces deux paramètres ne sont PAS encore calibrés. Tant qu'ils restent neutres,
 * 234/454 ne peuvent pas servir à donner un statut de taille catégorique : le
 * propre historique du projet chiffre leur écart aux vraies tempes au-dessus du
 * seuil de décision.
 */
export const FACE_WIDTH_CORRECTION_MM = 0;
export const FACE_WIDTH_CORRECTION_RATIO = 1;
export const FACE_WIDTH_FALLBACK_CALIBRATED = false;

export interface ComparisonWidth {
  mm: number;
  relError: number;
  /** Vrai seulement si la largeur réellement pertinente a été mesurée/calibrée. */
  reliableForStatus: boolean;
}

export function comparisonWidth(cal: UserCalibration): ComparisonWidth {
  const measured = cal.temporalWidthMm;
  const measuredRel = cal.temporalRelError;
  if (measured !== undefined && measuredRel !== undefined) {
    return { mm: measured, relError: measuredRel, reliableForStatus: true };
  }
  return {
    mm: cal.faceWidthMm * FACE_WIDTH_CORRECTION_RATIO + FACE_WIDTH_CORRECTION_MM,
    relError: cal.relError,
    reliableForStatus: FACE_WIDTH_FALLBACK_CALIBRATED,
  };
}

export function verdict(
  lm: readonly NormalizedLandmark[],
  cal: UserCalibration | null,
  spec: FrameSpec,
  w: number,
  h: number,
  yawRad: number,
): SizeVerdict | null {
  if (cal === null) return null;

  const m = frameMetrics(lm, w, h, cal, yawRad);
  if (Math.abs(m.yawRad) > MAX_YAW_RAD) return null;
  if (Math.abs(m.rollRad) > MAX_ROLL_RAD) return null;

  const compared = comparisonWidth(cal);
  const faceWidthMm = compared.mm;
  const corrected: UserCalibration = { ...cal, faceWidthMm, relError: compared.relError };

  const frameWidthMm = totalFrameWidthMm(spec);
  const deltaMm = frameWidthMm - faceWidthMm;

  const u = decentrementUncertaintyMm(spec, cal);
  const conclusive = u < DECENTREMENT_THRESHOLD_MM / 2;
  const decentrementMm = conclusive
    ? {
        left: horizontalOffsetMm(at(lm, EYE_L), at(lm, EYE_L_INNER), spec.lensCenterL, spec, m, w, h),
        right: horizontalOffsetMm(at(lm, EYE_R), at(lm, EYE_R_INNER), spec.lensCenterR, spec, m, w, h),
      }
    : null;

  return {
    frameWidthMm,
    faceWidthMm,
    faceWidthUncertaintyMm: faceWidthMm * compared.relError,
    deltaMm,
    thresholdMm: thresholdFor(faceWidthMm),
    // Audit prédictif 2026-08-21 : auparavant le code savait explicitement que
    // le fallback 234/454 était non calibré et "décalé d'un cran", puis donnait
    // quand même correcte/sous/sur-taillée. On interdit cette contradiction.
    status: compared.reliableForStatus ? classify(deltaMm, corrected) : 'indetermine',
    decentrementMm,
    source: cal.source,
  };
}

export function legend(v: SizeVerdict): string {
  const u = v.faceWidthUncertaintyMm;
  return (
    `Monture ${v.frameWidthMm.toFixed(0)} mm · largeur visage ${v.faceWidthMm.toFixed(0)} ± ${u.toFixed(0)} mm` +
    (v.status === 'indetermine' ? '' : ` · ${v.status}`)
  );
}
