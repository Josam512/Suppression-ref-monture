/**
 * tests/camera.test.ts — la focale est mesurée UNE fois puis réutilisée.
 *
 * Le défaut que ces tests verrouillent : le balayage mesurait la focale, s'en
 * servait pour une conversion, puis la jetait. À la séance suivante — ou si le
 * client passait la rotation — la chaîne retombait sur le champ de vision
 * SUPPOSÉ, faux de 46 % sur le premier sujet réel.
 */

import { describe, expect, it } from 'vitest';

import {
  FOCAL_SYSTEMATIC_FLOOR,
  identityCompatible,
  MAX_USABLE_FOCAL_REL_ERROR,
  PROFILE_MAX_AGE_MS,
  focalPxFor,
  isProfileUsable,
  mergeProfile,
  parseCameraProfile,
  profileFromSweep,
  type CameraProfile,
} from '../src/core/cameraProfile.js';
import { cameraFromCard, cardDistanceWithFocal, type CardQuad } from '../src/core/cardPose.js';
import { CalibrationError } from '../src/core/geom.js';

const NOW = 1_700_000_000_000;

const sweep = (focalPx: number, rel = 0.05, views = 50): { focalPx: number; focalRelError: number; views: number } => ({
  focalPx,
  focalRelError: rel,
  views,
});

describe('le profil d’objectif est indépendant de la résolution', () => {
  it('la MÊME caméra à deux résolutions donne le même profil', () => {
    // Un objectif à 1,0 × largeur d'image : 2544 px de focale sur 2544 de large,
    // 1200 sur 1200. C'est la même optique, et le profil doit le dire.
    const grand = profileFromSweep(sweep(2544), 2544, NOW);
    const petit = profileFromSweep(sweep(1200), 1200, NOW);
    expect(grand.focalPerWidth).toBeCloseTo(petit.focalPerWidth, 9);
  });

  it('et il se redéploie en pixels sur n’importe quelle largeur', () => {
    const p = profileFromSweep(sweep(2544), 2544, NOW);
    expect(focalPxFor(p, 1280)).toBeCloseTo(1280, 6);
    expect(focalPxFor(p, 640)).toBeCloseTo(640, 6);
  });

  it('une focale absurde n’est PAS enregistrée — un profil faux contaminerait tout', () => {
    expect(() => profileFromSweep(sweep(2544 * 8), 2544, NOW)).toThrow(CalibrationError);
    expect(() => profileFromSweep(sweep(2544 * 0.1), 2544, NOW)).toThrow(CalibrationError);
  });

  it('l’incertitude ne descend jamais sous le plancher systématique', () => {
    // Un balayage qui se croit précis à 0,1 % : le moyennage tue le bruit de
    // pointage, pas la distorsion ni le point principal supposé au centre.
    const p = profileFromSweep(sweep(2544, 0.001), 2544, NOW);
    expect(p.relError).toBe(FOCAL_SYSTEMATIC_FLOOR);
  });
});

describe('accumuler des séances améliore le profil, sans mentir', () => {
  it('la fusion pondère par l’inverse de la variance', () => {
    const sur = { focalPerWidth: 1.0, relError: 0.02, views: 50, measuredAt: NOW };
    const flou = { focalPerWidth: 1.4, relError: 0.20, views: 5, measuredAt: NOW };
    const m = mergeProfile(sur, flou);
    // La mesure sûre pèse 100× plus : le résultat doit rester tout près d'elle.
    expect(m.focalPerWidth).toBeGreaterThan(1.0);
    expect(m.focalPerWidth).toBeLessThan(1.01);
    expect(m.views).toBe(55);
  });

  it('même en empilant les séances, elle ne passe pas sous le plancher', () => {
    let p: CameraProfile | null = null;
    for (let i = 0; i < 40; i++) {
      p = mergeProfile(p, profileFromSweep(sweep(2544, 0.05), 2544, NOW));
    }
    expect(p!.relError).toBe(FOCAL_SYSTEMATIC_FLOOR);
  });

  it('sans profil stocké, la nouvelle mesure passe telle quelle', () => {
    const fresh = profileFromSweep(sweep(2544, 0.06), 2544, NOW);
    expect(mergeProfile(null, fresh)).toEqual(fresh);
  });
});

describe('on ne réutilise un profil que s’il vaut mieux que l’a priori', () => {
  const bon: CameraProfile = { focalPerWidth: 1.0, relError: 0.03, views: 50, measuredAt: NOW };

  it('un bon profil récent est utilisable', () => {
    expect(isProfileUsable(bon, NOW)).toBe(true);
  });

  it('trop incertain → refusé', () => {
    expect(isProfileUsable({ ...bon, relError: MAX_USABLE_FOCAL_REL_ERROR + 0.01 }, NOW)).toBe(false);
  });

  it('trop vieux → refusé : l’appareil a pu changer', () => {
    expect(isProfileUsable(bon, NOW + PROFILE_MAX_AGE_MS + 1)).toBe(false);
  });

  it('absent ou corrompu → refusé, jamais complété par une valeur par défaut', () => {
    expect(isProfileUsable(null, NOW)).toBe(false);
    expect(isProfileUsable({ ...bon, focalPerWidth: Number.NaN }, NOW)).toBe(false);
    expect(parseCameraProfile({ focalPerWidth: 'x' })).toBeNull();
    expect(parseCameraProfile(null)).toBeNull();
    expect(parseCameraProfile({ focalPerWidth: 1, relError: 0.03, views: 5 })).toBeNull();
  });
});

