/**
 * core/temporalWidth.ts — l'ÉCART TEMPORAL, mesuré et non deviné.
 *
 * ## Ce qui est en jeu
 *
 * `verdict()` compare la largeur de la monture à celle du visage. Jusqu'ici,
 * « largeur du visage » voulait dire « écartement des repères 234/454 », plus
 * une constante `FACE_WIDTH_CORRECTION_MM` que personne n'a jamais mesurée.
 * La confrontation aux vraies montures a montré que cette constante vaut de
 * l'ordre de 20 mm — quatre à cinq fois le seuil de décision lui-même — et
 * qu'elle varie d'au moins ±4 mm d'un visage à l'autre. Une constante ne peut
 * donc pas faire l'affaire : c'est une grandeur à MESURER sur chaque client.
 *
 * ## Comment
 *
 * L'écart temporal, c'est la largeur de la tête à hauteur des yeux — là où
 * passe la face de la monture. Ce n'est pas dans le maillage facial, c'est à la
 * frontière tête/fond de l'image (`core/silhouette.ts`), convertie en
 * millimètres par une échelle prise AU BON PLAN, c'est-à-dire corrigée de la
 * parallaxe de la carte (`core/parallax.ts`).
 *
 * ## Ce que ce fichier refuse de faire
 *
 * Il ne rend jamais une valeur approximative sans le dire. Cheveux longs devant
 * les tempes, fond chargé, capuche, rotation trop faible : dans tous ces cas il
 * rend `measured: false` avec une raison en clair, et l'appelant retombe sur la
 * mesure par repères. Une largeur fausse d'allure normale est le mode d'échec
 * que tout ce projet combat.
 */

import { at, px, type NormalizedLandmark } from './geom.js';
import { EYE_L, EYE_R, FACE_L, FACE_R } from './faceMetrics.js';
import { findHeadEdgeByGrowth } from './headGrowth.js';
import { type ImageBuffer } from './silhouette.js';
import {
  glassesRefusal,
  MAX_TEMPLE_MARGIN_MM,
  refusal,
  type LineWidth,
} from './temporalRefusals.js';

export {
  GLASSES_STEP_MAX_MM,
  MAX_TEMPLE_ASYMMETRY_MM,
  MAX_TEMPLE_MARGIN_MM,
  MIN_TEMPLE_MARGIN_MM,
} from './temporalRefusals.js';

/** Incertitude de pointage d'un bord de tête, SUR UNE LIGNE, en pixels. */
export const EDGE_NOISE_PX = 4;

/**
 * Nombre de lignes balayées autour de la ligne des tempes, et leur pas.
 *
 * Une seule ligne, c'est un seul pixel de décision par côté : un reflet, une
 * branche de lunette oubliée, un pixel de compression suffisent à la décaler.
 * La médiane de plusieurs lignes est insensible à une ligne aberrante et divise
 * le bruit par √n — c'est ce qui fait passer l'incertitude sous celle de la
 * carte, au lieu de la doubler.
 */
export const EDGE_ROWS = 5;
export const EDGE_ROW_STEP_PX = 3;

/** En deçà, la médiane ne veut plus rien dire : on refuse. */
const MIN_CONFIDENT_ROWS = 3;

export interface TemporalMeasurement {
  /** Largeur aux tempes, en millimètres. À ne lire que si `measured`. */
  widthMm: number;
  /** Incertitude relative propagée jusqu'à CETTE largeur. */
  relError: number;
  /** Débord mesuré de chaque côté, en mm. Diagnostic pour l'humain. */
  marginMm: { left: number; right: number };
  measured: boolean;
  /** Nommée dès que `measured` est faux. Affichable telle quelle. */
  reason: string | null;
}

export interface TemporalInput {
  /** Image de face figée — celle de la carte. */
  frontal: ImageBuffer;
  /** Masque de mouvement issu des vues tournées, ou null si pas de rotation. */
  motion: Uint8Array | null;
  lm: readonly NormalizedLandmark[];
  w: number;
  h: number;
  /** Échelle AU PLAN DES TEMPES, parallaxe déjà corrigée. */
  pxPerMm: number;
  /** Incertitude relative de cette échelle, propagée depuis la carte. */
  scaleRelError: number;
}

