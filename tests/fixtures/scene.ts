/**
 * tests/fixtures/scene.ts — images de synthèse pour la mesure de silhouette.
 *
 * `core/silhouette.ts` cherche la frontière tête/fond dans des PIXELS. On ne
 * peut donc pas le tester avec des landmarks : il lui faut des images. Celles-ci
 * sont volontairement grossières — un bloc sur un fond — car ce qu'on teste
 * n'est pas la beauté du rendu, mais quatre comportements précis :
 *
 *   1. le bord est trouvé à quelques pixels près sur un fond propre ;
 *   2. un fond chargé est REFUSÉ, jamais deviné ;
 *   3. une chevelure large est REFUSÉE, jamais prise pour une tempe ;
 *   4. un bord qui n'a pas bougé pendant la rotation est REFUSÉ.
 */

import type { ImageBuffer } from '../../src/core/silhouette.js';

export interface SceneOptions {
  w: number;
  h: number;
  /** Bord gauche et bord droit de la tête, en pixels. */
  headLeftPx: number;
  headRightPx: number;
  bgLuma?: number;
  headLuma?: number;
  /** Amplitude du bruit ajouté au fond. Au-delà de ~16, le fond est « chargé ». */
  bgNoise?: number;
  /** Décalage horizontal de la tête — sert à fabriquer du mouvement. */
  shiftPx?: number;
}

/** Générateur pseudo-aléatoire déterministe : un test doit être reproductible. */
function noiseAt(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s) - 0.5;
}

export function makeScene(opts: SceneOptions): ImageBuffer {
  const bg = opts.bgLuma ?? 205;
  const head = opts.headLuma ?? 85;
  const noise = opts.bgNoise ?? 2;
  const shift = opts.shiftPx ?? 0;

  const data = new Uint8ClampedArray(opts.w * opts.h * 4);
  for (let y = 0; y < opts.h; y++) {
    for (let x = 0; x < opts.w; x++) {
      const inHead = x >= opts.headLeftPx + shift && x <= opts.headRightPx + shift;
      const v = inHead ? head : bg + noise * 2 * noiseAt(x, y);
      const i = (y * opts.w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: opts.w, height: opts.h };
}
