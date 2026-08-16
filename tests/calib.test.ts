/**
 * tests/calib.test.ts — le protocole du lot 8 (CLAUDE.md §5).
 *
 * Ces règles décident si une constante qui pèse PLUS LOURD que le seuil de
 * décision a le droit d'être figée. Les tester, c'est empêcher qu'on la fige
 * sur un point unique « qui tombe bien ».
 */

import { describe, expect, it } from 'vitest';
import { dispersion, MAX_DISPERSION_MM, median, protocolSatisfied } from '../src/prep/stats.js';

const complet = { essais: 3, montures: 3, visages: 2, dispersionMm: 1.5 };

describe('Lot 8 — statistiques du protocole', () => {
  it('la médiane ignore un essai aberrant, là où une moyenne le suivrait', () => {
    const essais = [10.5, 11.0, 11.2, 10.8, 42.0]; // le dernier : pointage raté
    expect(median(essais)).toBeCloseTo(11.0, 6);
    const moyenne = essais.reduce((a, b) => a + b, 0) / essais.length;
    expect(Math.abs(moyenne - 11.0)).toBeGreaterThan(5); // la moyenne, elle, dérape
  });

  it('la médiane gère un nombre pair d’essais', () => {
    expect(median([10, 11, 12, 13])).toBeCloseTo(11.5, 6);
  });

  it('la dispersion mesure l’étendue, pas l’écart-type', () => {
    expect(dispersion([10, 11, 13])).toBeCloseTo(3, 6);
  });

  it('un seul essai ne suffit jamais, même parfaitement cohérent', () => {
    // C'était le protocole d'origine : une monture « dont on sait qu'elle va bien ».
    expect(protocolSatisfied({ essais: 1, montures: 1, visages: 1, dispersionMm: 0 })).toBe(false);
  });

  it('trois essais sur une seule monture ne suffisent pas non plus', () => {
    expect(protocolSatisfied({ ...complet, montures: 1 })).toBe(false);
  });

  it('trois montures sur un seul visage ne suffisent pas non plus', () => {
    expect(protocolSatisfied({ ...complet, visages: 1 })).toBe(false);
  });

  it('une dispersion trop large interdit de figer', () => {
    expect(protocolSatisfied({ ...complet, dispersionMm: MAX_DISPERSION_MM + 0.1 })).toBe(false);
    expect(protocolSatisfied({ ...complet, dispersionMm: MAX_DISPERSION_MM })).toBe(true);
  });

  it('le protocole complet autorise à figer', () => {
    expect(protocolSatisfied(complet)).toBe(true);
  });
});