interface RowEdge {
  x: number;
  confident: boolean;
  reason: string | null;
  /** Combien de lignes ont réellement conclu. Pilote l'incertitude finale. */
  rows: number;
}

/**
 * Médiane des bords trouvés sur plusieurs lignes autour de la ligne des tempes.
 *
 * Les lignes qui échouent ne sont pas remplacées par une valeur par défaut :
 * elles sont écartées, et s'il en reste trop peu la mesure est refusée.
 */
function medianEdge(
  input: TemporalInput,
  y: number,
  fromX: number,
  dir: -1 | 1,
  maxPx: number,
): RowEdge {
  const xs: number[] = [];
  let lastReason: string | null = null;

  const first = -Math.floor(EDGE_ROWS / 2);
  for (let k = 0; k < EDGE_ROWS; k++) {
    const r = findHeadEdgeByGrowth({
      buf: input.frontal,
      motion: input.motion,
      y: y + (first + k) * EDGE_ROW_STEP_PX,
      fromX,
      dir,
      maxPx,
    });
    if (r.confident) xs.push(r.x);
    else lastReason = r.reason;
  }

  if (xs.length < MIN_CONFIDENT_ROWS) {
    return { x: fromX, confident: false, reason: lastReason ?? 'trop peu de lignes exploitables', rows: xs.length };
  }

  xs.sort((p, q) => p - q);
  const mid = xs[Math.floor(xs.length / 2)] ?? fromX;
  return { x: mid, confident: true, reason: null, rows: xs.length };
}

function widthAtLine(
  input: TemporalInput,
  y: number,
  innerLeft: number,
  innerRight: number,
  windowPx: number,
): LineWidth {
  const left = medianEdge(input, y, innerLeft, -1, windowPx);
  const right = medianEdge(input, y, innerRight, 1, windowPx);
  return {
    left,
    right,
    widthMm: (right.x - left.x) / input.pxPerMm,
    marginMm: {
      left: (innerLeft - left.x) / input.pxPerMm,
      right: (right.x - innerRight) / input.pxPerMm,
    },
  };
}

/**
 * Mesure la largeur de la tête à hauteur des yeux.
 *
 * La ligne de balayage est la moyenne des coins externes des yeux : c'est la
 * hauteur à laquelle passe la face d'une monture, donc la seule qui intéresse
 * un opticien.
 *
 * ⚠️ C'est aussi, très exactement, la hauteur des BRANCHES d'une monture déjà
 * portée — d'où le contrôle des deux lignes ci-dessous.
 */
export function measureTemporalWidth(input: TemporalInput): TemporalMeasurement {
  const { lm, w, h, pxPerMm } = input;

  const eL = px(at(lm, EYE_L), w, h);
  const eR = px(at(lm, EYE_R), w, h);
  const y = Math.round((eL.y + eR.y) / 2);

  const fL = px(at(lm, FACE_L), w, h);
  const fR = px(at(lm, FACE_R), w, h);
  const innerLeft = Math.min(fL.x, fR.x);
  const innerRight = Math.max(fL.x, fR.x);

  const windowPx = MAX_TEMPLE_MARGIN_MM * pxPerMm;

  const eyeLine = widthAtLine(input, y, innerLeft, innerRight, windowPx);
  const { left, right, marginMm, widthMm } = eyeLine;

  const reason =
    refusal(left, right, marginMm) ??
    glassesRefusal(input, y, eyeLine, (line) =>
      widthAtLine(input, line, innerLeft, innerRight, windowPx),
    );
  if (reason !== null) return { widthMm, relError: 1, marginMm, measured: false, reason };

  // Deux bords pointés indépendamment, chacun médian sur `rows` lignes, plus
  // l'échelle : sommes quadratiques. Le √rows n'est pas une faveur qu'on
  // s'accorde — il n'apparaît que parce que les lignes sont bien indépendantes.
  const rows = Math.min(left.rows, right.rows);
  const edgeRel = ((EDGE_NOISE_PX / Math.sqrt(rows)) * Math.SQRT2) / (widthMm * pxPerMm);
  return {
    widthMm,
    relError: Math.hypot(input.scaleRelError, edgeRel),
    marginMm,
    measured: true,
    reason: null,
  };
}
