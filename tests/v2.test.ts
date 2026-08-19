/**
 * tests/v2.test.ts — mode magasin (CLAUDE.md §11).
 *
 * La V2 n'est pas un fork : elle ajoute UNE fonction de calibration et UNE
 * valeur d'énumération. Tout l'aval — frameMetrics, classify, verdict, drawFrame
 * — est strictement inchangé. Ces tests verrouillent cette promesse.
 */

import { describe, expect, it } from 'vitest';

import {
  CARD_REL_ERROR,
  IRIS_REL_ERROR,
  WORN_FRAME_REL_ERROR,
  calibrateWithWornFrame,
} from '../src/core/calibration.js';
import { haloOffsets, OVERLAY_PADDING_MM } from '../src/render/composite.js';
import { frameMetrics } from '../src/core/faceMetrics.js';
import {
  apply,
  renderedTempleLengthPx,
  spriteAffine,
  templeAffine,
  templeLengthMm,
} from '../src/core/transform.js';
import { totalFrameWidthMm } from '../src/core/frameSpec.js';
import { verdict } from '../src/core/verdict.js';

import { H, LANDMARKS_CAL, makeFaceAtYaw, W } from './fixtures/landmarks.js';
import { makeCal, specForTotalWidthMm } from './fixtures/builders.js';

describe('V2-1 — la monture portée comme étalon', () => {
  it('est la source la plus précise des trois, sans être flattée', () => {
    expect(WORN_FRAME_REL_ERROR).toBeLessThan(CARD_REL_ERROR);
    expect(CARD_REL_ERROR).toBeLessThan(IRIS_REL_ERROR);
    // T8 : 2 %, pas le 1 % d'origine, qui supposait 2 clics justes à 4 px sur 400
    // sur un bord d'acétate flou, PLUS le biais de profondeur de B4.
    expect(WORN_FRAME_REL_ERROR).toBeCloseTo(0.02, 6);
  });

  it('convertit la largeur pixel de la monture portée en largeur de visage', () => {
    const worn = specForTotalWidthMm(140, { slug: 'etalon' });
    const cal = calibrateWithWornFrame(500, worn, LANDMARKS_CAL, W, H);

    // 500 px pour 140 mm → 3,571 px/mm ; le visage fait 483,6 px.
    expect(cal.faceWidthMm).toBeCloseTo(483.6448598130841 / (500 / 140), 6);
    expect(cal.source).toBe('worn-frame');
  });

  it('une monture de référence plus large donne un visage plus large, proportionnellement', () => {
    const a = calibrateWithWornFrame(500, specForTotalWidthMm(130), LANDMARKS_CAL, W, H);
    const b = calibrateWithWornFrame(500, specForTotalWidthMm(140), LANDMARKS_CAL, W, H);
    expect(b.faceWidthMm / a.faceWidthMm).toBeCloseTo(140 / 130, 6);
  });
});

describe('V2-2 — dilatation du sprite sur la monture réelle (§11.6)', () => {
  it('aucune dilatation par défaut : la V1 n’en veut pas', () => {
    expect(haloOffsets(0, 3.5)).toHaveLength(0);
    expect(haloOffsets(-1, 3.5)).toHaveLength(0);
  });

  it('le rayon est exprimé en MILLIMÈTRES réels, pas en pixels en dur', () => {
    // Même dilatation physique quelle que soit la distance à la caméra :
    // un padding en pixels grossirait en s’approchant, ce qui n’a aucun sens.
    for (const livePxPerMm of [2, 3.5, 7]) {
      for (const [dx, dy] of haloOffsets(OVERLAY_PADDING_MM, livePxPerMm)) {
        expect(Math.hypot(dx, dy) / livePxPerMm).toBeCloseTo(OVERLAY_PADDING_MM, 6);
      }
    }
  });

  it('le halo est centré : il épaissit la silhouette sans déplacer la monture', () => {
    // Un halo asymétrique décalerait le sprite, donc fausserait le décentrement
    // à l’écran tout en gardant des chiffres justes — le pire des deux mondes.
    const offsets = haloOffsets(OVERLAY_PADDING_MM, 3.5);
    const sx = offsets.reduce((a, [dx]) => a + dx, 0);
    const sy = offsets.reduce((a, [, dy]) => a + dy, 0);
    expect(sx).toBeCloseTo(0, 9);
    expect(sy).toBeCloseTo(0, 9);
  });

  it('la dilatation ne peut PAS atteindre la chaîne de mesure', () => {
    // Garde structurel : `verdict()` prend 6 paramètres et aucun n’est un
    // padding. Si un jour quelqu’un fait entrer la dilatation dans la mesure,
    // ce test devient rouge avant que l’image ne devienne fausse.
    expect(verdict.length).toBe(6);

    const spec = specForTotalWidthMm(132);
    expect(totalFrameWidthMm(spec)).toBeCloseTo(132, 6);
    expect(OVERLAY_PADDING_MM).toBeCloseTo(1.5, 6);
  });
});

