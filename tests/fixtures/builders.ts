/**
 * tests/fixtures/builders.ts — ⭐ correctif T5.
 *
 * Les tests d'origine appelaient `verdict(LANDMARKS_138, CAL, SPEC_132)` —
 * trois arguments pour une signature qui en exige six — et déréférençaient un
 * retour `| null` sans `!`, ce qui ne typechecke pas en `strict`.
 *
 * Ces helpers existent pour que la suite n'ait qu'une seule chose à dire par
 * test, et qu'un changement de signature se répare en un seul endroit.
 */

import type { UserCalibration } from '../../src/core/calibration.js';
import type { FrameSpec } from '../../src/core/frameSpec.js';
import type { NormalizedLandmark } from '../../src/core/geom.js';
import { verdict, type SizeVerdict } from '../../src/core/verdict.js';
import { W, H } from './landmarks.js';

export { W, H };

/** UserCalibration complet à partir de ce qui varie réellement dans le test. */
export function makeCal(over: Partial<UserCalibration> = {}): UserCalibration {
  return { faceWidthMm: 138, source: 'card', relError: 0.025, measuredAt: 0, ...over };
}

/** Appelle verdict() avec la signature COMPLÈTE et garantit un retour non-null. */
export function callVerdict(
  lm: readonly NormalizedLandmark[],
  cal: UserCalibration,
  spec: FrameSpec,
  yawRad = 0,
): SizeVerdict {
  const v = verdict(lm, cal, spec, W, H, yawRad);
  if (v === null) {
    throw new Error('verdict() a renvoyé null alors que ce test en attend une légende');
  }
  return v;
}

export const SPRITE_PX_PER_MM = 12;

/** Levier centre optique ↔ centre du pont : 360 px / 12 = 30 mm, valeur courante. */
const LENS_LEVER_PX = 360;

export interface SpecOptions {
  slug?: string;
  lensLeverPx?: number;
  /** Marge transparente autour de la monture, en pixels sprite. */
  paddingPx?: number;
}

/**
 * Fabrique un spec.json cohérent pour une largeur totale donnée.
 *
 * `totalWidthMm` est DÉRIVÉ de la bbox alpha (correctif B3), jamais saisi :
 * `parseFrameSpec` refuserait un spec où les deux ne concordent pas.
 */
export function specForTotalWidthMm(mm: number, opts: SpecOptions = {}): FrameSpec {
  const pad = opts.paddingPx ?? 20;
  const lever = opts.lensLeverPx ?? LENS_LEVER_PX;
  const w = Math.round(mm * SPRITE_PX_PER_MM);
  const bridgeX = pad + w / 2;

  return {
    slug: opts.slug ?? `test-${mm}`,
    aMm: 44,
    bMm: 39,
    pontMm: 22,
    brancheMm: 145,
    totalWidthMm: w / SPRITE_PX_PER_MM,
    front: 'front.png',
    profile: 'profile.png',
    spritePxPerMm: SPRITE_PX_PER_MM,
    alphaBBox: { x: pad, y: 18, w, h: 512 },
    bridgeCenter: { x: bridgeX, y: 274 },
    lensCenterL: { x: bridgeX - lever, y: 286 },
    lensCenterR: { x: bridgeX + lever, y: 286 },
    hingeProfile: { x: 96, y: 130 },
    calibratedAt: '2026-08-16',
  };
}

export const SPEC_132 = specForTotalWidthMm(132, { slug: 'test-01' });
export const SPEC_120 = specForTotalWidthMm(120, { slug: 'etroite' });
export const SPEC_138 = specForTotalWidthMm(138, { slug: 'pile' });
export const SPEC_150 = specForTotalWidthMm(150, { slug: 'large' });

/**
 * Monture à long levier optique (40 mm) : l'incertitude propagée au
 * décentrement y dépasse la demi-tolérance en mode iris.
 */
export const SPEC_LONG_LEVER = specForTotalWidthMm(150, {
  slug: 'levier-long',
  lensLeverPx: 40 * SPRITE_PX_PER_MM,
});

/** Image RGBA synthétique : un bloc opaque `w×h` posé à `(offX, offY)` sur un fond transparent. */
export function makeRgba(
  imgW: number,
  imgH: number,
  block: { x: number; y: number; w: number; h: number },
): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(imgW * imgH * 4); // tout à 0 → alpha 0
  for (let y = block.y; y < block.y + block.h; y++) {
    for (let x = block.x; x < block.x + block.w; x++) {
      const i = (y * imgW + x) * 4;
      data[i] = 20;
      data[i + 1] = 20;
      data[i + 2] = 20;
      data[i + 3] = 255;
    }
  }
  return { data, width: imgW, height: imgH };
}
