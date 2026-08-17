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
import { faceWidthPx, frameMetrics } from '../src/core/faceMetrics.js';
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
  it('sa longueur rendue croît avec le yaw, et reste quasi nulle de face', () => {
    const spec = specForTotalWidthMm(132);
    const at = (yaw: number): number =>
      renderedTempleLengthPx(spec, frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw), 1);

    // ⚠️ Plus « exactement zéro » : de face la charnière et l'oreille ne sont
    // pas confondues à l'écran, elles sont seulement très proches. C'est la
    // réalité mesurée, et `render/temple.ts` masque de toute façon la branche
    // en dessous de 0,10 rad. Le seuil est exprimé en largeurs de visage pour
    // ne pas réintroduire une constante de taille (§0.0.3).
    const m0 = frameMetrics(makeFaceAtYaw(0), W, H, makeCal(), 0);
    expect(at(0)).toBeLessThan(0.1 * faceWidthPx(makeFaceAtYaw(0), W, H));
    expect(m0.livePxPerMm).toBeGreaterThan(0);
    expect(at(Math.PI / 6)).toBeGreaterThan(at(0));
    expect(at(Math.PI / 3)).toBeGreaterThan(at(Math.PI / 6));
  });

  /**
   * ⭐ Ce test REMPLACE « elle suit sin(yaw) ».
   *
   * L'ancien verrouillait un modèle NOMINAL : longueur du sprite × sin(yaw).
   * C'est ce modèle qui laissait la branche fausse de ±20 %, parce que la
   * longueur venait du sprite et non du visage. Elle est désormais MESURÉE —
   * la branche relie deux points connus à l'écran — et c'est cette propriété
   * là qu'il faut verrouiller, sur un balayage et non sur un point.
   *
   * Le raccourci en sin(yaw) n'est pas perdu pour autant : il est porté par
   * l'écart charnière ↔ oreille, qui est lui-même le long de l'axe
   * avant-arrière de la tête.
   */
  it('GARDE-FOU : le bout de la branche tombe SUR l’oreille, à tout yaw', () => {
    const spec = specForTotalWidthMm(132);
    for (const yaw of [0.15, 0.3, Math.PI / 6, 0.7, Math.PI / 3, -0.4, -Math.PI / 6]) {
      const m = frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw);
      const side: 1 | -1 = yaw >= 0 ? -1 : 1;
      const t = templeAffine(spec, m, side);
      const tip = apply(t, {
        x: spec.hingeProfile.x + templeLengthMm(spec) * (spec.profilePxPerMm ?? spec.spritePxPerMm),
        y: spec.hingeProfile.y,
      });
      const ear = side > 0 ? m.ear.right : m.ear.left;
      expect(Math.hypot(tip.x - ear.x, tip.y - ear.y), `yaw=${yaw}`).toBeLessThan(0.5);
    }
  });

  it('elle est ancrée à la CHARNIÈRE, pas au centre du pont', () => {
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

  it('les deux côtés sont symétriques DE FACE — et pas de trois quarts', () => {
    const spec = specForTotalWidthMm(132);

    // De face, rien ne distingue les deux côtés : la symétrie doit être exacte.
    const m0 = frameMetrics(makeFaceAtYaw(0), W, H, makeCal(), 0);
    expect(templeAffine(spec, m0, 1).a).toBeCloseTo(-templeAffine(spec, m0, -1).a, 9);

    // ⚠️ Ce test exigeait auparavant la même symétrie À TOUT YAW. C'était une
    // propriété du modèle NOMINAL (±longueur·sin|yaw|), pas du réel : quand la
    // tête tourne, une branche s'allonge et l'autre se dérobe. L'exiger
    // revenait à verrouiller le modèle qu'on vient justement de remplacer par
    // une mesure. On vérifie donc l'inverse : de trois quarts, les deux côtés
    // NE sont plus symétriques.
    const yaw = Math.PI / 6;
    const m = frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw);
    expect(Math.abs(templeAffine(spec, m, 1).a)).not.toBeCloseTo(
      Math.abs(templeAffine(spec, m, -1).a),
      3,
    );
  });
});
