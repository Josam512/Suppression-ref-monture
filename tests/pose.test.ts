/**
 * tests/pose.test.ts — la pose sur le nez, verrouillée (vérification 2026-08-19,
 * §22–28).
 *
 * ## Les quatre plans, à ne jamais confondre
 *
 * | Plan | Ce qui y vit | Ce qui s'y décide |
 * |---|---|---|
 * | ligne des yeux (canthi) | hauteur des centres optiques | pose VERTICALE (§14.6) |
 * | pont / arête du nez | bridgeCenter, décentrement | pose HORIZONTALE (sellion) |
 * | face de la monture | ~48 mm devant 234/454 | RIEN — l'échelle n'y est jamais prise (§14.4) |
 * | tempes / tenons | largeur réalisée, écart temporal | l'échelle `livePxPerMm` |
 *
 * ## La convention de pose, conservée et déclarée
 *
 * La monture est montrée telle qu'un opticien l'ajusterait : plaquettes réglées
 * pour amener les centres optiques à hauteur de pupille (ligne des CANTHI, pas
 * les iris — le regard bouge, le crâne non). Ce n'est PAS « la monture au fond
 * des yeux » : l'ancrage vertical est la cible du réglage opticien, l'ancrage
 * horizontal est le nez (le pont l'enjambe). Remplacer cette convention par des
 * landmarks nasaux individuels serait un NOUVEAU choix scientifique non
 * démontré : la convention actuelle est validée sur le sujet réel
 * (docs/verification/), l'alternative ne l'est pas — signalée, pas inventée.
 *
 * Aucun paramètre libre : pas de VERTICAL_OFFSET, pas de hauteur de nez moyenne,
 * pas de « ça tombe mieux ». Chaque test ci-dessous rougit si on en réintroduit un.
 */

import { describe, expect, it } from 'vitest';

import { at, midpoint, px } from '../src/core/geom.js';
import { eyeLineY, FACE_L, FACE_R, frameMetrics, poseAnchorOf, SELLION, visibleTempleSide } from '../src/core/faceMetrics.js';
import { spriteToScreen } from '../src/core/transform.js';
import { makeCal, specForTotalWidthMm, SPRITE_PX_PER_MM, W, H } from './fixtures/builders.js';
import { makeFace } from './fixtures/landmarks.js';

const SPEC = specForTotalWidthMm(132);

describe('POSE : les centres optiques tombent sur la ligne des yeux — toute morphologie', () => {
  // Enfant proche, adulte médian, forte carrure éloignée : trois échelles très
  // différentes, zéro constante — la pose doit suivre chacune exactement.
  const variants = [
    { faceWidthPx: 350, faceWidthMm: 110 },
    { faceWidthPx: 430, faceWidthMm: 138 },
    { faceWidthPx: 560, faceWidthMm: 152 },
  ];

  for (const v of variants) {
    it(`visage ${v.faceWidthMm} mm (${v.faceWidthPx} px) : centres optiques à hauteur des canthi`, () => {
      const lm = makeFace({ faceWidthPx: v.faceWidthPx });
      const m = frameMetrics(lm, W, H, makeCal({ faceWidthMm: v.faceWidthMm }), 0);
      const mid = midpoint(spriteToScreen(SPEC.lensCenterL, SPEC, m), spriteToScreen(SPEC.lensCenterR, SPEC, m));
      expect(mid.y).toBeCloseTo(eyeLineY(lm, W, H), 6);
      // Horizontalement : le pont enjambe le nez — la médiane, pas une moyenne.
      expect(mid.x).toBeCloseTo(px(at(lm, SELLION), W, H).x, 6);
    });
  }
});

describe('POSE : la hauteur du pont suit CHAQUE monture — aucun décalage constant possible', () => {
  it('deux montures aux centres optiques 1 mm et 10 mm sous le pont : le pont bouge, pas les centres', () => {
    const lm = makeFace({ faceWidthPx: 430 });
    const m = frameMetrics(lm, W, H, makeCal(), 0);

    const shallow = {
      ...specForTotalWidthMm(132, { slug: 'pont-bas' }),
      lensCenterL: { ...SPEC.lensCenterL, y: SPEC.bridgeCenter.y + 1 * SPRITE_PX_PER_MM },
      lensCenterR: { ...SPEC.lensCenterR, y: SPEC.bridgeCenter.y + 1 * SPRITE_PX_PER_MM },
    };
    const deep = {
      ...specForTotalWidthMm(132, { slug: 'pont-haut' }),
      lensCenterL: { ...SPEC.lensCenterL, y: SPEC.bridgeCenter.y + 10 * SPRITE_PX_PER_MM },
      lensCenterR: { ...SPEC.lensCenterR, y: SPEC.bridgeCenter.y + 10 * SPRITE_PX_PER_MM },
    };

    // Les centres optiques des DEUX montures tombent sur la ligne des yeux…
    for (const spec of [shallow, deep]) {
      const mid = midpoint(spriteToScreen(spec.lensCenterL, spec, m), spriteToScreen(spec.lensCenterR, spec, m));
      expect(mid.y).toBeCloseTo(eyeLineY(lm, W, H), 6);
    }
    // …donc le PONT, lui, est 9 mm plus haut sur la monture profonde. C'est la
    // propriété qu'aucune constante VERTICAL_OFFSET ne peut satisfaire (§14.6).
    const bridgeShallow = spriteToScreen(shallow.bridgeCenter, shallow, m).y;
    const bridgeDeep = spriteToScreen(deep.bridgeCenter, deep, m).y;
    expect(bridgeShallow - bridgeDeep).toBeCloseTo(9 * m.livePxPerMm, 6);
  });
});

