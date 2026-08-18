/**
 * core/cardFinder.ts — trouver la carte SANS que le client la montre.
 *
 * ## Pourquoi une cinquième tentative, après quatre échecs
 *
 * `tests/cardFind.atelier.ts` garde la trace de quatre détections ratées —
 * rapport ISO noté (36 % d'erreur), contours fermés (0 candidat), segments de
 * droite (57 %), recherche contrainte au front (22 % de dispersion). Toutes
 * posaient la même question : **où est la carte sur CETTE image ?** Et sur une
 * image, la lisière des cheveux est un bord plus franc que la carte.
 *
 * 🔴 Ce fichier ne pose pas cette question. Il en pose une autre : **quelle
 * largeur revient sur TOUTES les images ?** Le client filme ; la carte est le
 * seul objet dont la largeur rapportée au visage reste constante d'une image à
 * l'autre, parce qu'elle est rigide et normalisée. Un bord de cheveux, un
 * montant de fenêtre, une ombre donnent une valeur différente à chaque image et
 * ne survivent pas à la médiane.
 *
 * ## Ce que ça vaut, MESURÉ sur la séquence réelle du sujet — 179 images
 *
 * | Grandeur | Valeur |
 * |---|---|
 * | Carte localisée | **179 / 179 images** |
 * | Dispersion image par image | **4,3 %** — médiocre, et c'est assumé |
 * | Écart-type de la MÉDIANE des 179 vues | **0,32 %** |
 *
 * ⚠️ **Ces 0,32 % ne sont PAS une précision.** C'est de la répétabilité, et le
 * §4 (correctif B4) dit déjà pourquoi il ne faut jamais confondre les deux : un
 * biais systématique — des bords systématiquement accrochés deux pixels à
 * l'intérieur de la carte — ne se moyenne pas. L'incertitude annoncée reste
 * celle de `CARD_CLICK_REL_ERROR`, et rien ici ne l'abaisse.
 *
 * ⚠️ **Contrôle de non-circularité.** La fenêtre de recherche a été élargie de
 * `[-1,30 ; +0,10]` à `[-1,40 ; +0,60]` largeurs de visage — c'est-à-dire au
 * double, couvrant le front comme les joues. La médiane a bougé de 0,3 %
 * (0,7193 → 0,7170). Ce sont donc bien les pixels qui décident, pas la fenêtre.
 * Un test verrouille cette insensibilité.
 */

import { at, type NormalizedLandmark, type Pt } from './geom.js';
import { EYE_L, EYE_R, FACE_L, FACE_R } from './faceMetrics.js';
import { CARD_H_MM, CARD_W_MM, type CardQuad } from './cardPose.js';
import { luma, type ImageBuffer } from './silhouette.js';

/** Rapport hauteur/largeur de la norme ISO/IEC 7810 ID-1. */
const ISO_RATIO = CARD_H_MM / CARD_W_MM;

/**
 * Fenêtre de recherche, en largeurs de visage, dans le repère de la TÊTE.
 *
 * ⚠️ Volontairement large : elle couvre le front, les yeux et les joues. Une
 * fenêtre serrée ferait la mesure à la place des pixels — c'est le défaut qui a
 * coulé la quatrième tentative. Élargir encore ne change la médiane que de
 * 0,3 %, ce qui est la preuve que la contrainte ne porte rien.
 */
export const SEARCH_TOP = -1.4;
export const SEARCH_BOTTOM = 0.6;
export const SEARCH_HALF_WIDTH = 0.85;

/** Côté de la grille de ré-échantillonnage. Impair : il y a une colonne centrale. */
export const GRID = 161;

/**
 * Écart de luminance sous la peau à partir duquel un pixel compte comme
 * « pas de la peau ». Mesuré sur la séquence réelle : la carte du sujet est à
 * 40–70 niveaux sous son front, la marge de 25 laisse passer les cartes claires
 * sans laisser passer le grain de peau (écart-type local ≈ 6).
 */
export const DARKER_THAN_SKIN = 25;

/** Bornes de plausibilité de la largeur, en fraction de largeur de visage. */
export const MIN_WIDTH_RATIO = 0.45;
export const MAX_WIDTH_RATIO = 0.9;

export interface CardSighting {
  /**
   * Largeur de la carte ÷ largeur du visage, sur CETTE image. **Sans unité**,
   * donc insensible à la distance : c'est ce qui rend la médiane légitime.
   */
  widthRatio: number;
  /** Le quadrilatère, en pixels image — prêt pour `refineQuad` et la pose. */
  quad: CardQuad;
}

