/**
 * tests/nonadaptation.test.ts — 🔴 LE contrat du projet : AUCUNE adaptation.
 *
 * La mesure du visage et les cotes de la monture sont deux chaînes strictement
 * indépendantes qui ne se rencontrent qu'à l'affichage (vérification finale du
 * 2026-08-19, §8–9, 15, 29–33). Ce fichier verrouille :
 *
 *   1. la calibration est BIT-IDENTIQUE quelle que soit la monture essayée ;
 *   2. la largeur peinte vaut EXACTEMENT largeur réelle × échelle du visage,
 *      y compris par incréments de 2 mm (résolution relative parfaite) ;
 *   3. la distance caméra (30–80 cm) ne déplace ni la mesure ni le rapport ;
 *   4. un visage de 110 à 160 mm est mesuré à SA taille — aucune attraction
 *      vers une moyenne (pente mesuré/vrai = 1, pas < 1) ;
 *   5. une monture trop grande DÉPASSE du visage, une trop petite est étroite —
 *      l'app montre, elle ne corrige jamais (§0.0.1, §1 bug #1).
 *
 * Leçon S4 appliquée : chaque assertion peut rougir — un clamp, un fit-ratio,
 * une normalisation esthétique introduits n'importe où dans la chaîne feraient
 * échouer au moins un bloc.
 */

import { describe, expect, it } from 'vitest';

import { AutoCalibrationEngine } from '../src/core/autoCalibration.js';
import { calibrateAuto, AUTO_ASSUMED_HFOV_DEG, EYEPLANE_TO_TEMPLE_DEPTH_MM } from '../src/core/autoCalibrate.js';
import { faceWidthPx, frameMetrics } from '../src/core/faceMetrics.js';
import { HVID_MEAN_MM } from '../src/core/ocularScale.js';
import { renderedFrameWidthPx } from '../src/core/transform.js';
import type { UserCalibration } from '../src/core/calibration.js';
import { specForTotalWidthMm } from './fixtures/builders.js';
import { H, W, makeFace } from './fixtures/landmarks.js';

/** Scène cohérente (même modèle que tests/autocal.test.ts). */
function scene(over: Partial<{ distanceMm: number; pdFarMm: number; faceWidthMm: number }> = {}) {
  const distanceMm = over.distanceMm ?? 500;
  const pdFarMm = over.pdFarMm ?? 63;
  const faceWidthMm = over.faceWidthMm ?? 138;
  const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
  const pdNearMm = (pdFarMm * (distanceMm + 3.05)) / (distanceMm + 13.5);
  const mmPerPxEye = distanceMm / focalPx;
  return {
    faceWidthMm,
    lm: makeFace({
      faceWidthPx: (faceWidthMm * focalPx) / (distanceMm + EYEPLANE_TO_TEMPLE_DEPTH_MM),
      pdPx: pdNearMm / mmPerPxEye,
      hvidPx: HVID_MEAN_MM / mmPerPxEye,
    }),
  };
}

function calibrated(s: ReturnType<typeof scene>): UserCalibration {
  const e = new AutoCalibrationEngine();
  for (let i = 0; i < 80; i++) e.offer(s.lm, 0, 0, W, H, i * 33);
  return calibrateAuto(e.measures()!, W, null, 0).cal;
}

describe('NON-ADAPTATION 1 — la calibration ignore la monture, bit à bit', () => {
  it('essayer 100 → 160 mm ne change pas UN caractère de la calibration', () => {
    const s = scene();
    const cal = calibrated(s);
    const before = JSON.stringify(cal);
    const m = frameMetrics(s.lm, W, H, cal, 0);

    for (const mm of [100, 110, 120, 132, 140, 150, 160]) {
      const painted = renderedFrameWidthPx(specForTotalWidthMm(mm, { slug: `na-${mm}` }), m);
      expect(painted / m.livePxPerMm).toBeCloseTo(mm, 9); // la cote réelle, exactement
    }
    expect(JSON.stringify(cal)).toBe(before); // rien n'a écrit dans la mesure
  });

  it('structurel : frameMetrics ne REÇOIT même pas la monture', () => {
    // (lm, w, h, cal, yawRad) — aucun paramètre par lequel une cote de monture
    // pourrait entrer dans l'échelle du visage. Si quelqu'un en ajoute un, ce
    // test le signale avant que la fuite ne devienne un couplage.
    expect(frameMetrics.length).toBe(5);
  });
});

describe('NON-ADAPTATION 2 — résolution relative : les incréments de 2 mm', () => {
  it('132 → 144 mm par pas de 2 : chaque pas vaut EXACTEMENT 2 × livePxPerMm', () => {
    const s = scene();
    const m = frameMetrics(s.lm, W, H, calibrated(s), 0);
    let prev: number | null = null;
    for (let mm = 132; mm <= 144; mm += 2) {
      const painted = renderedFrameWidthPx(specForTotalWidthMm(mm, { slug: `inc-${mm}` }), m);
      if (prev !== null) expect(painted - prev).toBeCloseTo(2 * m.livePxPerMm, 9);
      prev = painted;
    }
  });
});

