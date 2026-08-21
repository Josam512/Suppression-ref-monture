/**
 * tests/coherence.test.ts — COHÉRENCE PHYSIQUE entre mesures (guide 78–80,
 * compléments 17, 34).
 *
 * Géométrie synthétique CONNUE : chaque test affirme une loi physique que le
 * logiciel n'a pas le droit de violer — aucune métrique n'en modifie une
 * autre, le verdict ne touche jamais le rendu, cos(yaw) s'applique une fois.
 */

import { describe, expect, it } from 'vitest';

import { AutoCalibrationEngine } from '../src/core/autoCalibration.js';
import {
  assembleDistanceMm,
  assembleFaceScale,
  assemblePd,
  focalChoiceFor,
  AUTO_ASSUMED_HFOV_DEG,
  EYEPLANE_TO_TEMPLE_DEPTH_MM,
} from '../src/core/autoCalibrate.js';
import { frameMetrics } from '../src/core/faceMetrics.js';
import { HVID_MEAN_MM } from '../src/core/ocularScale.js';
import { pupilPixelsOf } from '../src/core/pupillary.js';
import { renderedFrameHeightPx, renderedFrameWidthPx } from '../src/core/transform.js';
import { verdict } from '../src/core/verdict.js';
import type { UserCalibration } from '../src/core/calibration.js';
import { makeCal, specForTotalWidthMm } from './fixtures/builders.js';
import { H, W, makeFace } from './fixtures/landmarks.js';

const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
const focal = focalChoiceFor(W, null, 0);

function face(distanceMm: number, farPdMm = 62) {
  const mmPerPxEye = distanceMm / focalPx;
  // Scène PHYSIQUE : le sujet fixe la caméra, ses pupilles convergent — le PD
  // APPARENT dépend de la distance ((D+3,05)/(D+13,5)), le PD de LOIN non.
  const nearPdMm = (farPdMm * (distanceMm + 3.05)) / (distanceMm + 13.5);
  return makeFace({
    faceWidthPx: (138 * focalPx) / (distanceMm + EYEPLANE_TO_TEMPLE_DEPTH_MM),
    pdPx: nearPdMm / mmPerPxEye,
    hvidPx: HVID_MEAN_MM / mmPerPxEye,
  });
}

function measure(lm: ReturnType<typeof makeFace>) {
  const e = new AutoCalibrationEngine();
  for (let i = 0; i < 80; i++) e.offer(lm, 0, 0, W, H, i * 33);
  return e.measures()!;
}

describe('point 78 — cohérence physique entre mesures', () => {
  it('PD +2 mm dans la scène → PD mesuré +2 mm, largeur INCHANGÉE', () => {
    const d = 500;
    const m62 = measure(face(d, 62));
    const m64 = measure(face(d, 64));
    const pd62 = assemblePd(m62, focal, assembleDistanceMm(m62, focal));
    const pd64 = assemblePd(m64, focal, assembleDistanceMm(m64, focal));
    expect(pd64.pdMm - pd62.pdMm).toBeCloseTo(2 * ((d + 13.5) / (d + 3.05)), 1);
    const f62 = assembleFaceScale(m62, focal, assembleDistanceMm(m62, focal));
    const f64 = assembleFaceScale(m64, focal, assembleDistanceMm(m64, focal));
    expect(f64.faceWidthMm).toBeCloseTo(f62.faceWidthMm, 4); // le PD n'altère pas la largeur
  });

  it('c34 — cos(yaw) exactement UNE fois : largeur en cos, hauteur constante, jamais cos²', () => {
    const lm = face(500);
    for (const deg of [0, 10, 20, 30]) {
      const yaw = (deg * Math.PI) / 180;
      const m0 = frameMetrics(lm, W, H, makeCal(), 0);
      const mY = { ...frameMetrics(lm, W, H, makeCal(), 0), yawRad: yaw };
      const spec = specForTotalWidthMm(134, { slug: `cos-${deg}` });
      const ratio = renderedFrameWidthPx(spec, mY) / renderedFrameWidthPx(spec, m0);
      expect(ratio).toBeCloseTo(Math.cos(yaw), 9); // cos, pas cos²
      expect(renderedFrameHeightPx(spec, mY)).toBeCloseTo(renderedFrameHeightPx(spec, m0), 9);
    }
  });

  it('le roll ne modifie AUCUNE longueur physique rendue', () => {
    const lmFlat = makeFace({ faceWidthPx: 420 });
    const lmRolled = makeFace({ faceWidthPx: 420, rollRad: 0.2 });
    const spec = specForTotalWidthMm(134, { slug: 'roll' });
    const mF = frameMetrics(lmFlat, W, H, makeCal(), 0);
    const mR = frameMetrics(lmRolled, W, H, makeCal(), 0);
    expect(renderedFrameWidthPx(spec, mR)).toBeCloseTo(renderedFrameWidthPx(spec, mF), 3);
  });

  it('eye → temple : la correction s’applique EXACTEMENT une fois', () => {
    const m = measure(face(500));
    const d = assembleDistanceMm(m, focal);
    const f = assembleFaceScale(m, focal, d);
    // Une fois : eyePlane × (1 + Δ/D). Ni zéro (124–130 mm), ni deux (150+).
    expect(f.faceWidthMm).toBeCloseTo(m.faceWidthEyePlaneMm * (1 + EYEPLANE_TO_TEMPLE_DEPTH_MM / d), 6);
    expect(f.depthCorrection).toBeCloseTo(1 + EYEPLANE_TO_TEMPLE_DEPTH_MM / d, 9);
  });

  it('point 54 — le VERDICT n’altère jamais le rendu : même échelle avec ou sans temporal', () => {
    const lm = face(500);
    const base: UserCalibration = { faceWidthMm: 138, source: 'auto', relError: 0.05, measuredAt: 0 };
    const withTemporal: UserCalibration = { ...base, temporalWidthMm: 152, temporalRelError: 0.03 };
    const spec = specForTotalWidthMm(134, { slug: 'verdict-neutre' });

    const mBase = frameMetrics(lm, W, H, base, 0);
    const mTemp = frameMetrics(lm, W, H, withTemporal, 0);
    // L'écart temporal change la LÉGENDE, jamais l'échelle du sprite.
    expect(mTemp.livePxPerMm).toBeCloseTo(mBase.livePxPerMm, 9);
    expect(renderedFrameWidthPx(spec, mTemp)).toBeCloseTo(renderedFrameWidthPx(spec, mBase), 9);

    const vBase = verdict(lm, base, spec, W, H, 0);
    const vTemp = verdict(lm, withTemporal, spec, W, H, 0);
    expect(vBase?.frameWidthMm).toBeCloseTo(vTemp?.frameWidthMm ?? NaN, 9); // la monture ne « rentre » jamais
    expect(vTemp?.faceWidthMm).toBeCloseTo(152, 6); // seule la largeur COMPARÉE change
  });

  it('complément 17 — OD/OG suivent la GÉOMÉTRIE, jamais une convention inversée', () => {
    const asym = makeFace({ faceWidthPx: 420, pdSplitPx: { right: 84, left: 98 } });
    const p = pupilPixelsOf(asym, W, H)!;
    expect(p.rightPx).toBeCloseTo(84, 0);
    expect(p.leftPx).toBeCloseTo(98, 0);
    const swapped = makeFace({ faceWidthPx: 420, pdSplitPx: { right: 98, left: 84 } });
    const q = pupilPixelsOf(swapped, W, H)!;
    expect(q.rightPx).toBeCloseTo(98, 0);
    expect(q.leftPx).toBeCloseTo(84, 0);
  });
});

