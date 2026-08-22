/**
 * tests/stability.test.ts — ré-audit A8/A9/A10 : la stabilité de l'échelle est
 * jugée sur la série de l'estimateur PUBLIÉ, le mode dégradé la refuse aussi,
 * et les statistiques (dispersion par frame, dérive, outliers) sont EXPLOITÉES
 * — plus jamais calculées pour rien.
 *
 * ⚠️ Leçon B2/S4 : les principes sont balayés sur des DOMAINES de séries
 * synthétiques, pas sur une fixture bien choisie ; le moteur est exercé de
 * bout en bout sur le cas emblématique (série alternée = bimodale).
 */

import { describe, expect, it } from 'vitest';

import { AutoCalibrationEngine } from '../src/core/autoCalibration.js';
import { relStandardError, seriesStats } from '../src/core/autoMeasures.js';
import {
  AUTO_TIMEOUT_MS,
  MAX_SCALE_SE_DEGRADED,
  MAX_SCALE_SPREAD_REL,
  MAX_SCALE_STANDARD_ERROR,
} from '../src/core/autoTuning.js';
import { AUTO_ASSUMED_HFOV_DEG, EYEPLANE_TO_TEMPLE_DEPTH_MM } from '../src/core/autoCalibrate.js';
import { HVID_MEAN_MM } from '../src/core/ocularScale.js';
import { pickStableEstimator, scaleSeriesStable } from '../src/core/scaleStability.js';
import { H, W, makeFace } from './fixtures/landmarks.js';

const alternating = (n: number, a: number, b: number): number[] =>
  Array.from({ length: n }, (_, i) => (i % 2 === 0 ? a : b));

/** Visage cohérent à `distanceMm`, avec un HVID éventuellement forcé. */
function faceAt(distanceMm: number, hvidScale = 1) {
  const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
  const mmPerPxEye = distanceMm / focalPx;
  return makeFace({
    faceWidthPx: (138 * focalPx) / (distanceMm + EYEPLANE_TO_TEMPLE_DEPTH_MM),
    pdPx: 62 / mmPerPxEye,
    hvidPx: (HVID_MEAN_MM / mmPerPxEye) * hvidScale,
  });
}

describe('A10 — les quatre portes de stabilité, balayées en pur', () => {
  it('🔴 une série BIMODALE passe l’erreur-type à grand n… et c’est la dispersion qui la refuse', () => {
    const bimodal = alternating(600, 1.0, 1.12);
    // La preuve du bug d'origine : l'erreur-type seule aurait conclu.
    expect(relStandardError(bimodal)).toBeLessThan(MAX_SCALE_STANDARD_ERROR);
    // La dispersion PAR FRAME, elle, ne se moyenne pas : refusée.
    expect(seriesStats(bimodal).madRel).toBeGreaterThan(MAX_SCALE_SPREAD_REL);
    expect(scaleSeriesStable(bimodal, MAX_SCALE_STANDARD_ERROR)).toBe(false);
    expect(scaleSeriesStable(bimodal, MAX_SCALE_SE_DEGRADED)).toBe(false); // le dégradé non plus
  });

  it('la DÉRIVE au-delà du plancher biologique refuse ; en deçà, elle passe', () => {
    const drifting = [...Array.from({ length: 20 }, () => 1.0), ...Array.from({ length: 20 }, () => 1.08)];
    expect(Math.abs(seriesStats(drifting).driftRel)).toBeGreaterThan(0.043);
    expect(scaleSeriesStable(drifting, MAX_SCALE_STANDARD_ERROR)).toBe(false);
    const settling = [...Array.from({ length: 20 }, () => 1.0), ...Array.from({ length: 20 }, () => 1.03)];
    expect(scaleSeriesStable(settling, MAX_SCALE_STANDARD_ERROR)).toBe(true);
  });

  it('une série CONTAMINÉE (>10 % de points à >3 MAD) est refusée', () => {
    const clean = Array.from({ length: 30 }, (_, i) => 1.0 + (i % 2 === 0 ? 0.002 : -0.002));
    const contaminated = [...clean, ...Array.from({ length: 5 }, () => 1.5)];
    expect(seriesStats(contaminated).outlierRatio).toBeGreaterThan(0.1);
    expect(scaleSeriesStable(contaminated, MAX_SCALE_STANDARD_ERROR)).toBe(false);
    expect(scaleSeriesStable(clean, MAX_SCALE_STANDARD_ERROR)).toBe(true);
  });

  it('série vide : jamais stable — rien ne se conclut sur rien', () => {
    expect(scaleSeriesStable([], MAX_SCALE_STANDARD_ERROR)).toBe(false);
  });
});

