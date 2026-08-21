/**
 * tests/autogates.test.ts — les TROIS défauts structurels de l'audit humain du
 * 2026-08-21, chacun verrouillé par un test qui rougirait si on les
 * réintroduisait.
 *
 *   1. le chrono de convergence partait AVANT la première frame utile ;
 *   2. le délai verrouillait `offer()` pour le reste de la session ;
 *   3. les compteurs de rejet n'attribuaient qu'UNE cause par frame.
 *
 * ⚠️ Aucun de ces tests ne dépend d'une fixture particulière : chacun balaie
 * ce qu'il verrouille (leçon B2/S4 du §11.4).
 */

import { describe, expect, it } from 'vitest';

import {
  AutoCalibrationEngine,
  AUTO_TIMEOUT_MS,
  IRIS_DISCREPANCY_MAX,
  MAX_AUTO_ROLL_RAD,
  MAX_AUTO_YAW_RAD,
  MIN_AUTO_FRAMES,
} from '../src/core/autoCalibration.js';
import {
  IRIS_ABSOLUTE_FLOOR_PX,
  IRIS_DISCREPANCY_MARGIN,
  irisDiscrepancyMax,
  irisQualityOf,
} from '../src/core/irisQuality.js';
import { renderPoseScale } from '../src/core/renderPose.js';
import { faceWidthPx } from '../src/core/faceMetrics.js';
import { HVID_MEAN_MM } from '../src/core/ocularScale.js';
import { AUTO_ASSUMED_HFOV_DEG, EYEPLANE_TO_TEMPLE_DEPTH_MM } from '../src/core/autoCalibrate.js';
import { H, W, makeFace } from './fixtures/landmarks.js';

/** Une frame valide, cohérente avec la caméra supposée (mêmes maths qu'autocal). */
function validFace(distanceMm = 500) {
  const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
  const mmPerPxEye = distanceMm / focalPx;
  return makeFace({
    faceWidthPx: (138 * focalPx) / (distanceMm + EYEPLANE_TO_TEMPLE_DEPTH_MM),
    pdPx: 62 / mmPerPxEye,
    hvidPx: HVID_MEAN_MM / mmPerPxEye,
  });
}

function film(e: AutoCalibrationEngine, n: number, t0: number, yaw = 0, roll = 0): number {
  const lm = validFace();
  for (let i = 0; i < n; i++) e.offer(lm, yaw, roll, W, H, t0 + i * 33);
  return t0 + n * 33;
}

describe('audit 1 — le chrono de convergence ne part QU’À la première frame utile', () => {
  it('🔴 une longue absence AVANT la première frame utile ne consomme pas le délai', () => {
    const e = new AutoCalibrationEngine();
    // Une minute entière sans visage : trois fois le délai de convergence.
    for (let i = 0; i * 500 <= 60_000; i++) e.offer(null, 0, 0, W, H, i * 500);
    expect(e.status().elapsedMs).toBe(0); // aucune horloge de convergence armée

    // La personne se place enfin : la mesure doit être NOMINALE, pas dégradée.
    film(e, 80, 61_000);
    expect(e.state).toBe('calibrated');
    expect(e.measures()!.degraded).toBe(false);
  });

  it('les deux horloges sont distinctes : acquisition ≠ convergence', () => {
    const e = new AutoCalibrationEngine();
    const lm = validFace();
    // 5 s de visage vu mais toujours trop tourné → acquisition court, pas la convergence.
    for (let i = 0; i < 150; i++) e.offer(lm, MAX_AUTO_YAW_RAD * 2, 0, W, H, i * 33);
    const s = e.status();
    expect(s.acquisitionMs).toBeGreaterThan(4000);
    expect(s.elapsedMs).toBe(0);
  });
});

