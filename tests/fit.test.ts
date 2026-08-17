/**
 * tests/fit.test.ts — l'ajustement de la correction de largeur.
 *
 * Ce que ces tests protègent : la capacité du modèle à prédire un visage qu'il
 * n'a PAS vu. C'est la seule propriété qui compte pour un client à distance.
 */

import { describe, expect, it } from 'vitest';
import {
  fitCorrection,
  loocvErrorMm,
  MIN_MEASUREMENTS,
  predict,
  publiable,
  type Measurement,
} from '../src/prep/fitCorrection.js';
import { canthiToTempleDepthMm } from '../src/core/cardRefinement.js';

/** Fabrique n sujets dont la largeur réelle suit exactement le modèle choisi. */
function synth(modele: 'decalage' | 'rapport', p: number, n = 10): Measurement[] {
  return Array.from({ length: n }, (_, i) => {
    const landmarkMm = 100 + i * 4; // des morphologies bien étalées
    return {
      sujet: `S${i}`,
      landmarkMm,
      reelleMm: predict(landmarkMm, modele, p),
      origine: 'compas' as const,
    };
  });
}

describe('Ajustement de la correction', () => {
  it('sans mesure, il n’y a rien à ajuster', () => {
    expect(fitCorrection([])).toBeNull();
    expect(publiable(null)).toBe(false);
  });

  it('retrouve un décalage constant, et le reconnaît comme tel', () => {
    const a = fitCorrection(synth('decalage', 18))!;
    expect(a.modele).toBe('decalage');
    expect(a.parametre).toBeCloseTo(18, 6);
    expect(a.erreurLoocvMm).toBeCloseTo(0, 6);
    expect(publiable(a)).toBe(true);
  });

  it('retrouve une proportion, et ne la confond pas avec un décalage', () => {
    const a = fitCorrection(synth('rapport', 1.16))!;
    expect(a.modele).toBe('rapport');
    expect(a.parametre).toBeCloseTo(1.16, 6);
    expect(a.erreurLoocvMm).toBeCloseTo(0, 6);
  });

  it('un décalage constant ne trompe pas le modèle proportionnel, et inversement', () => {
    // Sur des morphologies étalées, les deux modèles divergent nettement :
    // c'est ce qui rend le choix possible. Avec des visages tous identiques,
    // ils seraient indiscernables — d'où l'exigence de sujets variés.
    const rows = synth('decalage', 18);
    expect(loocvErrorMm(rows, 'rapport')).toBeGreaterThan(loocvErrorMm(rows, 'decalage'));
  });

  it('🔴 la validation croisée est PAR SUJET, pas par photo', () => {
    // Dix photos d'une seule personne ne valent pas dix personnes : le modèle
    // aurait déjà vu ce visage, et son erreur paraîtrait nulle à tort.
    const memeSujet: Measurement[] = Array.from({ length: 10 }, () => ({
      sujet: 'unique',
      landmarkMm: 115,
      reelleMm: 136,
      origine: 'compas' as const,
    }));
    expect(loocvErrorMm(memeSujet, 'decalage')).toBeNaN();
    expect(publiable(fitCorrection(memeSujet))).toBe(false);
  });

  it('refuse de publier en dessous du nombre de mesures exigé', () => {
    const a = fitCorrection(synth('decalage', 18, MIN_MEASUREMENTS - 1))!;
    expect(a.erreurLoocvMm).toBeCloseTo(0, 6); // l'ajustement est parfait…
    expect(publiable(a)).toBe(false); // …et pourtant refusé : trop peu de monde
  });

  it('refuse quand les mesures se contredisent, même nombreuses', () => {
    const bruit = synth('decalage', 18).map((r, i) => ({
      ...r,
      reelleMm: r.reelleMm + (i % 2 === 0 ? 9 : -9),
    }));
    expect(publiable(fitCorrection(bruit))).toBe(false);
  });

  it('la médiane encaisse une mesure aberrante isolée', () => {
    const rows = synth('decalage', 18);
    rows[3] = { ...rows[3]!, reelleMm: rows[3]!.reelleMm + 60 }; // pointage raté
    const a = fitCorrection(rows)!;
    expect(a.parametre).toBeCloseTo(18, 1);
  });
});

describe('le dernier tronçon carte → tempes', () => {
  // ⚠️ Il valait 12 mm en absolu : un chiffre d'adulte. Sur un visage d'enfant
  // il surestimait le tronçon de moitié — le présupposé de taille du §0.0.3,
  // exactement celui que le §5 avait déjà chassé du seuil en le proportionnant.
  it('suit la taille du visage, au lieu de valoir 12 mm pour tout le monde', () => {
    const adulte = canthiToTempleDepthMm(152);
    const enfant = canthiToTempleDepthMm(115);

    expect(adulte).toBeCloseTo(12, 0); // le sujet réel sur lequel il est calé
    expect(enfant).toBeLessThan(adulte);
    // Proportionné, pas simplement « plus petit » : le rapport suit les largeurs.
    expect(enfant / adulte).toBeCloseTo(115 / 152, 6);
  });

  it("il pèse assez peu pour qu'une erreur de 50 % dessus reste tolérable", () => {
    // La correction totale vaut ~6 % ; ce tronçon en fait le quart. Se tromper
    // de moitié dessus doit coûter moins de 1 % sur la largeur finale.
    const D = 780;
    const mesure = 37; // profondeur carte ↔ coins des yeux, mesurée
    const facteur = (leg: number): number => 1 / (1 - (mesure + leg) / D);
    const juste = facteur(canthiToTempleDepthMm(152));
    const faux = facteur(canthiToTempleDepthMm(152) * 1.5);
    expect(Math.abs(faux / juste - 1)).toBeLessThan(0.01);
  });
});
