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
  profileScaleCorrection,
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

describe('BRANCHE : échelle PHYSIQUE, départ au tenon, fin libre (2026-08-19)', () => {
  const M30 = frameMetrics(makeFaceAtYaw(Math.PI / 6), W, H, makeCal(), Math.PI / 6);
  const b140 = { ...specForTotalWidthMm(132, { slug: 'b140' }), brancheMm: 140 };
  const b150 = { ...specForTotalWidthMm(132, { slug: 'b150' }), brancheMm: 150 };

  it('🔴 l’échelle du sprite NE dépend PAS de la longueur nominale (fin du stretch)', () => {
    expect(templeLengthMm(b140)).toBe(140);
    expect(templeLengthMm(b150)).toBe(150);
    const a140 = templeAffine(b140, M30, 1);
    const a150 = templeAffine(b150, M30, 1);
    // L'ancien modèle étirait la 140 et comprimait la 150 pour que les deux
    // extrémités tombent sur l'oreille (rapport 140/150 entre les échelles).
    // Le modèle physique donne la MÊME échelle aux deux : c'est la longueur
    // peinte qui diffère, dans le rapport des longueurs réelles.
    expect(Math.hypot(a150.a, a150.b)).toBeCloseTo(Math.hypot(a140.a, a140.b), 9);
    expect(renderedTempleLengthPx(b150, M30, 1) / renderedTempleLengthPx(b140, M30, 1))
      .toBeCloseTo(150 / 140, 9);
  });

  it('la longueur peinte vaut EXACTEMENT longueur réelle × échelle × sin(yaw)', () => {
    const paintedMm = renderedTempleLengthPx(b140, M30, 1) / M30.livePxPerMm;
    expect(paintedMm).toBeCloseTo(140 * Math.sin(Math.PI / 6), 6);
  });

  it('🔴 RÈGLE CHANGÉE (guide pt 51/c30) : la longueur PEINTE est la cote FABRICANT', () => {
    // L'ancien test verrouillait l'inverse — « templeRectifiedMm PRIME » — et
    // c'est exactement ce que le guide interdit : les fiches réelles portaient
    // 147 → 137,1 et 145 → 174,5, trois longueurs physiques contradictoires
    // pour le même objet. Le redressement ne calibre que les PIXELS du sprite
    // (profileScaleCorrection) ; la longueur physique reste `brancheMm`.
    const redresse = { ...b140, templeRectifiedMm: 174.5, profilePxPerMm: 4.86 };
    expect(templeLengthMm(redresse)).toBeCloseTo(b140.brancheMm, 6);
    expect(profileScaleCorrection(redresse)).toBeCloseTo(b140.brancheMm / 174.5, 6);
    // Le nouveau nom explicite est lu en priorité, l'historique en repli.
    const renomme = { ...b140, profileReferenceLengthMm: 150, templeRectifiedMm: 174.5 };
    expect(profileScaleCorrection(renomme)).toBeCloseTo(b140.brancheMm / 150, 6);
    // Sans référence (profil photographié à plat) : aucune correction.
    expect(profileScaleCorrection(b140)).toBe(1);
  });

  it('le DÉPART est le tenon : explicite s’il est marqué, approximation sinon', () => {
    // Sans marque : repli documenté = bord externe de la bbox, hauteur du pont.
    const t = templeAffine(b140, M30, 1);
    const fallback = spriteToScreen(
      { x: b140.alphaBBox.x + b140.alphaBBox.w, y: b140.bridgeCenter.y },
      b140,
      M30,
    );
    const pivot = apply(t, b140.hingeProfile);
    expect(pivot.x).toBeCloseTo(fallback.x, 6);
    expect(pivot.y).toBeCloseTo(fallback.y, 6);

    // Avec templeRootR marqué sur la photo de face : c'est LUI qui commande.
    const root = { x: b140.alphaBBox.x + b140.alphaBBox.w - 30, y: b140.bridgeCenter.y + 12 };
    const marked = { ...b140, templeRootR: root };
    const pivotMarked = apply(templeAffine(marked, M30, 1), marked.hingeProfile);
    const rootOnScreen = spriteToScreen(root, marked, M30);
    expect(pivotMarked.x).toBeCloseTo(rootOnScreen.x, 6);
    expect(pivotMarked.y).toBeCloseTo(rootOnScreen.y, 6);

    // …et le coin (0,0) du fichier, lui, ne tombe PAS sur le tenon.
    const corner = apply(t, { x: 0, y: 0 });
    expect(Math.hypot(corner.x - fallback.x, corner.y - fallback.y)).toBeGreaterThan(1);
  });

  it('🔴 ARBITRAGE 2026-08-27 : la branche PROLONGE la face — axes de la tête, pas d’oreille', () => {
    // L'ancien test verrouillait « direction = tenon → oreille détectée » :
    // c'est l'orientation INVENTÉE que le terrain a condamnée (le landmark de
    // contour n'est pas à la hauteur du sillon — la branche montait, manchon
    // en l'air). La direction est désormais celle des axes de la face :
    // ±(cos roll, sin roll), l'inclinaison réelle venant de la photo.
    const t = templeAffine(b140, M30, 1);
    const cosR = Math.cos(M30.rollRad);
    const sinR = Math.sin(M30.rollRad);
    const cross = t.a * sinR - t.b * cosR;
    expect(Math.abs(cross) / Math.hypot(t.a, t.b)).toBeLessThan(1e-9);
    // Côté image-droit : la branche s'étend vers +x du repère de la tête.
    expect(t.a * cosR + t.b * sinR).toBeGreaterThan(0);
  });

  it('🔴 le côté gauche est le MIROIR du droit — jamais une rotation tête-bêche', () => {
    // Le bug des captures terrain : le côté gauche était construit par une
    // rotation ≈ 180° — le manchon plongeant de la photo se peignait VERS LE
    // HAUT. Un miroir horizontal est exigé : déterminant négatif, et un point
    // situé SOUS la charnière dans le sprite se peint SOUS elle à l'écran,
    // des deux côtés (roll ≈ 0 dans la fixture).
    const tR = templeAffine(b140, M30, 1);
    const tL = templeAffine(b140, M30, -1);
    expect(tR.a * tR.d - tR.b * tR.c).toBeGreaterThan(0);
    expect(tL.a * tL.d - tL.b * tL.c).toBeLessThan(0);
    const below = { x: b140.hingeProfile.x, y: b140.hingeProfile.y + 100 };
    for (const side of [1, -1] as const) {
      const t = templeAffine(b140, M30, side);
      const pivot = apply(t, b140.hingeProfile);
      const p = apply(t, below);
      expect(p.y, `côté ${side}`).toBeGreaterThan(pivot.y);
    }
  });

  it('🔴 la pente de MISE EN PAGE de la photo est ANNULÉE — jamais amplifiée', () => {
    // severine : la branche MONTE de ~9° dans son fichier (pose de la photo,
    // pas propriété de la monture). Sans annulation, cette composante restait
    // à l'échelle pleine pendant que l'axe s'écrasait en sin(yaw) : ~30° à
    // l'écran à petit yaw (captures terrain du 2026-08-27). Un point de l'AXE
    // mesuré doit se peindre SUR la ligne de la branche, à tout yaw, des deux
    // côtés — et à la distance écrasée en sin(yaw), pas davantage.
    const axis = (9 * Math.PI) / 180;
    const skewed = { ...b140, profileAxisRad: axis };
    for (const yaw of [0.15, 0.3, 0.6]) {
      const m = frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw);
      const sScale =
        (m.livePxPerMm * profileScaleCorrection(skewed)) / (skewed.profilePxPerMm ?? skewed.spritePxPerMm);
      for (const side of [1, -1] as const) {
        const t = templeAffine(skewed, m, side);
        const pivot = apply(t, skewed.hingeProfile);
        const onAxis = apply(t, {
          x: skewed.hingeProfile.x + 500 * Math.cos(axis),
          y: skewed.hingeProfile.y + 500 * Math.sin(axis),
        });
        const cosR = Math.cos(m.rollRad);
        const sinR = Math.sin(m.rollRad);
        const perp = -(onAxis.x - pivot.x) * sinR + (onAxis.y - pivot.y) * cosR;
        expect(Math.abs(perp), `hors-ligne yaw=${yaw} côté ${side}`).toBeLessThan(1e-6);
        const alongPx = ((onAxis.x - pivot.x) * cosR + (onAxis.y - pivot.y) * sinR) * side;
        expect(alongPx, `écrasement yaw=${yaw} côté ${side}`).toBeCloseTo(500 * sScale * Math.sin(yaw), 6);
      }
    }
  });

  it('2.5D : la branche peinte s’allonge quand la tête tourne (profil progressif)', () => {
    const M6 = frameMetrics(makeFaceAtYaw(0.1), W, H, makeCal(), 0.1);
    const nearFrontal = renderedTempleLengthPx(b140, M6, 1);
    const profil = renderedTempleLengthPx(b140, M30, 1);
    expect(profil).toBeGreaterThan(nearFrontal);
    // Le raccourci de perspective est sin(yaw) sur la longueur RÉELLE : la fin
    // peut dépasser l'oreille ou ne pas l'atteindre — c'est une information,
    // et l'occlusion cache ce qui passe derrière la tête.
  });
});