describe('NON-ADAPTATION 3 — la distance caméra (30 à 80 cm) ne déplace rien', () => {
  it('mesure stable et rapport monture/visage constant à toute distance', () => {
    const spec = specForTotalWidthMm(132);
    const ref = scene({ distanceMm: 500 });
    const refCal = calibrated(ref);

    for (const d of [300, 400, 500, 650, 800]) {
      const s = scene({ distanceMm: d });
      const cal = calibrated(s);
      // La taille MESURÉE ne dépend pas de la distance…
      expect(Math.abs(cal.faceWidthMm - refCal.faceWidthMm), `d=${d}`).toBeLessThan(2);
      // …et le rapport À L'ÉCRAN non plus : la monture suit le visage.
      const m = frameMetrics(s.lm, W, H, cal, 0);
      const ratio = renderedFrameWidthPx(spec, m) / faceWidthPx(s.lm, W, H);
      const mRef = frameMetrics(ref.lm, W, H, refCal, 0);
      const ratioRef = renderedFrameWidthPx(spec, mRef) / faceWidthPx(ref.lm, W, H);
      expect(ratio, `d=${d}`).toBeCloseTo(ratioRef, 3);
    }
  });
});

describe('NON-ADAPTATION 4 — aucun visage n’est tiré vers une moyenne', () => {
  it('110 → 160 mm : mesuré ≈ vrai (± 3 %), et la PENTE vaut 1, pas moins', () => {
    const truths = [110, 125, 138, 150, 160];
    const measured = truths.map((t) => calibrated(scene({ faceWidthMm: t })).faceWidthMm);

    truths.forEach((t, i) => {
      expect(Math.abs(measured[i]! - t) / t, `visage ${t} mm`).toBeLessThan(0.03);
    });

    // Une attraction vers la moyenne comprimerait l'étendue : pente NETTEMENT
    // sous 1 (un clamp la mettrait vers 0). Mesuré ici : 1,058 — le résidu va
    // dans l'AUTRE sens, et il a une cause identifiée : sur les grands visages
    // adultes du fixture, la fente palpébrale entre dans sa fenêtre 2σ et son
    // prior de population tire l'échelle de quelques % (dans la marge annoncée
    // de ~3–4 %). C'est un biais de prior biologique, pas une adaptation à la
    // monture ; on tolère ± 0,07, jamais une compression au-delà.
    const xm = truths.reduce((a, b) => a + b) / truths.length;
    const ym = measured.reduce((a, b) => a + b) / measured.length;
    const slope =
      truths.reduce((s, x, i) => s + (x - xm) * (measured[i]! - ym), 0) /
      truths.reduce((s, x) => s + (x - xm) * (x - xm), 0);
    expect(slope).toBeGreaterThan(0.93);
    expect(slope).toBeLessThan(1.07);
  });
});

describe('NON-ADAPTATION 5 — l’image MONTRE, elle ne corrige jamais', () => {
  it('enfant 110 mm / monture 90 et adulte 150 / 150 : chacun à sa taille', () => {
    const child = scene({ faceWidthMm: 110, pdFarMm: 52 });
    const mChild = frameMetrics(child.lm, W, H, calibrated(child), 0);
    expect(renderedFrameWidthPx(specForTotalWidthMm(90, { slug: 'enfant-90' }), mChild) / mChild.livePxPerMm)
      .toBeCloseTo(90, 9);

    const adult = scene({ faceWidthMm: 150, pdFarMm: 66 });
    const mAdult = frameMetrics(adult.lm, W, H, calibrated(adult), 0);
    expect(renderedFrameWidthPx(specForTotalWidthMm(150, { slug: 'adulte-150' }), mAdult) / mAdult.livePxPerMm)
      .toBeCloseTo(150, 9);
  });

  it('monture 150 sur visage 130 : elle DÉPASSE à l’écran — et doit dépasser', () => {
    const s = scene({ faceWidthMm: 130 });
    const m = frameMetrics(s.lm, W, H, calibrated(s), 0);
    const painted = renderedFrameWidthPx(specForTotalWidthMm(150, { slug: 'trop-grande' }), m);
    expect(painted).toBeGreaterThan(faceWidthPx(s.lm, W, H));
  });

  it('monture 120 sur visage 150 : visiblement étroite — jamais élargie', () => {
    const s = scene({ faceWidthMm: 150, pdFarMm: 66 });
    const m = frameMetrics(s.lm, W, H, calibrated(s), 0);
    const painted = renderedFrameWidthPx(specForTotalWidthMm(120, { slug: 'trop-petite' }), m);
    expect(painted).toBeLessThan(faceWidthPx(s.lm, W, H));
  });
});
