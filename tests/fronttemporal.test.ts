/**
 * tests/fronttemporal.test.ts — 🧪 prototype frontal (mission 2026-08-20).
 *
 * Le candidat `frontOnlyTemporalCandidate` est HORS production : ces tests sont
 * séparés et ne touchent à aucun comportement baseline. Ce qu'ils verrouillent :
 *
 *   1. masque propre → largeur retrouvée à sa vraie valeur, confiance haute ;
 *   2. 🔴 des CHEVEUX sur les tempes ne deviennent JAMAIS une tempe : refus
 *      nommé, aucune valeur inventée ;
 *   3. cheveux partiels → mesuré, mais confiance dégradée et dit ;
 *   4. bord absent / débord invraisemblable → refus (mêmes bornes 1–18 mm que
 *      le moteur rotation) ;
 *   5. accord avec le moteur silhouette+rotation existant sur la même scène —
 *      référence comparative interne, PAS une vérité terrain clinique.
 */

import { describe, expect, it } from 'vitest';

import { at, px } from '../src/core/geom.js';
import { EYE_L, EYE_R } from '../src/core/faceMetrics.js';
import { motionMask } from '../src/core/silhouette.js';
import { measureTemporalWidth } from '../src/core/temporalWidth.js';
import {
  frontOnlyTemporalCandidate,
  FT_ROW_STEP_PX,
  SEG_BACKGROUND,
  SEG_FACE_SKIN,
  SEG_HAIR,
  SEG_OTHERS,
  type SegMask,
} from '../src/experimental/frontTemporal.js';
import { makeScene } from './fixtures/scene.js';
import { H, W, makeFace } from './fixtures/landmarks.js';

const FACE_MM = 138;
const FACE_PX = 430;
const PX_PER_MM = FACE_PX / FACE_MM; // échelle au plan des tempes, VRAIE par construction
const MARGIN_MM = 10;
const MARGIN_PX = MARGIN_MM * PX_PER_MM;
const LM = makeFace({ faceWidthPx: FACE_PX });
const TRUE_MM = FACE_MM + 2 * MARGIN_MM;

const EYE_Y = Math.round((px(at(LM, EYE_L), W, H).y + px(at(LM, EYE_R), W, H).y) / 2);

interface MaskOptions {
  maskW?: number;
  maskH?: number;
  skinHalfPx?: number; // demi-largeur de peau autour du centre, en px IMAGE
  /** Bande de cheveux ADJACENTE au bord de peau : côté, et lignes image couvertes. */
  hair?: { side: 'left' | 'right' | 'both'; fromY?: number; toY?: number };
  /** Branches de lunettes PORTÉES : classe « autres » collée aux deux bords. */
  wornGlasses?: boolean;
}

/** Masque synthétique : peau au centre, fond ailleurs, cheveux optionnels. */
function makeMask(opts: MaskOptions = {}): SegMask {
  const mw = opts.maskW ?? W;
  const mh = opts.maskH ?? H;
  const skinHalf = opts.skinHalfPx ?? FACE_PX / 2 + MARGIN_PX;
  const classes = new Uint8Array(mw * mh).fill(SEG_BACKGROUND);
  const sx = mw / W;
  const sy = mh / H;
  const skinL = Math.round((W / 2 - skinHalf) * sx);
  const skinR = Math.round((W / 2 + skinHalf) * sx);
  const hairFrom = Math.round((opts.hair?.fromY ?? 0) * sy);
  const hairTo = Math.round((opts.hair?.toY ?? H) * sy);
  const hairBandPx = Math.round(30 * PX_PER_MM * sx); // 30 mm de chevelure

  for (let y = 0; y < mh; y++) {
    for (let x = skinL; x <= skinR; x++) classes[y * mw + x] = SEG_FACE_SKIN;
    if (opts.wornGlasses === true) {
      // Une branche portée : bande « autres » collée au bord de peau, des deux
      // côtés, sur toute la hauteur des lignes balayées.
      const bandPx = Math.round(6 * PX_PER_MM * sx);
      for (let x = skinR + 1; x <= Math.min(mw - 1, skinR + bandPx); x++) classes[y * mw + x] = SEG_OTHERS;
      for (let x = Math.max(0, skinL - bandPx); x < skinL; x++) classes[y * mw + x] = SEG_OTHERS;
    }
    if (opts.hair !== undefined && y >= hairFrom && y <= hairTo) {
      const sides = opts.hair.side === 'both' ? ['left', 'right'] : [opts.hair.side];
      for (const side of sides) {
        if (side === 'left') {
          for (let x = Math.max(0, skinL - hairBandPx); x < skinL; x++) classes[y * mw + x] = SEG_HAIR;
        } else {
          for (let x = skinR + 1; x <= Math.min(mw - 1, skinR + hairBandPx); x++) classes[y * mw + x] = SEG_HAIR;
        }
      }
    }
  }
  return { w: mw, h: mh, classes };
}

