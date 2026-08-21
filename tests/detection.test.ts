/**
 * tests/detection.test.ts — la couche détection, en calcul pur : validité des
 * frames AVANT inférence, échelle de stratégies TEMPORELLE (guide 2026-08-21,
 * points 6/11/12 : une seule Task en production, montées par élimination en
 * millisecondes — jamais en nombre de frames), et validation de la sortie du
 * modèle À LA FRONTIÈRE (point 16).
 */

import { describe, expect, it } from 'vitest';

import { frameValidity, MIN_MEAN_LUMA } from '../src/tracking/frameFeed.js';
import { landmarksInvalidReason, MIN_LANDMARKS } from '../src/tracking/faceLoop.js';
import {
  coordinateSpaceOf,
  currentStrategy,
  DETECTION_STRATEGIES,
  initialPlan,
  planStep,
  unpadPoint,
  SWAP_MIN_SILENT_FRAMES,
  SWAP_SILENT_MS,
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

/** Simule une cadence : n frames muettes valides espacées de `gapMs`. */
function feedSilent(plan: DetectionPlan, n: number, gapMs: number, startMs: number): number {
  let advanced = 0;
  for (let i = 0; i < n; i++) {
    const t = planStep(plan, { frameValid: true, landmarksFound: false, nowMs: startMs + i * gapMs });
    if (t.advanceTo !== null) advanced++;
  }
  return advanced;
}

describe('échelle de stratégies — montées TEMPORELLES, sans sonde (points 6/11/12)', () => {
  it('sans visage, l’échelle entière est gravie par élimination, en DURÉE', () => {
    const plan = initialPlan();
    expect(currentStrategy(plan).id).toBe('gpu');
    // 15 fps pendant 12 s : trois montées attendues (2,5 s de silence chacune).
    const advanced = feedSilent(plan, 180, 66, 0);
    expect(advanced).toBe(DETECTION_STRATEGIES.length - 1);
    expect(currentStrategy(plan).id).toBe('cpu-seuils');
  });

  it('le même code à 60 fps monte au même MOMENT, pas au même nombre de frames', () => {
    const lent = initialPlan();
    const rapide = initialPlan();
    // 15 fps vs 60 fps : première montée dans les deux cas vers ~2,5 s.
    let lentAt = -1;
    for (let i = 0; i < 300 && lentAt === -1; i++) {
      if (planStep(lent, { frameValid: true, landmarksFound: false, nowMs: i * 66 }).advanceTo !== null) lentAt = i * 66;
    }
    let rapideAt = -1;
    for (let i = 0; i < 1200 && rapideAt === -1; i++) {
      if (planStep(rapide, { frameValid: true, landmarksFound: false, nowMs: i * 16 }).advanceTo !== null) rapideAt = i * 16;
    }
    expect(lentAt).toBeGreaterThanOrEqual(SWAP_SILENT_MS);
    expect(rapideAt).toBeGreaterThanOrEqual(SWAP_SILENT_MS);
    expect(Math.abs(lentAt - rapideAt)).toBeLessThan(200); // même horloge, pas même compte
  });

  it('deux frames espacées de 3 s ne suffisent PAS : il faut aussi de la matière', () => {
    const plan = initialPlan();
    // Une caméra qui livre 2 frames en 4 s ne prouve pas une stratégie muette.
    expect(feedSilent(plan, SWAP_MIN_SILENT_FRAMES - 2, 500, 0)).toBe(0);
    expect(currentStrategy(plan).id).toBe('gpu');
  });

  it('🔴 les frames INVALIDES ne font JAMAIS monter l’échelle', () => {
    const plan = initialPlan();
    for (let i = 0; i < 500; i++) {
      const t = planStep(plan, { frameValid: false, landmarksFound: false, nowMs: i * 66 });
      expect(t.advanceTo).toBeNull();
    }
    expect(currentStrategy(plan).id).toBe('gpu');
    expect(plan.silentValidFrames).toBe(0); // une entrée cassée ne dit rien des détecteurs
  });

  it('🔴 sortie du champ ≠ panne : une stratégie qui a suivi n’est PAS soupçonnée avant la fenêtre prudente', () => {
    const plan = initialPlan();
    planStep(plan, { frameValid: true, landmarksFound: true, nowMs: 0 });
    expect(plan.phase).toBe('tracking');
    // ~18 s d'absence à 15 fps : bien plus qu'une pause, moins que la fenêtre prudente.
    expect(feedSilent(plan, 270, 66, 100)).toBe(0);
    expect(currentStrategy(plan).id).toBe('gpu');
    expect(plan.strategyEverTracked).toBe(true);
  });

  it('en haut de l’échelle : on continue de chercher, honnêtement — pas de ping-pong', () => {
    const plan = initialPlan();
    feedSilent(plan, 180, 66, 0); // gravit tout
    expect(currentStrategy(plan).id).toBe('cpu-seuils');
    expect(feedSilent(plan, 600, 66, 60_000)).toBe(0);
    expect(currentStrategy(plan).id).toBe('cpu-seuils');
    expect(plan.phase).toBe('searching');
  });

  it('A2 — silence anormalement LONG post-tracking : la MÊME stratégie est recréée, une fois', () => {
    const plan = initialPlan();
    planStep(plan, { frameValid: true, landmarksFound: true, nowMs: 0 });
    const actions: ReturnType<typeof planStep>[] = [];
    // ~26 s de frames valides muettes : UNE action attendue, la recréation.
    for (let i = 0; i < 400; i++) {
      const t = planStep(plan, { frameValid: true, landmarksFound: false, nowMs: 100 + i * 66 });
      if (t.advanceTo !== null) actions.push(t);
    }
    expect(actions).toHaveLength(1);
    expect(actions[0]!.recreate).toBe(true);
    expect(actions[0]!.advanceTo).toBe(0); // la MÊME marche, pas la suivante
    expect(actions[0]!.reason).toMatch(/recrée/);
    expect(currentStrategy(plan).id).toBe('gpu');
  });

  it('A2 — le retour du visage remet la reprise à zéro : chaque absence repaie la fenêtre entière', () => {
    const plan = initialPlan();
    planStep(plan, { frameValid: true, landmarksFound: true, nowMs: 0 });
    feedSilent(plan, 400, 66, 100); // → recréation déclenchée
    expect(plan.recoveryAttempts).toBe(1);
    planStep(plan, { frameValid: true, landmarksFound: true, nowMs: 30_000 }); // le client revient
    expect(plan.recoveryAttempts).toBe(0);
    expect(feedSilent(plan, 270, 66, 31_000)).toBe(0); // nouvelle absence courte : rien
    expect(currentStrategy(plan).id).toBe('gpu');
  });

  it('A2 — recréée et TOUJOURS muette une fenêtre complète : l’échelle descend enfin', () => {
    const plan = initialPlan();
    planStep(plan, { frameValid: true, landmarksFound: true, nowMs: 0 });
    const actions: ReturnType<typeof planStep>[] = [];
    // ~53 s de frames valides muettes : recréation, puis descente.
    for (let i = 0; i < 800; i++) {
      const t = planStep(plan, { frameValid: true, landmarksFound: false, nowMs: 100 + i * 66 });
      if (t.advanceTo !== null) actions.push(t);
    }
    expect(actions.length).toBeGreaterThanOrEqual(2);
    expect(actions[0]!.recreate).toBe(true); // d'abord la même…
    expect(actions[1]!.advanceTo).toBe(1); // …puis la marche suivante
    expect(actions[1]!.recreate).toBeUndefined();
    expect(plan.strategyEverTracked).toBe(false); // la nouvelle marche repart en acquisition rapide
  });

  it('A2 — en haut de l’échelle : une seule recréation par épisode, puis on cherche honnêtement', () => {
    const plan = initialPlan();
    feedSilent(plan, 180, 66, 0); // gravit tout sans jamais suivre
    expect(currentStrategy(plan).id).toBe('cpu-seuils');
    planStep(plan, { frameValid: true, landmarksFound: true, nowMs: 20_000 }); // suit enfin
    const actions: ReturnType<typeof planStep>[] = [];
    for (let i = 0; i < 900; i++) {
      const t = planStep(plan, { frameValid: true, landmarksFound: false, nowMs: 21_000 + i * 66 });
      if (t.advanceTo !== null) actions.push(t);
    }
    expect(actions).toHaveLength(1);
    expect(actions[0]!.recreate).toBe(true);
    expect(currentStrategy(plan).id).toBe('cpu-seuils'); // pas de ping-pong au sommet
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

  it('complément 9 — une stratégie paddée étiquette son repère : le Z y est inexploitable', () => {
    expect(coordinateSpaceOf(DETECTION_STRATEGIES[0]!)).toBe('direct');
    expect(coordinateSpaceOf(DETECTION_STRATEGIES[2]!)).toBe('padded-remapped');
    expect(coordinateSpaceOf(DETECTION_STRATEGIES[3]!)).toBe('padded-remapped');
  });
});

describe('frontière du tracking — la sortie du modèle est VALIDÉE (point 16)', () => {
  const full = (): Array<{ x: number; y: number }> =>
    Array.from({ length: MIN_LANDMARKS }, (_, i) => ({ x: (i % 100) / 100, y: (i % 90) / 90 }));

  it('478 landmarks finis → exploitable', () => {
    expect(landmarksInvalidReason(full())).toBeNull();
  });

  it('« aucun visage » (liste vide ou absente) n’est PAS « sortie invalide »', () => {
    expect(landmarksInvalidReason(undefined)).toBeNull();
    expect(landmarksInvalidReason([])).toBeNull();
  });

  it('sortie partielle (400 points) → rejetée localement, cause nommée', () => {
    expect(landmarksInvalidReason(full().slice(0, 400))).toMatch(/partielle.*400/);
  });

  it('landmark critique non fini (NaN sur l’iris 473) → rejetée, cause nommée', () => {
    const lm = full();
    lm[473] = { x: Number.NaN, y: 0.5 };
    expect(landmarksInvalidReason(lm)).toMatch(/473/);
  });

  it('landmark critique non fini (Infinity sur le sellion 168) → rejetée', () => {
    const lm = full();
    lm[168] = { x: 0.5, y: Number.POSITIVE_INFINITY };
    expect(landmarksInvalidReason(lm)).toMatch(/168/);
  });
});
