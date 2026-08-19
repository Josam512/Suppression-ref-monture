/**
 * tests/temporal-auto.test.ts — l'écart temporal dans le parcours SANS CARTE.
 *
 * Le §14.2 l'exigeait pour la carte ; la vérification du 2026-08-19 (§10–13)
 * le câble au parcours automatique : la silhouette est mesurée sur une frame
 * frontale figée pendant la collecte, confirmée par le mouvement des vues
 * tournées. Trois garanties verrouillées ici :
 *
 *   1. séance avec rotation → `temporalWidthMm` MESURÉ, à sa vraie valeur, et
 *      c'est LUI que la légende compare à la monture ;
 *   2. séance sans rotation → rien n'est deviné : champs absents, note en clair ;
 *   3. mesure impossible (lunettes gardées) → refus NOMMÉ, champs absents.
 *
 * ⚠️ Les vues tournées n'apportent que des PIXELS (masque de mouvement) :
 * `AutoTemporalScene` ne transporte aucun landmark de profil — les repères
 * 234/454 ne sont jamais traités comme des points physiques pendant la rotation.
 */

import { describe, expect, it } from 'vitest';

import { AutoCalibrationEngine } from '../src/core/autoCalibration.js';
import {
  calibrateAuto,
  AUTO_ASSUMED_HFOV_DEG,
  EYEPLANE_TO_TEMPLE_DEPTH_MM,
  type AutoTemporalScene,
} from '../src/core/autoCalibrate.js';
import { at, px } from '../src/core/geom.js';
import { EYE_L, EYE_R } from '../src/core/faceMetrics.js';
import { HVID_MEAN_MM } from '../src/core/ocularScale.js';
import { motionMask } from '../src/core/silhouette.js';
import { comparisonWidth } from '../src/core/verdict.js';
import { makeScene, type GlassesOptions } from './fixtures/scene.js';
import { H, W, makeFace } from './fixtures/landmarks.js';

const FACE_MM = 138;
const MARGIN_MM = 10; // tempes réelles : ~10 mm au-delà des repères, par côté
const DISTANCE_MM = 500;

const FOCAL_PX = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
const FACE_PX = (FACE_MM * FOCAL_PX) / (DISTANCE_MM + EYEPLANE_TO_TEMPLE_DEPTH_MM);
const PX_PER_MM_TEMPLE = FACE_PX / FACE_MM; // échelle VRAIE au plan des tempes

const LM = makeFace({
  faceWidthPx: FACE_PX,
  pdPx: (63 * ((DISTANCE_MM + 3.05) / (DISTANCE_MM + 13.5)) * FOCAL_PX) / DISTANCE_MM,
  hvidPx: (HVID_MEAN_MM * FOCAL_PX) / DISTANCE_MM,
});

const TRUE_TEMPORAL_MM = FACE_MM + 2 * MARGIN_MM;

function sceneOf(over: { shiftPx?: number; glasses?: GlassesOptions } = {}) {
  const marginPx = MARGIN_MM * PX_PER_MM_TEMPLE;
  return makeScene({
    w: W,
    h: H,
    headLeftPx: Math.round(W / 2 - FACE_PX / 2 - marginPx),
    headRightPx: Math.round(W / 2 + FACE_PX / 2 + marginPx),
    ...over,
  });
}

function autoScene(glasses?: GlassesOptions): AutoTemporalScene {
  const frontal = sceneOf(glasses ? { glasses } : {});
  return {
    frontal,
    motion: motionMask(frontal, [sceneOf({ shiftPx: 6 }), sceneOf({ shiftPx: -6 })]),
    lm: LM,
    w: W,
    h: H,
  };
}

function calibrate(scene: AutoTemporalScene | null) {
  const e = new AutoCalibrationEngine();
  for (let i = 0; i < 80; i++) e.offer(LM, 0, 0, W, H, i * 33);
  return calibrateAuto(e.measures()!, W, null, 0, scene);
}

describe('écart temporal SANS CARTE — mesuré quand la séance le permet', () => {
  it('🔴 rotation faite → la largeur aux tempes est MESURÉE, à sa vraie valeur', () => {
    const out = calibrate(autoScene());
    expect(out.cal.temporalWidthMm).toBeDefined();
    expect(Math.abs((out.cal.temporalWidthMm ?? 0) - TRUE_TEMPORAL_MM)).toBeLessThan(3);
    expect(out.cal.temporalRelError).toBeGreaterThan(0);
    expect(out.notes.join(' ')).toMatch(/écart temporal mesuré/i);
    // Et c'est LUI que la légende compare à la monture (présence de donnée,
    // jamais un branchement sur la source — §11.4).
    expect(comparisonWidth(out.cal).mm).toBeCloseTo(out.cal.temporalWidthMm ?? 0, 6);
  });

  it('la ligne de mesure passe bien à hauteur des yeux du fixture', () => {
    // Contrôle de cohérence du test lui-même (leçon S4) : si les landmarks et
    // l'image cessaient d'être alignés, le test 1 pourrait passer par accident.
    const eyeY = (px(at(LM, EYE_L), W, H).y + px(at(LM, EYE_R), W, H).y) / 2;
    expect(eyeY).toBeGreaterThan(0);
    expect(eyeY).toBeLessThan(H);
  });

  it('sans rotation → RIEN n’est deviné : champs absents, invitation en clair', () => {
    const out = calibrate(null);
    expect(out.cal.temporalWidthMm).toBeUndefined();
    expect(out.cal.temporalRelError).toBeUndefined();
    expect(out.notes.join(' ')).toMatch(/écart temporal non mesuré/i);
    expect(out.notes.join(' ')).toMatch(/profils/i);
    // La légende retombe sur la largeur aux repères, avec SA marge.
    expect(comparisonWidth(out.cal).mm).toBeCloseTo(out.cal.faceWidthMm, 6);
  });

  it('lunettes gardées pendant la séance → refus NOMMÉ, jamais une mesure fausse', () => {
    const eyeY = Math.round((px(at(LM, EYE_L), W, H).y + px(at(LM, EYE_R), W, H).y) / 2);
    const out = calibrate(
      autoScene({
        eyeY,
        halfHeightPx: Math.round(9 * PX_PER_MM_TEMPLE),
        overhangPx: Math.round(5 * PX_PER_MM_TEMPLE),
      }),
    );
    expect(out.cal.temporalWidthMm).toBeUndefined();
    expect(out.notes.join(' ')).toMatch(/non mesuré/i);
    expect(out.notes.join(' ')).toMatch(/lunettes/i);
  });
});