describe('audit 2 — aucun état ne condamne la séance', () => {
  it('🔴 après le délai avec trop peu de matière, `offer()` compte TOUJOURS', () => {
    const e = new AutoCalibrationEngine();
    // Quelques frames utiles (moins que le plancher dégradé), puis un long vide.
    film(e, 5, 0);
    const before = e.status().usableFrames;
    for (let i = 0; i * 500 <= AUTO_TIMEOUT_MS + 2000; i++) e.offer(null, 0, 0, W, H, 1000 + i * 500);

    expect(e.state).toBe('collecting');
    expect(e.status().attempts).toBeGreaterThanOrEqual(1);
    expect(e.status().lastAttemptFailure).not.toBeNull();

    // La preuve : les frames suivantes sont bien comptées, et on conclut.
    film(e, 80, AUTO_TIMEOUT_MS + 5000);
    expect(e.status().usableFrames).toBeGreaterThan(before);
    expect(e.state).toBe('calibrated');
  });

  it('les échantillons déjà acquis ne sont PAS jetés à la tentative suivante', () => {
    const e = new AutoCalibrationEngine();
    film(e, 5, 0);
    for (let i = 0; i * 500 <= AUTO_TIMEOUT_MS + 1000; i++) e.offer(null, 0, 0, W, H, 1000 + i * 500);
    expect(e.status().usableFrames).toBe(5);
  });

  it('une seule tentative est comptée par période de délai — pas de boucle folle', () => {
    const e = new AutoCalibrationEngine();
    film(e, 3, 0);
    // Trois délais successifs, sondés très finement (100 ms) : au plus 3 tentatives.
    for (let t = 1000; t <= 3 * AUTO_TIMEOUT_MS; t += 100) e.offer(null, 0, 0, W, H, t);
    expect(e.status().attempts).toBeLessThanOrEqual(3);
    expect(e.status().attempts).toBeGreaterThanOrEqual(2);
  });
});

describe('audit 3 — les gates sont comptés INDÉPENDAMMENT', () => {
  it('🔴 une frame à la fois tournée ET inclinée incrémente les DEUX compteurs', () => {
    const e = new AutoCalibrationEngine();
    e.offer(validFace(), MAX_AUTO_YAW_RAD * 2, MAX_AUTO_ROLL_RAD * 2, W, H, 0);
    const r = e.status().rejected;
    expect(r['turn-to-front']).toBe(1);
    expect(r['straighten-head']).toBe(1);
  });

  it('la consigne AFFICHÉE reste unique, même quand deux gates sont violés', () => {
    const e = new AutoCalibrationEngine();
    e.offer(validFace(), MAX_AUTO_YAW_RAD * 2, MAX_AUTO_ROLL_RAD * 2, W, H, 0);
    expect(e.status().primaryRejectReason).toBe('turn-to-front');
  });

  it('une frame acceptée ne rejette rien du tout', () => {
    const e = new AutoCalibrationEngine();
    e.offer(validFace(), 0, 0, W, H, 0);
    const r = e.status().rejected;
    expect(r['no-face'] + r['eyes-too-small'] + r['turn-to-front'] + r['straighten-head']).toBe(0);
    expect(e.status().primaryRejectReason).toBeNull();
  });
});

describe('audit 3 bis — le gate iris juge la QUALITÉ, plus la taille', () => {
  it('🔴 un iris de 6,8 px PARFAITEMENT stable est accepté', () => {
    // Le cas explicite de l'arbitrage : sous l'ancien plancher de 8 px, mais
    // sans aucune aberration. C'est l'erreur-type sur n frames qui tranchera.
    expect(irisQualityOf(6.8, 6.8, IRIS_DISCREPANCY_MAX).ok).toBe(true);
  });

  it('un iris aberrant (un œil masqué) est refusé, même GROS', () => {
    const q = irisQualityOf(20, 12, IRIS_DISCREPANCY_MAX);
    expect(q.ok).toBe(false);
    expect(q.reason).toBe('iris-aberrant');
  });

  it('sous le plancher de quantification, la largeur n’a plus de signe', () => {
    const q = irisQualityOf(IRIS_ABSOLUTE_FLOOR_PX - 0.5, IRIS_ABSOLUTE_FLOOR_PX - 0.5, IRIS_DISCREPANCY_MAX);
    expect(q.ok).toBe(false);
    expect(q.reason).toBe('quantification');
  });

  it('🔴 le seuil d’aberration reste DÉRIVÉ du gate frontal, jamais réglé à la main', () => {
    expect(IRIS_DISCREPANCY_MAX).toBeCloseTo(irisDiscrepancyMax(MAX_AUTO_YAW_RAD), 12);
    // …et il domine d’un ordre de grandeur l’asymétrie géométrique admissible.
    expect(IRIS_DISCREPANCY_MAX / (1 - Math.cos(MAX_AUTO_YAW_RAD))).toBeCloseTo(IRIS_DISCREPANCY_MARGIN, 9);
  });

  it('un iris sous l’ancien plancher de 8 px permet toujours de calibrer', () => {
    // Preuve de bout en bout : la personne est loin, les iris sont petits, la
    // mesure aboutit quand même — ce que l'ancien `MIN_IRIS_PX = 8` interdisait.
    const e = new AutoCalibrationEngine();
    const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
    const distanceMm = 1400; // ~1,4 m : hvid ≈ 6,7 px
    const mmPerPxEye = distanceMm / focalPx;
    const hvidPx = HVID_MEAN_MM / mmPerPxEye;
    expect(hvidPx).toBeLessThan(8);
    expect(hvidPx).toBeGreaterThan(IRIS_ABSOLUTE_FLOOR_PX);
    const lm = makeFace({
      faceWidthPx: (138 * focalPx) / (distanceMm + EYEPLANE_TO_TEMPLE_DEPTH_MM),
      pdPx: 62 / mmPerPxEye,
      hvidPx,
    });
    for (let i = 0; i < 80; i++) e.offer(lm, 0, 0, W, H, i * 33);
    expect(e.state).toBe('calibrated');
    expect(e.measures()!.usableFrames).toBeGreaterThanOrEqual(MIN_AUTO_FRAMES);
  });
});

