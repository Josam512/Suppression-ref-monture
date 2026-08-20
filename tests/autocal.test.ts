/**
 * tests/autocal.test.ts — la calibration automatique SE TERMINE, et le dit.
 *
 * Ces tests reproduisent d'abord les exigences de la mission (PARTIE XIII) :
 *
 *   1. **Calibration completion** : une séquence valide produit nécessairement
 *      `state = 'calibrated'` en un nombre FINI de frames.
 *   2. **No infinite collecting** : une calibration conclue n'accumule plus rien.
 *   3. **Failure reason** : une calibration non terminée a TOUJOURS une raison
 *      (`WHY_NOT_DONE`), et un échec nomme sa cause dominante.
 *   4. **State transition** : une seule transition vers `calibrated`, verrouillée.
 *   5. La séparation caméra/collecte : le moteur ne connaît PAS la caméra — il
 *      s'arrête, elle continue. (La caméra est testée au banc navigateur.)
 *
 * ⚠️ Règle d'architecture (mission §45), encodée ici : toute opération finie a
 * un état initial, une condition de réussite, une condition d'échec, une
 * dégradation au timeout, et une transition suivante. Si un de ces tests
 * rougit, c'est le moteur qu'on répare, jamais le test.
 */

import { describe, expect, it } from 'vitest';

import {
  AutoCalibrationEngine,
  AUTO_TIMEOUT_MS,
  MAX_AUTO_YAW_RAD,
  MIN_AUTO_FRAMES,
} from '../src/core/autoCalibration.js';
import {
  calibrateAuto,
  AUTO_ASSUMED_HFOV_DEG,
  EYEPLANE_TO_TEMPLE_DEPTH_MM,
} from '../src/core/autoCalibrate.js';
import { CalibrationError } from '../src/core/geom.js';
import { HVID_MEAN_MM } from '../src/core/ocularScale.js';
import { farPdFromNear } from '../src/core/pupillary.js';
import { H, W, makeFace } from './fixtures/landmarks.js';

/**
 * Une scène synthétique COHÉRENTE : caméra de focale f, yeux à `distanceMm`,
 * repères 234/454 en arrière de `EYEPLANE_TO_TEMPLE_DEPTH_MM`. La vérité
 * terrain est le PD de LOIN et la largeur au plan des tempes.
 */
function scene(over: Partial<{ distanceMm: number; pdFarMm: number; faceWidthMm: number }> = {}) {
  const distanceMm = over.distanceMm ?? 500;
  const pdFarMm = over.pdFarMm ?? 63;
  const faceWidthMm = over.faceWidthMm ?? 138;
  const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));

  // Le PD observé est le PD de PRÈS (convergence sur la caméra) : on inverse
  // exactement la formule que le code applique, pour une vérité sans biais.
  const pdNearMm = (pdFarMm * (distanceMm + 3.05)) / (distanceMm + 13.5);

  const mmPerPxEye = distanceMm / focalPx; // taille réelle d'un pixel au plan des yeux
  const templeDistance = distanceMm + EYEPLANE_TO_TEMPLE_DEPTH_MM;

  return {
    distanceMm,
    pdFarMm,
    faceWidthMm,
    lm: makeFace({
      // La largeur 234↔454 se projette depuis SON plan, plus lointain.
      faceWidthPx: (faceWidthMm * focalPx) / templeDistance,
      pdPx: pdNearMm / mmPerPxEye,
      hvidPx: HVID_MEAN_MM / mmPerPxEye,
    }),
  };
}

/** Nourrit le moteur de `n` frames valides, à ~30 im/s. */
function film(engine: AutoCalibrationEngine, n: number, lm = scene().lm, t0 = 0): number {
  for (let i = 0; i < n; i++) engine.offer(lm, 0, 0, W, H, t0 + i * 33);
  return t0 + n * 33;
}