interface HeadFrame {
  centre: Pt;
  ux: Pt;
  uy: Pt;
  faceWidthPx: number;
}

function headFrame(lm: readonly NormalizedLandmark[], w: number, h: number): HeadFrame {
  const p = (i: number): Pt => ({ x: at(lm, i).x * w, y: at(lm, i).y * h });
  const fl = p(FACE_L);
  const fr = p(FACE_R);
  const el = p(EYE_L);
  const er = p(EYE_R);
  const roll = Math.atan2(er.y - el.y, er.x - el.x);
  return {
    centre: { x: (el.x + er.x) / 2, y: (el.y + er.y) / 2 },
    ux: { x: Math.cos(roll), y: Math.sin(roll) },
    uy: { x: -Math.sin(roll), y: Math.cos(roll) },
    faceWidthPx: Math.hypot(fr.x - fl.x, fr.y - fl.y),
  };
}

/** Repère tête (en largeurs de visage) → pixels image. */
function toImage(f: HeadFrame, u: number, v: number): Pt {
  const s = f.faceWidthPx;
  return {
    x: f.centre.x + f.ux.x * u * s + f.uy.x * v * s,
    y: f.centre.y + f.ux.y * u * s + f.uy.y * v * s,
  };
}

/** Plus longue plage de `true` : son début et sa longueur. */
function longestRun(mask: Uint8Array): { start: number; length: number } {
  let best = 0;
  let bestStart = 0;
  let cur = 0;
  let start = 0;
  for (let k = 0; k < mask.length; k++) {
    if (mask[k] === 1) {
      if (cur === 0) start = k;
      cur++;
      if (cur > best) {
        best = cur;
        bestStart = start;
      }
    } else {
      cur = 0;
    }
  }
  return { start: bestStart, length: best };
}

/** Sommet parabolique autour de `k` : le bord se lit sous le pixel. */
function subpixel(profile: Float32Array, k: number): number {
  if (k <= 0 || k >= profile.length - 1) return k;
  const a = profile[k - 1] as number;
  const b = profile[k] as number;
  const c = profile[k + 1] as number;
  const den = a - 2 * b + c;
  return den === 0 ? k : k - 0.5 * ((c - a) / den);
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? (s[m] as number) : (((s[m - 1] as number) + (s[m] as number)) / 2);
}

/**
 * Cherche la carte sur UNE image. Rend `null` quand rien de plausible ne sort —
 * ce qui n'est pas une panne : les autres images du film parleront.
 */
