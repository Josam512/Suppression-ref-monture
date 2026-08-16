/**
 * tests/scale.test.ts — la chaîne des trois échelles (CLAUDE.md §8).
 *
 * Toute la géométrie de core/ est du calcul pur : elle se teste sans webcam,
 * sans navigateur, en millisecondes.
 */

import { describe, expect, it } from 'vitest';

import { CalibrationError } from '../src/core/geom.js';
import {
  computeSpritePxPerMm,
  totalFrameWidthMm,
  type FrontMarks,
} from '../src/core/frameSpec.js';
import {
  assertIrisUsable,
  assertPlausibleFaceWidth,
  calibrateWithCard,
  calibrateWithWornFrame,
  estimateDistanceMm,
  isTooCloseForCard,
  scaleFromIris,
  WORN_FRAME_REL_ERROR,
} from '../src/core/calibration.js';
import { faceWidthPx, frameMetrics } from '../src/core/faceMetrics.js';
import { renderedFrameHeightPx, renderedFrameWidthPx } from '../src/core/transform.js';
import { computeAlphaBBox } from '../src/prep/alphaBBox.js';

import {
  BASE_FACE_PX,
  H,
  LANDMARKS_100CM,
  LANDMARKS_50CM,
  LANDMARKS_CAL,
  makeFaceAtYaw,
  W,
} from './fixtures/landmarks.js';
import { makeCal, makeRgba, SPEC_132, specForTotalWidthMm } from './fixtures/builders.js';

/** 6 points cohérents avec une échelle de 12,0 px/mm. */
const MARKS_FIXTURE: FrontMarks = {
  p1: { x: 0, y: 0 },
  p2: { x: 44 * 12, y: 0 },
  p3: { x: 0, y: 0 },
  p4: { x: 22 * 12, y: 0 },
  p5: { x: 0, y: 0 },
  p6: { x: 0, y: 39 * 12 },
};

/** Le pont paraît 10 % trop court : signature d'une photo prise de trois quarts. */
const MARKS_SKEWED: FrontMarks = {
  ...MARKS_FIXTURE,
  p4: { x: 22 * 12 * 0.9, y: 0 },
};

describe('Échelle 1 — le sprite de la monture', () => {
  it('3 mesures concordantes → px/mm', () => {
    expect(computeSpritePxPerMm(MARKS_FIXTURE, { aMm: 44, bMm: 39, pontMm: 22 })).toBeCloseTo(
      12.0,
      1,
    );
  });

  it('photo de trois quarts → rejetée', () => {
    expect(() => computeSpritePxPerMm(MARKS_SKEWED, { aMm: 44, bMm: 39, pontMm: 22 })).toThrow(
      CalibrationError,
    );
  });

  it('sans la cote B, le seuil se durcit et attrape un écart que 3 cotes toléraient', () => {
    // Écart de 3 % : accepté à 3 cotes (seuil 4 %), refusé à 2 (seuil 2,5 %).
    const marks: FrontMarks = { ...MARKS_FIXTURE, p4: { x: 22 * 12 * 0.97, y: 0 } };
    expect(() => computeSpritePxPerMm(marks, { aMm: 44, bMm: 39, pontMm: 22 })).not.toThrow();
    expect(() => computeSpritePxPerMm(marks, { aMm: 44, pontMm: 22 })).toThrow(CalibrationError);
  });

  // ⭐ B3 — le padding transparent ne doit RIEN changer à la largeur en mm.
  it('B3 : un sprite padé et un sprite recadré donnent la même largeur en mm', () => {
    const tight = makeRgba(120, 40, { x: 0, y: 0, w: 120, h: 40 });
    const padded = makeRgba(160, 80, { x: 20, y: 18, w: 120, h: 40 });

    const bboxTight = computeAlphaBBox(tight);
    const bboxPadded = computeAlphaBBox(padded);

    expect(bboxPadded.w).toBe(bboxTight.w);
    expect(bboxPadded.h).toBe(bboxTight.h);

    // Et la preuve que le test attraperait bien la régression : les dimensions
    // du FICHIER, elles, diffèrent de 33 %. C'est exactement ce que l'ancienne
    // formule `img.width / spritePxPerMm` aurait injecté dans le livrable.
    expect(padded.width).not.toBe(tight.width);
  });

  it('la largeur totale se lit sur la bbox alpha', () => {
    expect(totalFrameWidthMm(SPEC_132)).toBeCloseTo(132.0, 3);
  });
});

