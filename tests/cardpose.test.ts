/**
 * tests/cardpose.test.ts — la carte donne-t-elle vraiment la caméra ?
 *
 * La vérité terrain vient de `head3d.ts`, qui projette en perspective EXACTE
 * avec une focale et une distance connues par construction. Aucun de ces deux
 * nombres n'est communiqué au solveur : il ne reçoit que quatre coins en pixels,
 * exactement ce que le client ajuste à l'écran.
 */

import { describe, expect, it } from 'vitest';

import { cameraFromCard } from '../src/core/cardPose.js';
import { CalibrationError } from '../src/core/geom.js';
import {
  ADULTE,
  cardCornersPx,
  cardDistanceMm,
  focalPx,
  type CameraOptions,
} from './fixtures/head3d.js';

const W = 1280;
const H = 720;

const cam = (over: Partial<CameraOptions> = {}): CameraOptions => ({
  yawRad: 0,
  distanceMm: 780,
  w: W,
  h: H,
  ...over,
});

describe('la carte donne la caméra', () => {
  it('la focale est MESURÉE, pas supposée à 60° de champ', () => {
    const opts = cam();
    const r = cameraFromCard(cardCornersPx(ADULTE, opts), W, H);
    expect(r.focalPx).toBeCloseTo(focalPx(opts), 0);
  });

  // 🔴 LE test qui compte : si le solveur supposait un champ de 60°, il rendrait
  // la même focale pour les deux caméras. Il rend celle de chacune.
  it('un objectif plus large est retrouvé comme tel', () => {
    const large = cam({ hfovDeg: 90 });
    const serre = cam({ hfovDeg: 40 });

    const fl = cameraFromCard(cardCornersPx(ADULTE, large), W, H).focalPx;
    const fs = cameraFromCard(cardCornersPx(ADULTE, serre), W, H).focalPx;

    expect(fl).toBeCloseTo(focalPx(large), 0);
    expect(fs).toBeCloseTo(focalPx(serre), 0);
    expect(fs / fl).toBeGreaterThan(2); // deux objectifs franchement différents
  });

  it('la distance sort en millimètres, à toute distance', () => {
    for (const d of [620, 780, 1000]) {
      const opts = cam({ distanceMm: d });
      const r = cameraFromCard(cardCornersPx(ADULTE, opts), W, H);
      expect(r.cardDistanceMm).toBeCloseTo(cardDistanceMm(ADULTE, opts), 0);
    }
  });

  it('elle marche aussi tête tournée — le balayage n\'est pas perdu', () => {
    const opts = cam({ yawRad: 0.45 });
    const r = cameraFromCard(cardCornersPx(ADULTE, opts), W, H);
    expect(r.focalPx).toBeCloseTo(focalPx(opts), 0);
    expect(r.cardDistanceMm).toBeCloseTo(cardDistanceMm(ADULTE, opts), 0);
  });

  // Tête tournée, la carte fuit dans les DEUX directions : les deux contraintes
  // deviennent exploitables et se contrôlent l'une l'autre, comme le contrôle à
  // trois cotes du §4.
  it('tête tournée, les deux estimations indépendantes concordent', () => {
    const r = cameraFromCard(cardCornersPx(ADULTE, cam({ yawRad: 0.45 })), W, H);
    expect(r.focalSpread).toBeLessThan(0.01);
  });

  // ⚠️ Limite honnête, à ne pas maquiller : de face, la carte ne fuit que
  // verticalement. Le terme d'orthogonalité devient 0/0 et sort du calcul — il
  // ne reste qu'UNE estimation, donc aucun contrôle croisé. C'est une raison de
  // plus pour que la rotation existe, et le champ le dit au lieu de rendre un
  // écart de 0 % qui ferait croire à une concordance.
  it("de face, il ne reste qu'une estimation et le champ l'annonce", () => {
    const r = cameraFromCard(cardCornersPx(ADULTE, cam()), W, H);
    expect(Number.isNaN(r.focalSpread)).toBe(true);
    expect(r.focalPx).toBeCloseTo(focalPx(cam()), 0);
  });

  // 🔴 Le cas dégénéré, à refuser bruyamment plutôt qu'à rendre en silence :
  // sans perspective, un rectangle ne dit RIEN de l'objectif.
  it('une carte vue parfaitement de face est refusée, pas devinée', () => {
    const plate = cardCornersPx(ADULTE, cam(), 0); // aucune inclinaison
    expect(() => cameraFromCard(plate, W, H)).toThrow(CalibrationError);
  });

  it('quatre coins alignés sont refusés', () => {
    const ligne = [
      { x: 100, y: 300 },
      { x: 200, y: 300 },
      { x: 300, y: 300 },
      { x: 400, y: 300 },
    ] as const;
    expect(() => cameraFromCard(ligne, W, H)).toThrow(CalibrationError);
  });
});

