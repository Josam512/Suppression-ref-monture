/**
 * tests/scale.test.ts — la chaîne des trois échelles (CLAUDE.md §8).
 *
 * Toute la géométrie de core/ est du calcul pur : elle se teste sans webcam,
 * sans navigateur, en millisecondes.
 */

import { describe, expect, it } from 'vitest';

import { CalibrationError } from '../src/core/geom.js';
import {
  computeSpritePxPerMm,
  totalFrameWidthMm,
  type FrontMarks,
} from '../src/core/frameSpec.js';
import {
  assertIrisUsable,
  assertPlausibleFaceWidth,
  calibrateWithCard,
  calibrateWithWornFrame,
  estimateDistanceMm,
  parallaxRelErrorAt,
  parallaxRelErrorFromCard,
  scaleFromIris,
  WORN_FRAME_REL_ERROR,
} from '../src/core/calibration.js';
import { faceWidthPx, frameMetrics } from '../src/core/faceMetrics.js';
import { renderedFrameHeightPx, renderedFrameWidthPx } from '../src/core/transform.js';
import {
  BRIDGE_AHEAD_MM,
  NOMINAL_DISTANCE_MM,
  planeScale,
} from '../src/core/framePlane.js';
import { computeAlphaBBox } from '../src/prep/alphaBBox.js';

import {
  BASE_FACE_PX,
  H,
  LANDMARKS_100CM,
  LANDMARKS_50CM,
  LANDMARKS_138,
  LANDMARKS_CAL,
  makeFaceAtYaw,
  W,
} from './fixtures/landmarks.js';
import { makeCal, makeRgba, SPEC_132, specForTotalWidthMm } from './fixtures/builders.js';

/** 6 points cohérents avec une échelle de 12,0 px/mm. */
const MARKS_FIXTURE: FrontMarks = {
  p1: { x: 0, y: 0 },
  p2: { x: 44 * 12, y: 0 },
  p3: { x: 0, y: 0 },
  p4: { x: 22 * 12, y: 0 },
  p5: { x: 0, y: 0 },
  p6: { x: 0, y: 39 * 12 },
};

/** Le pont paraît 10 % trop court : signature d'une photo prise de trois quarts. */
const MARKS_SKEWED: FrontMarks = {
  ...MARKS_FIXTURE,
  p4: { x: 22 * 12 * 0.9, y: 0 },
};

describe('Échelle 1 — le sprite de la monture', () => {
  it('3 mesures concordantes → px/mm', () => {
    expect(computeSpritePxPerMm(MARKS_FIXTURE, { aMm: 44, bMm: 39, pontMm: 22 })).toBeCloseTo(
      12.0,
      1,
    );
  });

  it('photo de trois quarts → rejetée', () => {
    expect(() => computeSpritePxPerMm(MARKS_SKEWED, { aMm: 44, bMm: 39, pontMm: 22 })).toThrow(
      CalibrationError,
    );
  });

  it('sans la cote B, le seuil se durcit et attrape un écart que 3 cotes toléraient', () => {
    // Écart de 3 % : accepté à 3 cotes (seuil 4 %), refusé à 2 (seuil 2,5 %).
    const marks: FrontMarks = { ...MARKS_FIXTURE, p4: { x: 22 * 12 * 0.97, y: 0 } };
    expect(() => computeSpritePxPerMm(marks, { aMm: 44, bMm: 39, pontMm: 22 })).not.toThrow();
    expect(() => computeSpritePxPerMm(marks, { aMm: 44, pontMm: 22 })).toThrow(CalibrationError);
  });

  // ⭐ B3 — le padding transparent ne doit RIEN changer à la largeur en mm.
  it('B3 : un sprite padé et un sprite recadré donnent la même largeur en mm', () => {
    const tight = makeRgba(120, 40, { x: 0, y: 0, w: 120, h: 40 });
    const padded = makeRgba(160, 80, { x: 20, y: 18, w: 120, h: 40 });

    const bboxTight = computeAlphaBBox(tight);
    const bboxPadded = computeAlphaBBox(padded);

    expect(bboxPadded.w).toBe(bboxTight.w);
    expect(bboxPadded.h).toBe(bboxTight.h);

    // Et la preuve que le test attraperait bien la régression : les dimensions
    // du FICHIER, elles, diffèrent de 33 %. C'est exactement ce que l'ancienne
    // formule `img.width / spritePxPerMm` aurait injecté dans le livrable.
    expect(padded.width).not.toBe(tight.width);
  });

  it('la largeur totale se lit sur la bbox alpha', () => {
    expect(totalFrameWidthMm(SPEC_132)).toBeCloseTo(132.0, 3);
  });
});

