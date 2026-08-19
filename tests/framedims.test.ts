/**
 * tests/framedims.test.ts — chaque cote RÉELLE de la monture pèse sur le rendu.
 *
 * Cas synthétiques déterministes exigés par la vérification du 2026-08-19 :
 * largeurs 100/120/140/160 sur le MÊME visage, hauteurs différentes à largeur
 * égale, ponts différents à A/B égaux, branches 140/150, largeur totale ≠
 * 2A + pont. Aucune normalisation esthétique n'a le droit d'exister.
 *
 * ⚠️ Rappel d'architecture : la géométrie (forme, hauteur, position du pont)
 * vient des PIXELS de la vraie photo ; A, B et pont CALIBRENT et VÉRIFIENT
 * l'échelle de cette photo (contrôle de cohérence à 3 cotes, §4). Les tests
 * ci-dessous vérifient que la chaîne photo → affine → écran transmet bien ces
 * différences, au millimètre.
 */

import { describe, expect, it } from 'vitest';

import { frameMetrics } from '../src/core/faceMetrics.js';
import {
  apply,
  renderedFrameHeightPx,
  renderedFrameWidthPx,
  renderedTempleLengthPx,
  spriteToScreen,
  templeAffine,
  templeLengthMm,
} from '../src/core/transform.js';
import { totalFrameWidthMm } from '../src/core/frameSpec.js';
import { makeCal, specForTotalWidthMm, SPRITE_PX_PER_MM, W, H } from './fixtures/builders.js';
import { LANDMARKS_138, makeFaceAtYaw } from './fixtures/landmarks.js';

const M0 = frameMetrics(LANDMARKS_138, W, H, makeCal(), 0);

describe('LARGEUR : 100 → 160 mm sur le même visage, sans normalisation', () => {
  it('la largeur peinte vaut EXACTEMENT la largeur réelle × l’échelle du visage', () => {
    let previous = 0;
    for (const mm of [100, 120, 140, 160]) {
      const spec = specForTotalWidthMm(mm);
      const paintedMm = renderedFrameWidthPx(spec, M0) / M0.livePxPerMm;
      expect(paintedMm).toBeCloseTo(mm, 6); // pas « à peu près » : exactement
      expect(paintedMm * M0.livePxPerMm).toBeGreaterThan(previous); // strictement croissant
      previous = paintedMm * M0.livePxPerMm;
    }
  });

  it('le padding transparent du fichier ne change RIEN (B3, re-vérifié ici)', () => {
    const serre = specForTotalWidthMm(160, { paddingPx: 0 });
    const pade = specForTotalWidthMm(160, { paddingPx: 80 });
    expect(renderedFrameWidthPx(pade, M0)).toBeCloseTo(renderedFrameWidthPx(serre, M0), 6);
  });
});

describe('COTE B : même largeur, hauteurs franchement différentes', () => {
  // Deux « A52 » de même largeur totale ; leurs PHOTOS (bbox alpha) portent
  // des hauteurs de 40 et 55 mm — c'est le cas A52 B30 vs A52 B45, la hauteur
  // hors-tout dépassant B de l'épaisseur du cerclage.
  const basse = {
    ...specForTotalWidthMm(122, { slug: 'a52-b30' }),
    bMm: 30,
    alphaBBox: { ...specForTotalWidthMm(122).alphaBBox, h: 40 * SPRITE_PX_PER_MM },
  };
  const haute = {
    ...specForTotalWidthMm(122, { slug: 'a52-b45' }),
    bMm: 45,
    alphaBBox: { ...specForTotalWidthMm(122).alphaBBox, h: 55 * SPRITE_PX_PER_MM },
  };

  it('largeur de verre identique à l’écran, hauteur clairement différente', () => {
    expect(renderedFrameWidthPx(haute, M0)).toBeCloseTo(renderedFrameWidthPx(basse, M0), 6);
    const hBasse = renderedFrameHeightPx(basse, M0) / M0.livePxPerMm;
    const hHaute = renderedFrameHeightPx(haute, M0) / M0.livePxPerMm;
    expect(hBasse).toBeCloseTo(40, 6);
    expect(hHaute).toBeCloseTo(55, 6);
    // ⚠️ L'échelle est ISOTROPE : c'est la photo qui porte la hauteur réelle,
    // et B sert de contrôle de cohérence à la préparation. Aucun étirement
    // vertical séparé n'existe — il déformerait la vraie photo (§1 bug #2).
  });
});