function candidate(mask: SegMask) {
  return frontOnlyTemporalCandidate({
    mask,
    lm: LM,
    w: W,
    h: H,
    pxPerMmTemple: PX_PER_MM,
    scaleRelError: 0.032,
  });
}

describe('frontal PROPRE : la largeur aux tempes est retrouvée sans rotation', () => {
  it('masque pleine résolution → vraie valeur, confiance ≥ 0,9', () => {
    const r = candidate(makeMask());
    expect(r.measured).toBe(true);
    expect(Math.abs(r.widthMm - TRUE_MM)).toBeLessThan(1.5);
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.relError).toBeGreaterThan(0.03); // jamais sous l'échelle amont
  });

  it('masque 256×144 (résolution réelle du modèle) → même mesure, à la cellule près', () => {
    const r = candidate(makeMask({ maskW: 256, maskH: 144 }));
    expect(r.measured).toBe(true);
    // Une cellule de masque vaut 5 px image ≈ 1,6 mm : tolérance 2 cellules.
    expect(Math.abs(r.widthMm - TRUE_MM)).toBeLessThan(3.5);
  });
});

describe('🔴 les CHEVEUX ne deviennent jamais une tempe', () => {
  it('tempes couvertes des deux côtés → refus NOMMÉ, aucune valeur', () => {
    // La peau s'arrête à 3 mm des repères, les cheveux collés au bord : la
    // vraie tempe est DESSOUS. Mesurer le bord de peau serait un mensonge.
    const r = candidate(makeMask({ skinHalfPx: FACE_PX / 2 + 3 * PX_PER_MM, hair: { side: 'both' } }));
    expect(r.measured).toBe(false);
    expect(r.reason).toMatch(/cheveux/i);
    expect(r.widthMm).toBe(0); // rien d'inventé
  });

  it('mèche sur QUELQUES lignes d’un côté → mesuré, confiance dégradée et dite', () => {
    const clean = candidate(makeMask());
    const partial = candidate(
      makeMask({ hair: { side: 'right', fromY: EYE_Y - 3 * FT_ROW_STEP_PX, toY: EYE_Y - FT_ROW_STEP_PX } }),
    );
    expect(partial.measured).toBe(true);
    expect(partial.hairBounded.right).toBeGreaterThan(0);
    expect(partial.confidence).toBeLessThan(clean.confidence);
    expect(Math.abs(partial.widthMm - TRUE_MM)).toBeLessThan(2.5); // la médiane tient
  });
});

describe('🔴 des lunettes PORTÉES ne deviennent jamais une tempe', () => {
  it('classe « autres » collée aux bords à hauteur des yeux → refus nommant les lunettes', () => {
    // Relevé sur la photo réelle du sujet AVEC lunettes : le bord de peau
    // s'arrête sur la branche portée — mesurer là annoncerait la monture du
    // client en prétendant que c'est sa tête. Même règle que S2 (iris).
    const r = candidate(makeMask({ wornGlasses: true }));
    expect(r.measured).toBe(false);
    expect(r.reason).toMatch(/lunettes/i);
    expect(r.widthMm).toBe(0);
  });
});

describe('bornes de plausibilité — les mêmes que le moteur rotation', () => {
  it('peau s’arrêtant AUX repères → « bord non trouvé », pas 138 mm par défaut', () => {
    const r = candidate(makeMask({ skinHalfPx: FACE_PX / 2 }));
    expect(r.measured).toBe(false);
    expect(r.reason).toMatch(/bord non trouvé/i);
  });
});

describe('comparaison au moteur silhouette+rotation (référence interne)', () => {
  it('sur une même scène, les deux mesures concordent à 2 mm près', () => {
    const headL = Math.round(W / 2 - FACE_PX / 2 - MARGIN_PX);
    const headR = Math.round(W / 2 + FACE_PX / 2 + MARGIN_PX);
    const luma = (shift = 0) => makeScene({ w: W, h: H, headLeftPx: headL, headRightPx: headR, shiftPx: shift });
    const rotation = measureTemporalWidth({
      frontal: luma(),
      motion: motionMask(luma(), [luma(6), luma(-6)]),
      lm: LM,
      w: W,
      h: H,
      pxPerMm: PX_PER_MM,
      scaleRelError: 0.032,
    });
    const frontal = candidate(makeMask());
    expect(rotation.measured).toBe(true);
    expect(frontal.measured).toBe(true);
    expect(Math.abs(rotation.widthMm - frontal.widthMm)).toBeLessThan(2);
  });
});

describe('protection baseline : le prototype est HORS production', () => {
  it('aucun module de production n’importe src/experimental', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = fileURLToPath(new URL('../src', import.meta.url)); // indépendant du cwd
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    for (const dir of ['core', 'render', 'ui', 'tracking', 'prep'].map((d) => join(src, d))) {
      for (const file of walk(dir)) {
        expect(
          readFileSync(file, 'utf8').includes('experimental/'),
          `${file} importe un module expérimental — interdit sans validation humaine`,
        ).toBe(false);
      }
    }
  });
});