describe('audit 4 — le produit ne reste plus vide : TRACKING ≠ MÉTROLOGIE', () => {
  it('🔴 une seule frame suffit à POSER l’image, et son échelle est vraie', () => {
    // La vérité terrain de la scène est 138 mm. L'échelle de pose vient du
    // MÊME étalon iris que la calibration définitive : la largeur qu'elle
    // IMPLIQUE doit retrouver la vérité terrain — sinon c'est une taille
    // inventée, ce qui est interdit. (Elle ne PUBLIE aucune largeur : aucune
    // grandeur anatomique ne vit dans le chemin de rendu — guide, point 3.)
    const lm = validFace(500);
    const p = renderPoseScale(lm, W, H, IRIS_DISCREPANCY_MAX, null, 0);
    expect(p).not.toBeNull();
    const implied = faceWidthPx(lm, W, H) / p!.templePlanePxPerMm;
    expect(implied).toBeGreaterThan(120);
    expect(implied).toBeLessThan(155);
  });

  it('iris inexploitables → PAS de nouvelle échelle (le rendu TIENT la dernière, point 30)', () => {
    const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
    const aberrant = makeFace({ faceWidthPx: 400, pdPx: 120, hvidPx: 1 }); // sous le plancher
    expect(renderPoseScale(aberrant, W, H, IRIS_DISCREPANCY_MAX, null, 0)).toBeNull();
    expect(focalPx).toBeGreaterThan(0);
  });

  it('🔴 l’aperçu ne saute plus avec la distance (audit du 2026-08-21, point 2)', () => {
    // ⚠️ RÈGLE CHANGÉE. Ce test verrouillait l'inverse : il ACTAIT un biais de
    // parallaxe de ~4 % entre 40 et 70 cm, parce que l'aperçu convertissait une
    // largeur du plan des TEMPES avec un mm/px du plan des YEUX. L'audit a
    // demandé de traiter ce saut comme un bug — il l'était : la monture était
    // peinte 6 à 10 % trop large, puis rétrécissait à la calibration. L'aperçu
    // emprunte désormais la MÊME formule de plan, donc le biais a disparu.
    // Le détail chiffré, avant/après, vit dans `tests/plane.test.ts`.
    const lmNear = validFace(400);
    const lmFar = validFace(700);
    const near = faceWidthPx(lmNear, W, H) / renderPoseScale(lmNear, W, H, IRIS_DISCREPANCY_MAX, null, 0)!.templePlanePxPerMm;
    const far = faceWidthPx(lmFar, W, H) / renderPoseScale(lmFar, W, H, IRIS_DISCREPANCY_MAX, null, 0)!.templePlanePxPerMm;
    expect(Math.abs(far - near) / far).toBeLessThan(0.005);
    // …et les deux retrouvent la vérité terrain, au lieu de la sous-estimer.
    expect(near).toBeCloseTo(138, 0);
    expect(far).toBeCloseTo(138, 0);
  });
});