describe('1. la calibration automatique SE TERMINE', () => {
  it('une séquence valide produit `calibrated` en un temps fini', () => {
    const e = new AutoCalibrationEngine();
    film(e, 80);
    expect(e.state).toBe('calibrated');
    expect(e.measures()).not.toBeNull();
    expect(e.measures()!.usableFrames).toBeGreaterThanOrEqual(MIN_AUTO_FRAMES);
  });

  it("…et le succès n'exige PAS d'attendre le timeout", () => {
    const e = new AutoCalibrationEngine();
    const end = film(e, 80);
    expect(end).toBeLessThan(AUTO_TIMEOUT_MS / 2);
    expect(e.measures()!.degraded).toBe(false);
  });
});

describe('2. une calibration conclue N’ACCUMULE PLUS RIEN', () => {
  it('les frames offertes après la conclusion sont sans effet', () => {
    const e = new AutoCalibrationEngine();
    film(e, 80);
    const frames = e.measures()!.usableFrames;
    film(e, 200, scene().lm, 10_000);
    expect(e.measures()!.usableFrames).toBe(frames);
    expect(e.status().usableFrames).toBe(frames);
  });
});

describe('3. une calibration non terminée a TOUJOURS une raison', () => {
  it('WHY_NOT_DONE dit combien de frames manquent', () => {
    const e = new AutoCalibrationEngine();
    film(e, 5);
    const why = e.status().whyNotDone;
    expect(why?.code).toBe('need-more-frames');
    expect(why?.label).toMatch(/5\/30/);
  });

  it('sans visage : la cause dominante est nommée, puis l’échec la porte', () => {
    const e = new AutoCalibrationEngine();
    for (let i = 0; i * 500 <= AUTO_TIMEOUT_MS + 500; i++) e.offer(null, 0, 0, W, H, i * 500);
    expect(e.state).toBe('failed');
    expect(e.failure()?.code).toBe('no-face');
    expect(e.status().whyNotDone?.label).toMatch(/face à la caméra/i);
  });

  it('tête toujours tournée : la consigne dit de regarder devant', () => {
    const e = new AutoCalibrationEngine();
    const lm = scene().lm;
    for (let i = 0; i * 500 <= AUTO_TIMEOUT_MS + 500; i++) {
      e.offer(lm, MAX_AUTO_YAW_RAD * 2, 0, W, H, i * 500);
    }
    expect(e.state).toBe('failed');
    expect(e.failure()?.code).toBe('turn-to-front');
  });

  it('🔴 trop près (~20 cm) : la calibration CONCLUT quand même — jamais un cul-de-sac (§14.7)', () => {
    // Constaté en réel le 2026-08-20 : un premier jet REFUSAIT les frames trop
    // proches ; sur un téléphone tenu à bout de bras la calibration ne pouvait
    // jamais aboutir — ni essayage, ni PD. La distance est désormais une NOTE :
    // la mesure conclut, la marge s'élargit, et le guidage est dit en clair.
    const s = scene({ distanceMm: 200 });
    const e = new AutoCalibrationEngine();
    film(e, 80, s.lm);
    expect(e.state).toBe('calibrated');
    const out = calibrateAuto(e.measures()!, W, null, 0);
    expect(out.notes.join(' ')).toMatch(/près du visage.*40–60 cm/);
    expect(Math.abs((out.cal.pdMm ?? NaN) - s.pdFarMm)).toBeLessThan(1.5); // le PD sort quand même
  });

  it('la note de distance s\'élargit avec la proximité, et disparaît à 40–60 cm', () => {
    const relAt = (distanceMm: number) => {
      const e = new AutoCalibrationEngine();
      film(e, 80, scene({ distanceMm }).lm);
      const out = calibrateAuto(e.measures()!, W, null, 0);
      return { rel: out.cal.relError, noted: /40–60 cm/.test(out.notes.join(' ')) };
    };
    const near = relAt(200);
    const fine = relAt(500);
    expect(near.noted).toBe(true);
    expect(fine.noted).toBe(false);
    expect(near.rel).toBeGreaterThan(fine.rel); // la marge dit la proximité, pas un refus
  });

  it('le timeout avec assez de matière CONCLUT au lieu d’échouer — et le dit', () => {
    const e = new AutoCalibrationEngine();
    const lm = scene().lm;
    // 15 frames utiles éparses sur 21 s : pas de convergence nominale possible.
    for (let i = 0; i < 15; i++) e.offer(lm, 0, 0, W, H, i * 1500);
    expect(e.state).toBe('calibrated');
    expect(e.measures()!.degraded).toBe(true);
  });
});

