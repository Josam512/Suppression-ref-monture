/**
 * tests/autogates.test.ts — garde-fous de la calibration automatique.
 */

import { describe, expect, it } from 'vitest';

import {
  AutoCalibrationEngine,
  AUTO_TIMEOUT_MS,
  IRIS_DISCREPANCY_MAX,
  MAX_AUTO_ROLL_RAD,
  MAX_AUTO_YAW_RAD,
  MIN_AUTO_FRAMES,
} from '../src/core/autoCalibration.js';
import {
  IRIS_ABSOLUTE_FLOOR_PX,
  IRIS_DISCREPANCY_MARGIN,
  irisDiscrepancyMax,
  irisQualityOf,
} from '../src/core/irisQuality.js';
import { provisionalScale } from '../src/core/provisionalScale.js';
import { HVID_MEAN_MM } from '../src/core/ocularScale.js';
import { AUTO_ASSUMED_HFOV_DEG, EYEPLANE_TO_TEMPLE_DEPTH_MM } from '../src/core/autoCalibrate.js';
import { H, W, makeFace } from './fixtures/landmarks.js';

function validFace(distanceMm = 500) {
  const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
  const mmPerPxEye = distanceMm / focalPx;
  return makeFace({
    faceWidthPx: (138 * focalPx) / (distanceMm + EYEPLANE_TO_TEMPLE_DEPTH_MM),
    pdPx: 62 / mmPerPxEye,
    hvidPx: HVID_MEAN_MM / mmPerPxEye,
  });
}

function film(e: AutoCalibrationEngine, n: number, t0: number, yaw = 0, roll = 0): number {
  const lm = validFace();
  for (let i = 0; i < n; i++) e.offer(lm, yaw, roll, W, H, t0 + i * 33);
  return t0 + n * 33;
}

describe('audit 1 — le chrono de convergence ne part QU’À la première frame utile', () => {
  it('une longue absence avant la première frame utile ne consomme pas le délai', () => {
    const e = new AutoCalibrationEngine();
    for (let i = 0; i * 500 <= 60_000; i++) e.offer(null, 0, 0, W, H, i * 500);
    expect(e.status().elapsedMs).toBe(0);
    film(e, 80, 61_000);
    expect(e.state).toBe('calibrated');
    expect(e.measures()!.degraded).toBe(false);
  });

  it('les deux horloges sont distinctes : acquisition ≠ convergence', () => {
    const e = new AutoCalibrationEngine();
    const lm = validFace();
    for (let i = 0; i < 150; i++) e.offer(lm, MAX_AUTO_YAW_RAD * 2, 0, W, H, i * 33);
    const s = e.status();
    expect(s.acquisitionMs).toBeGreaterThan(4000);
    expect(s.elapsedMs).toBe(0);
  });
});

describe('audit 2 — aucun état ne condamne la séance', () => {
  it('après le délai avec trop peu de matière, `offer()` compte toujours', () => {
    const e = new AutoCalibrationEngine();
    film(e, 5, 0);
    for (let i = 0; i * 500 <= AUTO_TIMEOUT_MS + 2000; i++) e.offer(null, 0, 0, W, H, 1000 + i * 500);

    expect(e.state).toBe('collecting');
    expect(e.status().attempts).toBeGreaterThanOrEqual(1);
    expect(e.status().lastAttemptFailure).not.toBeNull();

    film(e, 80, AUTO_TIMEOUT_MS + 5000);
    expect(e.status().usableFrames).toBeGreaterThanOrEqual(MIN_AUTO_FRAMES);
    expect(e.state).toBe('calibrated');
  });

  it('une tentative ratée repart sur des échantillons FRAIS', () => {
    const e = new AutoCalibrationEngine();
    film(e, 5, 0);
    for (let i = 0; i * 500 <= AUTO_TIMEOUT_MS + 1000; i++) e.offer(null, 0, 0, W, H, 1000 + i * 500);
    // Les 5 mesures ont plus de 20 s : elles ne doivent pas être mélangées à
    // une future position/distance du client.
    expect(e.status().usableFrames).toBe(0);
    expect(e.status().elapsedMs).toBe(0);
  });

  it('un délai sans nouvelle frame utile ne boucle pas les tentatives', () => {
    const e = new AutoCalibrationEngine();
    film(e, 3, 0);
    for (let t = 1000; t <= 3 * AUTO_TIMEOUT_MS; t += 100) e.offer(null, 0, 0, W, H, t);
    // Après le premier réarmement, l'horloge attend une NOUVELLE frame utile.
    expect(e.status().attempts).toBe(1);
  });
});

