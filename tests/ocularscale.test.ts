/**
 * tests/ocularscale.test.ts — l'échelle périoculaire, et ses garde-fous.
 *
 * Le point verrouillé ici est l'ANTI-BIAIS ENFANT : la fente palpébrale
 * n'atteint sa taille adulte que vers 8–11 ans. L'imposer à un enfant tirerait
 * l'échelle vers le haut — précisément le « présupposé de taille » que le
 * §0.0.3 interdit. Elle est donc GATÉE : hors plage adulte, elle est écartée
 * et l'estimateur retombe sur les iris seuls, plus large mais jamais biaisé.
 */

import { describe, expect, it } from 'vitest';

import {
  eyePlaneScale,
  ocularPixelsOf,
  HVID_MEAN_MM,
  HVID_ONLY_REL_ERROR,
  OCULAR_PRIOR_REL_ERROR,
} from '../src/core/ocularScale.js';
import { PALPEBRAL_FISSURE } from '../src/core/ocularPrior.js';
import { H, W, makeFace } from './fixtures/landmarks.js';

/** Un jeu de pixels où tout colle au prior adulte, à l'échelle `mmPerPx`. */
function adult(mmPerPx: number) {
  return {
    hvidLeftPx: HVID_MEAN_MM / mmPerPx,
    hvidRightPx: HVID_MEAN_MM / mmPerPx,
    pflLeftPx: PALPEBRAL_FISSURE.meanMm / mmPerPx,
    pflRightPx: PALPEBRAL_FISSURE.meanMm / mmPerPx,
  };
}

describe('l’échelle périoculaire', () => {
  it('sur un adulte conforme au prior, l’échelle est exacte et la fente participe', () => {
    const out = eyePlaneScale(adult(0.45));
    expect(out).not.toBeNull();
    expect(out!.mmPerPx).toBeCloseTo(0.45, 3);
    expect(out!.pflUsed).toBe(true);
    expect(out!.relError).toBeCloseTo(OCULAR_PRIOR_REL_ERROR, 6);
  });

  it('la fusion à 4 traits est plus INFORMATIVE que les iris seuls — un peu', () => {
    expect(OCULAR_PRIOR_REL_ERROR).toBeLessThan(HVID_ONLY_REL_ERROR);
    // …mais aucune des deux bornes ne prétend mieux que ~3 % : c'est le prior.
    expect(OCULAR_PRIOR_REL_ERROR).toBeGreaterThan(0.025);
  });

  it('GARDE-FOU ENFANT : une fente 20 % plus courte est écartée, PAS imposée', () => {
    const p = adult(0.45);
    const child = { ...p, pflLeftPx: p.pflLeftPx * 0.8, pflRightPx: p.pflRightPx * 0.8 };
    const out = eyePlaneScale(child);
    expect(out).not.toBeNull();
    expect(out!.pflUsed).toBe(false);
    // Iris égaux au prior → l'échelle DOIT être exactement celle des iris,
    // non tirée vers le haut par la fente adulte manquante.
    expect(out!.mmPerPx).toBeCloseTo(0.45, 3);
    expect(out!.relError).toBeCloseTo(HVID_ONLY_REL_ERROR, 6);
  });

  it('un œil fermé (iris illisible) ne rend rien, jamais une valeur par défaut', () => {
    expect(eyePlaneScale({ ...adult(0.45), hvidLeftPx: 0 })).toBeNull();
  });

  it('INVARIANT : moitié moins de pixels → échelle exactement doublée', () => {
    const near = eyePlaneScale(adult(0.3))!;
    const far = eyePlaneScale({
      hvidLeftPx: adult(0.3).hvidLeftPx / 2,
      hvidRightPx: adult(0.3).hvidRightPx / 2,
      pflLeftPx: adult(0.3).pflLeftPx / 2,
      pflRightPx: adult(0.3).pflRightPx / 2,
    })!;
    expect(far.mmPerPx).toBeCloseTo(near.mmPerPx * 2, 6);
  });

  it('les pixels lus sur le fixture sont ceux des landmarks d’iris', () => {
    const lm = makeFace({ faceWidthPx: 400, pdPx: 176, hvidPx: 33 });
    const p = ocularPixelsOf(lm, W, H);
    expect(p.hvidLeftPx).toBeCloseTo(33, 1);
    expect(p.hvidRightPx).toBeCloseTo(33, 1);
  });
});
