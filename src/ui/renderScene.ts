/**
 * ui/renderScene.ts — ce qui est peint sur le canvas, à chaque image.
 *
 * Deux rendus possibles, et le choix ne se fait PAS sur un mode (§11.4) : il se
 * fait sur la présence d'une donnée. Si l'on sait quelle monture la personne
 * porte réellement — donc uniquement en magasin, mais le code ne le sait pas —
 * on repeint cette monture au coloris voulu. Sinon, on pose le sprite.
 *
 * ⚠️ Ordre de repli explicite : si le recoloriage ne retrouve pas la monture
 * dans l'image, on retombe sur le sprite posé. On ne laisse jamais l'écran vide
 * (§0.0.2), et la raison du repli remonte à l'IHM au lieu de disparaître.
 */

import { frameMetrics } from '../core/faceMetrics.js';
import type { NormalizedLandmark } from '../core/geom.js';
import { verdict } from '../core/verdict.js';
import { drawFrame } from '../render/composite.js';
import { drawRecolored } from '../render/recolorLive.js';
import { faceOutlinePath } from '../tracking/landmarker.js';
import type { Live } from './liveState.js';

export function paintScene(
  ctx: CanvasRenderingContext2D,
  live: Live,
  lm: readonly NormalizedLandmark[],
  yawRad: number,
  video: CanvasImageSource | null,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (live.cal === null || live.sprites.status !== 'ready') {
    live.verdict = null;
    return;
  }

  const m = frameMetrics(lm, w, h, live.cal, yawRad);
  const target = { img: live.sprites.sprites.front.img, spec: live.sprites.spec };

  // ⭐ V2 « 2,5 D » : la géométrie, la lumière et la perspective viennent du
  // réel ; seule la matière est substituée.
  const worn = live.wornSprite;
  let recolored = false;
  if (worn !== null && video !== null && worn.spec.slug !== target.spec.slug) {
    const report = drawRecolored(ctx, video, worn, target, m);
    live.recolorReason = report.reason;
    recolored = report.reason === null && report.painted > 0;
  } else {
    live.recolorReason = null;
  }

  if (!recolored) {
    drawFrame(ctx, live.sprites.sprites, m, faceOutlinePath(lm, w, h), {
      overlayPaddingMm: live.overlayPaddingMm,
    });
  }

  live.verdict = verdict(lm, live.cal, live.sprites.spec, w, h, yawRad);
}
