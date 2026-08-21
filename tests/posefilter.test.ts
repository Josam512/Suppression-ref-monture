/**
 * tests/posefilter.test.ts — le filtre de pose One-Euro (guide 47–49, c32/c35).
 *
 * Rendu SEULEMENT : ces tests vérifient aussi les deux propriétés qui rendent
 * le filtre inoffensif pour la mesure — il tient l'échelle quand la frame n'en
 * apporte pas (au lieu de laisser la monture disparaître ou respirer), et il
 * repart À NEUF après une vraie perte (au lieu de glisser depuis l'ancienne
 * position).
 */

import { describe, expect, it } from 'vitest';

import { PoseFilter, RESET_AFTER_MS } from '../src/ui/poseFilter.js';

const pose = (x: number, scale: number | null = 3.2) => ({
  x,
  y: 100,
  rollRad: 0,
  yawRad: 0,
  scalePxPerMm: scale,
});

describe('PoseFilter — One-Euro, rendu seulement', () => {
  it('sans AUCUNE échelle jamais vue, rien à dessiner : null', () => {
    const f = new PoseFilter();
    expect(f.apply(pose(10, null), 0)).toBeNull();
  });

  it('une entrée constante ressort identique (pas de dérive au repos)', () => {
    const f = new PoseFilter();
    let out = f.apply(pose(50), 0)!;
    for (let t = 16; t <= 2000; t += 16) out = f.apply(pose(50), t)!;
    expect(out.x).toBeCloseTo(50, 6);
    expect(out.scalePxPerMm).toBeCloseTo(3.2, 6);
  });

  it('le tremblement est atténué : la variance de sortie est bien plus faible', () => {
    const f = new PoseFilter();
    const outs: number[] = [];
    for (let i = 0; i < 200; i++) {
      const jitter = ((i % 2) * 2 - 1) * 2; // ±2 px de tremblement alterné
      const o = f.apply(pose(50 + jitter), i * 33)!;
      if (i > 20) outs.push(o.x);
    }
    const mean = outs.reduce((a, b) => a + b, 0) / outs.length;
    const spread = Math.max(...outs) - Math.min(...outs);
    expect(mean).toBeCloseTo(50, 0);
    expect(spread).toBeLessThan(1); // ±2 px d'entrée → < 1 px de sortie
  });

  it('un mouvement FRANC est suivi avec une latence faible (point 48 : pas de flottement)', () => {
    const f = new PoseFilter();
    f.apply(pose(0), 0);
    let out = 0;
    // 300 px en 500 ms — un vrai geste de tête.
    for (let t = 16; t <= 500; t += 16) out = f.apply(pose((300 * t) / 500), t)!.x;
    expect(out).toBeGreaterThan(270); // < 10 % de retard sur la cible
  });

  it('c35/point 30 — sans échelle fraîche, le filtre TIENT la dernière valeur sûre', () => {
    const f = new PoseFilter();
    for (let t = 0; t <= 320; t += 16) f.apply(pose(10, 4.0), t);
    const held = f.apply(pose(10, null), 336)!;
    expect(held.scalePxPerMm).toBeCloseTo(4.0, 6);
    expect(f.heldScale()).toBeCloseTo(4.0, 6);
  });

  it('point 48 — après une perte longue, PAS de glissement : reprise nette', () => {
    const f = new PoseFilter();
    for (let t = 0; t <= 320; t += 16) f.apply(pose(10), t);
    // Perte de plus de RESET_AFTER_MS, puis le visage réapparaît AILLEURS.
    const t2 = 320 + RESET_AFTER_MS + 100;
    const out = f.apply(pose(500), t2)!;
    expect(out.x).toBe(500); // première sortie = nouvelle entrée, sans transition
  });

  it('noteLossAt arme le reset : la dernière échelle ne survit pas à une longue perte', () => {
    const f = new PoseFilter();
    for (let t = 0; t <= 320; t += 16) f.apply(pose(10, 4.0), t);
    f.noteLossAt(320 + RESET_AFTER_MS + 100);
    expect(f.heldScale()).toBeNull();
    expect(f.apply(pose(500, null), 320 + RESET_AFTER_MS + 200)).toBeNull(); // pas d'échelle → rien d'honnête
  });

  it('une micro-perte (< RESET_AFTER_MS) ne réinitialise rien', () => {
    const f = new PoseFilter();
    for (let t = 0; t <= 320; t += 16) f.apply(pose(10, 4.0), t);
    f.noteLossAt(320 + RESET_AFTER_MS / 2);
    expect(f.heldScale()).toBeCloseTo(4.0, 6);
  });
});
