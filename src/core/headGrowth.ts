/**
 * core/headGrowth.ts — le bord de la tête, trouvé EN PARTANT DE LA TÊTE.
 *
 * ## Ce que ce fichier remplace, et pourquoi
 *
 * La première version modélisait le FOND, échantillonné au bord de l'image, et
 * balayait vers l'intérieur jusqu'au premier objet rencontré. Elle exigeait donc
 * du client un mur uni et une tête bien centrée — c'est-à-dire qu'elle
 * transformait un problème de mesure en liste de contraintes imposées à la
 * personne. Sur la première vraie vidéo, prise dans un salon, elle a trouvé le
 * montant d'une fenêtre à 83 mm de la tempe, puis conclu « ce sont des cheveux ».
 *
 * On ne regarde plus le fond du tout. On part d'une zone dont on SAIT qu'elle
 * est la tête — la tempe, juste sous le repère facial —, on y apprend à quoi
 * ressemblent la peau et les cheveux de CETTE personne dans CETTE lumière, et on
 * progresse vers l'extérieur tant que les pixels leur ressemblent. Le premier
 * décrochage franc est le bord de la tête.
 *
 * Ce que contient l'arrière-plan devient sans importance : mur bleu à pois
 * verts, fenêtre, bibliothèque — on ne le lit jamais.
 */

import { offset, type EdgeResult, type EdgeSearch, type ImageBuffer } from './silhouette.js';

/** Un bord n'est un bord que s'il est suivi de plusieurs pixels non-tête. */
const EDGE_RUN_PX = 4;

// ── Croissance depuis la tête (chemin nominal) ───────────────────────────────

/** Demi-hauteur de la zone de référence prise sur la tempe, en pixels. */
export const SEED_BOX_PX = 18;
/** Demi-largeur de cette zone. */
const SEED_HALF_PX = 4;
/** De combien on rentre À L'INTÉRIEUR du repère pour être sûr d'être sur la tête. */
const SEED_INSET_PX = 6;
/** En deçà, la zone de référence n'apprend rien. */
const MIN_SEEDS = 60;
/** Multiple de la dispersion interne de la tête au-delà duquel on décroche. */
const GROWTH_FACTOR = 2.6;
/** Plancher, pour qu'une tempe parfaitement lisse ne rende pas tout « fond ». */
const GROWTH_FLOOR = 26;

interface Ycc {
  y: number;
  cb: number;
  cr: number;
}

function sample(buf: ImageBuffer, x: number, y: number): Ycc | null {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return null;
  const i = offset(buf, x, y);
  const r = buf.data[i] ?? 0;
  const g = buf.data[i + 1] ?? 0;
  const b = buf.data[i + 2] ?? 0;
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    cb: 128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    cr: 128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  };
}

/**
 * Distance au plus proche des échantillons de référence.
 *
 * ⚠️ Au PLUS PROCHE, et non à leur moyenne. La tête n'est pas une couleur : elle
 * en a au moins deux, la peau et les cheveux, très éloignées l'une de l'autre.
 * Une moyenne les confondrait en un gris qui ne ressemble à rien, et la
 * frontière tomberait au milieu du visage.
 */
function minDistance(p: Ycc, seeds: readonly Ycc[]): number {
  let best = Infinity;
  for (const s of seeds) {
    const d = Math.hypot(p.y - s.y, (p.cb - s.cb) * 1.5, (p.cr - s.cr) * 1.5);
    if (d < best) best = d;
  }
  return best;
}

/** Dispersion interne d'un ensemble : distance médiane au deuxième plus proche. */
function medianDistanceToSet(set: readonly Ycc[], seeds: readonly Ycc[]): number {
  const step = Math.max(1, Math.floor(set.length / 60));
  const ds: number[] = [];
  for (let i = 0; i < set.length; i += step) {
    const p = set[i];
    if (p === undefined) continue;
    let first = Infinity;
    let second = Infinity;
    for (const s of seeds) {
      const d = Math.hypot(p.y - s.y, (p.cb - s.cb) * 1.5, (p.cr - s.cr) * 1.5);
      if (d < first) {
        second = first;
        first = d;
      } else if (d < second) second = d;
    }
    if (Number.isFinite(second)) ds.push(second);
  }
  ds.sort((a, b) => a - b);
  return ds[Math.floor(ds.length / 2)] ?? GROWTH_FLOOR;
}


