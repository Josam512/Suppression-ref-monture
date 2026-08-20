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
import { provisionalScale } from '../src/core/provisionalScale.js';
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
  it('🔴 une seule frame suffit à POSER l’image, et c’est une vraie mesure', () => {
    // La vérité terrain de la scène est 138 mm. L'échelle provisoire vient du
    // MÊME étalon iris que la calibration définitive : elle doit retrouver la
    // largeur, en gros — sinon c'est une taille inventée, ce qui est interdit.
    const p = provisionalScale(validFace(500), W, H, IRIS_DISCREPANCY_MAX, 0);
    expect(p).not.toBeNull();
    expect(p!.cal.faceWidthMm).toBeGreaterThan(120);
    expect(p!.cal.faceWidthMm).toBeLessThan(155);
    expect(p!.cal.relError).toBeGreaterThan(0); // une mesure SANS incertitude serait fausse
  });

  it('elle refuse quand les iris ne sont pas exploitables — pas de taille inventée', () => {
    const focalPx = W / (2 * Math.tan(((AUTO_ASSUMED_HFOV_DEG / 2) * Math.PI) / 180));
    const aberrant = makeFace({ faceWidthPx: 400, pdPx: 120, hvidPx: 1 }); // sous le plancher
    expect(provisionalScale(aberrant, W, H, IRIS_DISCREPANCY_MAX, 0)).toBeNull();
    expect(focalPx).toBeGreaterThan(0);
  });

  it('🔴 l’aperçu porte un biais de PARALLAXE connu — et c’est pour ça qu’aucun mm n’est affiché', () => {
    // Constat mesuré en écrivant ce test, et NON corrigé : l'échelle provisoire
    // convertit une largeur prise au plan des TEMPES avec un mm/px valable au
    // plan des YEUX. Il manque donc le terme de parallaxe que `calibrateAuto`
    // applique, lui, sur la mesure définitive — d'où un aperçu quelques pour
    // cent trop étroit, ET dépendant de la distance.
    const near = provisionalScale(validFace(400), W, H, IRIS_DISCREPANCY_MAX, 0)!;
    const far = provisionalScale(validFace(700), W, H, IRIS_DISCREPANCY_MAX, 0)!;
    const drift = Math.abs(far.cal.faceWidthMm - near.cal.faceWidthMm) / far.cal.faceWidthMm;
    expect(drift).toBeGreaterThan(0.01); // le biais EXISTE : ne pas prétendre le contraire
    expect(drift).toBeLessThan(0.10); //  …et il reste borné : l'aperçu tient debout
    // La conséquence, verrouillée ici : un aperçu ne publie JAMAIS de millimètre.
    // C'est `renderScene.ts` qui l'applique — `verdict` reste null sans `cal`.
    expect(near.cal.faceWidthMm).toBeLessThan(138); // systématiquement sous la vérité
    expect(far.cal.faceWidthMm).toBeLessThan(138);
  });
});
