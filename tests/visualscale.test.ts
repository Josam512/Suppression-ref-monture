/**
 * tests/visualscale.test.ts — l'échelle VISUELLE de secours (⚖️ arbitrage
 * 2026-08-23, 🔴 corrigé au ré-audit humain du soir).
 *
 * La loi : pxPerMm = largeur du visage en px ÷ RÉFÉRENCE DE SESSION en mm.
 * La référence est FIGÉE (première monture affichée) et ne change JAMAIS avec
 * la monture essayée : à travers une référence unique, une monture de 150 mm
 * reste 25 % plus large qu'une 120 mm. La première version divisait par la
 * monture EN COURS — petite zoomée, grande réduite, toutes « couvraient » le
 * visage : l'adaptation cosmétique que le projet interdit (§1 bug #1).
 */

import { describe, expect, it } from 'vitest';
import { estimateVisualScale } from '../src/ui/visualScale.js';
import { FACE_L, FACE_R } from '../src/core/faceMetrics.js';

const W = 1000;
const H = 800;

function face(widthNorm: number): Array<{ x: number; y: number }> {
  const lm: Array<{ x: number; y: number }> = [];
  lm[FACE_L] = { x: 0.5 - widthNorm / 2, y: 0.5 };
  lm[FACE_R] = { x: 0.5 + widthNorm / 2, y: 0.5 };
  return lm;
}

describe('échelle visuelle de secours — une référence de SESSION, jamais la monture en cours', () => {
  it('🔴 INVARIANT (ré-audit) : à travers la MÊME échelle, chaque monture garde sa taille relative', () => {
    // Visage de 300 px, référence de session 132 mm → 300/132 px/mm, pour
    // TOUTES les montures. Dessinées à cette échelle unique :
    const scale = estimateVisualScale(face(0.3), W, H, 132)!;
    const drawnPetite = scale * 120; // largeur rendue d'une 120 mm, en px
    const drawnGrande = scale * 150; // largeur rendue d'une 150 mm, en px
    // La 150 mm reste EXACTEMENT 25 % plus large que la 120 mm — le fallback
    // n'est pas métrique, mais il ne MENT pas sur le rapport entre montures.
    expect(drawnGrande / drawnPetite).toBeCloseTo(150 / 120, 9);
    // Et les deux ne « couvrent » PAS toutes le visage de 300 px :
    expect(drawnPetite).toBeLessThan(300);
    expect(drawnGrande).toBeGreaterThan(300 * (150 / 132) - 1e-9);
  });

  it('l’échelle SUIT la distance : visage 2× plus large en px → échelle 2×, même référence', () => {
    expect(estimateVisualScale(face(0.3), W, H, 132)).toBeCloseTo(300 / 132, 6);
    expect(estimateVisualScale(face(0.6), W, H, 132)).toBeCloseTo(600 / 132, 6);
  });

  it('aucune constante anatomique : la référence vient d’une cote RÉELLE de monture (spec.json)', () => {
    // Deux références différentes = deux sessions différentes ; dans CHAQUE
    // session le rapport entre montures rendues reste le rapport réel.
    for (const ref of [110, 132, 150]) {
      const s = estimateVisualScale(face(0.3), W, H, ref)!;
      expect((s * 150) / (s * 120)).toBeCloseTo(150 / 120, 9);
    }
  });

  it('entrées dégénérées → null, jamais NaN ni exception', () => {
    expect(estimateVisualScale([], W, H, 132)).toBeNull(); // repères absents
    expect(estimateVisualScale(face(0), W, H, 132)).toBeNull(); // largeur nulle
    expect(estimateVisualScale(face(0.3), W, H, 0)).toBeNull(); // référence nulle
    expect(estimateVisualScale(face(0.3), W, H, Number.NaN)).toBeNull();
  });
});
