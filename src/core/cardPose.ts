/**
 * core/cardPose.ts — la carte ne donne pas une échelle, elle donne la CAMÉRA.
 *
 * ## Ce que ce fichier corrige, et pourquoi c'était grave
 *
 * Jusqu'ici la carte n'était lue que comme une règle à plat : deux bords, une
 * largeur en pixels, une échelle en px/mm — et c'est tout. Tout le reste de la
 * chaîne devait alors DEVINER ce que la carte contenait déjà :
 *
 *   - la distance caméra, posée à 780 mm ± 17 % « parce que l'application
 *     impose cette fenêtre » ;
 *   - le dernier tronçon jusqu'au plan des tempes, posé par l'anatomie.
 *
 * Or un rectangle de dimensions NORMALISÉES vu en perspective est une mire de
 * calibration. Ses quatre coins donnent une homographie, et une homographie
 * donne la focale — donc la distance en millimètres, et la pose complète de la
 * carte dans l'espace. Il n'y a rien à demander de plus au client : il a déjà
 * mis l'objet devant l'objectif.
 *
 * ## Pourquoi il fallait un feu vert humain, et où il est
 *
 * 🔴 Le §4 met en garde : « la mesure multi-vues est la porte d'entrée la plus
 * plausible pour de la 3D introduite logiquement... si une tâche future invoque
 * cette section pour justifier un solveur de pose 3D, elle contredit le contrat :
 * s'arrêter et demander à l'humain. » Je m'arrête donc et je le signale : ce
 * fichier EST un solveur de pose. Il entre sur arbitrage explicite du 2026-08-17
 * (§14.5) : « du moment que la personne a mis une carte bancaire devant toi, tu
 * connais les mesures de la carte, il n'y a plus rien d'autre à demander ».
 *
 * Ce qui reste interdit n'a pas bougé d'un pouce : aucun maillage, aucun rendu
 * 3D, aucune bibliothèque de géométrie. Le rendu reste du sprite 2D sur canvas
 * (§0). On extrait des SCALAIRES — une focale, une distance, une pose — par de
 * l'algèbre linéaire écrite ici, en clair, et testable.
 */

import { CalibrationError, type Pt } from './geom.js';

/** Norme ISO/IEC 7810 ID-1. */
export const CARD_W_MM = 85.6;
export const CARD_H_MM = 53.98;

/**
 * Les quatre coins de la carte à l'écran, dans l'ordre : haut-gauche,
 * haut-droit, bas-droit, bas-gauche. C'est exactement ce que le client ajuste
 * déjà (§4 : « un rectangle redimensionnable apparaît »), à ceci près qu'on en
 * lit maintenant les quatre sommets au lieu de deux bords.
 */
export type CardQuad = readonly [Pt, Pt, Pt, Pt];

/** Coins du modèle, en millimètres, dans le plan de la carte (z = 0). */
const MODEL: CardQuad = [
  { x: -CARD_W_MM / 2, y: -CARD_H_MM / 2 },
  { x: CARD_W_MM / 2, y: -CARD_H_MM / 2 },
  { x: CARD_W_MM / 2, y: CARD_H_MM / 2 },
  { x: -CARD_W_MM / 2, y: CARD_H_MM / 2 },
];

/**
 * Inclinaison minimale exigée de la carte, en « pixels de fuite ».
 *
 * 🔴 Une carte vue parfaitement de face ne dit RIEN de la focale : son
 * homographie est alors une simple similitude, les deux termes de fuite sont
 * nuls, et `f²` sort d'un rapport 0/0. C'est le mode de défaillance à ne
 * surtout pas laisser passer en silence — il rendrait une focale absurde avec
 * l'air d'une mesure. Il faut de la PERSPECTIVE, donc de l'inclinaison.
 *
 * Le front en fournit naturellement : il est incliné vers l'arrière, et il
 * tourne pendant le balayage. Mais on le vérifie au lieu de l'espérer.
 */
