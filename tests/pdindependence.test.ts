/**
 * tests/pdindependence.test.ts — le PD est un SOUS-SYSTÈME INDÉPENDANT
 * (guide de fiabilisation, points 20–26, 29, compléments 1, 13–15).
 *
 * Ce que ce fichier verrouille : le PD total vient de la distance DIRECTE
 * pupille↔pupille ; un sellion décroché prive des demi-PD, jamais du total ;
 * un échec d'assemblage d'une métrique n'entraîne JAMAIS l'autre ; les codes
 * d'échec sont typés ; les frames rejetées se comptent une fois.
 */

import { describe, expect, it } from 'vitest';

import {
  AutoCalibrationEngine,
  AUTO_TIMEOUT_MS,
  MIN_SPLIT_FRAMES,
} from '../src/core/autoCalibration.js';
import {
  assembleDistanceMm,
  assembleFaceScale,
  assemblePd,
  focalChoiceFor,
  AUTO_ASSUMED_HFOV_DEG,
  EYEPLANE_TO_TEMPLE_DEPTH_MM,
  HALF_SUM_MAX_REL_GAP,
} from '../src/core/autoCalibrate.js';
import type { AutoMeasures } from '../src/core/autoMeasures.js';
import { seriesStats } from '../src/core/autoMeasures.js';
import { CalibrationError } from '../src/core/geom.js';
import { HVID_MEAN_MM } from '../src/core/ocularScale.js';
import { halfPdUsable, pupilPixelsOf, SELLION_T_MAX, SELLION_T_MIN } from '../src/core/pupillary.js';
import { SELLION } from '../src/core/faceMetrics.js';
import { H, W, makeFace } from './fixtures/landmarks.js';

const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));

/** Frame cohérente avec la caméra supposée, à la vérité terrain 138 mm / PD 62. */
function face(distanceMm = 500, over: Parameters<typeof makeFace>[0] extends infer O ? Partial<O> : never = {}) {
  const mmPerPxEye = distanceMm / focalPx;
  return makeFace({
    faceWidthPx: (138 * focalPx) / (distanceMm + EYEPLANE_TO_TEMPLE_DEPTH_MM),
    pdPx: 62 / mmPerPxEye,
    hvidPx: HVID_MEAN_MM / mmPerPxEye,
    ...over,
  });
}

function calibratedMeasures(lm = face(500)): AutoMeasures {
  const e = new AutoCalibrationEngine();
  for (let i = 0; i < 80; i++) e.offer(lm, 0, 0, W, H, i * 33);
  const m = e.measures();
  expect(m).not.toBeNull();
  return m!;
}

const focal = focalChoiceFor(W, null, 0);

describe('point 22 — le PD total est la distance DIRECTE pupille ↔ pupille', () => {
  it('un sellion DÉCROCHÉ (projection hors segment) ne change pas le PD total', () => {
    const clean = face(500);
    const broken = face(500);
    // Sellion projeté LOIN à droite des deux pupilles : t >> 1.
    broken[SELLION] = { x: 0.95, y: clean[SELLION]!.y };

    const pClean = pupilPixelsOf(clean, W, H)!;
    const pBroken = pupilPixelsOf(broken, W, H)!;
    expect(pBroken.pdPx).toBeCloseTo(pClean.pdPx, 6); // la distance directe, intacte
    expect(halfPdUsable(pBroken.t)).toBe(false); // les demi-PD, refusées
    expect(pBroken.t).toBeGreaterThan(SELLION_T_MAX);

    // Et au niveau du MOTEUR : la frame nourrit le total, pas les demi-PD.
    const e = new AutoCalibrationEngine();
    for (let i = 0; i < 80; i++) e.offer(broken, 0, 0, W, H, i * 33);
    const m = e.measures()!;
    expect(m.splitFrames).toBe(0);
    expect(Number.isNaN(m.pdRightNearMm)).toBe(true);
    const pd = assemblePd(m, focal, assembleDistanceMm(m, focal));
    expect(pd.pdMm).toBeGreaterThan(55);
    expect(pd.pdMm).toBeLessThan(70);
    expect(pd.pdRightMm).toBeUndefined(); // jamais fabriquées, jamais PD/2
  });

  it('les bornes anatomiques de t encadrent le milieu, pas les pupilles', () => {
    expect(SELLION_T_MIN).toBeGreaterThan(0);
    expect(SELLION_T_MAX).toBeLessThan(1);
    expect(halfPdUsable(0.5)).toBe(true);
    expect(halfPdUsable(0.2)).toBe(true);
    expect(halfPdUsable(-0.05)).toBe(false);
    expect(halfPdUsable(1.02)).toBe(false);
    expect(halfPdUsable(Number.NaN)).toBe(false);
  });
});

