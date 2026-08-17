/**
 * render/recolor.ts — ⭐ V2 « 2,5 D » : changer le COLORIS d'une monture RÉELLE.
 *
 * ## Le renversement
 *
 * Jusqu'ici la V2 posait un sprite PAR-DESSUS la monture physiquement portée,
 * d'où le liseré du §11.6 et la dilatation de 1,5 mm censée le masquer. Ici on
 * ne pose rien : on repeint les pixels de la monture réelle. Le liseré n'a plus
 * lieu d'être, puisqu'il n'y a plus deux montures superposées mais une seule,
 * dont on change la matière.
 *
 * ## Pourquoi c'est de la 2,5 D sans une ligne de 3D
 *
 * Toute la géométrie vient du réel : la pose de la tête, la perspective, le
 * galbe de la face, l'occlusion par le nez, le flou de bougé, l'ombre portée du
 * sourcil, le reflet qui glisse quand la personne bouge. Rien de tout cela n'est
 * calculé — c'est filmé. On ne substitue que la chrominance et le niveau de
 * luminance, en conservant la MODULATION de luminance de l'image réelle.
 *
 * Aucun maillage, aucun `three.js`, aucun WebGL : une boucle sur les pixels d'un
 * rectangle. Le §0 reste intact.
 *
 * ## Ce que ça ne fait pas
 *
 * Rien de métrologique. La largeur affichée reste celle du §5, mesurée sur la
 * monture portée. Le recoloriage est de l'esthétique — et c'est exactement la
 * question que pose la V2 : « ce coloris me va-t-il ? » (§11.2).
 */

import type { FrameMetrics } from '../core/faceMetrics.js';
import type { FrameSpec } from '../core/frameSpec.js';
import type { Pt } from '../core/geom.js';
import type { ImageBuffer } from '../core/silhouette.js';
import { apply, invertAffine, spriteAffine } from '../core/transform.js';
import { distanceYcc, toRgb, toYcc, type Ycc } from './ycc.js';

/** Alpha minimal pour qu'un pixel de sprite compte comme « de la monture ». */
export const SPRITE_ALPHA_MIN = 24;

/**
 * Distance colorimétrique minimale entre un pixel et la peau environnante.
 *
 * Le masque géométrique dit OÙ la monture devrait être ; ce seuil dit si elle y
 * est vraiment. Sans lui, une pose décalée de deux millimètres repeindrait une
 * bande de peau en écaille — le genre de défaut qui saute aux yeux d'un client
 * et à personne d'autre.
 */
export const SKIN_DISTANCE_MIN = 26;

/**
 * Part de la modulation de luminance réelle réinjectée dans le coloris.
 *
 * À 0, le résultat est un aplat de couleur, plat et faux. À 1, un cerclage noir
 * conserve son noir et le changement de coloris ne se voit plus. Entre les deux,
 * les reflets et les ombres survivent tout en laissant la matière changer.
 */
export const SHADING_GAIN = 0.45;

/** Plancher du niveau de référence, pour ne pas diviser par une ombre. */
const LUMA_FLOOR = 24;

/**
 * Épaisseur de l'anneau de peau échantillonné AUTOUR du rectangle traité.
 *
 * ⚠️ Il ne suffit pas de prendre la peau à l'intérieur du rectangle, hors du
 * masque : sur une monture pleine, ou quand le rectangle colle à la silhouette,
 * cet échantillon est vide. La référence de peau valait alors zéro, et le
 * contrôle « est-ce vraiment la monture ? » laissait tout passer — y compris
 * une joue entière. C'est un anneau extérieur qui garantit un échantillon.
 */
const SKIN_RING_PX = 8;

export interface RecolorInput {
  /** Pixels de la vidéo, lus seulement. */
  source: ImageBuffer;
  /** Calque transparent de même taille, écrit seulement. */
  out: ImageBuffer;
  /** Sprite RGBA du modèle PORTÉ — il fournit le masque géométrique. */
  wornSprite: ImageBuffer;
  wornSpec: FrameSpec;
  /** Sprite RGBA du coloris voulu — il fournit la matière. */
  targetSprite: ImageBuffer;
  targetSpec: FrameSpec;
  m: FrameMetrics;
}

