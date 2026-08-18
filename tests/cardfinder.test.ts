/**
 * tests/cardfinder.test.ts — trouver la carte, et surtout : ne pas trouver
 * autre chose.
 *
 * 🔴 Le mode d'échec de ce projet n'est pas « la carte est introuvable ». Quatre
 * tentatives de détection l'ont montré (`tests/cardFind.atelier.ts`) : le
 * détecteur trouve TOUJOURS quelque chose, et c'est la lisière des cheveux. Un
 * test qui vérifie seulement « une carte a été trouvée » est donc décoratif — il
 * serait vert avec un détecteur entièrement faux.
 *
 * Ces tests vérifient l'inverse : qu'un bord parasite PLUS contrasté que la
 * carte ne déplace pas la mesure, et qu'une image sans carte ne rend rien.
 */

import { describe, expect, it } from 'vitest';

import {
  consensusWidthRatio,
  findCard,
  MAX_WIDTH_RATIO,
  MIN_WIDTH_RATIO,
} from '../src/core/cardFinder.js';
import { CARD_H_MM, CARD_W_MM } from '../src/core/cardPose.js';
import { at, px } from '../src/core/geom.js';
import { FACE_L, FACE_R } from '../src/core/faceMetrics.js';
import type { ImageBuffer } from '../src/core/silhouette.js';
import { H, W, makeFace } from './fixtures/landmarks.js';

const FACE_PX = 420;
const lm = makeFace({ faceWidthPx: FACE_PX });
const faceWidthPx = Math.hypot(
  px(at(lm, FACE_R), W, H).x - px(at(lm, FACE_L), W, H).x,
  px(at(lm, FACE_R), W, H).y - px(at(lm, FACE_L), W, H).y,
);

interface Card {
  /** Largeur de la carte, en pixels image. */
  widthPx: number;
  /** Centre de la carte, en pixels image. */
  cx: number;
  cy: number;
  luma: number;
}

interface HairEdge {
  /** Rangée où le fond bascule brutalement — une lisière franche. */
  y: number;
  luma: number;
}

/**
 * Une scène : peau claire, carte sombre, et au besoin une lisière de cheveux
 * PLUS contrastée que la carte. C'est ce dernier point qui fait le test.
 */
function scene(card: Card | null, hair: HairEdge | null = null): ImageBuffer {
  const data = new Uint8ClampedArray(W * H * 4);
  const half = card === null ? 0 : (card.widthPx * CARD_H_MM) / CARD_W_MM / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 190; // peau
      if (hair !== null && y < hair.y) v = hair.luma;
      if (
        card !== null &&
        Math.abs(x - card.cx) <= card.widthPx / 2 &&
        Math.abs(y - card.cy) <= half
      ) {
        v = card.luma;
      }
      // Un grain léger : sans lui, tout gradient serait exactement nul et le
      // sommet parabolique n'aurait rien à interpoler.
      v += ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 3;
      const o = (y * W + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

/** Le centre du visage, en pixels — là où la carte se pose. */
const cxFace = (px(at(lm, FACE_L), W, H).x + px(at(lm, FACE_R), W, H).x) / 2;
const cyEyes = (px(at(lm, 33), W, H).y + px(at(lm, 263), W, H).y) / 2;

describe('la carte est mesurée, pas devinée', () => {
  it('sur une carte aux cotes connues, la largeur trouvée est la bonne', () => {
    const widthPx = 0.62 * faceWidthPx;
    const out = findCard(scene({ widthPx, cx: cxFace, cy: cyEyes - 0.55 * faceWidthPx, luma: 90 }), lm, W, H);
    expect(out).not.toBeNull();
    expect((out?.widthRatio ?? 0) * faceWidthPx).toBeCloseTo(widthPx, -1);
  });

  /**
   * 🔴 Le test qui compte. La lisière est un bord de 150 niveaux, la carte n'en
   * a que 100 : sur le seul critère du contraste, le détecteur devrait préférer
   * la lisière. C'est très exactement ce qui a coulé les quatre tentatives
   * précédentes.
   */
  it('une lisière de cheveux PLUS contrastée ne détourne pas la mesure', () => {
    const widthPx = 0.62 * faceWidthPx;
    const cy = cyEyes - 0.5 * faceWidthPx;
    const sans = findCard(scene({ widthPx, cx: cxFace, cy, luma: 90 }), lm, W, H);
    const avec = findCard(
      scene({ widthPx, cx: cxFace, cy, luma: 90 }, { y: cy - 0.35 * faceWidthPx, luma: 40 }),
      lm,
      W,
      H,
    );
    expect(sans).not.toBeNull();
    expect(avec).not.toBeNull();
    expect(avec?.widthRatio ?? 0).toBeCloseTo(sans?.widthRatio ?? -1, 2);
  });

  it('aucune carte dans l’image → rien n’est rendu, rien n’est inventé', () => {
    expect(findCard(scene(null), lm, W, H)).toBeNull();
  });

  it('un objet hors des bornes de plausibilité n’est pas pris pour une carte', () => {
    const trop = 0.2 * faceWidthPx; // bien sous MIN_WIDTH_RATIO
    expect(findCard(scene({ widthPx: trop, cx: cxFace, cy: cyEyes - 0.5 * faceWidthPx, luma: 90 }), lm, W, H))
      .toBeNull();
    expect(MIN_WIDTH_RATIO).toBeLessThan(MAX_WIDTH_RATIO);
  });

  /**
   * ⚠️ La carte peut être tenue sur le front OU sur la joue : le détecteur doit
   * la trouver au même endroit de l'échelle, sans que sa position privilégie une
   * hauteur. Si la fenêtre de recherche portait la mesure, ces deux valeurs
   * divergeraient.
   */
  it('front ou joue : la largeur trouvée est la même', () => {
    const widthPx = 0.6 * faceWidthPx;
    const haut = findCard(scene({ widthPx, cx: cxFace, cy: cyEyes - 0.75 * faceWidthPx, luma: 95 }), lm, W, H);
    const bas = findCard(scene({ widthPx, cx: cxFace, cy: cyEyes + 0.3 * faceWidthPx, luma: 95 }), lm, W, H);
    expect(haut).not.toBeNull();
    expect(bas).not.toBeNull();
    expect(bas?.widthRatio ?? 0).toBeCloseTo(haut?.widthRatio ?? -1, 2);
  });
});

describe('c’est le FILM qui tranche, pas une image', () => {
  it('la médiane ignore une vue aberrante', () => {
    const vues = [0.61, 0.62, 0.615, 0.605, 1.4, 0.618];
    expect(consensusWidthRatio(vues) ?? 0).toBeCloseTo(0.6165, 3);
  });

  it('aucune vue → aucune mesure, jamais une valeur par défaut', () => {
    expect(consensusWidthRatio([])).toBeNull();
  });
});