describe('point 79 — 40/50/60 cm : les grandeurs PHYSIQUES ne bougent pas', () => {
  const DISTANCES = [400, 500, 600];

  it('PD physique stable à ±0,3 mm sur toute la plage', () => {
    const pds = DISTANCES.map((d) => {
      const m = measure(face(d));
      return assemblePd(m, focal, assembleDistanceMm(m, focal)).pdMm;
    });
    for (const pd of pds) expect(Math.abs(pd - pds[0]!)).toBeLessThan(0.3);
  });

  it('largeur de visage physique stable, image évidemment plus grande de près', () => {
    const out = DISTANCES.map((d) => {
      const lm = face(d);
      const m = measure(lm);
      const f = assembleFaceScale(m, focal, assembleDistanceMm(m, focal));
      const cal: UserCalibration = { faceWidthMm: f.faceWidthMm, source: 'auto', relError: f.relError, measuredAt: 0 };
      return { faceMm: f.faceWidthMm, pxPerMm: frameMetrics(lm, W, H, cal, 0).livePxPerMm };
    });
    for (const o of out) expect(Math.abs(o.faceMm - out[0]!.faceMm)).toBeLessThan(0.5);
    expect(out[0]!.pxPerMm).toBeGreaterThan(out[2]!.pxPerMm); // près = plus de pixels par mm
  });

  it('la taille PHYSIQUE de la monture rendue est stable (rapport monture/visage constant)', () => {
    const spec = specForTotalWidthMm(134, { slug: 'dist-134' });
    const painted = DISTANCES.map((d) => {
      const lm = face(d);
      const m = measure(lm);
      const f = assembleFaceScale(m, focal, assembleDistanceMm(m, focal));
      const cal: UserCalibration = { faceWidthMm: f.faceWidthMm, source: 'auto', relError: f.relError, measuredAt: 0 };
      const fm = frameMetrics(lm, W, H, cal, 0);
      return renderedFrameWidthPx(spec, fm) / fm.livePxPerMm; // en mm rendus
    });
    for (const p of painted) expect(p).toBeCloseTo(134, 1);
  });
});

describe('point 80 — 120/134/145/155 mm : l’écart relatif est STRICTEMENT préservé', () => {
  it('sous la même calibration, les rapports de largeurs peintes = rapports réels', () => {
    const lm = face(500);
    const m = frameMetrics(lm, W, H, makeCal(), 0);
    const sizes = [120, 134, 145, 155];
    const painted = sizes.map((mm) => renderedFrameWidthPx(specForTotalWidthMm(mm, { slug: `s${mm}` }), m));
    for (let i = 1; i < sizes.length; i++) {
      expect(painted[i]! / painted[0]!).toBeCloseTo(sizes[i]! / sizes[0]!, 9);
    }
    // Le logiciel n'a PAS le droit de normaliser les montures à la tête.
    expect(painted[3]! - painted[0]!).toBeCloseTo((155 - 120) * m.livePxPerMm, 6);
  });
});