describe('Échelle 2 — le visage réel', () => {
  it('carte de 300 px de large → visage mesuré à 138 mm', () => {
    expect(calibrateWithCard(300, LANDMARKS_CAL, W, H).faceWidthMm).toBeCloseTo(138.0, 1);
  });

  it('iris de 42 px → échelle de 3.59 px/mm', () => {
    expect(scaleFromIris(42)).toBeCloseTo(3.59, 2);
  });

  // ⭐ B5 — un enfant n'est pas une panne.
  it("B5 : un visage d'enfant de 110 mm est accepté", () => {
    expect(() => assertPlausibleFaceWidth(110, 'card')).not.toThrow();
  });

  it('B5 : une mesure aberrante de 60 mm est rejetée en nommant la cause', () => {
    expect(() => assertPlausibleFaceWidth(60, 'card')).toThrow(/carte/i);
    expect(() => assertPlausibleFaceWidth(60, 'iris')).toThrow(/lunettes/i);
  });

  // ⭐ S2 — l'iris à travers des verres correcteurs est faux ET paraît excellent.
  it('S2 : des lunettes détectées interdisent la voie iris', () => {
    expect(() => assertIrisUsable(false)).not.toThrow();
    expect(() => assertIrisUsable(true)).toThrow(/carte bancaire/i);
  });

  /**
   * ⭐ B4 — la parallaxe se CHIFFRE, elle ne se renvoie plus au client.
   *
   * Ce test remplace « une carte trop grande signale que le client est trop
   * près », qui verrouillait un blocage : sous 60 cm, l'IHM affichait
   * « reculez » et désactivait la validation. C'était un problème de mesure
   * converti en contrainte de tournage — l'erreur que le journal du projet
   * retient déjà. Être près augmente un biais connu ; un biais connu se corrige
   * ou se chiffre.
   */
  it('B4 : plus on est près, plus la marge de parallaxe est grande — et rien ne bloque', () => {
    const far = 150; // px : carte petite à l'écran donc client loin
    const near = 600; // px : carte grande donc client près
    expect(estimateDistanceMm(far, W)).toBeGreaterThan(estimateDistanceMm(near, W));

    // La grandeur rendue est une MARGE, jamais un refus.
    expect(parallaxRelErrorFromCard(near, W)).toBeGreaterThan(parallaxRelErrorFromCard(far, W));
    for (const px of [100, 200, 400, 600, 900]) {
      const r = parallaxRelErrorFromCard(px, W);
      expect(Number.isFinite(r), `px=${px}`).toBe(true);
      expect(r, `px=${px}`).toBeGreaterThan(0);
    }
  });

  it('B4 : la marge suit bien Δz/z, la loi physique et rien d’autre', () => {
    expect(parallaxRelErrorAt(1000, 50)).toBeCloseTo(0.05, 9);
    expect(parallaxRelErrorAt(500, 50)).toBeCloseTo(0.10, 9);
    // Distance absurde (plus proche que la profondeur elle-meme) → marge maximale,
    // jamais un nombre rassurant.
    expect(parallaxRelErrorAt(20, 54)).toBe(1);
  });

  it('T8 : la monture portée est annoncée à 2 %, pas à 1 %', () => {
    const spec = specForTotalWidthMm(140);
    // Une monture de 140 mm qui occupe 500 px → 3.571 px/mm.
    const cal = calibrateWithWornFrame(500, spec, LANDMARKS_CAL, W, H);
    expect(cal.relError).toBe(WORN_FRAME_REL_ERROR);
    expect(cal.relError).toBeCloseTo(0.02, 5);
    expect(cal.faceWidthMm).toBeCloseTo((BASE_FACE_PX * 140) / 500, 3);
  });
});