/**
 * Ce que ça vaut face au bruit de pointage — la question qui décide de tout.
 *
 * Le client ajuste un cadre à la main. La focale, elle, sort d'un effet
 * perspectif du SECOND ordre : sur une carte de 85 mm vue à 78 cm, le raccourci
 * d'un bord à l'autre ne fait qu'un ou deux pixels. Le signal est donc au
 * niveau du bruit, et il faut le dire avec des chiffres plutôt que d'espérer.
 *
 * Bruit déterministe (générateur à graine fixe) : ces tests sont reproductibles.
 */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
}

const med = (a: readonly number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};
const mad = (a: readonly number[]): number => {
  const m = med(a);
  return med(a.map((x) => Math.abs(x - m))) * 1.4826;
};

function noisyQuad(opts: CameraOptions, r: () => number, sigma: number): never {
  return cardCornersPx(ADULTE, opts).map((p) => ({
    x: p.x + r() * 2 * sigma,
    y: p.y + r() * 2 * sigma,
  })) as never;
}

describe('ce que la carte vaut face au bruit de pointage', () => {
  // 🔴 À NE PAS « réparer ». Une seule vue est INSUFFISANTE, et le mesurer est
  // le seul moyen de ne pas remplacer un a priori honnête (780 mm ± 17 %) par
  // une mesure qui a l'air meilleure et qui est pire.
  it('une seule vue ne suffit pas, et de loin', () => {
    const opts = cam({ yawRad: 0.26 });
    const r = rng(4242);
    const rel: number[] = [];
    for (let k = 0; k < 300; k++) {
      try {
        rel.push(cameraFromCard(noisyQuad(opts, r, 0.5), W, H).focalPx / focalPx(opts));
      } catch {
        /* refus : compté comme non exploitable */
      }
    }
    expect(mad(rel)).toBeGreaterThan(0.15); // ±15 % au minimum sur UNE vue
  });

  // ⭐ Et voilà pourquoi la rotation n'est pas qu'un moyen de mesurer une
  // profondeur : elle donne 50 vues indépendantes de la même carte. Le bruit de
  // pointage, lui, n'est pas corrélé d'une image à l'autre — contrairement au
  // biais de parallaxe, que le moyennage ne touchera jamais.
  it('le balayage la rend meilleure que l’a priori qu’elle remplace', () => {
    const r = rng(777);
    const essais: number[] = [];
    for (let t = 0; t < 60; t++) {
      const fs: number[] = [];
      for (let i = 0; i < 50; i++) {
        const opts = cam({ yawRad: -0.52 + (1.04 * i) / 49 });
        try {
          fs.push(cameraFromCard(noisyQuad(opts, r, 0.5), W, H).focalPx / focalPx(opts));
        } catch {
          /* vue perdue */
        }
      }
      if (fs.length >= 4) essais.push(med(fs));
    }
    expect(med(essais)).toBeCloseTo(1, 1); // sans biais
    expect(mad(essais)).toBeLessThan(0.08); // ±8 %, contre ±17 % pour l'a priori
  });
});
