/**
 * tests/temporal.test.ts — la V1 mesure enfin l'écart temporal.
 *
 * Deux mécanismes y sont mis à l'épreuve, tous deux nouveaux :
 *
 *  1. la **parallaxe mesurée par rotation de tête** (§4, parade B4 n°2), qui
 *     remplace un biais systématique de 3 à 7 % supposé nul par une mesure ;
 *  2. l'**écart temporal lu dans les pixels** (`core/temporalWidth.ts`), qui
 *     remplace la constante `FACE_WIDTH_CORRECTION_MM` — laquelle demandait à un
 *     seul nombre de représenter un écart de ~20 mm variant de ±4 mm d'un
 *     visage à l'autre.
 *
 * 🔴 La tête de test est projetée en PERSPECTIVE EXACTE (`fixtures/head3d.ts`),
 * jamais par le modèle plan qu'utilise la sonde. Un test qui rendrait à la sonde
 * sa propre formule serait vert par construction — la leçon S4.
 */

import { describe, expect, it } from 'vitest';

import {
  calibrateWithCard,
  calibrateWithCardMeasured,
  CARD_WIDTH_MM,
  estimateDistanceMm,
} from '../src/core/calibration.js';
import {
  depthOffsetMm,
  isUsableProbeView,
  parallaxFactor,
  parallaxResidualRelError,
  type RotatedView,
} from '../src/core/parallax.js';
import { depthFromRotation } from '../src/core/depthFit.js';
import { findHeadEdge, motionMask } from '../src/core/silhouette.js';
import { measureTemporalWidth, MAX_TEMPLE_MARGIN_MM } from '../src/core/temporalWidth.js';
import { comparisonWidth } from '../src/core/verdict.js';
import { at, CalibrationError } from '../src/core/geom.js';
import { EYE_L, EYE_R } from '../src/core/faceMetrics.js';
import { ADULTE, cardWidthPx, probeDepthMm, projectHead, type CameraOptions } from './fixtures/head3d.js';
import { makeScene, type GlassesOptions, type SceneOptions } from './fixtures/scene.js';
import { makeCal } from './fixtures/builders.js';

const W = 1280;
const H = 720;
const DISTANCE_MM = 700; // distance au plan des tempes ; la carte est 30 mm devant

function camera(yawDeg: number, over: Partial<CameraOptions> = {}): CameraOptions {
  return { yawRad: (yawDeg * Math.PI) / 180, distanceMm: DISTANCE_MM, w: W, h: H, ...over };
}

function view(yawDeg: number, over: Partial<CameraOptions> = {}): RotatedView {
  const cam = camera(yawDeg, over);
  return { lm: projectHead(ADULTE, cam).lm, yawRad: cam.yawRad, rollRad: 0, w: W, h: H };
}

/**
 * Le BALAYAGE que le client produit en tournant la tête : plusieurs angles de
 * chaque côté. Deux extrêmes ne suffisent pas — la profondeur et la distance
 * dépendent de l'angle différemment, et deux points ne séparent pas deux
 * courbes qui se ressemblent.
 */
const DEGRES = [-30, -25, -20, -15, 15, 20, 25, 30];
const BALAYAGE = DEGRES.map((d) => view(d));
const BALAYAGE_75 = DEGRES.map((d) => view(d, { hfovDeg: 75 }));

/** Largeur vraie du segment 234↔454, telle que la tête de test la porte. */
const VRAIE_LARGEUR_REPERES = 2 * ADULTE.templeHalfMm;
/** Largeur vraie aux tempes — 21 mm de plus, l'ordre de grandeur observé en vrai. */
const VRAI_ECART_TEMPORAL = 2 * ADULTE.headHalfMm;

