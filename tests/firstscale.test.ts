/**
 * tests/firstscale.test.ts — ré-audit A6 : des iris refusés DEPUIS LE DÉBUT ne
 * produisent plus un canvas muet. Le refus d'échelle de pose est DIAGNOSTIQUÉ
 * (cause nommée, valeurs de la frame), et l'attente de première échelle est
 * bornée dans le temps puis EXPLIQUÉE à l'écran — sans jamais fabriquer une
 * valeur métrologique (aucune pose à constante de taille : §0.0.3).
 */

import { describe, expect, it } from 'vitest';

import { IRIS_DISCREPANCY_MAX } from '../src/core/autoCalibration.js';
import { AUTO_ASSUMED_HFOV_DEG, EYEPLANE_TO_TEMPLE_DEPTH_MM } from '../src/core/autoCalibrate.js';
import { HVID_MEAN_MM } from '../src/core/ocularScale.js';
import { renderPoseScale, renderPoseScaleDiagnosed } from '../src/core/renderPose.js';
import { firstScaleWaitHint, WAITING_FIRST_SCALE_EXPLAIN_MS } from '../src/ui/renderScene.js';
import { H, W, makeFace } from './fixtures/landmarks.js';
import type { NormalizedLandmark } from '../src/core/geom.js';

function validFace(distanceMm = 500): NormalizedLandmark[] {
  const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
  const mmPerPxEye = distanceMm / focalPx;
  return makeFace({
    faceWidthPx: (138 * focalPx) / (distanceMm + EYEPLANE_TO_TEMPLE_DEPTH_MM),
    pdPx: 62 / mmPerPxEye,
    hvidPx: HVID_MEAN_MM / mmPerPxEye,
  });
}

/** Rétrécit l'iris GAUCHE (indices 474/476) — reflet, mèche, verre correcteur. */
function shrinkLeftIris(lm: NormalizedLandmark[], ratio: number): NormalizedLandmark[] {
  const a = lm[474]!;
  const b = lm[476]!;
  const cx = (a.x + b.x) / 2;
  lm[474] = { ...a, x: cx + (a.x - cx) * ratio };
  lm[476] = { ...b, x: cx + (b.x - cx) * ratio };
  return lm;
}

describe('A6 — le refus d’échelle de pose est DIAGNOSTIQUÉ, jamais muet', () => {
  it('frame saine : échelle rendue, aucun refus', () => {
    const d = renderPoseScaleDiagnosed(validFace(), W, H, IRIS_DISCREPANCY_MAX, null, 0);
    expect(d.scale).not.toBeNull();
    expect(d.refusal).toBeNull();
  });

  it('iris incohérents entre les deux yeux → cause « iris-aberrant », valeurs de la frame', () => {
    const lm = shrinkLeftIris(validFace(), 0.7);
    const d = renderPoseScaleDiagnosed(lm, W, H, IRIS_DISCREPANCY_MAX, null, 0);
    expect(d.scale).toBeNull();
    expect(d.refusal?.code).toBe('iris-aberrant');
    expect(d.refusal?.detail).toMatch(/écart/);
    expect(d.refusal?.detail).toMatch(/lunettes/i); // le conseil actionnable est dans la phrase
  });

  it('iris sous le plancher de quantification → cause dédiée, tailles en pixels', () => {
    const lm = makeFace({ faceWidthPx: 400, pdPx: 120, hvidPx: 1 });
    const d = renderPoseScaleDiagnosed(lm, W, H, IRIS_DISCREPANCY_MAX, null, 0);
    expect(d.scale).toBeNull();
    expect(d.refusal?.code).toBe('iris-quantification');
    expect(d.refusal?.detail).toMatch(/px/);
  });

  it('renderPoseScale (vue simple) reste STRICTEMENT la vue .scale du diagnostic', () => {
    for (const lm of [validFace(), shrinkLeftIris(validFace(), 0.7)]) {
      const simple = renderPoseScale(lm, W, H, IRIS_DISCREPANCY_MAX, null, 0);
      const full = renderPoseScaleDiagnosed(lm, W, H, IRIS_DISCREPANCY_MAX, null, 0);
      expect(simple === null).toBe(full.scale === null);
      if (simple !== null) expect(simple.templePlanePxPerMm).toBe(full.scale!.templePlanePxPerMm);
    }
  });
});

describe('A6 — l’attente de première échelle est bornée puis EXPLIQUÉE', () => {
  it('une frame refusée isolée n’est pas un état : rien avant le seuil', () => {
    expect(firstScaleWaitHint(1000, 'iris incohérents', 1000 + WAITING_FIRST_SCALE_EXPLAIN_MS - 1)).toBeNull();
    expect(firstScaleWaitHint(null, null, 99_999)).toBeNull();
  });

  it('au-delà du seuil : durée + cause + « le suivi fonctionne » — jamais un écran qui se tait', () => {
    const hint = firstScaleWaitHint(0, 'iris incohérents entre les deux yeux (écart 18 %)', 10_000);
    expect(hint).toMatch(/10 s/);
    expect(hint).toMatch(/iris incohérents/);
    expect(hint).toMatch(/suivi du visage fonctionne/);
  });

  it('cause inconnue : le message reste honnête, sans valeur inventée', () => {
    const hint = firstScaleWaitHint(0, null, 5_000);
    expect(hint).toMatch(/aucune échelle de pose exploitable/);
    expect(hint).not.toMatch(/\d+ mm/); // aucun millimètre fabriqué
  });
});