export function findCard(
  buf: ImageBuffer,
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
): CardSighting | null {
  const f = headFrame(lm, w, h);
  if (!Number.isFinite(f.faceWidthPx) || f.faceWidthPx < 1) return null;

  const du = (2 * SEARCH_HALF_WIDTH) / (GRID - 1);
  const dv = (SEARCH_BOTTOM - SEARCH_TOP) / (GRID - 1);

  // Ré-échantillonnage dans le repère de la tête : le roll disparaît, donc les
  // bords de la carte redeviennent horizontaux et verticaux.
  const grid = new Float32Array(GRID * GRID);
  for (let r = 0; r < GRID; r++) {
    const v = SEARCH_TOP + r * dv;
    for (let c = 0; c < GRID; c++) {
      const q = toImage(f, -SEARCH_HALF_WIDTH + c * du, v);
      grid[r * GRID + c] = luma(buf, Math.round(q.x), Math.round(q.y));
    }
  }

  // Référence de peau : une bande sous les yeux, où il y a du visage à coup sûr.
  const skinRows: number[] = [];
  for (let r = Math.floor(0.6 * GRID); r < Math.floor(0.68 * GRID); r++) {
    for (let c = 0; c < GRID; c++) skinRows.push(grid[r * GRID + c] as number);
  }
  if (skinRows.length === 0) return null;
  const skin = median(skinRows);

  // Rangées dont la plus longue plage « plus sombre que la peau » a la largeur
  // plausible d'une carte. La carte en est une pile contiguë.
  const starts = new Int32Array(GRID);
  const lengths = new Int32Array(GRID);
  const band = new Uint8Array(GRID);
  const row = new Uint8Array(GRID);
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) row[c] = (grid[r * GRID + c] as number) < skin - DARKER_THAN_SKIN ? 1 : 0;
    const run = longestRun(row);
    starts[r] = run.start;
    lengths[r] = run.length;
    const ratio = run.length * du;
    band[r] = ratio > MIN_WIDTH_RATIO && ratio < MAX_WIDTH_RATIO ? 1 : 0;
  }
  const stack = longestRun(band);
  if (stack.length < 6) return null;

  // ── Resserrage sous le pixel, sur le gradient, dans la pile retenue.
  const cols = new Float32Array(GRID);
  for (let c = 0; c < GRID; c++) {
    let s = 0;
    for (let r = stack.start; r < stack.start + stack.length; r++) s += grid[r * GRID + c] as number;
    cols[c] = s / stack.length;
  }
  const grad = new Float32Array(GRID);
  for (let c = 1; c < GRID - 1; c++) grad[c] = ((cols[c + 1] as number) - (cols[c - 1] as number)) / 2;

  const inner: number[] = [];
  const outer: number[] = [];
  for (let r = stack.start; r < stack.start + stack.length; r++) {
    inner.push(starts[r] as number);
    outer.push((starts[r] as number) + (lengths[r] as number));
  }
  const win = Math.max(2, Math.round(0.06 / du));
  const argExtreme = (from: number, to: number, sign: number): number => {
    let bestK = from;
    let bestV = -Infinity;
    for (let k = Math.max(1, from); k < Math.min(GRID - 1, to); k++) {
      const v = sign * (grad[k] as number);
      if (v > bestV) {
        bestV = v;
        bestK = k;
      }
    }
    return bestK;
  };
  const l0 = Math.round(median(inner));
  const r0 = Math.round(median(outer));
  const negGrad = new Float32Array(GRID);
  for (let c = 0; c < GRID; c++) negGrad[c] = -(grad[c] as number);
  const cL = subpixel(negGrad, argExtreme(l0 - win, l0 + win, -1));
  const cR = subpixel(grad, argExtreme(r0 - win, r0 + win, +1));

  const widthRatio = (cR - cL) * du;
  if (!(widthRatio > MIN_WIDTH_RATIO && widthRatio < MAX_WIDTH_RATIO)) return null;

  // Bord bas : gradient vertical au centre de la carte. Le bord HAUT n'est pas
  // cherché — contre les cheveux il est sombre sur sombre, et la norme ISO le
  // donne exactement (§14.5 : un bord masqué n'arrête rien).
  const strip = new Float32Array(GRID);
  const c0 = Math.max(0, Math.round(cL) + 3);
  const c1 = Math.min(GRID, Math.round(cR) - 3);
  for (let r = 0; r < GRID; r++) {
    let s = 0;
    for (let c = c0; c < c1; c++) s += grid[r * GRID + c] as number;
    strip[r] = c1 > c0 ? s / (c1 - c0) : 0;
  }
  const vgrad = new Float32Array(GRID);
  for (let r = 1; r < GRID - 1; r++) vgrad[r] = ((strip[r + 1] as number) - (strip[r - 1] as number)) / 2;
  const b0 = stack.start + stack.length - 1;
  const wv = Math.max(2, Math.round(0.1 / dv));
  let bestR = b0;
  let bestV = -Infinity;
  for (let r = Math.max(1, b0 - wv); r < Math.min(GRID - 1, b0 + wv); r++) {
    if ((vgrad[r] as number) > bestV) {
      bestV = vgrad[r] as number;
      bestR = r;
    }
  }
  const vBottom = SEARCH_TOP + subpixel(vgrad, bestR) * dv;
  const vTop = vBottom - widthRatio * ISO_RATIO;

  const uL = -SEARCH_HALF_WIDTH + cL * du;
  const uR = -SEARCH_HALF_WIDTH + cR * du;
  const quad: CardQuad = [
    toImage(f, uL, vTop),
    toImage(f, uR, vTop),
    toImage(f, uR, vBottom),
    toImage(f, uL, vBottom),
  ];
  return { widthRatio, quad };
}

/**
 * La largeur retenue pour toute la séance : **la médiane des vues**.
 *
 * 🔴 La médiane, et pas la moyenne. Une image où le détecteur a accroché une
 * ombre ou un montant de fenêtre ne donne pas un petit écart : elle donne une
 * valeur très éloignée. La moyenne la traînerait ; la médiane l'ignore.
 */
export function consensusWidthRatio(widthRatios: readonly number[]): number | null {
  if (widthRatios.length === 0) return null;
  return median(widthRatios);
}