describe('4. UNE seule transition vers `calibrated`', () => {
  it('les mesures sont verrouillées : même objet, quoi qu’on offre ensuite', () => {
    const e = new AutoCalibrationEngine();
    film(e, 80);
    const first = e.measures();
    film(e, 100, scene({ distanceMm: 300 }).lm, 20_000);
    expect(e.measures()).toBe(first);
    expect(e.state).toBe('calibrated');
  });
});

describe('la MESURE elle-même — vérité terrain synthétique', () => {
  it('PD de loin retrouvé à mieux que 1 mm (scène idéale, prior exact)', () => {
    const s = scene();
    const e = new AutoCalibrationEngine();
    film(e, 80, s.lm);
    const out = calibrateAuto(e.measures()!, W, null, 0);
    expect(Math.abs((out.cal.pdMm ?? NaN) - s.pdFarMm)).toBeLessThan(1);
    expect(out.cal.pdLeftMm! + out.cal.pdRightMm!).toBeCloseTo(out.cal.pdMm!, 6);
  });

  it('largeur 234↔454 retrouvée malgré le changement de plan (yeux → tempes)', () => {
    const s = scene();
    const e = new AutoCalibrationEngine();
    film(e, 80, s.lm);
    const out = calibrateAuto(e.measures()!, W, null, 0);
    // Sans la correction de plan, l'erreur serait ~9 % (12 mm) : on exige < 3 %.
    expect(Math.abs(out.cal.faceWidthMm - s.faceWidthMm) / s.faceWidthMm).toBeLessThan(0.03);
  });

  it('INVARIANT : la distance à la caméra ne change pas la mesure', () => {
    const near = scene({ distanceMm: 350 });
    const far = scene({ distanceMm: 700 });
    const out = [near, far].map((s) => {
      const e = new AutoCalibrationEngine();
      film(e, 80, s.lm);
      return calibrateAuto(e.measures()!, W, null, 0);
    });
    expect(out[0]!.cal.pdMm!).toBeCloseTo(out[1]!.cal.pdMm!, 0);
    expect(Math.abs(out[0]!.cal.faceWidthMm - out[1]!.cal.faceWidthMm)).toBeLessThan(2);
  });

  it('l’incertitude annoncée ne descend JAMAIS sous le plancher du prior', () => {
    const e = new AutoCalibrationEngine();
    film(e, 300); // beaucoup de frames : le bruit tombe, le biais biologique reste
    const out = calibrateAuto(e.measures()!, W, null, 0);
    expect(out.cal.relError).toBeGreaterThan(0.03);
    expect(out.cal.pdRelError!).toBeGreaterThan(0.03);
  });

  it('un PD hors plage anatomique est REFUSÉ avec une cause, jamais publié', () => {
    const s = scene({ pdFarMm: 100 }); // yeux mal détectés simulés
    const e = new AutoCalibrationEngine();
    film(e, 80, s.lm);
    expect(() => calibrateAuto(e.measures()!, W, null, 0)).toThrow(CalibrationError);
  });

  it('la correction de convergence est appliquée dans le bon sens (+)', () => {
    // À 40 cm, un PD de près de 61,7 mm devient ~63 mm de loin.
    expect(farPdFromNear(61.72, 500)).toBeCloseTo(63.0, 1);
    expect(farPdFromNear(61.0, 300)).toBeGreaterThan(61.0);
  });
});
