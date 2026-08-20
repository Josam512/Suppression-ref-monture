/**
 * tests/detection.test.ts — la refonte de la couche détection (mission
 * 2026-08-20), en calcul pur : validité des frames AVANT inférence, et machine
 * d'état à transitions PROUVÉES (plus de retry aveugle).
 */

import { describe, expect, it } from 'vitest';

import { frameValidity, MIN_MEAN_LUMA } from '../src/tracking/frameFeed.js';
import {
  initialPlan,
  planStep,
  shouldProbe,
  PROBE_EVERY,
  SWAP_BLIND_AFTER,
  SWAP_WITH_EVIDENCE_AFTER,
  type DetectionObservation,
} from '../src/tracking/detectionPlan.js';

function rgba(pixels: Array<[number, number, number]>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
}

describe('couche 2 — une frame invalide est NOMMÉE, jamais « 0 visage »', () => {
  it('frame noire → invalide, cause « noire »', () => {
    const v = frameValidity(rgba(Array.from({ length: 64 }, () => [0, 0, 0])));
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/noire/);
  });

  it('frame uniforme (gris plein) → invalide, cause « uniforme »', () => {
    const v = frameValidity(rgba(Array.from({ length: 64 }, () => [128, 128, 128])));
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/uniforme/);
  });

  it('échantillon vide (canvas jamais rempli) → invalide, cause dédiée', () => {
    expect(frameValidity(new Uint8ClampedArray(0)).reason).toMatch(/vide/);
  });

  it('frame contrastée normale → valide, aucune raison', () => {
    const v = frameValidity(rgba(Array.from({ length: 64 }, (_, i) => [i * 4, 80, 200 - i * 3])));
    expect(v.valid).toBe(true);
    expect(v.reason).toBeNull();
    expect(v.meanLuma).toBeGreaterThan(MIN_MEAN_LUMA);
  });
});

const silent = (probeFound: boolean | null = null): DetectionObservation => ({
  frameValid: true,
  landmarksFound: false,
  probeFound,
});

describe('machine d’état — la bascule CPU exige une PREUVE', () => {
  it('sonde OUI + landmarker GPU muet → bascule CPU, raison nommée', () => {
    const plan = initialPlan();
    let swapped: string | null = null;
    for (let i = 0; i < SWAP_WITH_EVIDENCE_AFTER + 1 && swapped === null; i++) {
      const t = planStep(plan, silent(shouldProbe(plan) ? true : null));
      if (t.action === 'swap-to-cpu') swapped = t.reason;
    }
    expect(swapped).toMatch(/FaceDetector voit un visage/);
    expect(plan.delegate).toBe('CPU');
  });

  it('les DEUX muets → bascule par élimination, seulement après une longue attente', () => {
    const plan = initialPlan();
    let swappedAt = -1;
    let reason = '';
    for (let i = 1; i <= SWAP_BLIND_AFTER + 1 && swappedAt === -1; i++) {
      const t = planStep(plan, silent(shouldProbe(plan) ? false : null));
      if (t.action === 'swap-to-cpu') {
        swappedAt = i;
        reason = t.reason ?? '';
      }
    }
    expect(swappedAt).toBe(SWAP_BLIND_AFTER);
    expect(reason).toMatch(/élimination/);
  });

  it('🔴 les frames INVALIDES ne justifient JAMAIS une bascule de délégué', () => {
    const plan = initialPlan();
    for (let i = 0; i < SWAP_BLIND_AFTER * 3; i++) {
      const t = planStep(plan, { frameValid: false, landmarksFound: false, probeFound: null });
      expect(t.action).toBeNull();
    }
    expect(plan.delegate).toBe('GPU');
    expect(plan.silentValidFrames).toBe(0); // une entrée cassée ne dit rien des détecteurs
  });

  it('🔴 un délégué qui a DÉJÀ suivi un visage n’est jamais accusé (sortie du champ ≠ panne)', () => {
    const plan = initialPlan();
    planStep(plan, { frameValid: true, landmarksFound: true, probeFound: null });
    expect(plan.phase).toBe('tracking');
    for (let i = 0; i < SWAP_BLIND_AFTER * 2; i++) {
      const t = planStep(plan, silent(shouldProbe(plan) ? true : null));
      expect(t.action).toBeNull();
    }
    expect(plan.delegate).toBe('GPU');
  });

  it('la sonde tourne par échantillonnage, pas à chaque frame', () => {
    const plan = initialPlan();
    let probes = 0;
    for (let i = 0; i < PROBE_EVERY * 3; i++) {
      if (shouldProbe(plan)) probes++;
      planStep(plan, silent(null));
    }
    expect(probes).toBeGreaterThanOrEqual(2);
    expect(probes).toBeLessThanOrEqual(3);
  });

  it('après la bascule CPU, plus aucune autre bascule — pas de ping-pong', () => {
    const plan = initialPlan();
    for (let i = 0; i < SWAP_WITH_EVIDENCE_AFTER + 1; i++) {
      planStep(plan, silent(shouldProbe(plan) ? true : null));
    }
    expect(plan.delegate).toBe('CPU');
    for (let i = 0; i < SWAP_BLIND_AFTER * 2; i++) {
      expect(planStep(plan, silent(true)).action).toBeNull();
    }
    expect(plan.delegate).toBe('CPU');
  });
});
