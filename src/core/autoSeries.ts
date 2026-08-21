/**
 * core/autoSeries.ts — la MATIÈRE d'une tentative de collecte : les séries
 * doubles (un estimateur chacune) et l'évaluation des gates d'une frame.
 *
 * Scindé de `core/autoCalibration.ts` (règle des 300 lignes, §3). Deux
 * responsabilités, toutes deux pures :
 *
 *   - `DualSeries` (guide point 29) : chaque grandeur convertie en mm
 *     s'accumule dans DEUX séries parallèles — HVID seul, HVID+PFL — et
 *     l'estimateur n'est choisi qu'à la conclusion. Aucune série publiée ne
 *     mélange deux estimateurs ;
 *   - `gateFrame` : les trois gates (yaw, roll, yeux) évalués et rendus
 *     SÉPARÉMENT, avec la matière optique de la frame quand elle passe.
 */

import { faceWidthPx } from './faceMetrics.js';
import type { NormalizedLandmark } from './geom.js';
import { irisQualityOf, type IrisQuality } from './irisQuality.js';
import { eyePlaneScales, ocularPixelsOf, type EyePlaneScales } from './ocularScale.js';
import { pupilPixelsOf, type PupilPixels } from './pupillary.js';

/** Deux séries parallèles, une par estimateur — le choix se fait à la fin (pt 29). */
export class DualSeries {
  readonly hvid: number[] = [];
  readonly full: number[] = [];
  push(valuePx: number, sHvid: number, sFull: number | null): void {
    this.hvid.push(valuePx * sHvid);
    if (sFull !== null) this.full.push(valuePx * sFull);
  }
  pick(which: 'hvid' | 'hvid+pfl'): number[] {
    return which === 'hvid' ? this.hvid : this.full;
  }
}

export interface GatedFrame {
  yawFail: boolean;
  rollFail: boolean;
  eyesFail: boolean;
  /** Présents quand `eyesFail` est faux. */
  iris: IrisQuality | null;
  scales: EyePlaneScales | null;
  pupils: PupilPixels | null;
  faceWidthPx: number;
}

/** Lecture d'iris qui ne LÈVE jamais : une frame partielle est un gate, pas une panne. */
function ocularPixelsOfSafe(
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
): ReturnType<typeof ocularPixelsOf> | null {
  try {
    return ocularPixelsOf(lm, w, h);
  } catch {
    return null;
  }
}

/** Évalue les gates d'une frame — chacun POUR SOI, jamais une cascade. */
export function gateFrame(
  lm: readonly NormalizedLandmark[],
  yawRad: number,
  rollRad: number,
  w: number,
  h: number,
  maxYawRad: number,
  maxRollRad: number,
  irisDiscrepancyMax: number,
): GatedFrame {
  const yawFail = Math.abs(yawRad) > maxYawRad;
  const rollFail = Math.abs(rollRad) > maxRollRad;
  const eyes = ocularPixelsOfSafe(lm, w, h);
  const iris = eyes === null ? null : irisQualityOf(eyes.hvidLeftPx, eyes.hvidRightPx, irisDiscrepancyMax);
  const scales = eyes !== null && iris !== null && iris.ok ? eyePlaneScales(eyes) : null;
  const pupils = scales !== null ? pupilPixelsOf(lm, w, h) : null;
  const eyesFail = iris === null || !iris.ok || scales === null || pupils === null;
  let widthPx = NaN;
  try {
    widthPx = faceWidthPx(lm, w, h);
  } catch {
    // largeur illisible : la frame reste bonne pour le PD (point 31)
  }
  return { yawFail, rollFail, eyesFail, iris, scales, pupils, faceWidthPx: widthPx };
}
