/**
 * tests/scenescale.test.ts — la décision d'échelle du rendu, branche par
 * branche (refonte « VTO autonome », ⚖️ arbitrage 2026-08-23).
 *
 * La garantie centrale : AUCUNE branche sans calibration n'exige la
 * métrologie — iris refusés ⇒ échelle VISUELLE de secours, la monture
 * apparaît quand même. Le rendu n'est jamais l'otage de la mesure.
 */

import { describe, expect, it } from 'vitest';
import { resolveSceneScale } from '../src/ui/sceneScale.js';
import { FACE_L, FACE_R, IRIS_L_INNER, IRIS_L_OUTER, IRIS_R_INNER, IRIS_R_OUTER } from '../src/core/faceMetrics.js';

const W = 1280;
const H = 720;

/** 478 repères pleins, visage de `faceNorm` de large, iris de `irisPx` px. */
function face(faceNorm: number, irisPx: number): Array<{ x: number; y: number; z?: number }> {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  lm[FACE_L] = { x: 0.5 - faceNorm / 2, y: 0.5 };
  lm[FACE_R] = { x: 0.5 + faceNorm / 2, y: 0.5 };
  const iw = irisPx / W; // largeur d'iris voulue, en normalisé
  lm[IRIS_L_OUTER] = { x: 0.4 - iw / 2, y: 0.45 };
  lm[IRIS_L_INNER] = { x: 0.4 + iw / 2, y: 0.45 };
  lm[IRIS_R_OUTER] = { x: 0.6 - iw / 2, y: 0.45 };
  lm[IRIS_R_INNER] = { x: 0.6 + iw / 2, y: 0.45 };
  return lm;
}

describe('resolveSceneScale — le rendu n’est jamais l’otage de la métrologie', () => {
  it('calibration présente → échelle MÉTRIQUE, aucun repli', () => {
    const cal = { faceWidthMm: 138, source: 'card' as const, relError: 0.025, measuredAt: 0 };
    const d = resolveSceneScale(cal, face(0.3, 14), W, H, 0, null, 132, 0);
    // livePxPerMm = largeur visage px ÷ largeur visage mm (chaîne des échelles).
    expect(d.scale).toBeCloseTo((0.3 * W) / 138, 6);
    expect(d.visualFallbackReason).toBeNull();
  });

  it('iris exploitables → échelle de POSE provisoire (mémorisée pour le saut)', () => {
    const d = resolveSceneScale(null, face(0.3, 14), W, H, 0, null, 132, 0);
    expect(d.scale).not.toBeNull();
    expect(d.scale).toBeGreaterThan(0);
    expect(d.visualFallbackReason).toBeNull();
    expect(d.provisionalPxPerMm).toBe(d.scale);
  });

  it('🔴 iris REFUSÉS (quantification) → échelle VISUELLE : la monture apparaît QUAND MÊME', () => {
    // Iris de 2 px < plancher de 3 px : l'échelle de pose refuse — et avant
    // l'arbitrage, l'écran restait SANS monture. Plus maintenant. Le 132 est
    // la RÉFÉRENCE DE SESSION (figée par renderScene), pas la monture en cours.
    const d = resolveSceneScale(null, face(0.3, 2), W, H, 0, null, 132, 0);
    expect(d.scale).toBeCloseTo((0.3 * W) / 132, 6);
    expect(d.visualFallbackReason).not.toBeNull(); // …et la cause du repli est DITE
    expect(d.refusalDetail).toMatch(/iris/i);
  });

  it('🔴 INVARIANT (ré-audit 2026-08-23) : l’échelle visuelle ne dépend PAS de la monture essayée', () => {
    // La référence de session est FIGÉE : changer de monture ne change pas la
    // décision d'échelle. Rendues à travers la MÊME échelle, une 150 mm reste
    // 25 % plus large qu'une 120 mm — le fallback ne les « adapte » jamais.
    const ref = 132;
    const d = resolveSceneScale(null, face(0.3, 2), W, H, 0, null, ref, 0);
    expect(d.scale).not.toBeNull();
    const drawn = (frameWidthMm: number) => d.scale! * frameWidthMm;
    expect(drawn(150) / drawn(120)).toBeCloseTo(150 / 120, 9);
  });

  it('le repli visuel SUIT la distance : visage 2× plus proche → échelle 2×', () => {
    const loin = resolveSceneScale(null, face(0.2, 2), W, H, 0, null, 132, 0);
    const pres = resolveSceneScale(null, face(0.4, 2), W, H, 0, null, 132, 0);
    expect(pres.scale! / loin.scale!).toBeCloseTo(2, 6);
  });

  it('repères de largeur dégénérés → null (le SEUL cas sans rien à poser), causes dites', () => {
    const d = resolveSceneScale(null, face(0, 2), W, H, 0, null, 132, 0);
    expect(d.scale).toBeNull();
    expect(d.refusalDetail).not.toBeNull();
    expect(d.visualFallbackReason).toBeNull();
  });
});
