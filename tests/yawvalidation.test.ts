/**
 * tests/yawvalidation.test.ts — 🔴 ré-audit 2026-08-23 : le yaw PAR LANDMARKS
 * est la voie NOMINALE (catalogue minimal-first, matrices OFF) — son exactitude
 * se valide, elle ne se suppose pas.
 *
 * Banc : une paire rigide symétrique (±X0 du plan médian, la géométrie de
 * 234/454) est tournée de θ ∈ {0°, 10°, 20°, 30°} puis PROJETÉE en perspective
 * exacte (u = f·X/Z — jamais la formule plane que l'estimateur utilise), avec
 * un z à la convention MediaPipe (échelle de x, plus petit = plus proche). On
 * borne l'écart |yawFromLandmarks| ↔ θ vrai, on vérifie la monotonie, la
 * cohérence de signe, l'invariance au roll, et la lecture matricielle.
 *
 * ⚠️ Ce que ce banc NE prouve PAS, et qui est couvert AILLEURS : le maillage
 * RÉEL de MediaPipe n'est pas une paire idéale (234/454 pas parfaitement
 * symétriques, z non métrique). L'accord absolu de signe et d'amplitude face
 * au vrai modèle est OBSERVÉ en continu sur appareil quand les deux voies
 * coexistent (`yawAgreement`, santé/HUD) — l'instrument existe précisément
 * pour ça. Ici on prouve que la FORMULE est exacte sous sa convention
 * déclarée, second ordre perspectif compris.
 */

import { describe, expect, it } from 'vitest';
import { yawFromLandmarks, yawFromMatrix } from '../src/tracking/yaw.js';
import { FACE_L, FACE_R } from '../src/core/faceMetrics.js';

/** Demi-écart de la paire (mm) et distance caméra (mm) — proportions réalistes. */
const X0 = 70;
const Z0 = 450;
const FOCAL = 900; // px — webcam 1280 typique
const W = 1280;

/**
 * Projette la paire ±X0 tournée de `yawRad` (axe vertical) : x normalisé par
 * perspective EXACTE, z à la convention MediaPipe (échelle de x, référence au
 * centre de la tête). `rollRad` tourne ensuite le plan image (invariance).
 */
function pairAt(yawRad: number, rollRad = 0): Array<{ x: number; y: number; z: number }> {
  const lm: Array<{ x: number; y: number; z: number }> = [];
  const place = (index: number, sx: -1 | 1): void => {
    const x3 = sx * X0 * Math.cos(yawRad);
    const z3 = Z0 - sx * X0 * Math.sin(yawRad); // sx=+1 se RAPPROCHE quand yaw>0
    const u = (FOCAL * x3) / z3 / W; // perspective exacte, normalisée largeur
    const zN = ((z3 - Z0) * FOCAL) / Z0 / W; // z MediaPipe : échelle de x, plus petit = plus proche
    lm[index] = {
      x: 0.5 + u * Math.cos(rollRad),
      y: 0.5 + u * Math.sin(rollRad),
      z: zN,
    };
  };
  place(FACE_L, -1);
  place(FACE_R, 1);
  return lm;
}

/** Matrice de rotation Ry(θ), colonne-major 4×4 — la convention de yawFromMatrix. */
function ry(yawRad: number): number[] {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  // colonnes : [c,0,-s,0] [0,1,0,0] [s,0,c,0] [0,0,0,1]
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

const DEG = Math.PI / 180;
/** Tolérance : bruit nul, il ne reste que le second ordre perspectif (< 1°). */
const TOL_RAD = 1.5 * DEG;

describe('yaw par landmarks — validé contre la vérité terrain à 0/10/20/30°', () => {
  it('🔴 amplitude EXACTE (± second ordre perspectif) aux quatre angles', () => {
    for (const deg of [0, 10, 20, 30]) {
      const estimated = yawFromLandmarks(pairAt(deg * DEG));
      expect(Math.abs(Math.abs(estimated) - deg * DEG), `à ${deg}°`).toBeLessThan(TOL_RAD);
    }
  });

  it('monotone et de signe COHÉRENT sur toute la plage (dont la limite de règle 3, 12°)', () => {
    const angles = [5, 10, 12, 15, 20, 25, 30, 35];
    const values = angles.map((d) => yawFromLandmarks(pairAt(d * DEG)));
    const sign = Math.sign(values[0]!);
    for (let i = 0; i < values.length; i++) {
      expect(Math.sign(values[i]!), `signe à ${angles[i]}°`).toBe(sign);
      if (i > 0) expect(Math.abs(values[i]!)).toBeGreaterThan(Math.abs(values[i - 1]!));
    }
    // Et le miroir : θ négatif → signe opposé, même amplitude.
    expect(yawFromLandmarks(pairAt(-20 * DEG))).toBeCloseTo(-yawFromLandmarks(pairAt(20 * DEG)), 6);
  });

  it('INVARIANT au roll : la tête penchée ne fabrique pas de yaw', () => {
    const droit = yawFromLandmarks(pairAt(20 * DEG, 0));
    const penche = yawFromLandmarks(pairAt(20 * DEG, 25 * DEG));
    expect(Math.abs(penche - droit)).toBeLessThan(0.2 * DEG);
    expect(Math.abs(yawFromLandmarks(pairAt(0, 25 * DEG)))).toBeLessThan(0.2 * DEG);
  });

  it('la lecture MATRICIELLE rend θ exactement (Ry colonne-major) — la référence des deux voies', () => {
    for (const deg of [0, 10, 20, 30]) {
      expect(yawFromMatrix(ry(deg * DEG))).toBeCloseTo(deg * DEG, 10);
    }
  });

  it('z absent ou dégénéré → 0 (frontal supposé), jamais NaN', () => {
    const noZ: Array<{ x: number; y: number }> = [];
    noZ[FACE_L] = { x: 0.4, y: 0.5 };
    noZ[FACE_R] = { x: 0.6, y: 0.5 };
    expect(yawFromLandmarks(noZ)).toBe(0);
    expect(yawFromLandmarks([])).toBe(0);
  });
});
