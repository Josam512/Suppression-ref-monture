/**
 * tests/halfpd.test.ts — les demi-écarts pupillaires sont MESURÉS par œil.
 *
 * 🔴 Ce que ce fichier interdit à jamais : `demi-PD = PD / 2`. Chaque demi-écart
 * est la distance de SA pupille au pied du sellion projeté sur la ligne des
 * pupilles (`core/pupillary.ts`). Un modèle facial symétrique qui « recentre »
 * l'asymétrie ferait rougir tous les tests du premier bloc.
 *
 * Conventions verrouillées : landmarks 468 = iris de l'œil DROIT du client
 * (OD, même côté que FACEMESH_RIGHT_EYE 33/133) ; 473 = œil GAUCHE (OG).
 */

import { describe, expect, it } from 'vitest';

import { AutoCalibrationEngine, MAX_AUTO_YAW_RAD } from '../src/core/autoCalibration.js';
import { calibrateAuto, AUTO_ASSUMED_HFOV_DEG } from '../src/core/autoCalibrate.js';
import { HVID_MEAN_MM } from '../src/core/ocularScale.js';
import {
  farPdFromNear,
  pupilPixelsOf,
  CORNEA_TO_ENTRANCE_PUPIL_MM,
  CORNEA_TO_ROTATION_MM,
} from '../src/core/pupillary.js';
import { H, W, makeFace, type FaceOptions } from './fixtures/landmarks.js';

const FOCAL_PX = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));

/**
 * Scène cohérente : caméra au champ supposé, yeux à `distanceMm`, demi-PD de
 * LOIN imposés par œil. Les demi-PD observés sont ceux de PRÈS (convergence
 * inversée exactement comme le code la corrige — vérité terrain sans biais).
 */
function asymScene(pdRightFarMm: number, pdLeftFarMm: number, distanceMm = 500, yawRad = 0) {
  const mmPerPx = distanceMm / FOCAL_PX;
  const nearFactor = (distanceMm + CORNEA_TO_ENTRANCE_PUPIL_MM) / (distanceMm + CORNEA_TO_ROTATION_MM);
  // Un yaw raccourcit les longueurs horizontales du visage en cos(yaw) ; les
  // iris, EUX, continuent de faire face à la caméra (le client la fixe — VOR).
  const fore = Math.cos(yawRad);
  const opts: FaceOptions = {
    faceWidthPx: ((138 * FOCAL_PX) / (distanceMm + 45)) * fore,
    hvidPx: HVID_MEAN_MM / mmPerPx,
    pdSplitPx: {
      right: ((pdRightFarMm * nearFactor) / mmPerPx) * fore,
      left: ((pdLeftFarMm * nearFactor) / mmPerPx) * fore,
    },
  };
  return makeFace(opts);
}

function calibrated(lm: ReturnType<typeof makeFace>, frames = 80) {
  const e = new AutoCalibrationEngine();
  for (let i = 0; i < frames; i++) e.offer(lm, 0, 0, W, H, i * 33);
  return calibrateAuto(e.measures()!, W, null, 0);
}

describe('ASYMÉTRIE : deux demi-PD différentes restent différentes', () => {
  // Plusieurs asymétries plausibles, dont le cas imposé 30/34. Jamais 32/32.
  const cases: Array<[number, number]> = [
    [30, 34],
    [29, 35],
    [31, 33],
    [34, 30], // l'asymétrie inverse, pour attraper un échange gauche/droite
  ];

  for (const [odMm, ogMm] of cases) {
    it(`OD ${odMm} / OG ${ogMm} mm → restitués individuellement`, () => {
      const out = calibrated(asymScene(odMm, ogMm));
      expect(out.cal.pdRightMm!).toBeCloseTo(odMm, 0);
      expect(out.cal.pdLeftMm!).toBeCloseTo(ogMm, 0);
      // 🔴 L'interdit : le retour déguisé à la moitié symétrique. L'asymétrie
      // MESURÉE doit garder le signe et au moins 80 % de l'amplitude vraie.
      const trueGap = ogMm - odMm;
      const measuredGap = out.cal.pdLeftMm! - out.cal.pdRightMm!;
      expect(measuredGap * trueGap).toBeGreaterThan(0); // même signe
      expect(Math.abs(measuredGap)).toBeGreaterThan(0.8 * Math.abs(trueGap));
      expect(out.cal.pdMm!).toBeCloseTo(out.cal.pdRightMm! + out.cal.pdLeftMm!, 6);
    });
  }

  it('l’asymétrie survit au roulis : la projection suit la ligne des pupilles', () => {
    const lm = makeFace({
      faceWidthPx: 420,
      hvidPx: 34,
      pdSplitPx: { right: 84, left: 98 },
      rollRad: (12 * Math.PI) / 180,
    });
    const p = pupilPixelsOf(lm, W, H)!;
    expect(p.rightPx).toBeCloseTo(84, 0);
    expect(p.leftPx).toBeCloseTo(98, 0);
  });
});