describe('Échelle 3 — chaque frame', () => {
  // 🔴 S4 — l'ancienne version comparait deux valeurs recopiées depuis spec et
  // cal : elle ne pouvait PAS échouer, même chaîne d'échelle entièrement cassée.
  it('INVARIANT : la distance à la caméra ne change pas le rapport monture/visage', () => {
    const ratio = (lm: Parameters<typeof faceWidthPx>[0]): number => {
      const m = frameMetrics(lm, W, H, makeCal(), 0);
      return renderedFrameWidthPx(SPEC_132, m) / faceWidthPx(lm, W, H);
    };
    expect(ratio(LANDMARKS_50CM)).toBeCloseTo(ratio(LANDMARKS_100CM), 6);

    // Et ce rapport vaut bien 132/138 : la monture est rendue plus étroite que
    // le visage, dans la proportion exacte de leurs cotes réelles.
    expect(ratio(LANDMARKS_50CM)).toBeCloseTo(132 / 138, 6);

    // 🔴 Ce que cette égalité VERROUILLE, au-delà de l'invariant de distance :
    // la largeur rendue appartient au PLAN DES TEMPES, jamais à celui du pont.
    //
    // « Des lunettes sont posées sur le nez, pas sur les yeux » est vrai, et la
    // conclusion qu'on en tire spontanément — mettre le sprite à l'échelle du
    // plan du nez — est fausse : la LARGEUR d'une monture se réalise à ses
    // tenons, plaqués sur les côtés de la tête, pas à son pont situé ~48 mm
    // plus avant. Le faire dessinerait la monture 6 % trop large (8 mm sur
    // 132), et l'image aurait l'air MEILLEURE, sa partie centrale tombant
    // mieux. Raisonnement complet : `core/framePlane.ts`.
    const auPlanDuPont = (132 / 138) * planeScale(1, BRIDGE_AHEAD_MM);
    expect(ratio(LANDMARKS_50CM)).not.toBeCloseTo(auPlanDuPont, 2);
  });

  // 🔴 S1 — signature du yaw appliqué deux fois : la hauteur bougeait.
  it('INVARIANT : un yaw ne change PAS la hauteur rendue du sprite', () => {
    const height = (yaw: number): number =>
      renderedFrameHeightPx(SPEC_132, frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw));

    expect(height(Math.PI / 6)).toBeCloseTo(height(0), 6); // 30° vs 0°
    expect(height(Math.PI / 12)).toBeCloseTo(height(0), 6); // 15° vs 0°
  });

  it('S1 : le cos du yaw est appliqué UNE fois sur la largeur, pas deux', () => {
    const width = (yaw: number): number =>
      renderedFrameWidthPx(SPEC_132, frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw));

    const yaw = Math.PI / 6; // 30°
    // Une seule fois → cos(30°) = 0.866. Deux fois → cos²(30°) = 0.75.
    expect(width(yaw) / width(0)).toBeCloseTo(Math.cos(yaw), 6);
    expect(width(yaw) / width(0)).not.toBeCloseTo(Math.cos(yaw) ** 2, 3);
  });

  it("l'échelle live ne dépend pas du yaw", () => {
    const scale = (yaw: number): number =>
      frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw).livePxPerMm;
    expect(scale(Math.PI / 6)).toBeCloseTo(scale(0), 6);
  });

  // Le pont EST au plan du nez : l'échelle y est ~6 % plus grande qu'au plan
  // des tempes. Petit, mais du bon côté — et c'est ce qui empêche la constante
  // BRIDGE_AHEAD_MM d'être morte, donc supprimée « au nettoyage ».
  it('le plan du pont est bien en avant de celui des tempes', () => {
    const k = 4; // px/mm au plan des tempes
    const attendu = 1 / (1 - BRIDGE_AHEAD_MM / NOMINAL_DISTANCE_MM);
    expect(planeScale(k, BRIDGE_AHEAD_MM) / k).toBeCloseTo(attendu, 9);
    expect(attendu).toBeGreaterThan(1.05);
    expect(planeScale(k, 0)).toBe(k);
  });

  it('une profondeur de plan aberrante ne corrige rien plutôt que de corriger au hasard', () => {
    const k = 4;
    expect(planeScale(k, 400)).toBe(k); // 400 mm devant les tempes : impossible
    expect(planeScale(k, Number.NaN)).toBe(k);
  });
});

