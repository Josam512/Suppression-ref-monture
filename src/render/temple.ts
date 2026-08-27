/**
 * render/temple.ts — la branche, depuis le sprite de profil (CLAUDE.md §6).
 *
 * La branche doit passer DERRIÈRE la tête. Une branche qui flotte par-dessus
 * la joue trahit immédiatement le trucage.
 */

import type { FrameSpec } from '../core/frameSpec.js';
import type { FrameMetrics } from '../core/faceMetrics.js';
import { spriteToScreen, templeAffine, templeRootOf } from '../core/transform.js';

/**
 * ⭐ Guide point 52 — rayon PROTÉGÉ autour du tenon, en mm réels : l'occlusion
 * du visage n'a pas le droit d'effacer la racine de la branche. Le tenon est
 * projeté SUR le visage (il en sort), et `destination-out` y découpait un trou
 * — « tenon → trou → branche » donnait l'impression d'une géométrie fausse
 * alors que c'était le masque qui l'effaçait.
 */
export const TEMPLE_ROOT_PROTECT_MM = 8;

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
  /** 🔴 Terrain 2026-08-26 — le côté visible vient de la GÉOMÉTRIE PROJETÉE
   *  (core/faceMetrics.visibleTempleSide), plus jamais du signe du yaw : la
   *  convention absolue de ce signe n'est prouvée par rien sur la voie sans
   *  matrice, et un signe inversé dessinait la branche du mauvais côté. */
  side: 1 | -1,
): void {
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
    // ⭐ Point 52 — le masque s'applique PARTOUT SAUF autour du tenon : un
    // disque de TEMPLE_ROOT_PROTECT_MM y est retranché du masque (clip
    // evenodd), la racine de la branche reste attachée à la face.
    const anchor = spriteToScreen(templeRootOf(profile.spec, side), profile.spec, m);
    const r = TEMPLE_ROOT_PROTECT_MM * m.livePxPerMm;
    octx.save();
    if (Number.isFinite(anchor.x) && Number.isFinite(anchor.y) && Number.isFinite(r) && r > 0) {
      const clipZone = new Path2D();
      clipZone.rect(0, 0, off.width, off.height);
      clipZone.arc(anchor.x, anchor.y, r, 0, 2 * Math.PI);
      octx.clip(clipZone, 'evenodd');
    }
    octx.fill(faceOutline);
    octx.restore();

    // 🔴 Terrain 2026-08-27 — le MANCHON passe DERRIÈRE l'oreille. Au-delà de
    // la racine de l'hélix (162/389, `m.ear` du côté dessiné), la branche court
    // dans le sillon rétro-auriculaire : le pavillon puis le crâne la cachent
    // sur tout le domaine de yaw exploitable. On efface donc le demi-plan qui
    // commence à l'oreille, perpendiculairement à la branche — dans les axes de
    // la tête, les mêmes que `templeAffine`. Garde : si l'oreille détectée
    // tombait en deçà de la zone protégée du tenon (détection aberrante), on ne
    // coupe rien — un manchon visible vaut mieux qu'une branche effacée.
    const ear = side > 0 ? m.ear.right : m.ear.left;
    const ux = side * Math.cos(m.rollRad);
    const uy = side * Math.sin(m.rollRad);
    const tEar = (ear.x - anchor.x) * ux + (ear.y - anchor.y) * uy;
    if (Number.isFinite(tEar) && tEar > r) {
      const L = off.width + off.height; // couvre tout le calque, à toute rotation
      const nx = -uy;
      const ny = ux;
      const cut = new Path2D();
      cut.moveTo(ear.x - nx * L, ear.y - ny * L);
      cut.lineTo(ear.x + nx * L, ear.y + ny * L);
      cut.lineTo(ear.x + nx * L + ux * L, ear.y + ny * L + uy * L);
      cut.lineTo(ear.x - nx * L + ux * L, ear.y - ny * L + uy * L);
      cut.closePath();
      octx.fill(cut);
    }
  }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(off, 0, 0);
  ctx.restore();
}