describe('Lot 7 — la branche est perpendiculaire à la face', () => {
  it('sa longueur rendue croît avec le yaw, et vaut ZÉRO de face', () => {
    const spec = specForTotalWidthMm(132);
    const at = (yaw: number): number =>
      renderedTempleLengthPx(spec, frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw), 1);

    // Modèle physique (2026-08-19) : longueur réelle × sin(|yaw|). De face,
    // sin(0) = 0 — une branche vue exactement dans son axe n'a pas d'étendue.
    const m0 = frameMetrics(makeFaceAtYaw(0), W, H, makeCal(), 0);
    expect(at(0)).toBe(0);
    expect(m0.livePxPerMm).toBeGreaterThan(0);
    expect(at(Math.PI / 6)).toBeGreaterThan(at(0));
    expect(at(Math.PI / 3)).toBeGreaterThan(at(Math.PI / 6));
  });

  /**
   * 🔴 Ce test REMPLACE « le bout tombe SUR l'oreille » — arbitrage 2026-08-19.
   *
   * L'ancien garde-fou verrouillait précisément le comportement rejeté : une
   * similitude qui étirait/comprimait la branche pour que son extrémité tombe
   * sur l'oreille quelle que soit sa longueur réelle — le slider de taille
   * (§1 bug #1) appliqué à la branche. Le modèle retenu : échelle PHYSIQUE
   * (longueur réelle × sin|yaw|), direction mesurée vers l'oreille, extrémité
   * LIBRE — cachée par l'occlusion si elle passe derrière la tête.
   */
  it('GARDE-FOU : la longueur peinte est PHYSIQUE à tout yaw — jamais ajustée à l’oreille', () => {
    const spec = specForTotalWidthMm(132);
    for (const yaw of [0.15, 0.3, Math.PI / 6, 0.7, Math.PI / 3, -0.4, -Math.PI / 6]) {
      const m = frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw);
      const side: 1 | -1 = yaw >= 0 ? -1 : 1;
      const t = templeAffine(spec, m, side);
      const tip = apply(t, {
        x: spec.hingeProfile.x + templeLengthMm(spec) * (spec.profilePxPerMm ?? spec.spritePxPerMm),
        y: spec.hingeProfile.y,
      });
      const anchor = apply(t, spec.hingeProfile);
      const paintedMm = Math.hypot(tip.x - anchor.x, tip.y - anchor.y) / m.livePxPerMm;
      expect(paintedMm, `yaw=${yaw}`).toBeCloseTo(
        templeLengthMm(spec) * Math.sin(Math.abs(yaw)),
        6,
      );
      // …et l'oreille n'attire PAS l'extrémité : la direction est la sienne,
      // la distance est celle de la physique.
      const ear = side > 0 ? m.ear.right : m.ear.left;
      const cross = t.a * (ear.y - anchor.y) - t.b * (ear.x - anchor.x);
      expect(Math.abs(cross) / Math.hypot(t.a, t.b), `direction yaw=${yaw}`).toBeLessThan(1e-6);
    }
  });

  it('elle est ancrée au TENON, pas au centre du pont', () => {
    const spec = specForTotalWidthMm(132);
    const yaw = Math.PI / 6;
    const m = frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw);

    const face = spriteAffine(spec, m);
    const temple = templeAffine(spec, m, 1);
    // Le bord externe de la face est à 66 mm du pont : les deux ancrages ne
    // peuvent pas coïncider, sinon la branche partirait du milieu du visage.
    const ecartPx = Math.abs(temple.e - face.e);
    expect(ecartPx).toBeGreaterThan(60 * m.livePxPerMm);
  });

  it('l’échelle physique est IDENTIQUE des deux côtés — seule la direction diffère', () => {
    const spec = specForTotalWidthMm(132);

    // De face, la projection le long de la branche est nulle des deux côtés.
    const m0 = frameMetrics(makeFaceAtYaw(0), W, H, makeCal(), 0);
    expect(Math.hypot(templeAffine(spec, m0, 1).a, templeAffine(spec, m0, 1).b)).toBeCloseTo(0, 9);
    expect(Math.hypot(templeAffine(spec, m0, -1).a, templeAffine(spec, m0, -1).b)).toBeCloseTo(0, 9);

    // De trois quarts, les DEUX branches font la même longueur réelle et le
    // même angle avec l'axe optique : même |échelle| — l'ancien modèle « à
    // l'oreille » les rendait différentes, puisque chaque côté s'étirait vers
    // SON oreille. Les directions, elles, diffèrent (chacune vers la sienne).
    const yaw = Math.PI / 6;
    const m = frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw);
    const t1 = templeAffine(spec, m, 1);
    const t2 = templeAffine(spec, m, -1);
    expect(Math.hypot(t1.a, t1.b)).toBeCloseTo(Math.hypot(t2.a, t2.b), 9);
    // Chaque côté vise SA propre oreille (colinéarité mesurée, pas supposée).
    for (const [t, side] of [
      [t1, 1],
      [t2, -1],
    ] as const) {
      const anchor = apply(t, spec.hingeProfile);
      const ear = side > 0 ? m.ear.right : m.ear.left;
      const cross = t.a * (ear.y - anchor.y) - t.b * (ear.x - anchor.x);
      expect(Math.abs(cross) / Math.hypot(t.a, t.b), `côté ${side}`).toBeLessThan(1e-6);
    }
  });
});
