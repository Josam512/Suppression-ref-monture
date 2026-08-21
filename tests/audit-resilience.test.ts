import { describe, expect, it } from 'vitest';

import {
  initialPlan,
  planStep,
  RESTART_TRACKED_AFTER,
} from '../src/tracking/detectionPlan.js';
import {
  isProfileForDevice,
  mergeProfile,
  type CameraProfile,
} from '../src/core/cameraProfile.js';
import { AutoCalibrationEngine, IRIS_DISCREPANCY_MAX } from '../src/core/autoCalibration.js';
import { provisionalScale } from '../src/core/provisionalScale.js';
import { calibrateAuto, EYEPLANE_TO_TEMPLE_DEPTH_MM } from '../src/core/autoCalibrate.js';
import { HVID_MEAN_MM } from '../src/core/ocularScale.js';
import { makeFace } from './fixtures/landmarks.js';
import { W, H } from './fixtures/builders.js';

describe('résilience détection — une stratégie déjà bonne ne devient pas un cul-de-sac', () => {
  it('une longue perte redémarre la même stratégie UNE fois, sans escalade aveugle', () => {
    const p = initialPlan();
    planStep(p, { frameValid: true, landmarksFound: true, probeFound: null });

    let restarts = 0;
    for (let i = 0; i < RESTART_TRACKED_AFTER * 3; i++) {
      const t = planStep(p, { frameValid: true, landmarksFound: false, probeFound: null });
      if (t.restartCurrent) restarts++;
      expect(t.advanceTo).toBeNull();
    }
    expect(restarts).toBe(1);
    expect(p.strategyIndex).toBe(0);
  });

  it('après retour des landmarks, un futur incident peut de nouveau déclencher un restart', () => {
    const p = initialPlan();
    planStep(p, { frameValid: true, landmarksFound: true, probeFound: null });
    for (let i = 0; i < RESTART_TRACKED_AFTER; i++)
      planStep(p, { frameValid: true, landmarksFound: false, probeFound: null });
    expect(p.restartedSinceTrack).toBe(true);

    planStep(p, { frameValid: true, landmarksFound: true, probeFound: null });
    expect(p.restartedSinceTrack).toBe(false);
  });
});

describe('profil caméra — une focale ne traverse pas les objectifs', () => {
  const profile = (deviceId?: string): CameraProfile => ({
    focalPerWidth: 0.9,
    relError: 0.04,
    views: 20,
    measuredAt: 1,
    ...(deviceId ? { deviceId } : {}),
  });

  it('un profil lié à A est refusé sur B', () => {
    expect(isProfileForDevice(profile('A'), 'A')).toBe(true);
    expect(isProfileForDevice(profile('A'), 'B')).toBe(false);
  });

  it('deux profils explicitement issus de caméras différentes ne sont jamais moyennés', () => {
    const fresh = { ...profile('B'), focalPerWidth: 0.72, measuredAt: 2 };
    expect(mergeProfile(profile('A'), fresh)).toEqual(fresh);
  });
});

describe('aperçu → calibré — le même profil caméra doit donner la même géométrie', () => {
  it('un profil focal mémorisé est utilisé dans les DEUX chaînes', () => {
    const profile: CameraProfile = {
      focalPerWidth: 0.9,
      relError: 0.03,
      views: 20,
      measuredAt: 0,
    };
    const distanceMm = 500;
    const focalPx = profile.focalPerWidth * W;
    const mmPerPxEye = distanceMm / focalPx;
    const lm = makeFace({
      faceWidthPx: (138 * focalPx) / (distanceMm + EYEPLANE_TO_TEMPLE_DEPTH_MM),
      pdPx: 62 / mmPerPxEye,
      hvidPx: HVID_MEAN_MM / mmPerPxEye,
    });

    const prov = provisionalScale(lm, W, H, IRIS_DISCREPANCY_MAX, 0, profile);
    expect(prov).not.toBeNull();

    const engine = new AutoCalibrationEngine();
    for (let i = 0; i < 80; i++) engine.offer(lm, 0, 0, W, H, i * 33);
    const final = calibrateAuto(engine.measures()!, W, profile, 0).cal;

    expect(prov!.cal.faceWidthMm).toBeCloseTo(final.faceWidthMm, 6);
  });
});
