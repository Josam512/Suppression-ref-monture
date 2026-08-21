/**
 * tests/storage.test.ts — la persistance versionnée et sa migration
 * (guide points 57–58, 60, compléments 43–44).
 *
 * Calibration = une PERSONNE ; profil de focale = un OBJECTIF : deux clés,
 * deux cycles. Et un algorithme neuf ne tourne jamais sur les chiffres d'un
 * ancien : l'enveloppe porte AUTO_METROLOGY_VERSION, la relecture valide
 * champ par champ, migre ce qui est sûr, invalide SEULEMENT le reste.
 */

import { describe, expect, it } from 'vitest';

import { parseStoredCalibration } from '../src/ui/calibrationStorage.js';
import { AUTO_METROLOGY_VERSION } from '../src/core/versions.js';

const CAL = {
  faceWidthMm: 138,
  source: 'auto',
  relError: 0.05,
  measuredAt: 1000,
  pdMm: 62,
  pdRelError: 0.04,
  pdLeftMm: 30.5,
  pdRightMm: 31.5,
  pdHalfUncertaintyMm: { left: 1.2, right: 1.1 },
  temporalWidthMm: 152,
  temporalRelError: 0.03,
  distanceMm: 480,
};

describe('parseStoredCalibration — validation, version, migration', () => {
  it('une enveloppe de la version courante relit TOUT', () => {
    const cal = parseStoredCalibration({ v: AUTO_METROLOGY_VERSION, cal: CAL });
    expect(cal?.faceWidthMm).toBe(138);
    expect(cal?.pdMm).toBe(62);
    expect(cal?.pdLeftMm).toBe(30.5);
    expect(cal?.temporalWidthMm).toBe(152);
    expect(cal?.distanceMm).toBe(480);
  });

  it('c44 — une AUTRE version garde la largeur (rendu) et invalide la métrologie', () => {
    const cal = parseStoredCalibration({ v: AUTO_METROLOGY_VERSION - 1, cal: CAL });
    expect(cal?.faceWidthMm).toBe(138); // conservée : elle ne pilote que l'échelle
    expect(cal?.pdMm).toBeUndefined(); // PD à remesurer (l'algorithme a changé)
    expect(cal?.temporalWidthMm).toBeUndefined();
    expect(cal?.distanceMm).toBeUndefined();
  });

  it('la forme HISTORIQUE (calibration nue, sans v) est lue comme v1', () => {
    const cal = parseStoredCalibration(CAL);
    expect(cal?.faceWidthMm).toBe(138);
    expect(cal?.pdMm).toBeUndefined(); // v1 ≠ v3 : métrologie invalidée
  });

  it('des champs corrompus tombent individuellement, jamais en exception', () => {
    const cal = parseStoredCalibration({
      v: AUTO_METROLOGY_VERSION,
      cal: { ...CAL, pdMm: 'soixante', temporalWidthMm: Number.NaN },
    });
    expect(cal?.faceWidthMm).toBe(138);
    expect(cal?.pdMm).toBeUndefined();
    expect(cal?.temporalWidthMm).toBeUndefined();
  });

  it('une largeur implausible invalide TOUT (le rendu n’a plus de socle)', () => {
    expect(parseStoredCalibration({ v: AUTO_METROLOGY_VERSION, cal: { ...CAL, faceWidthMm: 60 } })).toBeNull();
    expect(parseStoredCalibration({ v: AUTO_METROLOGY_VERSION, cal: { ...CAL, faceWidthMm: 'x' } })).toBeNull();
    expect(parseStoredCalibration(null)).toBeNull();
    expect(parseStoredCalibration('garbage')).toBeNull();
  });

  it('un PD hors plage anatomique est écarté, le reste survit', () => {
    const cal = parseStoredCalibration({ v: AUTO_METROLOGY_VERSION, cal: { ...CAL, pdMm: 120 } });
    expect(cal?.faceWidthMm).toBe(138);
    expect(cal?.pdMm).toBeUndefined();
    expect(cal?.pdLeftMm).toBeUndefined(); // les demi-PD ne survivent pas sans total
  });

  it('des demi-PD incomplètes (une seule moitié) ne passent pas', () => {
    const cal = parseStoredCalibration({
      v: AUTO_METROLOGY_VERSION,
      cal: { ...CAL, pdRightMm: undefined },
    });
    expect(cal?.pdMm).toBe(62);
    expect(cal?.pdLeftMm).toBeUndefined();
  });
});