describe('complément 15 — MIN_SPLIT_FRAMES est appliqué À LA SORTIE', () => {
  const casesShort = [1, 3, 7];
  for (const strict of casesShort) {
    it(`${strict} frame(s) stricte(s) sur 30 larges → pdMm présent, demi-PD absentes`, () => {
      const e = new AutoCalibrationEngine();
      const lm = face(500);
      // D'abord `strict` frames de face stricte, puis du yaw large (les
      // demi-PD ne s'y accumulent pas, le total si).
      for (let i = 0; i < strict; i++) e.offer(lm, 0, 0, W, H, i * 33);
      for (let i = strict; i < 80; i++) e.offer(lm, 0.1, 0, W, H, i * 33);
      const m = e.measures()!;
      expect(m.splitFrames).toBe(strict);
      const pd = assemblePd(m, focal, assembleDistanceMm(m, focal));
      expect(Number.isFinite(pd.pdMm)).toBe(true);
      expect(pd.pdRightMm).toBeUndefined();
      expect(pd.pdLeftMm).toBeUndefined();
    });
  }

  it(`à ${MIN_SPLIT_FRAMES} frames strictes, les demi-PD sortent`, () => {
    const m = calibratedMeasures();
    expect(m.splitFrames).toBeGreaterThanOrEqual(MIN_SPLIT_FRAMES);
    const pd = assemblePd(m, focal, assembleDistanceMm(m, focal));
    expect(pd.pdRightMm).toBeDefined();
    expect(pd.pdLeftMm).toBeDefined();
  });
});

describe('complément 13 — cohérence OD + OG ≈ PD total, sans jamais recaler le total', () => {
  it('des demi-PD incohérentes sont écartées, le total conservé tel quel', () => {
    const m = calibratedMeasures();
    // Demi-écarts artificiellement gonflés : la somme ne recoupe plus le total.
    const broken: AutoMeasures = {
      ...m,
      pdRightNearMm: m.pdRightNearMm * (1 + 2 * HALF_SUM_MAX_REL_GAP),
      pdLeftNearMm: m.pdLeftNearMm * (1 + 2 * HALF_SUM_MAX_REL_GAP),
    };
    const clean = assemblePd(m, focal, assembleDistanceMm(m, focal));
    const pd = assemblePd(broken, focal, assembleDistanceMm(broken, focal));
    expect(pd.pdRightMm).toBeUndefined(); // demi-PD invalidées…
    expect(pd.pdMm).toBeCloseTo(clean.pdMm, 6); // …le total, intact
    expect(pd.notes.join(' ')).toMatch(/ne recoupe pas le total/);
  });
});

describe('points 20/26 — PD et largeur : deux assemblages, deux destins', () => {
  it('faceWidth aberrante → assembleFaceScale lève TYPÉ, assemblePd réussit', () => {
    const m = calibratedMeasures();
    const broken: AutoMeasures = { ...m, faceWidthEyePlaneMm: 300 }; // hors plage
    const d = assembleDistanceMm(broken, focal);
    expect(() => assembleFaceScale(broken, focal, d)).toThrowError(CalibrationError);
    try {
      assembleFaceScale(broken, focal, d);
    } catch (err) {
      expect((err as CalibrationError).code).toBe('face-width-out-of-range');
    }
    const pd = assemblePd(broken, focal, d);
    expect(pd.pdMm).toBeGreaterThan(55); // le PD, lui, vit sa vie
  });

  it('PD aberrant → assemblePd lève TYPÉ, assembleFaceScale réussit', () => {
    const m = calibratedMeasures();
    const broken: AutoMeasures = { ...m, pdDirectNearMm: 200 };
    const d = assembleDistanceMm(broken, focal);
    try {
      assemblePd(broken, focal, d);
      expect.unreachable('assemblePd aurait dû lever');
    } catch (err) {
      expect((err as CalibrationError).code).toBe('pd-out-of-range');
    }
    const face = assembleFaceScale(broken, focal, d);
    expect(face.faceWidthMm).toBeGreaterThan(130);
    expect(face.faceWidthMm).toBeLessThan(146);
  });

  it('distance incalculable → code invalid-distance, pas « rapprochez-vous »', () => {
    const m = calibratedMeasures();
    const broken: AutoMeasures = { ...m, hvidPx: 0 };
    try {
      assembleDistanceMm(broken, focal);
      expect.unreachable('assembleDistanceMm aurait dû lever');
    } catch (err) {
      expect((err as CalibrationError).code).toBe('invalid-distance');
    }
  });
});