describe('DBL / PONT : 52□14 et 52□22 ne se ressemblent pas', () => {
  // Même A (52) : les centres optiques sont à (A + DBL)/2 du pont, la largeur
  // totale suit 2A + DBL (+ tenons, ici nuls pour isoler l'effet du pont).
  const dbl = (pont: number) =>
    specForTotalWidthMm(2 * 52 + pont, {
      slug: `52-${pont}`,
      lensLeverPx: ((52 + pont) / 2) * SPRITE_PX_PER_MM,
    });
  const p14 = dbl(14);
  const p22 = dbl(22);

  it('l’écart entre les deux centres optiques à l’écran suit le pont réel', () => {
    const gapMm = (s: typeof p14) =>
      Math.hypot(
        spriteToScreen(s.lensCenterR, s, M0).x - spriteToScreen(s.lensCenterL, s, M0).x,
        spriteToScreen(s.lensCenterR, s, M0).y - spriteToScreen(s.lensCenterL, s, M0).y,
      ) / M0.livePxPerMm;
    expect(gapMm(p14)).toBeCloseTo(66, 6); // A + DBL = 52 + 14
    expect(gapMm(p22)).toBeCloseTo(74, 6); // A + DBL = 52 + 22
  });

  it('et la largeur totale peinte diffère de 8 mm exactement', () => {
    const wMm = (s: typeof p14) => renderedFrameWidthPx(s, M0) / M0.livePxPerMm;
    expect(wMm(p22) - wMm(p14)).toBeCloseTo(8, 6);
  });
});

describe('LARGEUR TOTALE : mesurée sur les pixels, jamais 2A + DBL', () => {
  it('des tenons de 3 mm par côté rendent la monture PLUS large que 2A + DBL', () => {
    // 52□18 avec tenons : la bbox alpha fait 128 mm là où 2A + DBL = 122.
    const spec = specForTotalWidthMm(128, { slug: 'tenons' });
    expect(totalFrameWidthMm(spec)).toBeCloseTo(128, 6);
    expect(renderedFrameWidthPx(spec, M0) / M0.livePxPerMm).toBeCloseTo(128, 6);
    expect(totalFrameWidthMm(spec)).not.toBeCloseTo(2 * 52 + 18, 0);
  });
});

describe('BRANCHE : longueur réelle et charnière réelle', () => {
  const M30 = frameMetrics(makeFaceAtYaw(Math.PI / 6), W, H, makeCal(), Math.PI / 6);
  const b140 = { ...specForTotalWidthMm(132, { slug: 'b140' }), brancheMm: 140 };
  const b150 = { ...specForTotalWidthMm(132, { slug: 'b150' }), brancheMm: 150 };

  it('la longueur de branche RÉELLE calibre le sprite de profil (140 ≠ 150)', () => {
    expect(templeLengthMm(b140)).toBe(140);
    expect(templeLengthMm(b150)).toBe(150);
    const a140 = templeAffine(b140, M30, 1);
    const a150 = templeAffine(b150, M30, 1);
    // Même charnière, même oreille : le sprite d'une branche de 150 mm est
    // remis à l'échelle 140/150 de celui d'une branche de 140 mm — sa
    // longueur réelle décide de son échelle, exactement comme pour la face.
    expect(Math.hypot(a150.a, a150.b) / Math.hypot(a140.a, a140.b)).toBeCloseTo(140 / 150, 6);
  });

  it('templeRectifiedMm (profil redressé) PRIME sur la longueur nominale', () => {
    const redresse = { ...b140, templeRectifiedMm: 174.5, profilePxPerMm: 4.86 };
    expect(templeLengthMm(redresse)).toBeCloseTo(174.5, 6);
  });

  it('le PIVOT est la vraie charnière du spec — jamais le coin de l’image', () => {
    const t = templeAffine(b140, M30, 1);
    // La charnière du sprite de profil doit tomber EXACTEMENT sur la charnière
    // de la face projetée (bord externe de la bbox, hauteur du pont).
    const frontHinge = spriteToScreen(
      { x: b140.alphaBBox.x + b140.alphaBBox.w, y: b140.bridgeCenter.y },
      b140,
      M30,
    );
    const pivot = apply(t, b140.hingeProfile);
    expect(pivot.x).toBeCloseTo(frontHinge.x, 6);
    expect(pivot.y).toBeCloseTo(frontHinge.y, 6);
    // …et le coin (0,0) du fichier, lui, ne tombe PAS sur la charnière.
    const corner = apply(t, { x: 0, y: 0 });
    expect(Math.hypot(corner.x - frontHinge.x, corner.y - frontHinge.y)).toBeGreaterThan(1);
  });

  it('2.5D : la branche peinte s’allonge quand la tête tourne (profil progressif)', () => {
    const M6 = frameMetrics(makeFaceAtYaw(0.1), W, H, makeCal(), 0.1);
    const nearFrontal = renderedTempleLengthPx(b140, M6, 1);
    const profil = renderedTempleLengthPx(b140, M30, 1);
    expect(profil).toBeGreaterThan(nearFrontal);
    // Sa longueur à l'écran est la distance charnière ↔ oreille MESURÉE sur ce
    // visage — le raccourci de perspective est porté par la mesure, pas simulé.
  });
});
