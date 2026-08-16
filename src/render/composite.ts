/**
 * render/composite.ts — compositing de sprites 2D sur canvas (CLAUDE.md §6.2).
 *
 * ⚠️ Aucune géométrie n'est calculée ici. Toute la transformée vient de
 * `core/transform.ts` (T3). Recomposer une matrice à coups de
 * translate/rotate/scale est barré par le hook (§9.0.g).
 */

import type { FrameSpec } from '../core/frameSpec.js';
import type { FrameMetrics } from '../core/faceMetrics.js';
import { spriteAffine } from '../core/transform.js';
import { smoothstep } from '../core/geom.js';
import { drawTemple, type ProfileSprite } from './temple.js';

export interface FrontSprite {
  img: CanvasImageSource;
  spec: FrameSpec;
}

export interface Sprites {
  front: FrontSprite;
  profile: ProfileSprite;
}

/** Seuils de révélation de la branche, en radians de |yaw|. */
const TEMPLE_FADE_IN = 0.1;
const TEMPLE_FADE_FULL = 0.45;

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  m: FrameMetrics,
  faceOutline: Path2D | null,
): void {
  // ⚠️ yawRad se lit sur `m` (T2). Ne PAS le repasser en paramètre : deux
  // sources pour la même grandeur finissent toujours par diverger.
  const t = spriteAffine(sprites.front.spec, m);

  ctx.save();
  ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  ctx.drawImage(sprites.front.img, 0, 0); // toute la géométrie est dans l'affine
  ctx.restore();

  const templeAlpha = smoothstep(TEMPLE_FADE_IN, TEMPLE_FADE_FULL, Math.abs(m.yawRad));
  if (templeAlpha > 0.01) {
    drawTemple(ctx, sprites.profile, m, templeAlpha, faceOutline);
  }
}
