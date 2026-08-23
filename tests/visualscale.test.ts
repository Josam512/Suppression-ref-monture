/**
 * tests/visualscale.test.ts — l'échelle VISUELLE de secours (⚖️ arbitrage
 * 2026-08-23, « VTO autonome »).
 *
 * La loi : pxPerMm = largeur du visage en px ÷ largeur totale de la MONTURE en
 * mm — la monture choisie couvre le visage. Aucun gate (PD, anatomie, qualité
 * d'iris) n'a le droit d'entrer ici ; la seule cote en mm est celle de la
 * monture, mesurée au réglet.
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

describe('échelle visuelle de secours — plausible, jamais métrologique', () => {
  it('la monture choisie COUVRE la largeur du visage, et l’échelle SUIT la distance', () => {
    // Visage de 300 px, monture de 132 mm → 300/132 px/mm : dessinée à cette
    // échelle, la monture fait exactement la largeur du visage à l'écran.
    expect(estimateVisualScale(face(0.3), W, H, 132)).toBeCloseTo(300 / 132, 6);
    // Le client s'approche (visage 2× plus large en px) → l'échelle double :
    // le RAPPORT monture/visage reste constant, comme une échelle réelle.
    expect(estimateVisualScale(face(0.6), W, H, 132)).toBeCloseTo(600 / 132, 6);
  });

  it('aucune constante anatomique : seule la cote de la MONTURE entre en mm', () => {
    const petite = estimateVisualScale(face(0.3), W, H, 110)!;
    const grande = estimateVisualScale(face(0.3), W, H, 150)!;
    // Même visage : l'échelle ne dépend que de la monture choisie — une petite
    // monture est dessinée plus « zoomée » pour couvrir le même visage.
    expect(petite / grande).toBeCloseTo(150 / 110, 6);
  });

  it('entrées dégénérées → null, jamais NaN ni exception', () => {
    expect(estimateVisualScale([], W, H, 132)).toBeNull(); // repères absents
    expect(estimateVisualScale(face(0), W, H, 132)).toBeNull(); // largeur nulle
    expect(estimateVisualScale(face(0.3), W, H, 0)).toBeNull(); // cote nulle
    expect(estimateVisualScale(face(0.3), W, H, Number.NaN)).toBeNull();
  });
});