/**
 * ⭐ Cherche le bord de la tête en partant DE LA TÊTE, jamais du fond.
 *
 * ## Pourquoi ceci remplace le balayage depuis le bord de l'image
 *
 * La version précédente modélisait le FOND, échantillonné au bord de l'image, et
 * balayait vers l'intérieur jusqu'au premier objet rencontré. Elle exigeait donc
 * deux choses du client : un mur uni, et sa tête bien centrée. C'est-à-dire
 * qu'elle transformait un problème de mesure en liste de contraintes — et sur la
 * première vraie vidéo elle a trouvé le montant d'une fenêtre à 83 mm de la
 * tempe, puis conclu « ce sont des cheveux ».
 *
 * On ne regarde plus le fond du tout. On part d'une zone dont on sait qu'elle
 * EST la tête — la tempe, sous le repère facial —, on y apprend à quoi
 * ressemblent la peau et les cheveux de CETTE personne dans CETTE lumière, et on
 * progresse vers l'extérieur tant que les pixels leur ressemblent. Le premier
 * décrochage franc est le bord de la tête.
 *
 * Ce que le fond contient devient alors sans importance : mur bleu à pois verts,
 * fenêtre, bibliothèque — on ne le lit jamais.
 */
export function findHeadEdgeByGrowth(s: EdgeSearch & { seedBoxPx?: number }): EdgeResult {
  const { buf, y, fromX, dir } = s;
  if (y < 1 || y >= buf.height - 1) {
    return { x: fromX, confident: false, reason: 'ligne des tempes hors image' };
  }

  const box = s.seedBoxPx ?? SEED_BOX_PX;
  const seedX = Math.round(fromX - dir * SEED_INSET_PX);

  // — Ce à quoi ressemble CETTE tête : peau de la tempe et cheveux au-dessus.
  const seeds: Ycc[] = [];
  for (let dy = -box; dy <= box; dy++) {
    for (let dx = -SEED_HALF_PX; dx <= SEED_HALF_PX; dx++) {
      const p = sample(buf, seedX + dx, y + dy);
      if (p !== null) seeds.push(p);
    }
  }
  if (seeds.length < MIN_SEEDS) {
    return { x: fromX, confident: false, reason: 'zone de référence hors image' };
  }

  // Seuil adaptatif : la dispersion INTERNE de la tête elle-même. Une chevelure
  // contrastée élargit naturellement la tolérance, une peau lisse la resserre.
  const spread = medianDistanceToSet(seeds, seeds);
  const tolerance = Math.max(GROWTH_FLOOR, spread * GROWTH_FACTOR);

  let run = 0;
  let edge: number | null = null;
  const limit = Math.round(fromX + dir * s.maxPx);

  for (let k = 1; ; k++) {
    const x = Math.round(fromX + dir * k);
    if (x < 0 || x >= buf.width) break;
    if (dir > 0 ? x > limit : x < limit) break;

    const p = sample(buf, x, y);
    if (p === null) break;

    if (minDistance(p, seeds) > tolerance) {
      run++;
      if (run >= EDGE_RUN_PX) {
        edge = x - dir * (EDGE_RUN_PX - 1);
        break;
      }
    } else {
      run = 0;
    }
  }

  if (edge === null) {
    // Aucun décrochage dans la fenêtre : la tête déborde plus que prévu, ou le
    // fond ressemble à la peau. On ne conclut pas.
    return {
      x: Math.round(fromX + dir * s.maxPx),
      confident: false,
      reason: 'aucune frontière nette entre votre tête et l’arrière-plan',
    };
  }

  return { x: edge, confident: true, reason: null };
}

