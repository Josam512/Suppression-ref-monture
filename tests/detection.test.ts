/**
 * tests/detection.test.ts — la couche détection (mission 2026-08-20), en calcul
 * pur : validité des frames AVANT inférence, et échelle de stratégies gravie
 * par PREUVES (plus de retry aveugle). L'échelle vient du cas mesuré sur
 * l'appareil réel : FaceDetector 0,91 / FaceLandmarker 0 sur la même frame.
 */

import { describe, expect, it } from 'vitest';

import { frameValidity, MIN_MEAN_LUMA } from '../src/tracking/frameFeed.js';
import {
  currentStrategy,
  DETECTION_STRATEGIES,
  initialPlan,
  planStep,
  shouldProbe,
  unpadPoint,
  PROBE_EVERY,
  SWAP_BLIND_AFTER,
  SWAP_WITH_EVIDENCE_AFTER,
  type DetectionObservation,
  type DetectionPlan,
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

/** Nourrit des frames muettes jusqu'à la prochaine montée ; rend sa raison. */
function feedUntilAdvance(plan: DetectionPlan, probeSees: boolean, cap: number): string | null {
  for (let i = 0; i < cap; i++) {
    const t = planStep(plan, silent(shouldProbe(plan) ? probeSees : null));
    if (t.advanceTo !== null) return t.reason;
  }
  return null;
}

describe('échelle de stratégies — chaque montée exige une PREUVE', () => {
  it('sonde OUI + landmarker muet → montée, raison nommée, dans l’ordre de l’échelle', () => {
    const plan = initialPlan();
    expect(currentStrategy(plan).id).toBe('gpu');
    const r1 = feedUntilAdvance(plan, true, SWAP_WITH_EVIDENCE_AFTER + 1);
    expect(r1).toMatch(/FaceDetector voit un visage/);
    expect(currentStrategy(plan).id).toBe('cpu');
    const r2 = feedUntilAdvance(plan, true, SWAP_WITH_EVIDENCE_AFTER + 1);
    expect(r2).toMatch(/marge/);
    expect(currentStrategy(plan).id).toBe('cpu-marge');
    const r3 = feedUntilAdvance(plan, true, SWAP_WITH_EVIDENCE_AFTER + 1);
    expect(r3).toMatch(/seuils/);
    expect(currentStrategy(plan).id).toBe('cpu-seuils');
  });

  it('les DEUX muets → montée par élimination, seulement après une longue attente', () => {
    const plan = initialPlan();
    let swappedAt = -1;
    let reason = '';
    for (let i = 1; i <= SWAP_BLIND_AFTER + 1 && swappedAt === -1; i++) {
      const t = planStep(plan, silent(shouldProbe(plan) ? false : null));
      if (t.advanceTo !== null) {
        swappedAt = i;
        reason = t.reason ?? '';
      }
    }
    expect(swappedAt).toBe(SWAP_BLIND_AFTER);
    expect(reason).toMatch(/élimination/);
  });

  it('🔴 SONDE INDISPONIBLE : l’échelle monte QUAND MÊME (jamais de blocage)', () => {
    // Le bug mesuré sur l'appareil réel le 2026-08-21 : la montée par
    // élimination exigeait `probeTried > 0`. Sonde non chargée ⇒ compteur à
    // zéro ⇒ échelle figée sur la première marche À VIE. 1199 frames perdues,
    // toujours en « délégué GPU ». Une élimination qui dépend d'un témoin
    // n'est pas une élimination.
    const plan = initialPlan();
    let advanced = 0;
    let lastReason = '';
    // `probeFound` reste TOUJOURS null : la sonde n'a jamais tourné.
    for (let i = 0; i < SWAP_BLIND_AFTER * (DETECTION_STRATEGIES.length + 1); i++) {
      const t = planStep(plan, { frameValid: true, landmarksFound: false, probeFound: null });
      if (t.advanceTo !== null) {
        advanced++;
        lastReason = t.reason ?? '';
      }
    }
    expect(advanced).toBe(DETECTION_STRATEGIES.length - 1); // toute l'échelle gravie
    expect(currentStrategy(plan).id).toBe('cpu-seuils');
    expect(lastReason).toMatch(/sonde indisponible/);
  });

  it('🔴 les frames INVALIDES ne font JAMAIS monter l’échelle', () => {
    const plan = initialPlan();
    for (let i = 0; i < SWAP_BLIND_AFTER * 3; i++) {
      const t = planStep(plan, { frameValid: false, landmarksFound: false, probeFound: null });
      expect(t.advanceTo).toBeNull();
    }
    expect(currentStrategy(plan).id).toBe('gpu');
    expect(plan.silentValidFrames).toBe(0); // une entrée cassée ne dit rien des détecteurs
  });

  it('🔴 une stratégie qui a DÉJÀ suivi un visage n’est jamais quittée (sortie du champ ≠ panne)', () => {
    const plan = initialPlan();
    planStep(plan, { frameValid: true, landmarksFound: true, probeFound: null });
    expect(plan.phase).toBe('tracking');
    for (let i = 0; i < SWAP_BLIND_AFTER * 2; i++) {
      expect(planStep(plan, silent(shouldProbe(plan) ? true : null)).advanceTo).toBeNull();
    }
    expect(currentStrategy(plan).id).toBe('gpu');
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

  it('en haut de l’échelle : on continue de chercher, honnêtement — pas de ping-pong', () => {
    const plan = initialPlan();
    for (let i = 0; i < DETECTION_STRATEGIES.length - 1; i++) {
      expect(feedUntilAdvance(plan, true, SWAP_WITH_EVIDENCE_AFTER + 1)).not.toBeNull();
    }
    expect(currentStrategy(plan).id).toBe('cpu-seuils');
    for (let i = 0; i < SWAP_BLIND_AFTER * 2; i++) {
      expect(planStep(plan, silent(true)).advanceTo).toBeNull();
    }
    expect(currentStrategy(plan).id).toBe('cpu-seuils');
    expect(plan.phase).toBe('searching');
  });

  it('l’échelle finit sur la stratégie la plus permissive : marge + seuils 0,25 en CPU', () => {
    const last = DETECTION_STRATEGIES[DETECTION_STRATEGIES.length - 1]!;
    expect(last.minConfidence).toBe(0.25);
    expect(last.padFraction).not.toBeNull();
    expect(last.delegate).toBe('CPU');
  });

  it('le dé-mappage de la marge est EXACT : centre → centre, bords → bords', () => {
    // Position, dans le cadre paddé, d'un point situé à xn du cadre d'origine :
    const padded = (xn: number, p: number): number => (p + xn) / (1 + 2 * p);
    for (const p of [0.1, 0.25, 0.4]) {
      for (const xn of [0, 0.25, 0.5, 0.77, 1]) {
        expect(unpadPoint(padded(xn, p), p)).toBeCloseTo(xn, 12);
      }
    }
  });
});
