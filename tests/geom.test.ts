import { describe, it, expect } from 'vitest';
import { dist, midpoint, px, smoothstep, CalibrationError } from '../src/core/geom';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Landmark minimal : seuls x et y entrent dans la chaîne de mesure 2D. */
const lm = (x: number, y: number): NormalizedLandmark =>
  ({ x, y, z: 0, visibility: 1 }) as NormalizedLandmark;

describe('geom — utilitaires partagés (§7)', () => {
  describe('dist', () => {
    it('mesure une distance euclidienne', () => {
      expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });

    it('est symétrique', () => {
      const a = { x: -2.5, y: 7 };
      const b = { x: 11, y: -3.25 };
      expect(dist(a, b)).toBe(dist(b, a));
    });

    it('est nulle sur un point confondu', () => {
      expect(dist({ x: 4, y: 4 }, { x: 4, y: 4 })).toBe(0);
    });

    it("est invariante par rotation — le roll de la tête ne doit pas changer une largeur", () => {
      const a = { x: 0, y: 0 };
      const b = { x: 10, y: 0 };
      const theta = 0.37;
      const rot = (p: { x: number; y: number }) => ({
        x: p.x * Math.cos(theta) - p.y * Math.sin(theta),
        y: p.x * Math.sin(theta) + p.y * Math.cos(theta),
      });
      expect(dist(rot(a), rot(b))).toBeCloseTo(dist(a, b), 12);
    });
  });

  describe('midpoint', () => {
    it('tombe au milieu', () => {
      expect(midpoint({ x: 0, y: 0 }, { x: 10, y: 4 })).toEqual({ x: 5, y: 2 });
    });

    it('est à égale distance des deux extrémités', () => {
      const a = { x: -7, y: 2 };
      const b = { x: 5, y: -9 };
      const m = midpoint(a, b);
      expect(dist(a, m)).toBeCloseTo(dist(b, m), 12);
    });
  });

  describe('px', () => {
    it('dénormalise un landmark vers les pixels image', () => {
      expect(px(lm(0.5, 0.25), 1280, 720)).toEqual({ x: 640, y: 180 });
    });

    it("l'origine normalisée reste l'origine pixel", () => {
      expect(px(lm(0, 0), 1280, 720)).toEqual({ x: 0, y: 0 });
    });
  });

  describe('smoothstep', () => {
    it('est bornée en dessous du seuil bas', () => {
      expect(smoothstep(0.1, 0.45, -1)).toBe(0);
    });

    it('est bornée au-dessus du seuil haut', () => {
      expect(smoothstep(0.1, 0.45, 99)).toBe(1);
    });

    it('vaut un demi au milieu', () => {
      expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
    });

    it('est monotone croissante — la branche ne doit jamais clignoter', () => {
      let prev = -1;
      for (let i = 0; i <= 20; i++) {
        const v = smoothstep(0.1, 0.45, i / 20);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    });
  });

  describe('CalibrationError', () => {
    it('est une Error nommée, reconnaissable en aval', () => {
      const e = new CalibrationError('mesure impossible');
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe('CalibrationError');
      expect(e.message).toBe('mesure impossible');
    });
  });
});
