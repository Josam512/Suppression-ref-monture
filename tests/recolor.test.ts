/**
 * tests/recolor.test.ts — V2 « 2,5 D » : changer le coloris d'une monture RÉELLE.
 *
 * La scène de test est volontairement minimale et entièrement connue : un fond
 * de peau uniforme, une monture noire rectangulaire au bon endroit, et sur elle
 * un reflet local. On vérifie alors les quatre propriétés qui font qu'un
 * recoloriage est crédible plutôt que peint au pochoir :
 *
 *   1. la MATIÈRE change — la chrominance devient celle du coloris voulu ;
 *   2. la LUMIÈRE reste — le reflet de la vidéo survit à la substitution ;
 *   3. la peau n'est PAS repeinte, même là où le masque géométrique la couvre ;
 *   4. un modèle qui n'est pas celui porté est SIGNALÉ, pas rendu quand même.
 */

import { describe, expect, it } from 'vitest';

import type { FrameMetrics } from '../src/core/faceMetrics.js';
import type { ImageBuffer } from '../src/core/silhouette.js';
import { spriteAffine, apply } from '../src/core/transform.js';
import {
  MIN_PAINTED_RATIO,
  recolorWornFrame,
  wornRegion,
  SHADING_GAIN,
} from '../src/render/recolor.js';
import { toYcc } from '../src/render/ycc.js';
import { SPEC_132, SPRITE_PX_PER_MM } from './fixtures/builders.js';

const W = 640;
const H = 360;

/** Peau claire et neutre ; monture noire ; coloris voulu : un roux saturé. */
const PEAU = [205, 170, 150] as const;
const MONTURE_REELLE = [28, 28, 30] as const;
const ECAILLE = [168, 96, 40] as const;

function blank(w: number, h: number): ImageBuffer {
  return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
}

function fill(buf: ImageBuffer, rgb: readonly [number, number, number], a = 255): void {
  for (let i = 0; i < buf.data.length; i += 4) {
    buf.data[i] = rgb[0];
    buf.data[i + 1] = rgb[1];
    buf.data[i + 2] = rgb[2];
    buf.data[i + 3] = a;
  }
}

/** Sprite opaque sur toute sa boîte alpha, transparent ailleurs. */
function spriteFor(rgb: readonly [number, number, number]): ImageBuffer {
  const b = SPEC_132.alphaBBox;
  const buf = blank(b.x + b.w + b.x, b.y + b.h + b.y);
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = (y * buf.width + x) * 4;
      buf.data[i] = rgb[0];
      buf.data[i + 1] = rgb[1];
      buf.data[i + 2] = rgb[2];
      buf.data[i + 3] = 255;
    }
  }
  return buf;
}

const metrics: FrameMetrics = {
  livePxPerMm: 3,
  rollRad: 0,
  yawRad: 0,
  poseAnchor: { x: W / 2, y: H / 2 },
  ear: { left: { x: W / 2 - 200, y: H / 2 }, right: { x: W / 2 + 200, y: H / 2 } },
};

/**
 * Vidéo synthétique : la monture réelle est peinte EXACTEMENT là où l'affine
 * projette le sprite porté. C'est le cas nominal — la calibration est juste.
 */
function sceneAvecMonture(options: { refletX?: number; decalePx?: number } = {}): ImageBuffer {
  const scene = blank(W, H);
  fill(scene, PEAU);

  const region = wornRegion(SPEC_132, metrics, W, H);
  const dx = options.decalePx ?? 0;
  for (let j = 0; j < region.h; j++) {
    for (let i = 0; i < region.w; i++) {
      const x = region.x + i + dx;
      if (x < 0 || x >= W) continue;
      const o = ((region.y + j) * W + x) * 4;
      const reflet = options.refletX !== undefined && Math.abs(region.x + i - options.refletX) < 6;
      const boost = reflet ? 90 : 0;
      scene.data[o] = MONTURE_REELLE[0] + boost;
      scene.data[o + 1] = MONTURE_REELLE[1] + boost;
      scene.data[o + 2] = MONTURE_REELLE[2] + boost;
      scene.data[o + 3] = 255;
    }
  }
  return scene;
}

function run(scene: ImageBuffer, target = spriteFor(ECAILLE)) {
  const out = blank(W, H);
  const report = recolorWornFrame({
    source: scene,
    out,
    wornSprite: spriteFor(MONTURE_REELLE),
    wornSpec: SPEC_132,
    targetSprite: target,
    targetSpec: SPEC_132,
    m: metrics,
  });
  return { out, report };
}

/** Pixel du calque de sortie, en RGBA. */
function pixel(buf: ImageBuffer, x: number, y: number): [number, number, number, number] {
  const i = (y * buf.width + x) * 4;
  return [buf.data[i] ?? 0, buf.data[i + 1] ?? 0, buf.data[i + 2] ?? 0, buf.data[i + 3] ?? 0];
}