describe('POSE : le regard ne déplace pas la monture (canthi, jamais les iris)', () => {
  it('des iris qui montent de 8 px (regard vers le haut) laissent la pose INCHANGÉE', () => {
    const lm = makeFace({ faceWidthPx: 430 });
    const gazing = lm.map((p, i) =>
      [468, 469, 471, 473, 474, 476].includes(i) ? { x: p.x, y: p.y - 8 / H } : p,
    );
    const before = poseAnchorOf(lm, W, H, 0);
    const after = poseAnchorOf(gazing, W, H, 0);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe('POSE : sous roulis, chaque axe garde sa référence', () => {
  it('à 12° de roulis : ancre SUR la ligne des yeux, ET sur la médiane du nez', () => {
    const roll = (12 * Math.PI) / 180;
    const lm = makeFace({ faceWidthPx: 430, rollRad: roll });
    const m = frameMetrics(lm, W, H, makeCal(), 0);
    const anchor = m.poseAnchor;

    // Ligne des yeux : direction (cos roll, sin roll) passant par le milieu des canthi.
    const canthiMidY = eyeLineY(lm, W, H);
    // La composante PERPENDICULAIRE à la ligne des yeux du vecteur
    // anchor − sellion doit être nulle côté « médiane du nez » (le sellion est
    // glissé LE LONG de la ligne, jamais à travers).
    const sellion = px(at(lm, SELLION), W, H);
    const dot = (anchor.x - sellion.x) * Math.cos(roll) + (anchor.y - sellion.y) * Math.sin(roll);
    expect(dot).toBeCloseTo(0, 6);
    expect(canthiMidY).toBeGreaterThan(0); // cohérence du fixture

    // Et les centres optiques projetés suivent l'ancre — sans écrasement, sans
    // décalage latéral (le bug classique « x d'un point, y d'un autre »).
    const mid = midpoint(spriteToScreen(SPEC.lensCenterL, SPEC, m), spriteToScreen(SPEC.lensCenterR, SPEC, m));
    expect(mid.x).toBeCloseTo(anchor.x, 6);
    expect(mid.y).toBeCloseTo(anchor.y, 6);
  });
});

describe('🔴 terrain 2026-08-26 — le côté de branche vient de la GÉOMÉTRIE, jamais du signe du yaw', () => {
  const mk = (sellionX: number, leftX: number, rightX: number) => {
    const lm: Array<{ x: number; y: number }> = [];
    lm[SELLION] = { x: sellionX, y: 0.5 };
    lm[FACE_L] = { x: leftX, y: 0.5 };
    lm[FACE_R] = { x: rightX, y: 0.5 };
    return lm;
  };

  it('joue image-GAUCHE plus large (tête tournée) → branche côté -1, et réciproquement', () => {
    // Tête tournée : la moitié TOURNÉE VERS LA CAMÉRA occupe plus de largeur.
    expect(visibleTempleSide(mk(0.52, 0.3, 0.62), 1280, 720)).toBe(-1); // gauche large
    expect(visibleTempleSide(mk(0.48, 0.38, 0.7), 1280, 720)).toBe(1); // droite large
  });

  it('invariant au ROLL : une tête penchée ne change pas le côté choisi', () => {
    const lm: Array<{ x: number; y: number }> = [];
    // Même asymétrie (gauche large), mais tournée de 30° dans le plan image.
    const rot = (x: number, y: number) => {
      const c = Math.cos(Math.PI / 6);
      const s = Math.sin(Math.PI / 6);
      return { x: 0.5 + (x - 0.5) * c - (y - 0.5) * s, y: 0.5 + (x - 0.5) * s + (y - 0.5) * c };
    };
    lm[SELLION] = rot(0.52, 0.5);
    lm[FACE_L] = rot(0.3, 0.5);
    lm[FACE_R] = rot(0.62, 0.5);
    expect(visibleTempleSide(lm, 1280, 720)).toBe(-1);
  });
});
