/**
 * tests/verdict.test.ts — la légende chiffrée.
 */

import { describe, expect, it } from 'vitest';

import {
  classify,
  decentrementUncertaintyMm,
  DECENTREMENT_THRESHOLD_MM,
  legend,
  thresholdFor,
  THRESHOLD_MAX_MM,
  THRESHOLD_MIN_MM,
  verdict,
} from '../src/core/verdict.js';

import { H, LANDMARKS_138, LANDMARKS_ROLLED, W } from './fixtures/landmarks.js';
import {
  callVerdict,
  makeCal,
  SPEC_120,
  SPEC_132,
  SPEC_138,
  SPEC_150,
  SPEC_LONG_LEVER,
} from './fixtures/builders.js';

const measured138 = () => makeCal({ temporalWidthMm: 138, temporalRelError: 0.025 });

describe('Règle 1 — le seuil est proportionnel et borné', () => {
  it('le seuil suit le visage, entre 3 et 5 mm', () => {
    expect(thresholdFor(105)).toBeCloseTo(3.15, 2);
    expect(thresholdFor(138)).toBeCloseTo(4.14, 2);
    expect(thresholdFor(145)).toBeCloseTo(4.35, 2);
  });

  it('le seuil est borné aux deux extrémités', () => {
    expect(thresholdFor(80)).toBe(THRESHOLD_MIN_MM);
    expect(thresholdFor(200)).toBe(THRESHOLD_MAX_MM);
  });

  it("un enfant n'est pas jugé deux fois plus sévèrement qu'un adulte", () => {
    expect(thresholdFor(105) / 105).toBeCloseTo(thresholdFor(145) / 145, 3);
  });
});

describe("Règle 1 bis — classify par arithmétique d'intervalle", () => {
  it('écart franc → tranché même en mode iris', () => {
    expect(classify(-18, makeCal({ source: 'iris', relError: 0.043 }))).toBe('sous-taillee');
    expect(classify(+18, makeCal({ source: 'iris', relError: 0.043 }))).toBe('surtaillee');
  });

  it('cas limite en mode iris → indéterminé', () => {
    expect(classify(-5, makeCal({ source: 'iris', relError: 0.043 }))).toBe('indetermine');
  });

  it('mesure serrée et précise → correcte', () => {
    expect(classify(0, makeCal())).toBe('correcte');
  });

  it('132 mm sur 138 mm avec une carte → indéterminé dans sa marge', () => {
    expect(classify(-6, makeCal())).toBe('indetermine');
  });
});

describe('La légende assemblée', () => {
  it('SANS écart temporal mesuré, aucun statut catégorique n’est inventé', () => {
    for (const spec of [SPEC_120, SPEC_132, SPEC_138, SPEC_150]) {
      expect(callVerdict(LANDMARKS_138, makeCal(), spec).status).toBe('indetermine');
    }
  });

  it('AVEC largeur temporal mesurée : 120 sur 138 → sous-taillée', () => {
    const v = callVerdict(LANDMARKS_138, measured138(), SPEC_120);
    expect(v.status).toBe('sous-taillee');
    expect(v.frameWidthMm).toBeCloseTo(120, 3);
    expect(v.faceWidthMm).toBeCloseTo(138, 3);
    expect(v.deltaMm).toBeCloseTo(-18, 3);
  });

  it('AVEC largeur temporal mesurée : 138 sur 138 → correcte', () => {
    expect(callVerdict(LANDMARKS_138, measured138(), SPEC_138).status).toBe('correcte');
  });

  it('AVEC largeur temporal mesurée : 150 sur 138 → surtaillée', () => {
    expect(callVerdict(LANDMARKS_138, measured138(), SPEC_150).status).toBe('surtaillee');
  });

  it('la marge est toujours transportée avec le chiffre', () => {
    const v = callVerdict(LANDMARKS_138, makeCal(), SPEC_132);
    expect(v.faceWidthUncertaintyMm).toBeCloseTo(138 * 0.025, 3);
    expect(v.thresholdMm).toBeCloseTo(4.14, 2);
    expect(legend(v)).toMatch(/Monture 132 mm · largeur visage 138 ± 3 mm/);
  });

  it('la légende ne contient aucun jugement textuel', () => {
    const texte = legend(callVerdict(LANDMARKS_138, makeCal(), SPEC_120));
    expect(texte).not.toMatch(/taill|correct|recommand|convient/i);
  });
});

describe('Règle 2 — décentrement', () => {
  it("l'incertitude est propagée jusqu'au décentrement", () => {
    const iris = decentrementUncertaintyMm(SPEC_132, makeCal({ relError: 0.043 }));
    const carte = decentrementUncertaintyMm(SPEC_132, makeCal({ relError: 0.025 }));
    expect(iris).toBeCloseTo(30 * 0.043, 3);
    expect(carte).toBeCloseTo(30 * 0.025, 3);
    expect(iris).toBeLessThan(DECENTREMENT_THRESHOLD_MM);
  });

  it('affiché quand la mesure peut trancher les 3 mm', () => {
    const v = callVerdict(LANDMARKS_138, makeCal(), SPEC_132);
    expect(v.decentrementMm).not.toBeNull();
    expect(v.decentrementMm!.left).toBeLessThan(DECENTREMENT_THRESHOLD_MM);
    expect(v.decentrementMm!.left).toBeCloseTo(v.decentrementMm!.right, 6);
  });

  it('masqué quand le levier rend la mesure non concluante', () => {
    const iris = callVerdict(LANDMARKS_138, makeCal({ source: 'iris', relError: 0.043 }), SPEC_LONG_LEVER);
    expect(iris.decentrementMm).toBeNull();
    const carte = callVerdict(LANDMARKS_138, makeCal(), SPEC_LONG_LEVER);
    expect(carte.decentrementMm).not.toBeNull();
  });
});

describe('Règle 3 — conditions de pose', () => {
  it('pas de calibration → aucune légende rendue', () => {
    expect(verdict(LANDMARKS_138, null, SPEC_132, W, H, 0)).toBeNull();
  });

  it('tête trop tournée → aucune légende rendue', () => {
    expect(verdict(LANDMARKS_138, makeCal(), SPEC_132, W, H, (30 * Math.PI) / 180)).toBeNull();
  });

  it('tête trop inclinée → aucune légende rendue', () => {
    expect(verdict(LANDMARKS_ROLLED, makeCal(), SPEC_132, W, H, 0)).toBeNull();
  });

  it('pose limite mais tolérée → légende rendue', () => {
    expect(verdict(LANDMARKS_138, makeCal(), SPEC_132, W, H, (10 * Math.PI) / 180)).not.toBeNull();
  });
});
