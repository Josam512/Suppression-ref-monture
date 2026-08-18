/**
 * ui/freezeFrame.ts — geler une image AVEC ses repères, jamais l'un sans l'autre.
 *
 * 🔴 La raison d'être de ce fichier tient en une phrase : **la carte et le
 * visage doivent être mesurés sur les mêmes pixels**, puisque c'est leur RAPPORT
 * qui est la mesure. Geler l'image ici et relire les repères là-bas, au moment
 * où le client valide ses bords, prendrait la tête telle qu'elle est quelques
 * secondes plus tard — et l'erreur serait parfaitement invisible : deux
 * grandeurs plausibles, un rapport faux.
 *
 * Les lier dans un seul objet rend le décalage impossible à réintroduire par
 * distraction. C'est la même discipline que l'affine unique du §6.1 : une
 * grandeur, une source.
 *
 * ⚠️ Seule exception au « live et jamais différé » (§0.0.2), et elle est
 * nécessaire — pas cosmétique.
 */

import type { NormalizedLandmark } from '../core/geom.js';

export interface FrozenFrame {
  frozen: HTMLCanvasElement;
  /** Repères relevés sur CETTE image, à cet instant. */
  lm: readonly NormalizedLandmark[];
}

/**
 * Fige la vidéo courante et lui attache les repères passés en argument.
 *
 * @returns `null` si la vidéo n'a rien à donner, ou si aucun visage n'est
 *          détecté — auquel cas il n'y a pas de mesure possible, et prétendre
 *          le contraire serait pire que de le dire.
 */
export function freezeFrame(
  video: HTMLVideoElement | null,
  lm: readonly NormalizedLandmark[] | null,
): FrozenFrame | null {
  if (video === null || video.videoWidth === 0 || lm === null) return null;

  const frozen = document.createElement('canvas');
  frozen.width = video.videoWidth;
  frozen.height = video.videoHeight;
  const ctx = frozen.getContext('2d');
  if (ctx === null) return null;
  ctx.drawImage(video, 0, 0);

  return { frozen, lm };
}
