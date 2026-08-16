/**
 * tests/fixtures/landmarks.ts — jeux de landmarks figés.
 *
 * MediaPipe renvoie 478 points normalisés (0..1). On ne fige que ceux dont la
 * chaîne de mesure se sert ; le reste est rempli d'un point neutre pour que les
 * index réels soient respectés.
 */

import type { NormalizedLandmark } from '../../src/core/geom.js';
import {
  EYE_L,
  EYE_L_INNER,
  EYE_R,
  EYE_R_INNER,
  FACE_L,
  FACE_R,
  SELLION,
} from '../../src/core/faceMetrics.js';

export const W = 1280;
export const H = 720;

const POINT_COUNT = 478;

/**
 * Largeur de visage, en pixels, telle qu'une carte de 300 px la mesurerait à
 * 138 mm : 138 / (85.60 / 300).
 */
export const BASE_FACE_PX = (138 * 300) / 85.6;

export interface FaceOptions {
  /** Largeur apparente du visage, en pixels image. */
  faceWidthPx: number;
  /** Inclinaison de la tête, en radians. 0 par défaut. */
  rollRad?: number;
}

/**
 * Construit un jeu de 478 landmarks cohérent : les deux bords du visage
 * écartés de `faceWidthPx`, les yeux et le sellion alignés entre eux.
 *
 * Les points sont posés en PIXELS puis normalisés, pour que la rotation de roll
 * reste une vraie rotation dans le repère où `frameMetrics` la mesure.
 */
export function makeFace(opts: FaceOptions): NormalizedLandmark[] {
  const roll = opts.rollRad ?? 0;
  const cos = Math.cos(roll);
  const sin = Math.sin(roll);

  const cxPx = W / 2;
  const cyPx = H / 2;
  const halfPx = opts.faceWidthPx / 2;

  /** (dx, dy) en pixels, dans le repère du visage → landmark normalisé. */
  const at = (dx: number, dy: number): NormalizedLandmark => ({
    x: (cxPx + dx * cos - dy * sin) / W,
    y: (cyPx + dx * sin + dy * cos) / H,
  });

  const lm: NormalizedLandmark[] = Array.from({ length: POINT_COUNT }, () => ({ x: 0.5, y: 0.5 }));

  lm[FACE_L] = at(-halfPx, 0);
  lm[FACE_R] = at(halfPx, 0);

  // Les yeux sont un peu au-dessus de la ligne des tempes.
  const eyeDy = -0.06 * opts.faceWidthPx;
  lm[EYE_L] = at(-halfPx * 0.62, eyeDy);
  lm[EYE_R] = at(halfPx * 0.62, eyeDy);
  lm[EYE_L_INNER] = at(-halfPx * 0.22, eyeDy);
  lm[EYE_R_INNER] = at(halfPx * 0.22, eyeDy);
  lm[SELLION] = at(0, eyeDy);

  return lm;
}

/**
 * Visage vu avec un yaw donné : sa largeur APPARENTE se raccourcit en cos(yaw).
 *
 * ⚠️ Indispensable pour tester S1. Réutiliser les mêmes landmarks à deux yaw
 * différents serait physiquement incohérent — et le test « la hauteur ne bouge
 * pas » deviendrait faux pour une raison qui n'est pas le bug cherché.
 */
export function makeFaceAtYaw(yawRad: number, baseFacePx = BASE_FACE_PX): NormalizedLandmark[] {
  return makeFace({ faceWidthPx: baseFacePx * Math.cos(yawRad) });
}

/** Le visage que la carte de 300 px mesure à 138 mm. */
export const LANDMARKS_CAL = makeFace({ faceWidthPx: BASE_FACE_PX });

/** Même personne, deux distances caméra. Le rapport monture/visage doit être identique. */
export const LANDMARKS_50CM = makeFace({ faceWidthPx: 500 });
export const LANDMARKS_100CM = makeFace({ faceWidthPx: 250 });

/** Visage de référence des tests de légende. */
export const LANDMARKS_138 = makeFace({ faceWidthPx: BASE_FACE_PX });

/** Tête franchement inclinée : au-delà de la tolérance de la règle 3 (15°). */
export const LANDMARKS_ROLLED = makeFace({
  faceWidthPx: BASE_FACE_PX,
  rollRad: (25 * Math.PI) / 180,
});