export const MIN_PERSPECTIVE = 0.004;

/** Bornes de plausibilité de la focale, en fraction de la largeur d'image. */
export const FOCAL_MIN_REL = 0.4; // très grand angle
export const FOCAL_MAX_REL = 4.0; // téléobjectif improbable sur une webcam

/**
 * Résout `A x = b` par élimination de Gauss avec pivot partiel.
 * Écrit ici plutôt qu'importé : c'est huit lignes de dépendance en moins (§9.1-8).
 */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] ?? 0]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]?.[col] ?? 0) > Math.abs(m[pivot]?.[col] ?? 0)) pivot = r;
    }
    const pr = m[pivot];
    const cr = m[col];
    if (pr === undefined || cr === undefined) throw new CalibrationError('Système singulier.');
    m[pivot] = cr;
    m[col] = pr;

    const head = m[col]?.[col] ?? 0;
    if (Math.abs(head) < 1e-12) {
      throw new CalibrationError(
        `Les quatre coins de la carte sont alignés ou confondus. Réajustez le cadre.`,
      );
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = (m[r]?.[col] ?? 0) / head;
      for (let c = col; c <= n; c++) {
        const row = m[r];
        const src = m[col];
        if (row === undefined || src === undefined) continue;
        row[c] = (row[c] ?? 0) - factor * (src[c] ?? 0);
      }
    }
  }

  return Array.from({ length: n }, (_, i) => (m[i]?.[n] ?? 0) / (m[i]?.[i] ?? 1));
}

/** Homographie modèle (mm) → image (px), normalisée par h33 = 1. */
export type Homography = readonly number[]; // 9 coefficients, ligne par ligne

/**
 * Homographie par DLT à partir des quatre coins.
 *
 * Quatre correspondances donnent huit équations pour huit inconnues : le
 * système est exactement déterminé, aucune moindre-carré n'est nécessaire.
 */
export function homographyFromQuad(quad: CardQuad): Homography {
  const a: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const X = MODEL[i]?.x ?? 0;
    const Y = MODEL[i]?.y ?? 0;
    const u = quad[i]?.x ?? 0;
    const v = quad[i]?.y ?? 0;
    a.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]);
    b.push(u);
    a.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]);
    b.push(v);
  }

  return [...solveLinear(a, b), 1];
}

export interface CameraFromCard {
  /** Focale en pixels. MESURÉE, pas déduite d'un champ de vision supposé. */
  focalPx: number;
  /** Écart relatif entre les DEUX estimations indépendantes de la focale. */
  focalSpread: number;
  /** Distance caméra ↔ CENTRE DE LA CARTE, en millimètres. */
  cardDistanceMm: number;
}

/**
 * Focale et distance, depuis une seule vue de la carte.
 *
 * ## D'où sort la focale
 *
 * En coordonnées image CENTRÉES sur le point principal, avec des pixels carrés,
 * les deux premières colonnes de l'homographie sont les images de deux vecteurs
 * du plan de la carte qui sont **orthogonaux et de même longueur** — parce que
 * la carte est un rectangle, et qu'on connaît ses cotes. Ces deux faits
 * s'écrivent :
 *
 *     (h11·h12 + h21·h22)/f² + h31·h32 = 0                    (orthogonalité)
 *     (h11² + h21² − h12² − h22²)/f² + h31² − h32² = 0        (même longueur)
 *
 * Chacune donne `f²`. Une seule vue suffit donc — et on en obtient DEUX
 * estimations indépendantes, dont l'écart est un contrôle de cohérence gratuit,
 * dans l'esprit du contrôle à trois cotes du §4.
 *
 * @param quad les quatre coins, en pixels image (origine au coin de l'image).
 * @param w largeur de l'image, pour centrer les coordonnées et borner la focale.
 * @param h hauteur de l'image.
 */