describe('Échelle 2 — le visage réel', () => {
  it('carte de 300 px de large → visage mesuré à 138 mm', () => {
    expect(calibrateWithCard(300, LANDMARKS_CAL, W, H).faceWidthMm).toBeCloseTo(138.0, 1);
  });

  it('iris de 42 px → échelle de 3.59 px/mm', () => {
    expect(scaleFromIris(42)).toBeCloseTo(3.59, 2);
  });

  // ⭐ B5 — un enfant n'est pas une panne.
  it("B5 : un visage d'enfant de 110 mm est accepté", () => {
    expect(() => assertPlausibleFaceWidth(110, 'card')).not.toThrow();
  });

  it('B5 : une mesure aberrante de 60 mm est rejetée en nommant la cause', () => {
    expect(() => assertPlausibleFaceWidth(60, 'card')).toThrow(/carte/i);
    expect(() => assertPlausibleFaceWidth(60, 'iris')).toThrow(/lunettes/i);
  });

  // ⭐ S2 — l'iris à travers des verres correcteurs est faux ET paraît excellent.
  it('S2 : des lunettes détectées interdisent la voie iris', () => {
    expect(() => assertIrisUsable(false)).not.toThrow();
    expect(() => assertIrisUsable(true)).toThrow(/carte bancaire/i);
  });

  // ⭐ B4, parade n°1 — trop près, la parallaxe devient dominante.
  it('B4 : une carte trop grande à l\'écran signale que le client est trop près', () => {
    const far = 150; // px
    const near = 600; // px
    expect(estimateDistanceMm(far, W)).toBeGreaterThan(estimateDistanceMm(near, W));
    expect(isTooCloseForCard(near, W)).toBe(true);
    expect(isTooCloseForCard(far, W)).toBe(false);
  });

  it('T8 : la monture portée est annoncée à 2 %, pas à 1 %', () => {
    const spec = specForTotalWidthMm(140);
    // Une monture de 140 mm qui occupe 500 px → 3.571 px/mm.
    const cal = calibrateWithWornFrame(500, spec, LANDMARKS_CAL, W, H);
    expect(cal.relError).toBe(WORN_FRAME_REL_ERROR);
    expect(cal.relError).toBeCloseTo(0.02, 5);
    expect(cal.faceWidthMm).toBeCloseTo((BASE_FACE_PX * 140) / 500, 3);
  });
});

describe('Échelle 3 — chaque frame', () => {
  // 🔴 S4 — l'ancienne version comparait deux valeurs recopiées depuis spec et
  // cal : elle ne pouvait PAS échouer, même chaîne d'échelle entièrement cassée.
  it('INVARIANT : la distance à la caméra ne change pas le rapport monture/visage', () => {
    const ratio = (lm: Parameters<typeof faceWidthPx>[0]): number => {
      const m = frameMetrics(lm, W, H, makeCal(), 0);
      return renderedFrameWidthPx(SPEC_132, m) / faceWidthPx(lm, W, H);
    };
    expect(ratio(LANDMARKS_50CM)).toBeCloseTo(ratio(LANDMARKS_100CM), 6);

    // Et ce rapport vaut bien 132/138 : la monture est rendue plus étroite que
    // le visage, dans la proportion exacte de leurs cotes réelles.
    expect(ratio(LANDMARKS_50CM)).toBeCloseTo(132 / 138, 6);
  });

  // 🔴 S1 — signature du yaw appliqué deux fois : la hauteur bougeait.
  it('INVARIANT : un yaw ne change PAS la hauteur rendue du sprite', () => {
    const height = (yaw: number): number =>
      renderedFrameHeightPx(SPEC_132, frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw));

    expect(height(Math.PI / 6)).toBeCloseTo(height(0), 6); // 30° vs 0°
    expect(height(Math.PI / 12)).toBeCloseTo(height(0), 6); // 15° vs 0°
  });

  it('S1 : le cos du yaw est appliqué UNE fois sur la largeur, pas deux', () => {
    const width = (yaw: number): number =>
      renderedFrameWidthPx(SPEC_132, frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw));

    const yaw = Math.PI / 6; // 30°
    // Une seule fois → cos(30°) = 0.866. Deux fois → cos²(30°) = 0.75.
    expect(width(yaw) / width(0)).toBeCloseTo(Math.cos(yaw), 6);
    expect(width(yaw) / width(0)).not.toBeCloseTo(Math.cos(yaw) ** 2, 3);
  });

  it("l'échelle live ne dépend pas du yaw", () => {
    const scale = (yaw: number): number =>
      frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw).livePxPerMm;
    expect(scale(Math.PI / 6)).toBeCloseTo(scale(0), 6);
  });
});
