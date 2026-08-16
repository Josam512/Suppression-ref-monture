/**
 * render/temple.ts — la branche, depuis le sprite de profil (CLAUDE.md §6).
 *
 * La branche doit passer DERRIÈRE la tête. Une branche qui flotte par-dessus
 * la joue trahit immédiatement le trucage.
 */

import type { FrameSpec } from '../core/frameSpec.js';
import type { FrameMetrics } from '../core/faceMetrics.js';
import { templeAffine } from '../core/transform.js';

export interface ProfileSprite {
  img: CanvasImageSource;
  spec: FrameSpec;
}

/**
 * Calque hors écran réutilisé d'une frame à l'autre.
 *
 * ⚠️ Il n'est pas là pour la performance, mais pour la CORRECTION.
 * `destination-out` efface tout ce qui est déjà peint à l'endroit visé — pas
 * seulement la branche. Appliqué directement sur le canvas principal, il
 * découpait un trou dans tout ce qui se trouvait dessous.
 *
 * Dans l'application le canvas est transparent au-dessus d'un `<video>`, donc
 * le trou ne se voyait pas ; sur un outil qui dessine une photo dans le même
 * canvas, il perçait le visage en noir. L'occlusion doit donc rester confinée
 * à son propre calque : c'est vrai partout, pas seulement là où ça se voit.
 */
let layer: HTMLCanvasElement | null = null;

function layerFor(w: number, h: number): HTMLCanvasElement {
  if (layer === null) layer = document.createElement('canvas');
  if (layer.width !== w || layer.height !== h) {
    layer.width = w;
    layer.height = h;
  }
  return layer;
}

/**
 * Dessine la branche sur un calque isolé, y retire la portion qui tombe à
 * l'intérieur du contour du visage, puis compose le résultat.
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
  // La branche visible est celle du côté opposé au sens de rotation de la tête.
  const side: 1 | -1 = m.yawRad >= 0 ? -1 : 1;
  const t = templeAffine(profile.spec, m, side);

  const off = layerFor(ctx.canvas.width, ctx.canvas.height);
  const octx = off.getContext('2d');
  if (octx === null) return;

  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.globalCompositeOperation = 'source-over';
  octx.clearRect(0, 0, off.width, off.height);

  octx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  octx.drawImage(profile.img, 0, 0);

  if (faceOutline !== null) {
    octx.setTransform(1, 0, 0, 1, 0, 0); // le contour est déjà en coordonnées écran
    octx.globalCompositeOperation = 'destination-out';
    octx.fill(faceOutline);
  }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(off, 0, 0);
  ctx.restore();
}