describe('audit 3 — les gates sont comptés indépendamment', () => {
  it('une frame tournée ET inclinée incrémente les deux compteurs', () => {
    const e = new AutoCalibrationEngine();
    e.offer(validFace(), MAX_AUTO_YAW_RAD * 2, MAX_AUTO_ROLL_RAD * 2, W, H, 0);
    const r = e.status().rejected;
    expect(r['turn-to-front']).toBe(1);
    expect(r['straighten-head']).toBe(1);
  });

  it('la consigne affichée reste unique', () => {
    const e = new AutoCalibrationEngine();
    e.offer(validFace(), MAX_AUTO_YAW_RAD * 2, MAX_AUTO_ROLL_RAD * 2, W, H, 0);
    expect(e.status().primaryRejectReason).toBe('turn-to-front');
  });

  it('une frame acceptée ne rejette rien', () => {
    const e = new AutoCalibrationEngine();
    e.offer(validFace(), 0, 0, W, H, 0);
    const r = e.status().rejected;
    expect(r['no-face'] + r['eyes-too-small'] + r['turn-to-front'] + r['straighten-head']).toBe(0);
    expect(e.status().primaryRejectReason).toBeNull();
  });
});

describe('audit 3 bis — le gate iris juge la qualité, plus la taille', () => {
  it('un iris de 6,8 px parfaitement stable est accepté', () => {
    expect(irisQualityOf(6.8, 6.8, IRIS_DISCREPANCY_MAX).ok).toBe(true);
  });

  it('un iris aberrant est refusé, même gros', () => {
    const q = irisQualityOf(20, 12, IRIS_DISCREPANCY_MAX);
    expect(q.ok).toBe(false);
    expect(q.reason).toBe('iris-aberrant');
  });

  it('le pourcentage est bien relatif à la MOYENNE, pas à la somme', () => {
    const q = irisQualityOf(11, 10, 1);
    expect(q.discrepancy).toBeCloseTo(1 / 10.5, 12);
  });

  it('sous le plancher de quantification, la largeur n’a plus de signe', () => {
    const q = irisQualityOf(IRIS_ABSOLUTE_FLOOR_PX - 0.5, IRIS_ABSOLUTE_FLOOR_PX - 0.5, IRIS_DISCREPANCY_MAX);
    expect(q.ok).toBe(false);
    expect(q.reason).toBe('quantification');
  });

  it('le seuil d’aberration reste dérivé du gate frontal', () => {
    expect(IRIS_DISCREPANCY_MAX).toBeCloseTo(irisDiscrepancyMax(MAX_AUTO_YAW_RAD), 12);
    expect(IRIS_DISCREPANCY_MAX / (1 - Math.cos(MAX_AUTO_YAW_RAD))).toBeCloseTo(IRIS_DISCREPANCY_MARGIN, 9);
  });

  it('un iris sous l’ancien plancher de 8 px permet toujours de calibrer', () => {
    const e = new AutoCalibrationEngine();
    const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
    const distanceMm = 1400;
    const mmPerPxEye = distanceMm / focalPx;
    const hvidPx = HVID_MEAN_MM / mmPerPxEye;
    expect(hvidPx).toBeLessThan(8);
    expect(hvidPx).toBeGreaterThan(IRIS_ABSOLUTE_FLOOR_PX);
    const lm = makeFace({
      faceWidthPx: (138 * focalPx) / (distanceMm + EYEPLANE_TO_TEMPLE_DEPTH_MM),
      pdPx: 62 / mmPerPxEye,
      hvidPx,
    });
    for (let i = 0; i < 80; i++) e.offer(lm, 0, 0, W, H, i * 33);
    expect(e.state).toBe('calibrated');
    expect(e.measures()!.usableFrames).toBeGreaterThanOrEqual(MIN_AUTO_FRAMES);
  });
});

describe('audit 4 — tracking ≠ métrologie', () => {
  it('une seule frame suffit à poser l’image', () => {
    const p = provisionalScale(validFace(500), W, H, IRIS_DISCREPANCY_MAX, 0);
    expect(p).not.toBeNull();
    expect(p!.cal.faceWidthMm).toBeGreaterThan(120);
    expect(p!.cal.faceWidthMm).toBeLessThan(155);
    expect(p!.cal.relError).toBeGreaterThan(0);
  });

  it('elle refuse quand les iris ne sont pas exploitables', () => {
    const aberrant = makeFace({ faceWidthPx: 400, pdPx: 120, hvidPx: 1 });
    expect(provisionalScale(aberrant, W, H, IRIS_DISCREPANCY_MAX, 0)).toBeNull();
  });

  it('l’aperçu ne saute plus avec la distance', () => {
    const near = provisionalScale(validFace(400), W, H, IRIS_DISCREPANCY_MAX, 0)!;
    const far = provisionalScale(validFace(700), W, H, IRIS_DISCREPANCY_MAX, 0)!;
    const drift = Math.abs(far.cal.faceWidthMm - near.cal.faceWidthMm) / far.cal.faceWidthMm;
    expect(drift).toBeLessThan(0.005);
    expect(near.cal.faceWidthMm).toBeCloseTo(138, 0);
    expect(far.cal.faceWidthMm).toBeCloseTo(138, 0);
  });
});
