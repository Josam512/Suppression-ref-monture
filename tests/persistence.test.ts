/**
 * tests/persistence.test.ts — ré-audit A17 : la persistance ne contamine plus.
 *
 *   - A17a : versions PAR MÉTRIQUE — chaque grandeur ne traverse que les
 *     versions où SON algorithme n'a pas changé ; une enveloppe du futur ne
 *     livre rien ; corriger la largeur demain = bump de SA version, et les
 *     largeurs anciennes tombent mécaniquement ;
 *   - A17b : la calibration décrit une PERSONNE — celle du client A n'est
 *     jamais relue par le client B ;
 *   - A17c : le profil caméra est enveloppé `{v, profile}` — une autre version
 *     de schéma est refusée proprement ; la forme historique nue est migrée ;
 *   - AA : l'identité d'objectif porte zoom (optique) et résolution effective
 *     (diagnostic) — un zoom différent rend deux identités incompatibles.
 */

import { describe, expect, it } from 'vitest';

import { identityCompatible, type CameraProfile } from '../src/core/cameraProfile.js';
import {
  AUTO_METROLOGY_VERSION,
  CAMERA_PROFILE_VERSION,
  FACE_SCALE_ALGO_VERSION,
  PD_ALGO_VERSION,
} from '../src/core/versions.js';
import { metricCompatible, parseStoredCalibration } from '../src/ui/calibrationStorage.js';
import { parseStoredCameraProfile } from '../src/ui/cameraStorage.js';

const CAL = {
  faceWidthMm: 138,
  source: 'auto',
  relError: 0.05,
  measuredAt: 1000,
  pdMm: 62,
  pdRelError: 0.04,
  temporalWidthMm: 152,
  temporalRelError: 0.03,
  distanceMm: 480,
};

describe('A17a — versions PAR MÉTRIQUE', () => {
  it('la règle : ALGO ≤ version stockée ≤ version courante, balayée', () => {
    for (let stored = 0; stored <= AUTO_METROLOGY_VERSION + 2; stored++) {
      expect(metricCompatible(stored, PD_ALGO_VERSION)).toBe(
        stored >= PD_ALGO_VERSION && stored <= AUTO_METROLOGY_VERSION,
      );
    }
  });

  it('les versions par métrique encadrent la version globale (cohérence du contrat)', () => {
    expect(FACE_SCALE_ALGO_VERSION).toBeLessThanOrEqual(AUTO_METROLOGY_VERSION);
    expect(PD_ALGO_VERSION).toBeLessThanOrEqual(AUTO_METROLOGY_VERSION);
    expect(FACE_SCALE_ALGO_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('une enveloppe du FUTUR ne livre RIEN — schéma inconnu', () => {
    expect(parseStoredCalibration({ v: AUTO_METROLOGY_VERSION + 1, cal: CAL })).toBeNull();
  });

  it('v2 : la largeur (algo inchangé depuis v1) survit, le PD (algo v3) tombe', () => {
    const cal = parseStoredCalibration({ v: 2, cal: CAL });
    expect(cal?.faceWidthMm).toBe(138);
    expect(cal?.pdMm).toBeUndefined();
    expect(cal?.temporalWidthMm).toBeUndefined();
    expect(cal?.distanceMm).toBeUndefined();
  });
});

describe('A17b — la calibration appartient à UNE personne', () => {
  const envelope = { v: AUTO_METROLOGY_VERSION, personId: 'client-A', cal: CAL };

  it('🔴 le client B ne relit JAMAIS la calibration du client A', () => {
    expect(parseStoredCalibration(envelope, 'client-B')).toBeNull();
  });

  it('la même personne relit la sienne', () => {
    expect(parseStoredCalibration(envelope, 'client-A')?.pdMm).toBe(62);
  });

  it("donnée d'avant la notion (sans personId) : migrée une fois, pas jetée", () => {
    expect(parseStoredCalibration({ v: AUTO_METROLOGY_VERSION, cal: CAL }, 'client-B')?.faceWidthMm).toBe(138);
  });

  it('sans exigence de personne (appels de banc), la lecture reste inchangée', () => {
    expect(parseStoredCalibration(envelope)?.pdMm).toBe(62);
  });
});

describe('A17c — le profil caméra est enveloppé et versionné', () => {
  const PROFILE: CameraProfile = { focalPerWidth: 0.9, relError: 0.05, views: 60, measuredAt: 1000 };

  it('enveloppe de la version courante : relue', () => {
    expect(parseStoredCameraProfile({ v: CAMERA_PROFILE_VERSION, profile: PROFILE })?.focalPerWidth).toBe(0.9);
  });

  it('🔴 une AUTRE version de schéma est refusée PROPREMENT (passée ou future)', () => {
    expect(parseStoredCameraProfile({ v: CAMERA_PROFILE_VERSION - 1, profile: PROFILE })).toBeNull();
    expect(parseStoredCameraProfile({ v: CAMERA_PROFILE_VERSION + 1, profile: PROFILE })).toBeNull();
    expect(parseStoredCameraProfile({ v: 'x', profile: PROFILE })).toBeNull();
  });

  it('forme HISTORIQUE nue : migrée, validée champ par champ', () => {
    expect(parseStoredCameraProfile(PROFILE)?.focalPerWidth).toBe(0.9);
    expect(parseStoredCameraProfile({ ...PROFILE, focalPerWidth: 'x' })).toBeNull();
    expect(parseStoredCameraProfile('garbage')).toBeNull();
  });
});

describe('AA — identité d’objectif : zoom et résolution effective', () => {
  it('un zoom différent rend deux identités INCOMPATIBLES (autre optique)', () => {
    expect(identityCompatible({ zoom: 1 }, { zoom: 2 })).toBe(false);
    expect(identityCompatible({ zoom: 1 }, { zoom: 1 })).toBe(true);
    expect(identityCompatible({ zoom: 1 }, {})).toBe(true); // absent ne condamne pas
  });

  it('la résolution effective est un DIAGNOSTIC : elle ne condamne pas', () => {
    // focalPerWidth est invariante par résolution : 640 → 1280 = même objectif.
    expect(identityCompatible({ captureWidthPx: 640 }, { captureWidthPx: 1280 })).toBe(true);
  });

  it('le profil enveloppé transporte zoom et résolution', () => {
    const p = parseStoredCameraProfile({
      v: CAMERA_PROFILE_VERSION,
      profile: { focalPerWidth: 0.9, relError: 0.05, views: 60, measuredAt: 1, zoom: 2, captureWidthPx: 1280 },
    });
    expect(p?.zoom).toBe(2);
    expect(p?.captureWidthPx).toBe(1280);
  });
});
