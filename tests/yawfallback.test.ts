/**
 * tests/yawfallback.test.ts — le yaw SANS matrice (stratégies « sans-matrice »
 * de la négociation, arbitrage humain 2026-08-22).
 *
 * La loi verrouillée : sur une paire symétrique (±X0 du plan médian), la
 * largeur X0 S'ANNULE — θ = atan2(Δz, écart projeté). Aucun terme de
 * morphologie ne survit (ce n'est PAS l'estimateur 2D banni au §4, qui
 * dépendait du rapport profondeur du nez / largeur du visage), et le SIGNE
 * suit la même convention que `yawFromMatrix`.
 */

import { describe, expect, it } from 'vitest';
import { yawFromLandmarks, yawFromMatrix } from '../src/tracking/yaw.js';
import { FACE_L, FACE_R } from '../src/core/faceMetrics.js';

/** Paire symétrique 234/454 sous un yaw θ (convention z MediaPipe : ~échelle de x). */
function pairAtYaw(thetaRad: number, halfWidth = 0.18, rollRad = 0): Array<{ x: number; y: number; z?: number }> {
  const lm: Array<{ x: number; y: number; z?: number }> = [];
  const dx = halfWidth * Math.cos(thetaRad);
  const dz = halfWidth * Math.sin(thetaRad);
  const cr = Math.cos(rollRad);
  const sr = Math.sin(rollRad);
  lm[FACE_L] = { x: 0.5 - dx * cr, y: 0.5 - dx * sr, z: -dz };
  lm[FACE_R] = { x: 0.5 + dx * cr, y: 0.5 + dx * sr, z: +dz };
  return lm;
}

describe('yaw sans matrice — rotation seule, paire symétrique', () => {
  it('retrouve θ sur tout le domaine utile (±40°)', () => {
    for (const deg of [-40, -25, -12, -5, 0, 5, 12, 25, 40]) {
      const theta = (deg * Math.PI) / 180;
      expect(yawFromLandmarks(pairAtYaw(theta)), `θ=${deg}°`).toBeCloseTo(theta, 6);
    }
  });

  it('🔴 la LARGEUR du visage s’annule : deux morphologies, même θ → même yaw', () => {
    const theta = (18 * Math.PI) / 180;
    const etroit = yawFromLandmarks(pairAtYaw(theta, 0.1));
    const large = yawFromLandmarks(pairAtYaw(theta, 0.27));
    expect(etroit).toBeCloseTo(large, 8);
    expect(etroit).toBeCloseTo(theta, 6);
  });

  it('invariant au ROLL : la tête penchée ne fabrique pas de yaw', () => {
    const theta = (15 * Math.PI) / 180;
    for (const rollDeg of [-20, -10, 10, 20]) {
      const yaw = yawFromLandmarks(pairAtYaw(theta, 0.18, (rollDeg * Math.PI) / 180));
      expect(yaw, `roll=${rollDeg}°`).toBeCloseTo(theta, 6);
    }
    expect(yawFromLandmarks(pairAtYaw(0, 0.18, (25 * Math.PI) / 180))).toBeCloseTo(0, 8);
  });

  it('même CONVENTION DE SIGNE que yawFromMatrix (R_y(θ) colonne-major)', () => {
    for (const deg of [-30, -10, 10, 30]) {
      const theta = (deg * Math.PI) / 180;
      const m = new Array<number>(16).fill(0);
      m[0] = Math.cos(theta);
      m[2] = -Math.sin(theta);
      m[5] = 1;
      m[8] = Math.sin(theta);
      m[10] = Math.cos(theta);
      m[15] = 1;
      expect(yawFromMatrix(m), `matrice θ=${deg}°`).toBeCloseTo(theta, 6);
      expect(Math.sign(yawFromLandmarks(pairAtYaw(theta)))).toBe(Math.sign(yawFromMatrix(m)));
    }
  });

  it('entrée dégénérée → 0 (frontal supposé), jamais NaN ni exception', () => {
    expect(yawFromLandmarks([])).toBe(0);
    const sansZ = pairAtYaw(0.3);
    delete sansZ[FACE_L]!.z;
    expect(yawFromLandmarks(sansZ)).toBe(0);
    const zNaN = pairAtYaw(0.3);
    zNaN[FACE_R]!.z = Number.NaN;
    expect(yawFromLandmarks(zNaN)).toBe(0);
    const confondus = pairAtYaw(0.3, 0);
    expect(yawFromLandmarks(confondus)).toBe(0); // écart projeté nul : rien à lire
  });
});
