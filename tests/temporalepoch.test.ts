/**
 * tests/temporalepoch.test.ts — ré-audit A7 (point 33 en PREMIÈRE passe) : la
 * frontale de l'écart temporal porte l'échelle de SA propre frame, mesurée AU
 * MOMENT de la capture — y compris pendant la calibration initiale, quand
 * aucune calibration n'existe encore.
 *
 * L'API rend le bug d'origine INEXPRIMABLE : `assembleTemporal` lit l'échelle
 * DANS la scène (`frameScalePxPerMm`), et une scène ne se construit qu'avec
 * elle. « Photo à 40 cm, échelle médiane de la tentative à 55 cm » ne peut
 * plus être écrit.
 */

import { describe, expect, it } from 'vitest';

import { AUTO_ASSUMED_HFOV_DEG, EYEPLANE_TO_TEMPLE_DEPTH_MM } from '../src/core/autoCalibrate.js';
import { IRIS_DISCREPANCY_MAX } from '../src/core/autoTuning.js';
import { frameMetrics } from '../src/core/faceMetrics.js';
import type { NormalizedLandmark } from '../src/core/geom.js';
import { HVID_MEAN_MM } from '../src/core/ocularScale.js';
import { renderPoseScale } from '../src/core/renderPose.js';
import type { ImageBuffer } from '../src/core/silhouette.js';
import { TemporalCapture, temporalFrameScaleOf } from '../src/ui/temporalCapture.js';
import { H, W, makeFace } from './fixtures/landmarks.js';

function faceAt(distanceMm: number): NormalizedLandmark[] {
  const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
  const mmPerPxEye = distanceMm / focalPx;
  return makeFace({
    faceWidthPx: (138 * focalPx) / (distanceMm + EYEPLANE_TO_TEMPLE_DEPTH_MM),
    pdPx: 62 / mmPerPxEye,
    hvidPx: HVID_MEAN_MM / mmPerPxEye,
  });
}

const buf = (): ImageBuffer => ({ data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 });

describe('A7 — temporalFrameScaleOf : l’échelle de LA frame, au moment de la capture', () => {
  it('SANS calibration (première passe) : l’échelle de POSE de la frame, pas null', () => {
    const lm = faceAt(400);
    const s = temporalFrameScaleOf(lm, W, H, null, 0, null, 0);
    expect(s).not.toBeNull();
    const rp = renderPoseScale(lm, W, H, IRIS_DISCREPANCY_MAX, null, 0)!;
    expect(s!.templePlanePxPerMm).toBeCloseTo(rp.templePlanePxPerMm, 10); // même optique que l'aperçu
    expect(s!.distanceMm).toBeCloseTo(rp.distanceMm, 6);
  });

  it('AVEC calibration : l’échelle calibrée de la frame (frameMetrics)', () => {
    const lm = faceAt(500);
    const cal = { faceWidthMm: 138, source: 'auto' as const, relError: 0.05, measuredAt: 0 };
    const s = temporalFrameScaleOf(lm, W, H, cal, 0, null, 0);
    expect(s!.templePlanePxPerMm).toBeCloseTo(frameMetrics(lm, W, H, cal, 0).livePxPerMm, 10);
  });

  it('frame sans iris exploitable : null — la capture sera écartée, rien d’inventé', () => {
    const lm = makeFace({ faceWidthPx: 400, pdPx: 120, hvidPx: 1 }); // sous le plancher
    expect(temporalFrameScaleOf(lm, W, H, null, 0, null, 0)).toBeNull();
  });
});

describe('A7 — TemporalCapture : la scène porte l’échelle de SA frontale', () => {
  it('🔴 frontale à 400 mm, profils montrés plus loin : la scène garde l’échelle des 400 mm', () => {
    const c = new TemporalCapture();
    c.reset(1);
    const near = faceAt(400);
    const nearScale = temporalFrameScaleOf(near, W, H, null, 0, null, 0)!;
    c.offer(near, 0, W, H, 1, buf, nearScale); // frontale capturée À 400 mm

    // La personne recule à 550 mm et montre ses profils : d'autres époques.
    const farLeft = temporalFrameScaleOf(faceAt(550), W, H, null, -0.3, null, 0);
    c.offer(faceAt(550), -0.3, W, H, 1, buf, farLeft);
    c.offer(faceAt(550), 0.3, W, H, 1, buf, temporalFrameScaleOf(faceAt(550), W, H, null, 0.3, null, 0));

    const scene = c.scene();
    expect(scene).not.toBeNull();
    expect(scene!.frameScalePxPerMm).toBeCloseTo(nearScale.templePlanePxPerMm, 10);
    expect(scene!.distanceMmAtCapture).toBeCloseTo(nearScale.distanceMm!, 6);
    expect(scene!.capturedAtMs).toBeGreaterThan(0);
  });

  it('frontale SANS échelle fiable : capture écartée — pas de scène plutôt qu’une fausse', () => {
    const c = new TemporalCapture();
    c.reset(1);
    c.offer(faceAt(400), 0, W, H, 1, buf, null); // frame frontale, échelle refusée
    c.offer(faceAt(400), -0.3, W, H, 1, buf, null);
    c.offer(faceAt(400), 0.3, W, H, 1, buf, null);
    expect(c.scene()).toBeNull();

    // Une frame frontale AVEC échelle arrive ensuite : la capture se fait enfin.
    const s = temporalFrameScaleOf(faceAt(400), W, H, null, 0, null, 0)!;
    c.offer(faceAt(400), 0, W, H, 1, buf, s);
    expect(c.scene()).not.toBeNull();
  });

  it('changement de génération : la frontale (et son échelle) est PURGÉE (c20–21)', () => {
    const c = new TemporalCapture();
    c.reset(1);
    const s = temporalFrameScaleOf(faceAt(400), W, H, null, 0, null, 0)!;
    c.offer(faceAt(400), 0, W, H, 1, buf, s);
    c.offer(faceAt(400), 0.3, W, H, 2, buf, null); // tentative suivante
    expect(c.generation).toBe(2);
    expect(c.scene()).toBeNull(); // rien de la tentative 1 ne survit
  });
});
