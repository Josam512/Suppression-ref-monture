/**
 * tests/plane.test.ts — LE PLAN dans lequel le sprite est mis à l'échelle.
 *
 * Demandé par l'audit humain du 2026-08-21, point 2 : « si la monture rétrécit
 * au passage aperçu → calibré, considère cela comme un bug de plan d'échelle ».
 *
 * Elle rétrécissait. Mesuré AVANT correctif, sur la même frame de synthèse :
 *
 *     distance    visage aperçu → calibré      sprite peint
 *      400 mm       124,0 → 138,0 mm             −10,1 %
 *      500 mm       126,6 → 138,0 mm              −8,3 %
 *      700 mm       129,7 → 138,0 mm              −6,0 %
 *
 * Cause : l'aperçu convertissait une largeur prise au plan des TEMPES avec un
 * mm/px valable au plan des YEUX. Il sous-estimait donc le visage, surestimait
 * `livePxPerMm`, et peignait la monture TROP LARGE — puis elle rétrécissait
 * d'un coup. Le correctif ne compense rien : l'aperçu passe désormais par la
 * MÊME chaîne d'assemblage que la mesure définitive, donc la discontinuité de
 * plan ne peut plus exister.
 *
 * ⚠️ Ces tests ne touchent pas aux demi-PD : l'aperçu déclare `splitFrames = 0`,
 * donc il n'en publie aucun (architecture inchangée, exigence de l'audit).
 */

import { describe, expect, it } from 'vitest';

import { AutoCalibrationEngine, IRIS_DISCREPANCY_MAX } from '../src/core/autoCalibration.js';
import {
  AUTO_ASSUMED_HFOV_DEG,
  EYEPLANE_TO_TEMPLE_DEPTH_MM,
  calibrateAuto,
} from '../src/core/autoCalibrate.js';
import { ENDPIECE_AHEAD_MM } from '../src/core/framePlane.js';
import { frameMetrics } from '../src/core/faceMetrics.js';
import { provisionalScale } from '../src/core/provisionalScale.js';
import { renderedFrameWidthPx } from '../src/core/transform.js';
import { HVID_MEAN_MM } from '../src/core/ocularScale.js';
import { specForTotalWidthMm, W, H } from './fixtures/builders.js';
import { makeFace } from './fixtures/landmarks.js';

const TRUE_FACE_MM = 138;
const DISTANCES = [400, 500, 600, 700];

/** Scène cohérente : les tempes projettent depuis LEUR plan, plus lointain. */
function face(distanceMm: number) {
  const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
  const mmPerPxEye = distanceMm / focalPx;
  return makeFace({
    faceWidthPx: (TRUE_FACE_MM * focalPx) / (distanceMm + EYEPLANE_TO_TEMPLE_DEPTH_MM),
    pdPx: 62 / mmPerPxEye,
    hvidPx: HVID_MEAN_MM / mmPerPxEye,
  });
}

/** La calibration convergée sur cette même frame, répétée. */
function calibrated(lm: ReturnType<typeof face>) {
  const e = new AutoCalibrationEngine();
  for (let i = 0; i < 80; i++) e.offer(lm, 0, 0, W, H, i * 33);
  return calibrateAuto(e.measures()!, W, null, 0, null).cal;
}

describe('plan d’échelle — l’aperçu et la mesure peignent la MÊME largeur', () => {
  const spec = specForTotalWidthMm(134, { slug: 'plan-134' });

  for (const d of DISTANCES) {
    it(`🔴 à ${d} mm : aucun saut de taille au passage aperçu → calibré`, () => {
      const lm = face(d);
      const prov = provisionalScale(lm, W, H, IRIS_DISCREPANCY_MAX, 0);
      expect(prov).not.toBeNull();
      const cal = calibrated(lm);

      const mP = frameMetrics(lm, W, H, prov!.cal, 0);
      const mC = frameMetrics(lm, W, H, cal, 0);

      // 1. la largeur de visage retenue
      expect(prov!.cal.faceWidthMm).toBeCloseTo(cal.faceWidthMm, 6);
      // 2. l'échelle live
      expect(mP.livePxPerMm).toBeCloseTo(mC.livePxPerMm, 6);
      // 3. les pixels RÉELLEMENT peints — la seule grandeur que l'œil juge
      const wP = renderedFrameWidthPx(spec, mP);
      const wC = renderedFrameWidthPx(spec, mC);
      expect(Math.abs(wC / wP - 1)).toBeLessThan(0.005); // < 0,5 %
    });
  }

  it('🔴 l’aperçu retrouve la VRAIE largeur, pas celle du plan des yeux', () => {
    // Le test qui rougirait si quelqu'un remettait la conversion au plan des
    // yeux : elle rendait 124–130 mm là où la vérité terrain vaut 138.
    for (const d of DISTANCES) {
      const prov = provisionalScale(face(d), W, H, IRIS_DISCREPANCY_MAX, 0)!;
      expect(prov.cal.faceWidthMm).toBeCloseTo(TRUE_FACE_MM, 0);
    }
  });

  it('l’écart de plan yeux ↔ tempes est bien ce qui causait le saut', () => {
    // Documente l'ordre de grandeur, et le rend vérifiable : le saut mesuré
    // avant correctif (−10,1 % à 400 mm) est exactement ce rapport-là.
    const d = 400;
    const ratio = d / (d + EYEPLANE_TO_TEMPLE_DEPTH_MM);
    expect(1 - ratio).toBeCloseTo(0.101, 2);
  });

  it('le plan des TENONS reste non corrigé, et c’est délibéré (§14.4)', () => {
    // La largeur de la monture se réalise à ses tenons, ~8 mm devant 234/454,
    // avec 75 % d'incertitude : au-delà de la barre que le projet s'est fixée,
    // corriger déplacerait l'erreur. Ce test verrouille l'ABSENCE de correction.
    const d = 500;
    const lm = face(d);
    const m = frameMetrics(lm, W, H, calibrated(lm), 0);
    const spec2 = specForTotalWidthMm(134, { slug: 'plan-134b' });
    const painted = renderedFrameWidthPx(spec2, m);
    const atTemple = 134 * m.livePxPerMm;
    expect(painted).toBeCloseTo(atTemple, 0); // aucun facteur de plan appliqué
    expect(ENDPIECE_AHEAD_MM / d).toBeLessThan(0.02); // ce qu'on choisit d'ignorer
  });
});
