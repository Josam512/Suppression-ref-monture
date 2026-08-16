import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/**
 * Utilitaires géométriques partagés — CLAUDE.md §7.
 *
 * ⚠️ Signatures FIGÉES par le contrat. Toute modification, y compris un simple
 * ajout de paramètre optionnel, exige l'accord explicite de l'humain.
 *
 * Écrits une fois, importés partout : ne JAMAIS les réimplémenter localement.
 * Deux implémentations de `dist` qui divergent d'un epsilon, c'est un verdict
 * qui bascule sans que personne ne comprenne pourquoi.
 */

export interface Pt {
  x: number;
  y: number;
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

export const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Landmark MediaPipe normalisé (0..1) → pixels image. */
export const px = (l: NormalizedLandmark, w: number, h: number): Pt => ({
  x: l.x * w,
  y: l.y * h,
});

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Levée dès qu'une mesure ne peut pas être garantie.
 *
 * Règle du projet : on ne rend jamais un résultat d'allure confiante sur une
 * mesure dégradée. Mieux vaut refuser bruyamment que se tromper en silence.
 */
export class CalibrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalibrationError';
  }
}