/**
 * 🔴 LE test qui justifie tout le fichier, bâti sur les coins RÉELS d'une photo
 * du sujet : carte à plat sur le front, vue quasi frontale, coin bas-droit sous
 * son doigt.
 */
describe('une vue frontale seule redevient exploitable grâce au profil mémorisé', () => {
  const VRAIE_PHOTO: CardQuad = [
    { x: 1319.23, y: 1061.82 },
    { x: 1831.67, y: 1080.22 },
    { x: 1813.98, y: 1394.02 },
    { x: 1310.61, y: 1368.55 },
  ];
  const W = 2544;
  const H = 3392;

  it('seule, elle ne peut PAS porter la focale — et elle est refusée', () => {
    expect(() => cameraFromCard(VRAIE_PHOTO, W, H)).toThrow(CalibrationError);
  });

  it('avec le profil d’une séance précédente, elle donne une distance plausible', () => {
    const profile = profileFromSweep(sweep(1.0 * W), W, NOW);
    expect(isProfileUsable(profile, NOW)).toBe(true);

    const d = cardDistanceWithFocal(VRAIE_PHOTO, W, H, focalPxFor(profile, W));
    // Bras plié, téléphone tenu près du visage : ~43 cm.
    expect(d).toBeGreaterThan(350);
    expect(d).toBeLessThan(550);
  });

  it('et la distance suit la focale du profil, sans paramètre libre', () => {
    // ⚠️ QUASI proportionnelle, pas exactement. Une première rédaction de ce
    // test exigeait un rapport de 2 au millionième pour une focale doublée :
    // mesure faite, il vaut 1,957. `cardDistanceWithFocal` normalise la
    // première colonne de l'homographie, dont le terme de fuite ne porte PAS la
    // focale — l'écart à la proportionnalité est ce terme, et il est réel.
    // C'était l'énoncé qui était faux, pas le code.
    const d = (k: number): number =>
      cardDistanceWithFocal(VRAIE_PHOTO, W, H, focalPxFor(profileFromSweep(sweep(k * W), W, NOW), W));

    expect(d(2.0) / d(1.0)).toBeGreaterThan(1.9);
    expect(d(2.0) / d(1.0)).toBeLessThan(2.0);
    // Ce qui compte vraiment : c'est monotone, donc sans ambiguïté.
    for (const [a, b] of [[0.5, 1.0], [1.0, 1.5], [1.5, 2.0], [2.0, 3.0]] as const) {
      expect(d(b), `${a} → ${b}`).toBeGreaterThan(d(a));
    }
  });
});

describe('points 39-40 / compléments 23-24 — le profil appartient à SON objectif', () => {
  const NOW2 = 1_700_000_000_000;
  const base = { focalPerWidth: 1.0, relError: 0.03, views: 50, measuredAt: NOW2 };

  it('🔴 c24 : deux appareils différents ne se FUSIONNENT jamais — la fraîche remplace', () => {
    const stored: CameraProfile = { ...base, deviceId: 'A', focalPerWidth: 1.0 };
    const fresh: CameraProfile = { ...base, deviceId: 'B', focalPerWidth: 1.4, views: 5 };
    const m = mergeProfile(stored, fresh);
    expect(m.focalPerWidth).toBe(1.4); // la fraîche, SEULE — aucun mélange
    expect(m.deviceId).toBe('B');
    expect(m.views).toBe(5);
  });

  it('facing arrière ↔ frontal : incompatibles', () => {
    expect(identityCompatible({ facingMode: 'user' }, { facingMode: 'environment' })).toBe(false);
  });

  it('un champ absent d’un côté ne condamne pas (navigateur discret)', () => {
    expect(identityCompatible({ deviceId: 'A' }, {})).toBe(true);
    expect(identityCompatible({}, {})).toBe(true);
  });

  it('un crop de rapport d’image franchement différent est une autre optique', () => {
    expect(identityCompatible({ aspect: 4 / 3 }, { aspect: 16 / 9 })).toBe(false);
    expect(identityCompatible({ aspect: 16 / 9 }, { aspect: 16 / 9.02 })).toBe(true);
  });

  it('même appareil → fusion normale, identité conservée', () => {
    const stored: CameraProfile = { ...base, deviceId: 'A' };
    const fresh: CameraProfile = { ...base, deviceId: 'A', focalPerWidth: 1.02, views: 10 };
    const m = mergeProfile(stored, fresh);
    expect(m.views).toBe(60);
    expect(m.deviceId).toBe('A');
    expect(m.focalPerWidth).toBeGreaterThan(1.0);
    expect(m.focalPerWidth).toBeLessThan(1.02);
  });

  it('parseCameraProfile relit l’identité, sans jamais l’inventer', () => {
    const p = parseCameraProfile({ ...base, deviceId: 'X', facingMode: 'user', aspect: 1.78 });
    expect(p?.deviceId).toBe('X');
    expect(p?.facingMode).toBe('user');
    const q = parseCameraProfile({ ...base });
    expect(q?.deviceId).toBeUndefined();
  });
});
