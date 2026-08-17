/**
 * tests/cardedges.test.ts — l'accrochage des coins, et le balayage.
 *
 * L'image est synthétique mais les coins sont connus au sous-pixel près : c'est
 * la seule façon de savoir si le raffinage gagne réellement en précision, ou
 * s'il se contente de recopier le cadre qu'on lui a donné.
 */

import { describe, expect, it } from 'vitest';

import { refineQuad, MAX_CORNER_SHIFT_PX } from '../src/core/cardEdges.js';
import { cameraFromSweep, measureDistance, MIN_SWEEP_VIEWS } from '../src/core/cardSweep.js';
import { cameraFromCard, type CardQuad } from '../src/core/cardPose.js';
import { CalibrationError } from '../src/core/geom.js';
import type { ImageBuffer } from '../src/core/silhouette.js';
import { ADULTE, cardCornersPx, cardDistanceMm, focalPx, type CameraOptions } from './fixtures/head3d.js';

const W = 640;
const H = 480;

const cam = (o: Partial<CameraOptions> = {}): CameraOptions => ({
  yawRad: 0,
  distanceMm: 780,
  w: 1280,
  h: 720,
  ...o,
});

/** Vrai si le point est dans le quadrilatère (test du demi-plan, convexe). */
function inside(q: CardQuad, x: number, y: number): boolean {
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
  }
  return true;
}

/** Une carte claire sur un fond sombre, avec anticrénelage 4×4 — donc du sous-pixel. */
function render(q: CardQuad): ImageBuffer {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          if (inside(q, x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits++;
        }
      }
      const v = 40 + (hits / 16) * 180;
      const o = (y * W + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { data, width: W, height: H } as ImageBuffer;
}

/** Carte franchement inclinée, coins connus exactement. */
const VRAI: CardQuad = [
  { x: 180, y: 150 },
  { x: 470, y: 168 },
  { x: 462, y: 330 },
  { x: 172, y: 300 },
];

const decale = (q: CardQuad, d: readonly number[]): CardQuad =>
  q.map((p, i) => ({ x: p.x + (d[2 * i] ?? 0), y: p.y + (d[2 * i + 1] ?? 0) })) as unknown as CardQuad;

describe("l'accrochage des coins", () => {
  it('un cadre approximatif est ramené sur les vrais bords', () => {
    const img = render(VRAI);
    const seed = decale(VRAI, [4, -3, -5, 4, 3, 3, -4, -4]);

    const avant = Math.max(...VRAI.map((p, i) => Math.hypot(p.x - seed[i]!.x, p.y - seed[i]!.y)));
    const out = refineQuad(img, seed);
    const apres = Math.max(...VRAI.map((p, i) => Math.hypot(p.x - out[i]!.x, p.y - out[i]!.y)));

    expect(avant).toBeGreaterThan(4);
    expect(apres).toBeLessThan(0.15); // sous-pixel : c'est tout l'enjeu (§cardSweep)
  });

  // ⭐ « Si le client met son doigt sur un coin, tu peux déduire où est l'autre. »
  // Un seul coin juste et trois franchement faux : les bords ramènent le tout.
  it('un seul coin juste suffit à récupérer les trois autres', () => {
    const img = render(VRAI);
    const seed = decale(VRAI, [0, 0, 6, -5, -6, 6, 5, 5]);
    const out = refineQuad(img, seed);
    for (let i = 0; i < 4; i++) {
      expect(Math.hypot(out[i]!.x - VRAI[i]!.x, out[i]!.y - VRAI[i]!.y)).toBeLessThan(0.15);
    }
  });

  it('un cadre posé loin de la carte est REFUSÉ, pas rapproché au hasard', () => {
    const img = render(VRAI);
    const seed = decale(VRAI, Array.from({ length: 8 }, () => 3 * MAX_CORNER_SHIFT_PX));
    expect(() => refineQuad(img, seed)).toThrow(CalibrationError);
  });

  it('une image sans contraste est refusée', () => {
    const plat: ImageBuffer = { data: new Uint8ClampedArray(W * H * 4).fill(120), width: W, height: H } as ImageBuffer;
    expect(() => refineQuad(plat, VRAI)).toThrow(CalibrationError);
  });
});

describe('la focale sort du balayage', () => {
  const sweepQuads = (n: number): CardQuad[] =>
    Array.from({ length: n }, (_, i) =>
      cardCornersPx(ADULTE, cam({ yawRad: -0.5 + (1.0 * i) / (n - 1) })) as unknown as CardQuad,
    );

  it('cinquante vues donnent la focale et la distance', () => {
    const s = cameraFromSweep(sweepQuads(50), 1280, 720);
    expect(s.focalPx).toBeCloseTo(focalPx(cam()), 0);
    expect(s.views).toBeGreaterThanOrEqual(MIN_SWEEP_VIEWS);

    const frontal = cardCornersPx(ADULTE, cam()) as unknown as CardQuad;
    const d = measureDistance(frontal, s, 1280, 720);
    expect(d.cardDistanceMm).toBeCloseTo(cardDistanceMm(ADULTE, cam()), 0);
  });

  // 🔴 Trop peu de vues : on garde l'a priori plutôt qu'une mesure plus bruitée
  // que lui. C'est le refus qui a de la valeur ici, pas le calcul.
  it('trop peu de vues → refus explicite, pas une focale au hasard', () => {
    expect(() => cameraFromSweep(sweepQuads(20).slice(0, 3), 1280, 720)).toThrow(CalibrationError);
  });

  it('la distance à focale connue est du PREMIER ordre, donc robuste', () => {
    // Même bruit de pointage que celui qui ruine la focale sur une vue : ici il
    // ne coûte presque rien, parce que la carte est simplement plus ou moins
    // grande. C'est pourquoi les deux rôles sont séparés (§cardSweep).
    const opts = cam();
    const s = cameraFromSweep(sweepQuads(50), 1280, 720);
    const vrai = cardDistanceMm(ADULTE, opts);
    const bruite = (cardCornersPx(ADULTE, opts) as unknown as CardQuad).map((p, i) => ({
      x: p.x + (i % 2 === 0 ? 0.5 : -0.5),
      y: p.y + (i < 2 ? -0.5 : 0.5),
    })) as unknown as CardQuad;

    const d = measureDistance(bruite, s, 1280, 720).cardDistanceMm;
    expect(Math.abs(d / vrai - 1)).toBeLessThan(0.02);

    // …alors que la MÊME image, seule, rend une focale franchement fausse.
    const seule = cameraFromCard(bruite, 1280, 720).focalPx;
    expect(Math.abs(seule / focalPx(opts) - 1)).toBeGreaterThan(0.05);
  });
});