describe('YAW : gate strict, pas de double correction', () => {
  it('à ±10° et ±20°, les frames sont REFUSÉES — on ne mesure pas, on le dit', () => {
    for (const deg of [10, 20, -10, -20]) {
      const yaw = (deg * Math.PI) / 180;
      expect(Math.abs(yaw)).toBeGreaterThan(MAX_AUTO_YAW_RAD); // le gate couvre bien ces angles
      const e = new AutoCalibrationEngine();
      for (let i = 0; i < 40; i++) e.offer(asymScene(30, 34, 500, yaw), yaw, 0, W, H, i * 33);
      expect(e.status().usableFrames).toBe(0);
      expect(e.status().rejected['turn-to-front']).toBeGreaterThan(0);
    }
  });

  it('sous le gate (±6°), les demi-PD restent stables à mieux que 1 %', () => {
    // Le rapport demi-PD / iris est invariant au yaw au premier ordre (les
    // deux se projettent depuis le même plan) — aucune correction n'est
    // appliquée, donc aucune ne peut être appliquée DEUX fois. Le résidu
    // théorique à 6° est 1 − cos(6°) ≈ 0,55 % si les iris ne tournent pas
    // avec la tête (fixation caméra) : sous 1 % dans tous les cas.
    const frontal = calibrated(asymScene(30, 34, 500, 0));
    for (const deg of [6, -6]) {
      const yaw = (deg * Math.PI) / 180;
      const e = new AutoCalibrationEngine();
      for (let i = 0; i < 80; i++) e.offer(asymScene(30, 34, 500, yaw), yaw, 0, W, H, i * 33);
      const out = calibrateAuto(e.measures()!, W, null, 0);
      expect(Math.abs(out.cal.pdRightMm! - frontal.cal.pdRightMm!) / 30).toBeLessThan(0.01);
      expect(Math.abs(out.cal.pdLeftMm! - frontal.cal.pdLeftMm!) / 34).toBeLessThan(0.01);
    }
  });
});

describe('CONVERGENCE : identique par œil quand la fixation est sur l’axe', () => {
  it('corriger chaque demi-PD ou le total revient au même (linéarité)', () => {
    for (const d of [300, 500, 800]) {
      expect(farPdFromNear(30, d) + farPdFromNear(34, d)).toBeCloseTo(farPdFromNear(64, d), 9);
    }
  });

  it('la correction est positive et décroît avec la distance', () => {
    expect(farPdFromNear(61.7, 300) - 61.7).toBeGreaterThan(farPdFromNear(61.7, 600) - 61.7);
    expect(farPdFromNear(61.7, 600)).toBeGreaterThan(61.7);
  });
});

describe('INCERTITUDE : chaque demi-PD porte la sienne', () => {
  it('les deux ± sont présents, en mm, et jamais nuls', () => {
    const out = calibrated(asymScene(30, 34));
    const u = out.cal.pdHalfUncertaintyMm!;
    expect(u.right).toBeGreaterThan(0.5); // ≥ le prior (~3,3 %) sur 30 mm
    expect(u.left).toBeGreaterThan(0.5);
    expect(u.right).toBeLessThan(3);
    expect(u.left).toBeLessThan(3);
  });

  it('un œil plus bruité que l’autre → incertitude PLUS LARGE de ce côté-là', () => {
    const e = new AutoCalibrationEngine();
    for (let i = 0; i < 80; i++) {
      // L'œil gauche tremble de ±0,6 mm d'une frame à l'autre ; le droit non.
      const jitter = i % 2 === 0 ? 0.9 : -0.9;
      e.offer(asymScene(30, 34 + jitter), 0, 0, W, H, i * 33);
    }
    const out = calibrateAuto(e.measures()!, W, null, 0);
    const u = out.cal.pdHalfUncertaintyMm!;
    expect(u.left).toBeGreaterThan(u.right);
  });
});