export interface RecolorReport {
  /** Pixels effectivement repeints. */
  painted: number;
  /** Pixels attendus par la géométrie seule. */
  expected: number;
  /** Non nul quand le résultat ne mérite pas d'être montré. */
  reason: string | null;
}

/**
 * En deçà de cette part du masque géométrique, la monture portée n'a pas été
 * retrouvée : mauvaise calibration, mauvais modèle, ou personne sortie du champ.
 */
export const MIN_PAINTED_RATIO = 0.35;

function pixelAt(buf: ImageBuffer, x: number, y: number): Ycc | null {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return null;
  const i = (y * buf.width + x) * 4;
  return toYcc(buf.data[i] ?? 0, buf.data[i + 1] ?? 0, buf.data[i + 2] ?? 0);
}

function alphaAt(buf: ImageBuffer, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return 0;
  return buf.data[(y * buf.width + x) * 4 + 3] ?? 0;
}

/**
 * Point homologue sur le sprite du coloris voulu.
 *
 * Les deux sprites sont le MÊME modèle (garde-fou §11.5) mais pas la même
 * photo : leurs boîtes alpha diffèrent en pixels. On passe donc par des
 * coordonnées normalisées dans la boîte alpha, ce qui aligne les deux
 * silhouettes sans supposer que les photos ont été prises à la même distance.
 */
function toTargetSprite(p: Pt, worn: FrameSpec, target: FrameSpec): Pt {
  const u = (p.x - worn.alphaBBox.x) / worn.alphaBBox.w;
  const v = (p.y - worn.alphaBBox.y) / worn.alphaBBox.h;
  return {
    x: target.alphaBBox.x + u * target.alphaBBox.w,
    y: target.alphaBBox.y + v * target.alphaBBox.h,
  };
}

/** Rectangle écran couvert par la monture portée, borné à l'image. */
export function wornRegion(spec: FrameSpec, m: FrameMetrics, w: number, h: number): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const t = spriteAffine(spec, m);
  const b = spec.alphaBBox;
  const corners = [
    apply(t, { x: b.x, y: b.y }),
    apply(t, { x: b.x + b.w, y: b.y }),
    apply(t, { x: b.x, y: b.y + b.h }),
    apply(t, { x: b.x + b.w, y: b.y + b.h }),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(w, Math.ceil(Math.max(...xs)));
  const y1 = Math.min(h, Math.ceil(Math.max(...ys)));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Médiane d'un échantillon. Robuste aux yeux sombres dans l'anneau de peau. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
}

/**
 * Repeint la monture portée avec la matière d'un autre coloris.
 *
 * `out` doit être transparent à l'appel : seuls les pixels effectivement
 * reconnus comme « monture » y sont écrits, en opaque. Tout le reste garde son
 * alpha nul, si bien que le calque se compose tel quel au-dessus de la vidéo.
 */
