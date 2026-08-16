/**
 * render/temple.ts — la branche, depuis le sprite de profil (CLAUDE.md §6).
 *
 * La branche doit passer DERRIÈRE la tête. Une branche qui flotte par-dessus
 * la joue trahit immédiatement le trucage.
 */

import type { FrameSpec } from '../core/frameSpec.js';
import type { FrameMetrics } from '../core/faceMetrics.js';
import { spriteAffine } from '../core/transform.js';

export interface ProfileSprite {
  img: CanvasImageSource;
  spec: FrameSpec;
}

/**
 * Dessine la branche puis retire, par `destination-out`, la portion qui tombe
 * à l'intérieur du contour du visage.
 *
 * @param faceOutline contour de l'ovale facial en coordonnées écran. `null`
 *        désactive l'occlusion — la branche est alors dessinée telle quelle,
 *        ce qui reste préférable à ne rien dessiner du tout.
 */
export function drawTemple(
  ctx: CanvasRenderingContext2D,
  profile: ProfileSprite,
  m: FrameMetrics,
  alpha: number,
  faceOutline: Path2D | null,
): void {
  const t = spriteAffine(profile.spec, m);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  ctx.drawImage(profile.img, 0, 0);
  ctx.restore();

  if (faceOutline === null) return;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // le contour est déjà en coordonnées écran
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fill(faceOutline);
  ctx.restore();
}
