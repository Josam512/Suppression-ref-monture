/**
 * tests/pdcarry.test.ts — ré-audit A11/A12 : le PD persistant SURVIT et
 * S'AFFICHE.
 *
 *   - A11 : les capacités sont séparées (total sans demi-PD = manque à
 *     collecter) et une tentative qui ne produit rien de mieux REPORTE les
 *     champs PD de la calibration précédente au lieu de les jeter ;
 *   - A12 : au rechargement d'une séance, le panneau affiche immédiatement le
 *     PD mémorisé (repli sur `cal`) — le store, plus frais, garde la priorité.
 */

import { describe, expect, it } from 'vitest';

import type { UserCalibration } from '../src/core/calibration.js';
import type { PdAssembly } from '../src/core/pdAssembly.js';
import { emptySlot, type MetricSlot } from '../src/ui/measurementStore.js';
import { carriedPdFields, missingPdCapacities, pdDisplayOf } from '../src/ui/pdCarry.js';

const baseCal: UserCalibration = { faceWidthMm: 138, source: 'auto', relError: 0.05, measuredAt: 0 };

const fullCal: UserCalibration = {
  ...baseCal,
  pdMm: 61.4,
  pdRelError: 0.045,
  pdRightMm: 30.9,
  pdLeftMm: 30.5,
  pdHalfUncertaintyMm: { right: 1.5, left: 1.5 },
};

const storePd = (value: PdAssembly): MetricSlot<PdAssembly> => ({
  phase: 'ready',
  value,
  failure: null,
  generation: 3,
});

describe('A11 — capacités séparées et report du PD persistant', () => {
  it('total présent + demi-PD absentes = un MANQUE à collecter, pas un état complet', () => {
    const caps = missingPdCapacities({ ...baseCal, pdMm: 61.4, pdRelError: 0.045 });
    expect(caps.hasPdTotal).toBe(true);
    expect(caps.hasHalfPd).toBe(false);
  });

  it('total + demi-PD présents : rien à collecter', () => {
    const caps = missingPdCapacities(fullCal);
    expect(caps).toEqual({ hasPdTotal: true, hasHalfPd: true });
  });

  it('aucun PD : les deux capacités manquent', () => {
    expect(missingPdCapacities(baseCal)).toEqual({ hasPdTotal: false, hasHalfPd: false });
  });

  it('report : la calibration précédente transmet TOUS ses champs PD', () => {
    const carried = carriedPdFields(fullCal);
    expect(carried.pdMm).toBe(61.4);
    expect(carried.pdRelError).toBe(0.045);
    expect(carried.pdRightMm).toBe(30.9);
    expect(carried.pdLeftMm).toBe(30.5);
    expect(carried.pdHalfUncertaintyMm).toEqual({ right: 1.5, left: 1.5 });
  });

  it('report : sans PD précédent (ou sans calibration), rien n’est inventé', () => {
    expect(carriedPdFields(baseCal)).toEqual({});
    expect(carriedPdFields(null)).toEqual({});
  });

  it('report partiel : un total seul voyage seul — jamais de demi-PD fabriquées', () => {
    const carried = carriedPdFields({ ...baseCal, pdMm: 61.4, pdRelError: 0.045 });
    expect(carried.pdMm).toBe(61.4);
    expect(carried.pdRightMm).toBeUndefined();
    expect(carried.pdLeftMm).toBeUndefined();
  });
});

describe('A12 — le PD persistant s’affiche immédiatement au rechargement', () => {
  it('store vide (idle) + calibration mémorisée 61,4 → affiché tout de suite, dit « mémorisé »', () => {
    const d = pdDisplayOf(emptySlot<PdAssembly>(), fullCal);
    expect(d).not.toBeNull();
    expect(d!.pdMm).toBe(61.4);
    expect(d!.uncertaintyMm).toBeCloseTo(61.4 * 0.045, 5);
    expect(d!.fromStore).toBe(false);
    expect(d!.splitFrames).toBeNull(); // séance mémorisée : pas de compte d'images à réinventer
    expect(d!.right!.mm).toBe(30.9);
    expect(d!.left!.mm).toBe(30.5);
  });

  it('le store, plus frais, garde la priorité sur la calibration mémorisée', () => {
    const fresh: PdAssembly = {
      pdMm: 62.1,
      pdRelError: 0.03,
      pdRightMm: 31.2,
      pdLeftMm: 30.9,
      pdHalfUncertaintyMm: { right: 1.1, left: 1.1 },
      splitFrames: 12,
      notes: [],
    };
    const d = pdDisplayOf(storePd(fresh), fullCal);
    expect(d!.pdMm).toBe(62.1);
    expect(d!.fromStore).toBe(true);
    expect(d!.splitFrames).toBe(12);
  });

  it('store total-seul : le total s’affiche, les demi-PD restent honnêtement absentes', () => {
    const totalOnly: PdAssembly = { pdMm: 61.4, pdRelError: 0.045, splitFrames: 3, notes: [] };
    const d = pdDisplayOf(storePd(totalOnly), null);
    expect(d!.pdMm).toBe(61.4);
    expect(d!.right).toBeNull();
    expect(d!.splitFrames).toBe(3);
  });

  it('ni store ni calibration : rien à afficher — jamais un zéro qui ressemble à une mesure', () => {
    expect(pdDisplayOf(emptySlot<PdAssembly>(), null)).toBeNull();
    expect(pdDisplayOf(emptySlot<PdAssembly>(), baseCal)).toBeNull();
  });
});
