/**
 * tests/verdict.test.ts — la légende chiffrée (CLAUDE.md §5).
 *
 * Rappel : ce module ne décide de rien (§0.0.1). Ces tests vérifient que les
 * chiffres sont justes et que le doute est dit, jamais qu'un tri est correct.
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

describe('Règle 1 — le seuil est proportionnel et borné', () => {
  it('le seuil suit le visage, entre 3 et 5 mm', () => {
    expect(thresholdFor(105)).toBeCloseTo(3.15, 2); // enfant
    expect(thresholdFor(138)).toBeCloseTo(4.14, 2); // adulte médian ≈ l'ancien 4 mm fixe
    expect(thresholdFor(145)).toBeCloseTo(4.35, 2);
  });

  it('le seuil est borné aux deux extrémités', () => {
    expect(thresholdFor(80)).toBe(THRESHOLD_MIN_MM); // sinon 2,4 mm : sous la précision de mesure
    expect(thresholdFor(200)).toBe(THRESHOLD_MAX_MM); // sinon 6 mm : tolérance qui ne veut plus rien dire
  });

  it("un enfant n'est pas jugé deux fois plus sévèrement qu'un adulte", () => {
    // C'était le défaut du seuil fixe : 4 mm sur 105 mm de visage, contre
    // 4 mm sur 145 mm, soit une exigence relative deux fois plus dure.
    const relEnfant = thresholdFor(105) / 105;
    const relAdulte = thresholdFor(145) / 145;
    expect(relEnfant).toBeCloseTo(relAdulte, 3);
  });
});

describe('Règle 1 bis — classify par arithmétique d\'intervalle (B2)', () => {
  it('écart franc → tranché même en mode iris', () => {
    expect(classify(-18, makeCal({ source: 'iris', relError: 0.043 }))).toBe('sous-taillee');
    expect(classify(+18, makeCal({ source: 'iris', relError: 0.043 }))).toBe('surtaillee');
  });

  it('cas limite en mode iris → indéterminé, aucun chiffre tranché', () => {
    expect(classify(-5, makeCal({ source: 'iris', relError: 0.043 }))).toBe('indetermine');
  });

  it('mesure serrée et précise → correcte', () => {
    expect(classify(0, makeCal())).toBe('correcte');
  });

  /**
   * ⚠️ Conséquence honnête de B2 + B4, à ne PAS « réparer » en abaissant les
   * incertitudes : avec une carte (±3,45 mm sur 138 mm) et un seuil de 4,14 mm,
   * un écart de 6 mm ne peut pas être tranché. L'exemple emblématique du
   * contrat — « 132 mm sur 138 mm, légèrement sous-taillée » — supposait une
   * précision que la mesure n'a pas.
   *
   * Ce n'est pas un échec du produit : l'image reste juste, les deux chiffres
   * restent affichés avec leurs marges, et la personne regarde (§0.0.1).
   */
  it('132 mm sur 138 mm avec une carte → indéterminé, et c\'est la vérité', () => {
    expect(callVerdict(LANDMARKS_138, makeCal(), SPEC_132).status).toBe('indetermine');
  });
});

describe('La légende assemblée', () => {
  it('INVARIANT : monture 120 mm sur visage 138 mm → sous-taillée', () => {
    const v = callVerdict(LANDMARKS_138, makeCal(), SPEC_120);
    expect(v.status).toBe('sous-taillee');
    expect(v.frameWidthMm).toBeCloseTo(120, 3);
    expect(v.faceWidthMm).toBeCloseTo(138, 3);
    expect(v.deltaMm).toBeCloseTo(-18, 3);
  });

  it('INVARIANT : monture 138 mm sur visage 138 mm → correcte', () => {
    expect(callVerdict(LANDMARKS_138, makeCal(), SPEC_138).status).toBe('correcte');
  });

  it('INVARIANT : monture 150 mm sur visage 138 mm → surtaillée', () => {
    expect(callVerdict(LANDMARKS_138, makeCal(), SPEC_150).status).toBe('surtaillee');
  });

  it('la marge est toujours transportée avec le chiffre', () => {
    const v = callVerdict(LANDMARKS_138, makeCal(), SPEC_132);
    expect(v.faceWidthUncertaintyMm).toBeCloseTo(138 * 0.025, 3);
    expect(v.thresholdMm).toBeCloseTo(4.14, 2);
    expect(legend(v)).toMatch(/monture 132 mm · votre visage 138 mm \(± 3 mm\)/);
  });

  it('la légende ne contient aucun jugement', () => {
    const texte = legend(callVerdict(LANDMARKS_138, makeCal(), SPEC_120));
    expect(texte).not.toMatch(/taill|correct|recommand|convient/i);
  });
});

describe('Règle 2 — décentrement', () => {
  it('l\'incertitude est propagée jusqu\'au décentrement, pas recopiée du visage', () => {
    const iris = decentrementUncertaintyMm(SPEC_132, makeCal({ relError: 0.043 }));
    const carte = decentrementUncertaintyMm(SPEC_132, makeCal({ relError: 0.025 }));

    // Levier de 30 mm : 4,3 % → 1,29 mm, et non les ±5,9 mm de la largeur du visage.
    expect(iris).toBeCloseTo(30 * 0.043, 3);
    expect(carte).toBeCloseTo(30 * 0.025, 3);
    expect(iris).toBeLessThan(DECENTREMENT_THRESHOLD_MM);
  });

  it('affiché quand la mesure peut trancher les 3 mm', () => {
    const v = callVerdict(LANDMARKS_138, makeCal(), SPEC_132);
    expect(v.decentrementMm).not.toBeNull();
    expect(v.decentrementMm!.left).toBeLessThan(DECENTREMENT_THRESHOLD_MM);
    // Le visage de test est symétrique : les deux yeux sont décentrés pareil.
    expect(v.decentrementMm!.left).toBeCloseTo(v.decentrementMm!.right, 6);
  });

  it('masqué — pas approximé — quand le levier rend la mesure non concluante', () => {
    // Levier de 40 mm : en mode iris, 1,72 mm d'incertitude pour un seuil de 3 mm.
    const iris = callVerdict(LANDMARKS_138, makeCal({ source: 'iris', relError: 0.043 }), SPEC_LONG_LEVER);
    expect(iris.decentrementMm).toBeNull();

    // La même monture reste mesurable avec une carte : c'est la PRÉCISION qui
    // décide, jamais l'origine de la mesure (correctif B2).
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
