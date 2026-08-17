/**
 * core/silhouette.ts — trouver le BORD DE LA TÊTE dans l'image.
 *
 * ## Pourquoi ce fichier existe
 *
 * Les repères 234/454 de MediaPipe sont sur le contour du VISAGE, sous les
 * tempes anatomiques. La confrontation aux vraies montures l'a chiffré : ils
 * lisent 115 mm sur un homme adulte dont la monture, mesurée au réglet, fait
 * 136 mm. Aucun repère facial ne donnera jamais cet écart — il est hors du
 * maillage. La largeur aux tempes n'est pas dans les repères : elle est dans
 * les PIXELS, à la frontière tête/fond.
 *
 * ## Ce que la rotation de tête apporte ici
 *
 * Un bord détecté sur une seule image peut être n'importe quoi : un pli du mur,
 * un montant de porte, l'ombre portée. Mais si on demande au client de tourner
 * la tête — ce qu'on lui demande déjà pour la parallaxe (§4, parade B4 n°2) —
 * alors les pixels de la TÊTE bougent et ceux du FOND ne bougent pas. Le
 * masque de mouvement ne sert pas à mesurer : il sert à CONFIRMER que le bord
 * trouvé appartient bien à la tête. Sans cette confirmation, on refuse.
 *
 * ⚠️ Ce fichier ne conclut jamais tout seul. Il rend un bord ET son niveau de
 * confiance ; les seuils en millimètres et la décision d'utiliser ou non la
 * mesure sont dans `core/temporalWidth.ts`.
 */

/**
 * Tampon d'image brut, structurellement compatible avec `ImageData`.
 *
 * Volontairement redéfini ici : `core/` doit rester testable sans DOM et sans
 * le moindre paquet externe.
 *
 * ⚠️ Les variables qui portent ce type ne s'appellent JAMAIS `img`. La chaîne de
 * mesure n'a pas le droit de lire les dimensions d'un fichier image (B3), et le
 * barrage §9.0.g cherche ce préfixe-là dans tout `src/core`. Ce n'est pas une
 * coquetterie de nommage : les dimensions manipulées ici sont celles d'une
 * IMAGE VIDÉO, jamais celles d'un PNG de monture.
 */
export interface ImageBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Écart de luminance à partir duquel un pixel est considéré comme ayant bougé. */
export const MOTION_THRESHOLD = 18;

/** Écart-type maximal toléré sur l'échantillon de fond. Au-delà : fond chargé. */
export const BG_UNIFORMITY_MAX = 16;

/** Largeur, en pixels, de l'échantillon de fond pris au bord de l'image. */
export const BG_SAMPLE_PX = 24;

/** Un bord n'est un bord que s'il est suivi de plusieurs pixels non-fond. */
export const EDGE_RUN_PX = 4;

/** Écart maximal toléré entre le bord colorimétrique et le bord de mouvement. */
export const MOTION_AGREEMENT_PX = 14;

/** Combien d'écarts-types au-dessus du fond pour qu'un pixel cesse d'être du fond. */
const BG_SIGMA = 3;

/** Plancher de tolérance : un fond parfaitement uni ne doit pas rendre tout « objet ». */
const BG_FLOOR = 10;

export function offset(buf: ImageBuffer, x: number, y: number): number {
  return (y * buf.width + x) * 4;
}