describe('A9 — la stabilité est jugée sur la série de l’estimateur PUBLIÉ', () => {
  const stable = Array.from({ length: 30 }, (_, i) => 0.5 + (i % 2 === 0 ? 0.001 : -0.001));

  it('candidat FULL stable → publié FULL, sans repli', () => {
    expect(pickStableEstimator(stable, stable, MAX_SCALE_STANDARD_ERROR)).toEqual({
      estimator: 'hvid+pfl',
      fallback: false,
    });
  });

  it('🔴 FULL instable + HVID stable → repli HVID, DIT — jamais FULL publié non jugé', () => {
    const fullUnstable = alternating(30, 0.47, 0.53);
    const pick = pickStableEstimator(stable, fullUnstable, MAX_SCALE_STANDARD_ERROR);
    expect(pick.estimator).toBe('hvid');
    expect(pick.fallback).toBe(true);
  });

  it('FULL trop courte (ratio < 0,7) → le candidat est HVID, jugé sur SA série', () => {
    const shortFull = stable.slice(0, 10);
    expect(pickStableEstimator(stable, shortFull, MAX_SCALE_STANDARD_ERROR)).toEqual({
      estimator: 'hvid',
      fallback: false,
    });
  });

  it('aucune série stable → aucun estimateur : la tentative continue ou échoue nommée', () => {
    const unstable = alternating(30, 0.47, 0.53);
    expect(pickStableEstimator(unstable, unstable, MAX_SCALE_STANDARD_ERROR).estimator).toBeNull();
  });
});

describe('A8 — le moteur, de bout en bout : degraded ≠ instable', () => {
  it('🔴 20 frames+ alternant 1,0/1,12 d’échelle → délai atteint, PAS de calibration, échec NOMMÉ', () => {
    const e = new AutoCalibrationEngine();
    const near = faceAt(500, 1.0);
    const far = faceAt(500, 1.12); // même géométrie, iris alterné : l'échelle est bimodale
    for (let i = 0; i < 700; i++) {
      e.offer(i % 2 === 0 ? near : far, 0, 0, W, H, i * 33);
    }
    expect(e.state).toBe('collecting'); // jamais calibré
    expect(e.measures()).toBeNull();
    const st = e.status();
    expect(st.attempts).toBeGreaterThanOrEqual(1);
    expect(st.lastAttemptFailure?.code).toBe('unstable-scale');
  });

  it('matière rare mais STABLE (15 frames en 20 s) → conclusion dégradée, assumée', () => {
    const e = new AutoCalibrationEngine();
    const lm = faceAt(500);
    let t = 0;
    while (t <= AUTO_TIMEOUT_MS + 1000) {
      e.offer(lm, 0, 0, W, H, t);
      t += 1300; // ~15 frames utiles au total : sous MIN_AUTO_FRAMES, sur MIN_DEGRADED
    }
    expect(e.state).toBe('calibrated');
    expect(e.measures()!.degraded).toBe(true);
    expect(['hvid', 'hvid+pfl']).toContain(e.measures()!.estimator);
  });

  it('le statut PUBLIE la stabilité de la série candidate (HUD, A10)', () => {
    const e = new AutoCalibrationEngine();
    const near = faceAt(500, 1.0);
    const far = faceAt(500, 1.12);
    for (let i = 0; i < 40; i++) e.offer(i % 2 === 0 ? near : far, 0, 0, W, H, i * 33);
    const st = e.status();
    expect(st.scaleSpreadRel).toBeGreaterThan(MAX_SCALE_SPREAD_REL); // la bimodalité est VISIBLE
    expect(['hvid', 'hvid+pfl']).toContain(st.candidateEstimator);
    expect(Number.isFinite(st.scaleDriftRel)).toBe(true);
    expect(st.scaleOutlierRatio).toBeGreaterThanOrEqual(0);
  });
});
