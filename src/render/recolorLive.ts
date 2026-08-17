/**
 * render/recolorLive.ts — le recoloriage V2, branché sur le flux vidéo.
 *
 * `recolor.ts` travaille sur des tampons de pixels et se teste sans navigateur.
 * Ce fichier-ci fait le pont : il lit la région utile de la vidéo, appelle le
 * recoloriage, et compose le calque obtenu au-dessus du flux.
 *
 * ⚠️ On ne lit QUE le rectangle de la monture, pas l'image entière. À 1280×720,
 * lire toute la frame par `getImageData` coûterait plus cher que la détection
 * elle-même ; le rectangle utile fait quelques dizaines de milliers de pixels.
 */

import type { FrameMetrics } from '../core/faceMetrics.js';
import type { FrameSpec } from '../core/frameSpec.js';
import type { ImageBuffer } from '../core/silhouette.js';
import { recolorWornFrame, wornRegion, type RecolorReport } from './recolor.js';

/** Même forme que `FrontSprite` : le recoloriage accepte ce que le rendu accepte. */
export interface SpriteImage {
  img: CanvasImageSource;
  spec: FrameSpec;
}

/**
 * Dimensions natives d'une source dessinable.
 *
 * ⚠️ Rien à voir avec la chaîne de mesure : la largeur d'un fichier n'y entre
 * jamais (B3). Ici il ne s'agit que de savoir sur quelle taille de canvas
 * rastériser le sprite avant d'en lire les pixels.
 */
function sizeOf(image: CanvasImageSource): { w: number; h: number } | null {
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
    return { w: image.naturalWidth, h: image.naturalHeight };
  }
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    return { w: image.width, h: image.height };
  }
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    return { w: image.width, h: image.height };
  }
  return null;
}

/**
 * Sprites rastérisés une fois pour toutes.
 *
 * Le recoloriage a besoin des PIXELS du sprite, pas de l'élément image. Les
 * re-décoder à chaque frame reviendrait à refaire soixante fois par seconde un
 * travail dont le résultat ne change jamais.
 */
const rasters = new WeakMap<object, ImageBuffer>();

function raster(image: CanvasImageSource): ImageBuffer | null {
  const held = rasters.get(image);
  if (held !== undefined) return held;

  const size = sizeOf(image);
  if (size === null || size.w === 0 || size.h === 0) return null;
  const { w, h } = size;

  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d', { willReadFrequently: true });
  if (octx === null) return null;
  octx.drawImage(image, 0, 0);

  const buf = octx.getImageData(0, 0, w, h);
  rasters.set(image, buf);
  return buf;
}

/** Tampons pleine image réutilisés : 0 = source, 1 = calque de sortie. */
const buffers: Array<ImageData | null> = [null, null];

/**
 * `ImageData` plutôt qu'un tampon nu : c'est le seul type que `putImageData`
 * accepte, et le convertir à la volée reviendrait à recopier 3,7 Mo par frame.
 * Il se lit par ailleurs comme un `ImageBuffer` — mêmes champs, même sens.
 */
function bufferFor(slot: 0 | 1, w: number, h: number): ImageData {
  const held = buffers[slot];
  if (held !== undefined && held !== null && held.width === w && held.height === h) return held;
  const fresh = new ImageData(w, h);
  buffers[slot] = fresh;
  return fresh;
}

/** Calques hors écran réutilisés : lecture de la vidéo, et composition du calque. */
const canvases: Record<'readback' | 'layer', HTMLCanvasElement | null> = {
  readback: null,
  layer: null,
};

function canvasFor(role: 'readback' | 'layer', w: number, h: number): HTMLCanvasElement {
  let held = canvases[role];
  if (held === null) {
    held = document.createElement('canvas');
    canvases[role] = held;
  }
  if (held.width !== w || held.height !== h) {
    held.width = w;
    held.height = h;
  }
  return held;
}

const readbackFor = (w: number, h: number): HTMLCanvasElement => canvasFor('readback', w, h);
const layerFor = (w: number, h: number): HTMLCanvasElement => canvasFor('layer', w, h);

/**
 * Repeint, sur `ctx`, la monture réellement portée avec la matière d'un coloris.
 *
 * @returns le compte-rendu du recoloriage, dont la raison d'un éventuel refus.
 *          Un refus n'interrompt pas l'essayage : la vidéo reste visible, il
 *          n'y a simplement rien de peint par-dessus (§0.0.2).
 */
export function drawRecolored(
  ctx: CanvasRenderingContext2D,
  video: CanvasImageSource,
  worn: SpriteImage,
  target: SpriteImage,
  m: FrameMetrics,
): RecolorReport {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  const wornPixels = raster(worn.img);
  const targetPixels = raster(target.img);
  if (wornPixels === null || targetPixels === null) {
    return { painted: 0, expected: 0, reason: 'sprites pas encore décodés' };
  }

  const region = wornRegion(worn.spec, m, w, h);
  if (region.w === 0 || region.h === 0) {
    return { painted: 0, expected: 0, reason: 'la monture portée est hors du champ' };
  }

  const off = readbackFor(w, h);
  const octx = off.getContext('2d', { willReadFrequently: true });
  if (octx === null) return { painted: 0, expected: 0, reason: 'contexte 2D indisponible' };

  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(region.x, region.y, region.w, region.h);
  octx.drawImage(video, 0, 0, w, h);

  const source = octx.getImageData(region.x, region.y, region.w, region.h);

  // On travaille dans le repère de l'image entière : `wornRegion` est recalculée
  // à l'identique dans `recolorWornFrame`, et les coordonnées doivent coïncider.
  //
  // ⚠️ Les deux tampons sont RÉUTILISÉS. En allouer deux de 3,7 Mo à chaque
  // frame ferait travailler le ramasse-miettes soixante fois par seconde, au
  // moment exact où la boucle de détection a besoin du processeur.
  const full = bufferFor(0, w, h);
  const out = bufferFor(1, w, h);
  for (let j = 0; j < region.h; j++) {
    const from = j * region.w * 4;
    const to = ((region.y + j) * w + region.x) * 4;
    full.data.set(source.data.subarray(from, from + region.w * 4), to);
    out.data.fill(0, to, to + region.w * 4);
  }

  const report = recolorWornFrame({
    source: full,
    out,
    wornSprite: wornPixels,
    wornSpec: worn.spec,
    targetSprite: targetPixels,
    targetSpec: target.spec,
    m,
  });

  if (report.reason === null && report.painted > 0) {
    // 🔴 `putImageData` REMPLACE les pixels, il ne les compose PAS : les zones
    // transparentes du calque écraseraient tout ce qui est dessous, alpha
    // compris. Dans l'application le canvas est transparent au-dessus d'un
    // <video> et le défaut ne se verrait pas ; sur un outil qui dessine la
    // vidéo dans le même canvas, il découpe un rectangle noir autour de la
    // monture. C'est exactement le mode d'échec de `destination-out` déjà
    // rencontré au §13 : invisible là où on regarde, destructeur ailleurs.
    //
    // On passe donc par `drawImage`, qui compose en `source-over`.
    const layer = layerFor(w, h);
    const lctx = layer.getContext('2d');
    if (lctx !== null) {
      lctx.putImageData(out, 0, 0, region.x, region.y, region.w, region.h);
      ctx.drawImage(
        layer,
        region.x,
        region.y,
        region.w,
        region.h,
        region.x,
        region.y,
        region.w,
        region.h,
      );
    }
  }
  return report;
}