export function recolorWornFrame(input: RecolorInput): RecolorReport {
  const { source, out, wornSprite, wornSpec, targetSprite, targetSpec, m } = input;
  const region = wornRegion(wornSpec, m, source.width, source.height);
  if (region.w === 0 || region.h === 0) {
    return { painted: 0, expected: 0, reason: 'la monture portée est hors du champ' };
  }

  const inv = invertAffine(spriteAffine(wornSpec, m));

  // — Passe 1 : masque géométrique, référence de peau, niveau de la monture.
  const mask = new Uint8Array(region.w * region.h);
  const spriteXs = new Float32Array(region.w * region.h);
  const spriteYs = new Float32Array(region.w * region.h);
  const skin: Ycc[] = [];
  let expected = 0;

  for (let j = 0; j < region.h; j++) {
    for (let i = 0; i < region.w; i++) {
      const sp = apply(inv, { x: region.x + i + 0.5, y: region.y + j + 0.5 });
      const k = j * region.w + i;
      spriteXs[k] = sp.x;
      spriteYs[k] = sp.y;

      if (alphaAt(wornSprite, Math.round(sp.x), Math.round(sp.y)) >= SPRITE_ALPHA_MIN) {
        mask[k] = 1;
        expected++;
      } else {
        const p = pixelAt(source, region.x + i, region.y + j);
        if (p !== null) skin.push(p);
      }
    }
  }
  if (expected === 0) {
    return { painted: 0, expected: 0, reason: 'la monture portée est hors du champ' };
  }

  // Anneau extérieur : la peau autour de la monture, toujours disponible.
  for (let j = -SKIN_RING_PX; j < region.h + SKIN_RING_PX; j++) {
    const bord = j < 0 || j >= region.h;
    for (let i = -SKIN_RING_PX; i < region.w + SKIN_RING_PX; i++) {
      if (!bord && i >= 0 && i < region.w) continue;
      const p = pixelAt(source, region.x + i, region.y + j);
      if (p !== null) skin.push(p);
    }
  }

  // Médiane composante par composante : la peau a une chrominance, et la
  // comparer à du gris neutre laisserait passer un cerclage clair et chaud.
  const skinRef: Ycc = {
    y: median(skin.map((p) => p.y)),
    cb: median(skin.map((p) => p.cb)),
    cr: median(skin.map((p) => p.cr)),
  };

  // Niveau de luminance de la monture RÉELLE : c'est lui qui sert de zéro à la
  // modulation. Une médiane, parce qu'un seul reflet suffirait à tirer la moyenne.
  const wornLumas: number[] = [];
  for (let k = 0; k < mask.length; k++) {
    if (mask[k] !== 1) continue;
    const p = pixelAt(source, region.x + (k % region.w), region.y + Math.floor(k / region.w));
    if (p !== null) wornLumas.push(p.y);
  }
  const wornLevel = Math.max(LUMA_FLOOR, median(wornLumas));

  // — Passe 2 : substitution de la matière, conservation de la lumière.
  let painted = 0;
  for (let k = 0; k < mask.length; k++) {
    if (mask[k] !== 1) continue;
    const i = k % region.w;
    const j = Math.floor(k / region.w);

    const live = pixelAt(source, region.x + i, region.y + j);
    if (live === null) continue;

    // La géométrie dit « ici » ; la couleur dit si la monture y est vraiment.
    if (distanceYcc(live, skinRef) < SKIN_DISTANCE_MIN) continue;

    const tp = toTargetSprite({ x: spriteXs[k] ?? 0, y: spriteYs[k] ?? 0 }, wornSpec, targetSpec);
    const tx = Math.round(tp.x);
    const ty = Math.round(tp.y);
    if (alphaAt(targetSprite, tx, ty) < SPRITE_ALPHA_MIN) continue;

    const matiere = pixelAt(targetSprite, tx, ty);
    if (matiere === null) continue;

    // ⭐ Le cœur : la matière vient de la photo, la lumière vient de la vidéo.
    const shade = (live.y - wornLevel) / wornLevel;
    const [r, g, b] = toRgb({
      y: matiere.y * (1 + SHADING_GAIN * shade),
      cb: matiere.cb,
      cr: matiere.cr,
    });

    const o = ((region.y + j) * out.width + (region.x + i)) * 4;
    out.data[o] = r;
    out.data[o + 1] = g;
    out.data[o + 2] = b;
    out.data[o + 3] = 255;
    painted++;
  }

  const ratio = painted / expected;
  return {
    painted,
    expected,
    reason:
      ratio < MIN_PAINTED_RATIO
        ? `Seuls ${(ratio * 100).toFixed(0)} % de la monture ont été retrouvés dans l'image. ` +
          `Vérifiez que le modèle sélectionné est bien celui qui est porté, et refaites l'étalonnage.`
        : null,
  };
}