describe('point 29 — estimateur verrouillé pour la tentative', () => {
  it('la conclusion nomme UN estimateur, et ses stats viennent de SA série', () => {
    const m = calibratedMeasures();
    expect(m.estimator === 'hvid' || m.estimator === 'hvid+pfl').toBe(true);
    expect(m.scaleStats.n).toBe(m.usableFrames === m.scaleStats.n ? m.usableFrames : m.scaleStats.n);
    expect(Number.isFinite(m.mmPerPxEye)).toBe(true);
  });
});

describe('complément 1 — rejectedFramesAny compte des FRAMES, pas des gates', () => {
  it('une frame tournée ET inclinée = 2 gates, 1 frame', () => {
    const e = new AutoCalibrationEngine();
    const lm = face(500);
    for (let i = 0; i < 5; i++) e.offer(lm, 0.5, 0.5, W, H, i * 33); // yaw + roll violés
    const st = e.status();
    expect(st.rejected['turn-to-front']).toBe(5);
    expect(st.rejected['straighten-head']).toBe(5);
    expect(st.rejectedFramesAny).toBe(5); // et non 10
    expect(st.lastFrameViolations).toContain('turn-to-front');
    expect(st.lastFrameViolations).toContain('straighten-head');
  });
});

describe('point 18 / complément 19 — l’horloge de TENTATIVE court toujours', () => {
  it('zéro frame utile pendant tout le délai → tentative échouée NOMMÉE, jamais éternelle', () => {
    const e = new AutoCalibrationEngine();
    const lm = face(500);
    // Un visage TOUJOURS tourné : des frames vues, aucune utile.
    for (let t = 0; t <= AUTO_TIMEOUT_MS + 1000; t += 200) e.offer(lm, 0.5, 0, W, H, t);
    const st = e.status();
    expect(st.attempts).toBeGreaterThanOrEqual(1);
    expect(st.lastAttemptFailure?.code).toBe('turn-to-front');
    expect(st.state).toBe('collecting'); // la collecte, elle, reste vivante
  });

  it('les trois phases d’acquisition sont nommées (c19)', () => {
    const e = new AutoCalibrationEngine();
    e.offer(null, 0, 0, W, H, 0);
    expect(e.status().phase).toBe('no-face');
    e.offer(face(500), 0.5, 0, W, H, 100); // vu, mais rejeté
    expect(e.status().phase).toBe('acquiring');
    e.offer(face(500), 0, 0, W, H, 200); // retenu
    expect(e.status().phase).toBe('converging');
  });
});

describe('point 32 — les statistiques disent la dérive et les outliers', () => {
  it('une série qui dérive est vue ; une série stable ne l’est pas', () => {
    const stable = seriesStats(Array.from({ length: 40 }, () => 100));
    expect(Math.abs(stable.driftRel)).toBeLessThan(1e-9);
    expect(stable.outlierRatio).toBe(0);

    const drifting = seriesStats(Array.from({ length: 40 }, (_, i) => 100 + (i < 20 ? 0 : 8)));
    expect(drifting.driftRel).toBeGreaterThan(0.05);
  });

  it('P10/P90 encadrent la médiane', () => {
    const s = seriesStats(Array.from({ length: 100 }, (_, i) => i));
    expect(s.p10).toBeLessThan(s.p90);
    expect(s.n).toBe(100);
  });
});