/** Luminance perceptuelle, en 0..255. */
export function luma(buf: ImageBuffer, x: number, y: number): number {
  const i = offset(buf, x, y);
  const r = buf.data[i] ?? 0;
  const g = buf.data[i + 1] ?? 0;
  const b = buf.data[i + 2] ?? 0;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Masque des pixels qui ont bougé entre l'image de face et les vues tournées.
 *
 * 1 = a bougé (donc : appartient à la tête, ou à ce qu'elle a découvert),
 * 0 = immobile (donc : fond).
 */
export function motionMask(base: ImageBuffer, others: readonly ImageBuffer[]): Uint8Array {
  const mask = new Uint8Array(base.width * base.height);
  for (const other of others) {
    if (other.width !== base.width || other.height !== base.height) continue;
    for (let y = 0; y < base.height; y++) {
      for (let x = 0; x < base.width; x++) {
        if (mask[y * base.width + x] === 1) continue;
        if (Math.abs(luma(base, x, y) - luma(other, x, y)) > MOTION_THRESHOLD) {
          mask[y * base.width + x] = 1;
        }
      }
    }
  }
  return mask;
}

export interface EdgeResult {
  /** Abscisse du bord de tête, en pixels image. Toujours renseignée. */
  x: number;
  /** Faux si la mesure ne mérite pas d'être utilisée. La raison est nommée. */
  confident: boolean;
  reason: string | null;
}

export interface EdgeSearch {
  buf: ImageBuffer;
  /** Masque de `motionMask`, ou null si la rotation n'a pas été faite. */
  motion: Uint8Array | null;
  /** Ligne de balayage : la hauteur des tempes, prise sur les coins des yeux. */
  y: number;
  /** Point de départ : le repère 234 ou 454, d'où l'on part vers l'extérieur. */
  fromX: number;
  /** −1 vers la gauche de l'image, +1 vers la droite. */
  dir: -1 | 1;
  /**
   * Débord maximal attendu au-delà du repère, en pixels.
   *
   * ⚠️ Ce n'est PAS une borne de balayage — le balayage va toujours jusqu'au
   * repère, sinon une chevelure plus large que la fenêtre passerait inaperçue
   * au lieu d'être refusée. C'est la marge qui garantit que l'échantillon de
   * fond, pris au bord de l'image, ne tombe pas sur la tête elle-même.
   */
  maxPx: number;
}

/**
 * Cherche la frontière tête/fond sur une ligne, en partant DU FOND vers la tête.
 *
 * ⚠️ Conservée pour les scènes à fond parfaitement uni, où elle reste plus
 * précise. Le chemin nominal est `findHeadEdgeByGrowth`, qui ne suppose rien
 * de l'arrière-plan.
 *
 * ⚠️ Le sens de parcours n'est pas un détail. En partant du repère vers
 * l'extérieur, la première mèche de cheveux, un reflet de lunette ou une ombre
 * arrêtent le balayage trop tôt et on sous-estime — silencieusement. En partant
 * du bord de l'image vers l'intérieur, on trouve le premier objet rencontré,
 * qui est la tête : les trous dans les cheveux ne peuvent plus tromper.
 */
export function findHeadEdge(s: EdgeSearch): EdgeResult {
  const { buf, y, fromX, dir } = s;
  if (y < 0 || y >= buf.height) {
    return { x: fromX, confident: false, reason: 'ligne des tempes hors image' };
  }

  const stop = Math.max(0, Math.min(buf.width - 1, Math.round(fromX)));
  const border = dir > 0 ? buf.width - 1 : 0;

  // Le cadrage doit laisser du fond au-delà du débord attendu, sinon
  // l'échantillon « de fond » serait pris sur la tête et tout s'effondrerait.
  if (Math.abs(border - stop) < s.maxPx + BG_SAMPLE_PX) {
    return { x: stop, confident: false, reason: 'cadrage trop serré : reculez un peu' };
  }

  // — Modèle de fond, pris au bord de l'image sur cette même ligne.
  const samples: number[] = [];
  for (let k = 0; k < BG_SAMPLE_PX; k++) {
    const x = border - dir * k;
    if (x < 0 || x >= buf.width) break;
    samples.push(luma(buf, x, y));
  }
  if (samples.length < BG_SAMPLE_PX) {
    return { x: stop, confident: false, reason: 'pas de fond visible sur cette ligne' };
  }

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  const sigma = Math.sqrt(variance);
  if (sigma > BG_UNIFORMITY_MAX) {
    return {
      x: stop,
      confident: false,
      reason: 'le fond derrière vous est trop chargé pour distinguer votre tête',
    };
  }
  const tolerance = Math.max(BG_FLOOR, BG_SIGMA * sigma);

  // — Balayage du bord de l'image vers le repère : premier objet rencontré.
  let run = 0;
  let edge: number | null = null;
  for (let x = border; dir > 0 ? x >= stop : x <= stop; x -= dir) {
    if (Math.abs(luma(buf, x, y) - mean) > tolerance) {
      run++;
      if (run >= EDGE_RUN_PX) {
        edge = x + dir * (EDGE_RUN_PX - 1);
        break;
      }
    } else {
      run = 0;
    }
  }
  if (edge === null) {
    return { x: stop, confident: false, reason: 'aucun bord de tête net sur cette ligne' };
  }

  // — Confirmation par le mouvement : CE bord a-t-il bougé avec la tête ?
  //
  // ⚠️ La question n'est pas « ce bord est-il le pixel mobile le plus
  // extérieur ». Une première version le demandait, et elle refusait toute
  // vraie prise de vue : pendant une rotation à main levée, la tête TRANSLATE
  // aussi, si bien que la zone balayée déborde largement la silhouette d'une
  // image donnée. Le masque est alors bien plus large que la tête, sans que
  // rien ne soit faux.
  //
  // Ce qu'on veut savoir est plus modeste et plus juste : ce bord appartient-il
  // à quelque chose qui a bougé ? Un montant de porte, lui, n'aura pas bougé.
  if (s.motion !== null) {
    let moved = false;
    for (let k = -MOTION_AGREEMENT_PX; k <= MOTION_AGREEMENT_PX && !moved; k++) {
      const x = edge + k;
      if (x >= 0 && x < buf.width && s.motion[y * buf.width + x] === 1) moved = true;
    }
    if (!moved) {
      return {
        x: edge,
        confident: false,
        reason: 'ce bord n’a pas bougé pendant la rotation — objet ou ombre, pas votre tête',
      };
    }
  }

  return { x: edge, confident: true, reason: null };
}