describe('parallaxe mesurée par rotation de tête (B4, parade n°2)', () => {
  it('retrouve la profondeur front ↔ coins externes à mieux que 10 %', () => {
    const attendu = probeDepthMm(ADULTE);
    const depth = depthOffsetMm(view(-20), view(20), VRAIE_LARGEUR_REPERES, DISTANCE_MM);
    expect(depth).toBeGreaterThan(attendu * 0.9);
    expect(depth).toBeLessThan(attendu * 1.1);
  });

  it('la mesure ne dépend pas du signe de la convention de yaw', () => {
    // Le signe de `yawRad` vient d'une matrice dont la convention n'est pas
    // vérifiable sans mire. La MAGNITUDE, elle, n'en dépend pas — et c'est la
    // seule chose que la sonde prétend produire.
    const direct = depthOffsetMm(view(-20), view(20), VRAIE_LARGEUR_REPERES, DISTANCE_MM);
    const inverse = depthOffsetMm(view(20), view(-20), VRAIE_LARGEUR_REPERES, DISTANCE_MM);
    expect(inverse).toBeCloseTo(direct, 6);
  });

  it('refuse deux vues du même côté', () => {
    expect(() => depthOffsetMm(view(15), view(22), VRAIE_LARGEUR_REPERES, DISTANCE_MM)).toThrow(CalibrationError);
  });

  it('refuse une rotation trop faible, au lieu d’amplifier le bruit', () => {
    expect(isUsableProbeView(view(4))).toBe(false);
    expect(() => depthOffsetMm(view(-4), view(4), VRAIE_LARGEUR_REPERES, DISTANCE_MM)).toThrow(/Tournez la tête/);
  });

  it('le résidu après mesure est bien plus petit que le biais qu’il remplace', () => {
    const depth = depthOffsetMm(view(-20), view(20), VRAIE_LARGEUR_REPERES, DISTANCE_MM);
    const biaisBrut = parallaxFactor(depth, DISTANCE_MM) - 1;
    expect(parallaxResidualRelError(depth, DISTANCE_MM)).toBeLessThan(biaisBrut / 2);
  });
});

describe('profondeur par rotation — l’estimateur qui a survécu au réel', () => {
  const VRAIE = 2 * ADULTE.templeHalfMm;

  it('retrouve la profondeur carte ↔ coins externes à mieux que 10 %', () => {
    // La tête de test est projetée en perspective EXACTE ; la sonde, elle,
    // utilise un modèle au premier ordre. L'écart résiduel — 8 % ici — est
    // exactement la différence entre les deux, et il pèse 8 % d'une correction
    // qui vaut 6 %, soit 0,5 % sur la largeur finale.
    const d = depthFromRotation(BALAYAGE, VRAIE, DISTANCE_MM);
    expect(Math.abs(d.depthMm - probeDepthMm(ADULTE)) / probeDepthMm(ADULTE)).toBeLessThan(0.1);
  });

  it('🔴 aucune dépendance au champ de vision de la caméra', () => {
    // Le HFOV supposé de 60° servait à estimer la distance. Il n'entre plus
    // nulle part : une caméra à 75° doit rendre EXACTEMENT le même résultat.
    const a = depthFromRotation(BALAYAGE, VRAIE, DISTANCE_MM);
    const b = depthFromRotation(BALAYAGE_75, VRAIE, DISTANCE_MM);
    expect(b.depthMm).toBeCloseTo(a.depthMm, 6);
  });

  it('🔴 un DÉCALAGE CONSTANT du repère sagittal est éliminé', () => {
    // C'est le défaut qui rendait 103 mm sur la vraie vidéo : le repère de front
    // n'est jamais exactement sur le plan sagittal. La pente doit l'ignorer.
    const biaise = BALAYAGE.map((v) => ({
      ...v,
      lm: v.lm.map((p, k) => (k === 151 ? { x: p.x + 0.02, y: p.y } : p)),
    }));
    const d = depthFromRotation(biaise, VRAIE, DISTANCE_MM);
    expect(d.depthMm).toBeCloseTo(depthFromRotation(BALAYAGE, VRAIE, DISTANCE_MM).depthMm, 1);
  });

  it('refuse un balayage d’un seul côté', () => {
    const plat = [12, 15, 18, 20].map((deg) => view(deg));
    expect(() => depthFromRotation(plat, VRAIE, DISTANCE_MM)).toThrow(/trop semblables|franchement/i);
  });

  it('refuse trop peu de vues', () => {
    expect(() => depthFromRotation([view(-20)], VRAIE, DISTANCE_MM)).toThrow(/vue\(s\) exploitable/);
  });

  it('rejette une profondeur hors de tout plausible', () => {
    // Un repère qui s'envole : la sonde doit refuser, pas publier.
    const fou = BALAYAGE.map((v) => ({
      ...v,
      lm: v.lm.map((p, k) => (k === 151 ? { x: 0.5 + (v.yawRad > 0 ? 0.2 : -0.2), y: p.y } : p)),
    }));
    expect(() => depthFromRotation(fou, VRAIE, DISTANCE_MM)).toThrow(/hors de tout plausible/);
  });
});