describe('V2 — recoloriage 2,5 D de la monture portée', () => {
  it('la géométrie du rectangle traité vient de l’affine unique (T3)', () => {
    const region = wornRegion(SPEC_132, metrics, W, H);
    const t = spriteAffine(SPEC_132, metrics);
    const coin = apply(t, { x: SPEC_132.alphaBBox.x, y: SPEC_132.alphaBBox.y });
    expect(region.x).toBeCloseTo(Math.max(0, Math.floor(coin.x)), 0);
    // 132 mm à 3 px/mm : 396 px, moins ce qui sort du cadre de 640.
    expect(region.w).toBeGreaterThan(300);
  });

  it('🔴 la MATIÈRE change : la chrominance devient celle du coloris voulu', () => {
    const { out, report } = run(sceneAvecMonture());
    expect(report.reason).toBeNull();
    expect(report.painted).toBeGreaterThan(0);

    const region = wornRegion(SPEC_132, metrics, W, H);
    const p = pixel(out, region.x + Math.floor(region.w / 2), region.y + Math.floor(region.h / 2));
    expect(p[3]).toBe(255);

    const voulu = toYcc(ECAILLE[0], ECAILLE[1], ECAILLE[2]);
    const obtenu = toYcc(p[0], p[1], p[2]);
    expect(obtenu.cb).toBeCloseTo(voulu.cb, 0);
    expect(obtenu.cr).toBeCloseTo(voulu.cr, 0);
  });

  it('🔴 la LUMIÈRE reste : le reflet filmé survit à la substitution', () => {
    const region = wornRegion(SPEC_132, metrics, W, H);
    const refletX = region.x + Math.floor(region.w / 3);
    const { out } = run(sceneAvecMonture({ refletX }));

    const y = region.y + Math.floor(region.h / 2);
    const surReflet = toYcc(...(pixel(out, refletX, y).slice(0, 3) as [number, number, number]));
    const horsReflet = toYcc(
      ...(pixel(out, region.x + Math.floor((2 * region.w) / 3), y).slice(0, 3) as [
        number,
        number,
        number,
      ]),
    );

    // Le reflet doit rester plus clair — sinon on a peint un aplat.
    expect(surReflet.y).toBeGreaterThan(horsReflet.y + 10);
    // ...mais atténué : SHADING_GAIN < 1, sinon le coloris ne changerait pas.
    expect(SHADING_GAIN).toBeLessThan(1);
  });

  it('🔴 la peau n’est PAS repeinte, même sous le masque géométrique', () => {
    // La monture réelle est décalée de 40 px : sous le masque, à gauche, il n'y
    // a que de la peau. Une pose imparfaite ne doit pas colorier un visage.
    const region = wornRegion(SPEC_132, metrics, W, H);
    const { out } = run(sceneAvecMonture({ decalePx: 40 }));

    const y = region.y + Math.floor(region.h / 2);
    for (let x = region.x + 2; x < region.x + 30; x++) {
      expect(pixel(out, x, y)[3], `peau repeinte en x=${x}`).toBe(0);
    }
  });

  it('🔴 un modèle qui n’est pas celui porté est SIGNALÉ, pas rendu quand même', () => {
    // Aucune monture dans l'image : que de la peau.
    const peau = blank(W, H);
    fill(peau, PEAU);
    const { report } = run(peau);
    expect(report.painted / report.expected).toBeLessThan(MIN_PAINTED_RATIO);
    expect(report.reason).toMatch(/monture/i);
  });

  it('les pixels hors monture gardent un alpha nul : le calque se compose tel quel', () => {
    const { out } = run(sceneAvecMonture());
    expect(pixel(out, 2, 2)[3]).toBe(0);
    expect(pixel(out, W - 3, H - 3)[3]).toBe(0);
  });

  it('un coloris pris sur une PHOTO d’échelle différente s’aligne quand même', () => {
    // Même modèle, photo prise de plus loin : boîte alpha deux fois plus petite.
    const petit = SPRITE_PX_PER_MM / 2;
    const spec = { ...SPEC_132, spritePxPerMm: petit };
    spec.alphaBBox = {
      x: 10,
      y: 9,
      w: Math.round(SPEC_132.alphaBBox.w / 2),
      h: Math.round(SPEC_132.alphaBBox.h / 2),
    };

    const b = spec.alphaBBox;
    const target = blank(b.x + b.w + b.x, b.y + b.h + b.y);
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const i = (y * target.width + x) * 4;
        target.data[i] = ECAILLE[0];
        target.data[i + 1] = ECAILLE[1];
        target.data[i + 2] = ECAILLE[2];
        target.data[i + 3] = 255;
      }
    }

    const out = blank(W, H);
    const report = recolorWornFrame({
      source: sceneAvecMonture(),
      out,
      wornSprite: spriteFor(MONTURE_REELLE),
      wornSpec: SPEC_132,
      targetSprite: target,
      targetSpec: spec,
      m: metrics,
    });
    expect(report.reason).toBeNull();
    expect(report.painted / report.expected).toBeGreaterThan(0.9);
  });
});
