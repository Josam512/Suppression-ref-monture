/**
 * tests/livesteps.test.ts — la boucle ne pousse JAMAIS deux fois le même état.
 *
 * 🔴 Reproduit le bug A1 de l'audit : `stepRotation` publiait un rapport à
 * CHAQUE frame dès que le compte de vues stagnait sur un multiple de
 * `SWEEP_REPORT_EVERY` — zéro inclus, donc pendant toute séance où la carte
 * n'était pas trouvée. `setPhase` tournait alors à la cadence vidéo et React
 * re-rendait 30 à 60 fois par seconde, au moment précis où la détection avait
 * besoin du processeur.
 *
 * La règle verrouillée : une étape de boucle rend `null` quand RIEN n'a changé.
 */

import { describe, expect, it } from 'vitest';

import { AutoCalibrationEngine } from '../src/core/autoCalibration.js';
import type { CardQuad } from '../src/core/cardPose.js';
import type { ImageBuffer } from '../src/core/silhouette.js';
import { createLive, type Live } from '../src/ui/liveState.js';
import { stepAutoCalibration, stepRotation } from '../src/ui/liveSteps.js';
import { RotationProbe } from '../src/ui/rotationProbe.js';
import { ADULTE, cardCornersPx, type CameraOptions } from './fixtures/head3d.js';
import { H, W, makeFace } from './fixtures/landmarks.js';

const cam = (over: Partial<CameraOptions> = {}): CameraOptions => ({
  yawRad: 0,
  distanceMm: 500,
  w: W,
  h: H,
  ...over,
});

function liveOf(): Live {
  return createLive({ status: 'loading' }, null, null, 0);
}

describe('stepRotation ne publie que sur CHANGEMENT (bug A1)', () => {
  const lm = makeFace({ faceWidthPx: 420 });
  const buf: ImageBuffer = { data: new Uint8ClampedArray(4), width: 1, height: 1 };

  it('carte jamais trouvée, tête immobile : UN rapport, puis silence', () => {
    const s = liveOf();
    s.probe = new RotationProbe(
      () => buf,
      () => null, // la carte n'est jamais trouvée : cardViews reste à 0
    );

    let published = 0;
    for (let i = 0; i < 120; i++) {
      if (stepRotation(s, lm, 0, W, H) !== null) published++;
    }
    // L'ancien code publiait 120 fois. Un seul rapport initial est légitime.
    expect(published).toBeLessThanOrEqual(1);
  });

  it('chaque nouveau palier de vues est publié une fois, pas soixante', () => {
    const s = liveOf();
    const quad = cardCornersPx(ADULTE, cam()) as unknown as CardQuad;
    s.probe = new RotationProbe(
      () => buf,
      () => ({ quad, widthRatio: 0.62 }),
    );

    let published = 0;
    for (let i = 0; i < 100; i++) {
      if (stepRotation(s, lm, 0, W, H) !== null) published++;
    }
    // 100 vues = 20 paliers de SWEEP_REPORT_EVERY (+1 rapport initial).
    expect(published).toBeGreaterThan(10);
    expect(published).toBeLessThanOrEqual(22);
  });
});

describe('stepAutoCalibration suit la même discipline', () => {
  it('un état inchangé n’est jamais republié', () => {
    const s = liveOf();
    s.auto = new AutoCalibrationEngine();

    // Détection perdue en continu : deux publications légitimes au maximum —
    // l'état initial (0/30), puis le passage de WHY_NOT_DONE à « je ne vous
    // vois pas » quand les rejets dominent. Jamais une par frame.
    let published = 0;
    for (let i = 0; i < 100; i++) {
      if (stepAutoCalibration(s, null, 0, W, H, i * 33) !== null) published++;
    }
    expect(published).toBeLessThanOrEqual(2);
  });

  it('sans moteur (collecte terminée), l’étape est un no-op', () => {
    const s = liveOf();
    expect(stepAutoCalibration(s, makeFace({ faceWidthPx: 400 }), 0, W, H, 0)).toBeNull();
  });
});