describe('la carte seule est BIAISÉE — et la rotation le corrige', () => {
  const cam = camera(0);
  const { lm } = projectHead(ADULTE, cam);
  const cardPx = cardWidthPx(ADULTE, cam);

  it('la carte SANS rotation sous-estime le visage : c’est le biais B4', () => {
    const naive = calibrateWithCard(cardPx, lm, W, H);
    const ecart = (VRAIE_LARGEUR_REPERES - naive.faceWidthMm) / VRAIE_LARGEUR_REPERES;
    // La carte est 30 mm devant les tempes, à 670 mm : ~4,5 % attendus.
    expect(ecart).toBeGreaterThan(0.03);
    expect(ecart).toBeLessThan(0.07);
  });

  it('🔴 INVARIANT : avec la rotation, la largeur vraie est retrouvée à mieux que 1 %', () => {
    // Le reliquat anatomique yeux → tempes vaut exactement, sur cette tête de
    // test, `sellionAheadMm / 2` = 11 mm — à comparer aux 12 mm déclarés.
    const { cal, refinement } = calibrateWithCardMeasured(
      cardPx,
      W,
      lm,
      W,
      H,
      BALAYAGE,
      null,
    );
    expect(refinement.parallaxMeasured).toBe(true);
    // Le reliquat vient du terme anatomique déclaré : 12 mm annoncés contre
    // 11 mm réels sur cette tête. Il vaut 0,6 % — l'ordre de grandeur promis.
    expect(Math.abs(cal.faceWidthMm - VRAIE_LARGEUR_REPERES) / VRAIE_LARGEUR_REPERES).toBeLessThan(
      0.01,
    );
  });

  it('sans rotation, la calibration reste EXACTEMENT celle du §4 — biais compris', () => {
    const naive = calibrateWithCard(cardPx, lm, W, H);
    const { cal, refinement } = calibrateWithCardMeasured(cardPx, W, lm, W, H, null, null);
    expect(cal.faceWidthMm).toBeCloseTo(naive.faceWidthMm, 6);
    expect(refinement.parallaxMeasured).toBe(false);
    expect(refinement.notes.join(' ')).toMatch(/parallaxe/i);
  });

  it('une caméra dont le champ n’est pas celui supposé ne casse pas la correction', () => {
    // Le HFOV n'entre QUE dans un terme du second ordre. Une erreur de 25 %
    // dessus doit rester invisible sur la largeur finale.
    const vrai = camera(0, { hfovDeg: 75 });
    const lm75 = projectHead(ADULTE, vrai).lm;
    const { cal } = calibrateWithCardMeasured(
      cardWidthPx(ADULTE, vrai),
      W,
      lm75,
      W,
      H,
      BALAYAGE_75,
      null,
    );
    expect(Math.abs(cal.faceWidthMm - VRAIE_LARGEUR_REPERES) / VRAIE_LARGEUR_REPERES).toBeLessThan(
      0.02,
    );
  });
});