export function cameraFromCard(quad: CardQuad, w: number, h: number): CameraFromCard {
  const centred: CardQuad = [
    { x: (quad[0]?.x ?? 0) - w / 2, y: (quad[0]?.y ?? 0) - h / 2 },
    { x: (quad[1]?.x ?? 0) - w / 2, y: (quad[1]?.y ?? 0) - h / 2 },
    { x: (quad[2]?.x ?? 0) - w / 2, y: (quad[2]?.y ?? 0) - h / 2 },
    { x: (quad[3]?.x ?? 0) - w / 2, y: (quad[3]?.y ?? 0) - h / 2 },
  ];
  const H = homographyFromQuad(centred);

  const [h11, h12, , h21, h22, , h31, h32] = H as [
    number, number, number, number, number, number, number, number, number,
  ];

  const orthoNum = -(h11 * h12 + h21 * h22);
  const orthoDen = h31 * h32;
  const normNum = -(h11 * h11 + h21 * h21 - h12 * h12 - h22 * h22);
  const normDen = h31 * h31 - h32 * h32;

  // 🔴 Carte trop frontale : on refuse au lieu de rendre un 0/0 déguisé en mesure.
  //
  // La grandeur qui compte n'est pas `h31` seul — il a des unités — mais le
  // RACCOURCI que la perspective produit d'un bord à l'autre de la carte,
  // exprimé en fraction. C'est lui qui porte l'information, et lui seul.
  const perspective =
    (Math.abs(h31) * CARD_W_MM) / 2 + (Math.abs(h32) * CARD_H_MM) / 2;
  if (perspective < MIN_PERSPECTIVE) {
    throw new CalibrationError(
      `La carte est vue trop de face pour donner la distance : sans perspective, ` +
        `un rectangle ne dit rien de l'objectif. Inclinez-la légèrement, ou tournez la tête.`,
    );
  }

  // Chaque estimation n'est retenue que si SON dénominateur est significatif.
  // De face, `h31 ≈ 0` : le terme d'orthogonalité devient 0/0 et doit sortir,
  // pendant que celui d'égalité des longueurs, lui, reste parfaitement défini.
  const denScale = (Math.abs(h31) + Math.abs(h32)) ** 2;
  const usable = (num: number, den: number): boolean =>
    Math.abs(den) > 0.05 * denScale && num / den > 0;

  const candidates: number[] = [];
  if (usable(orthoNum, orthoDen)) candidates.push(orthoNum / orthoDen);
  if (usable(normNum, normDen)) candidates.push(normNum / normDen);
  if (candidates.length === 0) {
    throw new CalibrationError(
      `Les quatre coins de la carte ne forment pas une perspective cohérente. ` +
        `Vérifiez que le cadre suit bien les bords, coin par coin.`,
    );
  }

  const f2 = candidates.reduce((s, x) => s + x, 0) / candidates.length;
  const focalPx = Math.sqrt(f2);
  const focalSpread =
    candidates.length === 2
      ? Math.abs(Math.sqrt(candidates[0] ?? 0) - Math.sqrt(candidates[1] ?? 0)) / focalPx
      : Number.NaN;

  if (focalPx < FOCAL_MIN_REL * w || focalPx > FOCAL_MAX_REL * w) {
    throw new CalibrationError(
      `Objectif mesuré à ${(focalPx / w).toFixed(2)} × la largeur d'image, hors de tout ` +
        `plausible. Le cadre a probablement été mal ajusté sur les bords de la carte.`,
    );
  }

  // Pose : λ normalise la première colonne, et t est la translation en mm.
  // On ne garde que t_z — la distance. La rotation de la carte n'intéresse
  // personne ici, et le contrat n'autorise pas à l'exploiter.
  const kInv = (a: number, b: number, c: number): [number, number, number] => [
    a / focalPx,
    b / focalPx,
    c,
  ];
  const c1 = kInv(h11, h21, h31);
  const lambda = 1 / Math.hypot(c1[0], c1[1], c1[2]);
  const cardDistanceMm = lambda * (H[8] ?? 1);

  return { focalPx, focalSpread, cardDistanceMm };
}