/**
 * ⭐ La question que le produit doit trancher : « une 46 ou une 48 ? »
 *
 * Un pas de calibre de 2 mm change la largeur totale de ~4 mm — 2 mm par verre.
 * Or l'incertitude sur la largeur du VISAGE vaut ±2,5 % en mode carte, soit
 * ±3,6 mm sur un visage de 145 : du même ordre. On pourrait en conclure que
 * l'app ne sait pas départager les deux tailles. Ce serait une erreur de
 * raisonnement, et ces tests disent pourquoi.
 *
 * Le client ne demande pas une largeur absolue : il compare DEUX montures sur
 * SON visage. L'erreur d'échelle du visage est alors **commune aux deux rendus**
 * — elle les agrandit ou les rétrécit ensemble, et l'écart entre les deux
 * survit intact. Ce qui doit être juste, c'est le RAPPORT des deux montures,
 * qui ne dépend que de leurs `spec.json` respectifs.
 */
describe('choisir entre une taille 46 et une taille 48', () => {
  /** Deux calibres du même modèle : 2 mm par verre, donc ~4 mm de largeur totale. */
  const CALIBRE_STEP_MM = 4;

  it('l’écart rendu à l’écran vaut exactement le pas de calibre', () => {
    const t46 = specForTotalWidthMm(132);
    const t48 = specForTotalWidthMm(132 + CALIBRE_STEP_MM);
    const m = frameMetrics(LANDMARKS_138, W, H, makeCal(), 0);

    const ecartPx = renderedFrameWidthPx(t48, m) - renderedFrameWidthPx(t46, m);
    expect(ecartPx / m.livePxPerMm).toBeCloseTo(CALIBRE_STEP_MM, 6);
  });

  /**
   * 🔴 LE test qui répond vraiment à la question — et qui a démenti la première
   * version de ce raisonnement.
   *
   * On avait écrit : « l'erreur de calibration est commune aux deux rendus,
   * donc elle ne brouille pas le choix ». **Faux, et le test l'a dit.** Ce qui
   * est commun, c'est le rapport entre les DEUX MONTURES. Leur rapport au
   * VISAGE, lui, se déplace en 1/calibration : croire le visage 10 % plus large
   * qu'il n'est dessine les deux montures 10 % plus étroites par rapport à lui.
   *
   * Ce qui est donc verrouillé ici, c'est le vrai invariant : le RAPPORT des
   * deux tailles entre elles, exact quelle que soit la calibration.
   */
  it('GARDE-FOU : le rapport entre les deux tailles est exact, calibration fausse ou non', () => {
    const t46 = specForTotalWidthMm(132);
    const t48 = specForTotalWidthMm(132 + CALIBRE_STEP_MM);

    for (const biais of [0.9, 0.95, 1.0, 1.05, 1.1]) {
      const m = frameMetrics(LANDMARKS_138, W, H, makeCal({ faceWidthMm: 138 * biais }), 0);
      expect(
        renderedFrameWidthPx(t48, m) / renderedFrameWidthPx(t46, m),
        `biais=${biais}`,
      ).toBeCloseTo((132 + CALIBRE_STEP_MM) / 132, 9);
    }
  });

  /**
   * ⚠️ Le chiffre qui décide, et il n'est pas confortable : avec la carte à
   * 2,5 %, l'incertitude sur la largeur du visage déplace la monture APPARENTE
   * de 3,3 mm sur 132 — soit 0,8 pas de calibre. Deux tailles voisines restent
   * donc départageables **par comparaison**, mais pas de façon absolue.
   *
   * Conclusion pratique, à ne pas enjoliver : pour trancher une taille 46
   * contre une 48 sans hésitation, il faut descendre la calibration sous 1,5 %.
   */
  it('chiffre la marge : la carte à 2,5 % vaut 0,8 pas de calibre', () => {
    const CARD = 0.025;
    const pasEquivalents = (132 * CARD) / CALIBRE_STEP_MM;
    expect(pasEquivalents).toBeGreaterThan(0.5);
    expect(pasEquivalents).toBeLessThan(1.0);
  });

  it('…et le pas de calibre reste bien au-dessus du bruit de pointage du sprite', () => {
    // Le sprite est contrôlé par trois cotes indépendantes concordantes à 4 %
    // (§4). Sur les ~44 mm d'un verre, cela borne l'écart de cote à 1,8 mm par
    // verre au PIRE — le pas de 2 mm par verre reste au-dessus, donc lisible.
    const spec = specForTotalWidthMm(132);
    expect(spec.aMm * 0.04).toBeLessThan(CALIBRE_STEP_MM / 2);
  });
});