describe('écart temporal lu dans les pixels', () => {
  const cam = camera(0);
  const { lm, headEdgesPx } = projectHead(ADULTE, cam);
  const cardPx = cardWidthPx(ADULTE, cam);

  const sceneOf = (over: Partial<SceneOptions> & { glasses?: GlassesOptions } = {}) =>
    makeScene({
      w: W,
      h: H,
      headLeftPx: Math.round(headEdgesPx.left),
      headRightPx: Math.round(headEdgesPx.right),
      ...over,
    });

  const frontal = sceneOf({});
  const motion = motionMask(frontal, [sceneOf({ shiftPx: 6 }), sceneOf({ shiftPx: -6 })]);

  it('🔴 INVARIANT : la largeur aux tempes est retrouvée, pas celle des repères', () => {
    const { cal } = calibrateWithCardMeasured(cardPx, W, lm, W, H, BALAYAGE, {
      frontal,
      motion,
      lm,
      w: W,
      h: H,
    });

    expect(cal.temporalWidthMm).toBeDefined();
    const mesure = cal.temporalWidthMm ?? 0;
    expect(Math.abs(mesure - VRAI_ECART_TEMPORAL)).toBeLessThan(3);

    // Et c'est bien une AUTRE grandeur que celle qui pilote l'échelle.
    expect(mesure - cal.faceWidthMm).toBeGreaterThan(15);
  });

  it('c’est l’écart temporal qui sert de référence à la légende', () => {
    const { cal } = calibrateWithCardMeasured(cardPx, W, lm, W, H, BALAYAGE, {
      frontal,
      motion,
      lm,
      w: W,
      h: H,
    });
    expect(comparisonWidth(cal).mm).toBeCloseTo(cal.temporalWidthMm ?? 0, 6);
  });

  it('sans mesure, la légende retombe sur les repères et leur constante', () => {
    const cal = makeCal({ faceWidthMm: 115 });
    expect(comparisonWidth(cal).mm).toBeCloseTo(115, 6);
    expect(comparisonWidth(cal).relError).toBeCloseTo(cal.relError, 6);
  });

  it('🔴 un fond CHARGÉ ne gêne plus : on ne le lit jamais', () => {
    // Renversement assumé. L'ancienne version modélisait le FOND et exigeait un
    // mur uni ; sur la première vraie vidéo elle a trouvé le montant d'une
    // fenêtre à 83 mm de la tempe. La nouvelle part de la TÊTE et croît vers
    // l'extérieur : ce qu'il y a derrière n'a plus d'importance.
    const charge = sceneOf({ bgNoise: 60 });
    const r = measureTemporalWidth({
      frontal: charge,
      motion: null,
      lm,
      w: W,
      h: H,
      pxPerMm: cardPx / CARD_WIDTH_MM,
      scaleRelError: 0.02,
    });
    expect(r.measured).toBe(true);
    // Un fond bruité coûte un peu de précision sur le bord, mais ne l'empêche plus.
    expect(Math.abs(r.widthMm - VRAI_ECART_TEMPORAL)).toBeLessThan(6);
  });

  it('une chevelure large est REFUSÉE, jamais prise pour une tempe', () => {
    const pxPerMm = cardPx / CARD_WIDTH_MM;
    const debord = Math.round((MAX_TEMPLE_MARGIN_MM + 12) * pxPerMm);
    const cheveux = sceneOf({
      headLeftPx: Math.round(headEdgesPx.left) - debord,
      headRightPx: Math.round(headEdgesPx.right) + debord,
    });
    const r = measureTemporalWidth({
      frontal: cheveux,
      motion: null,
      lm,
      w: W,
      h: H,
      pxPerMm,
      scaleRelError: 0.02,
    });
    expect(r.measured).toBe(false);
    expect(r.reason).toMatch(/cheveux|frontière nette/i);
  });

  it('🔴 un client qui a GARDÉ SES LUNETTES est refusé, pas mesuré', () => {
    // La ligne de balayage passe à hauteur des coins externes des yeux — donc
    // exactement là où passent les branches d'une monture déjà portée. Sans ce
    // contrôle, on mesurerait la monture du client en lui annonçant sa tête.
    const pxPerMm = cardPx / CARD_WIDTH_MM;
    const eyeY = Math.round(((at(lm, EYE_L).y + at(lm, EYE_R).y) / 2) * H);
    const porteur = sceneOf({
      glasses: {
        eyeY,
        halfHeightPx: Math.round(9 * pxPerMm),
        overhangPx: Math.round(5 * pxPerMm),
      },
    });

    const r = measureTemporalWidth({
      frontal: porteur,
      motion: null,
      lm,
      w: W,
      h: H,
      pxPerMm,
      scaleRelError: 0.02,
    });
    expect(r.measured).toBe(false);
    expect(r.reason).toMatch(/lunettes/i);
  });

  it('contre-épreuve : sans lunettes, le même visage passe', () => {
    // Sans cette contre-épreuve, le contrôle précédent serait satisfait par un
    // refus systématique — il vérifierait sa propre sévérité, pas sa justesse.
    const r = measureTemporalWidth({
      frontal,
      motion,
      lm,
      w: W,
      h: H,
      pxPerMm: cardPx / CARD_WIDTH_MM,
      scaleRelError: 0.02,
    });
    expect(r.reason).toBeNull();
    expect(r.measured).toBe(true);
  });

  it('un bord immobile pendant la rotation est REFUSÉ', () => {
    // Un fond parfaitement statique : rien n'a bougé, donc rien n'est confirmé.
    const rien = new Uint8Array(W * H);
    const r = findHeadEdge({
      buf: frontal,
      motion: rien,
      y: Math.round(H / 2),
      fromX: Math.round(headEdgesPx.right) - 20,
      dir: 1,
      maxPx: 200,
    });
    expect(r.confident).toBe(false);
    expect(r.reason).toMatch(/bougé/i);
  });

  it('l’incertitude annoncée reste sous celle de la carte non corrigée', () => {
    const { cal } = calibrateWithCardMeasured(cardPx, W, lm, W, H, BALAYAGE, {
      frontal,
      motion,
      lm,
      w: W,
      h: H,
    });
    expect(cal.relError).toBeLessThan(0.025);
    expect(cal.temporalRelError ?? 1).toBeLessThan(0.03);
  });
});

describe('la distance, elle, reste une estimation d’IHM', () => {
  it('la distance estimée retrouve le plan de la carte', () => {
    const cam = camera(0);
    const d = estimateDistanceMm(cardWidthPx(ADULTE, cam), W);
    expect(d).toBeCloseTo(DISTANCE_MM - ADULTE.foreheadAheadMm, -1);
  });
});
