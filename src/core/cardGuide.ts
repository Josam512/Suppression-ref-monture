/**
 * core/cardGuide.ts — le cadre affiché À L'ÉCRAN, et le verrouillage automatique.
 *
 * ## Le renversement, et pourquoi il vaut mieux qu'une détection
 *
 * L'ancien parcours demandait au client de **traîner un rectangle sur la carte**.
 * Lent, fastidieux, et c'était le seul geste long de la calibration.
 *
 * Trois tentatives de détection automatique ont échoué sur une vraie photo :
 * rectangles candidats notés au rapport ISO (36 % d'erreur d'échelle), contours
 * fermés à la mode « scanner de document » (0 candidat — le contour de la carte
 * n'est pas fermé sur un front éclairé), assemblage de segments de droite
 * (57 % d'erreur). La cause commune : sur un visage, **la lisière des cheveux
 * est un bord plus franc que la carte**.
 *
 * D'où le renversement, qui est celui de tous les scanners de carte en
 * production : au lieu de chercher où est la carte, **on dit où la mettre**.
 * L'app affiche un cadre au rapport ISO, le client avance ou recule la tête
 * jusqu'à ce que la carte le remplisse.
 *
 * 🔴 Le point clé : **le cadre EST la graine de l'accrochage**. On n'a donc plus
 * rien à détecter — `refineQuad` part du cadre et ne converge que si la carte
 * est réellement là. Le geste du client et la mesure sont le même acte.
 *
 * Bénéfice secondaire : remplir un cadre de taille fixe **fixe la distance**.
 * Une inconnue disparaît au lieu de s'ajouter.
 */

import type { Pt } from './geom.js';
import { luma, type ImageBuffer } from './silhouette.js';
import { CARD_H_MM, CARD_W_MM, type CardQuad } from './cardPose.js';

/** Fraction de la largeur de l'image occupée par le cadre. */
export const GUIDE_WIDTH_RATIO = 0.55;

/**
 * Écart maximal admis entre un coin accroché et le coin du cadre, en fraction
 * de la largeur du cadre.
 *
 * ⚠️ Ce n'est PAS une tolérance de mesure : l'accrochage sous-pixel a déjà fait
 * son travail quand on arrive ici. C'est la porte du geste — « la carte est-elle
 * dans le cadre ? ». Trop serrée, le client n'y arrive jamais ; trop lâche, on
 * verrouille sur autre chose que la carte.
 */
export const GUIDE_TOLERANCE_RATIO = 0.06;

/**
 * Nombre d'images consécutives conformes avant de verrouiller.
 *
 * ⚠️ Non nul, et c'est délibéré. À 30 images/s, trois images font un dixième de
 * seconde — imperceptible pour le client, mais suffisant pour qu'un reflet ou
 * une image floue de passage ne déclenche pas la mesure. « Instantané » ne veut
 * pas dire « sur la première image venue ».
 */
export const LOCK_FRAMES = 3;

/**
 * ⚠️ DÉFAUT CONNU, trouvé sur la vidéo réelle du sujet : ce cadre est centré
 * dans l'IMAGE, donc sur les yeux. La carte, elle, est posée en HAUT DU FRONT.
 * Les deux ne se croisent jamais, et rien ne peut verrouiller.
 *
 * 🔴 Le placement doit venir des REPÈRES DU VISAGE — milieu du front, entre les
 * sourcils et la naissance des cheveux — pas du centre de l'image. Tant que ce
 * n'est pas fait, cette fonction ne doit pas être branchée dans l'application.
 */
/** Cadre au rapport ISO, centré dans l'image. Coins dans l'ordre de `CardQuad`. */
export function guideQuad(imageWidthPx: number, imageHeightPx: number): CardQuad {
  const w = GUIDE_WIDTH_RATIO * imageWidthPx;
  const h = (w * CARD_H_MM) / CARD_W_MM;
  const cx = imageWidthPx / 2;
  const cy = imageHeightPx / 2;
  return [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
  ];
}

/** Largeur du cadre, en pixels. */
export function guideWidthPx(imageWidthPx: number): number {
  return GUIDE_WIDTH_RATIO * imageWidthPx;
}

/**
 * Bords qui doivent avoir été accrochés sur les PIXELS pour verrouiller.
 *
 * 🔴 Quatre sur quatre, et c'est le cœur du garde-fou. Une première version
 * comparait seulement les coins accrochés à ceux du cadre — contrôle
 * CIRCULAIRE, puisque `refineQuad` contraint déjà sa sortie à rester près de sa
 * graine, qui est le cadre. Il ne pouvait pas échouer, et il verrouillait sur
 * une carte deux fois trop petite. Seul le compte de bords réellement mesurés
 * dit que la carte est là.
 */
export const REQUIRED_MEASURED_EDGES = 4;

/**
 * Marche de luminance minimale, de part et d'autre de CHAQUE bord du cadre.
 *
 * 🔴 C'est le seul contrôle NON CIRCULAIRE du fichier, et il a fallu deux
 * essais ratés pour le comprendre. Comparer les coins accrochés au cadre ne
 * peut pas échouer, puisque `refineQuad` contraint déjà sa sortie à rester près
 * de sa graine. Compter les bords « mesurés » ne suffit pas non plus : du grain
 * de peau fournit assez de gradient pour qu'une droite s'y ajuste.
 *
 * Ici on ne cherche rien : on lit les pixels DE PART ET D'AUTRE du cadre, qui
 * est fixe. Si la carte le remplit, il y a une marche franche sur les quatre
 * bords. Si elle est trop petite, le bord du cadre tombe sur du front nu, et il
 * n'y a pas de marche. Aucune boucle possible.
 */
export const MIN_GUIDE_EDGE_STEP = 14; // ⚠️ PROVISOIRE — voir ci-dessous.

/*
 * ⚠️ VALEUR NON VALIDÉE, même discipline que FACE_WIDTH_CORRECTION_MM (§5).
 *
 * Mesurée sur la photo réelle du sujet, la marche culmine à **34,6** très
 * exactement là où la carte remplit le cadre (zoom 0,77 = 396 px de cadre pour
 * 512,8 px de carte), contre ~10 partout ailleurs. Le signal existe et sépare
 * d'un facteur 3 — mais 14 est un seuil choisi à la main entre ces deux
 * valeurs, sur UNE photo.
 *
 * 🔴 Il doit être figé depuis une vraie séquence webcam, pas depuis une
 * simulation. Ne pas l'ajuster pour faire passer un test : ce serait très
 * exactement le « régler jusqu'à ce que ça tombe juste » que ce dépôt combat.
 */

/** Distance d'échantillonnage de part et d'autre du bord, en px. */
const PROBE_PX = 6;

/**
 * Marche de luminance du bord le PLUS FAIBLE du cadre.
 *
 * Le minimum, jamais la moyenne : une carte a quatre bords. Un cadre posé à
 * cheval sur une lisière de cheveux en a un fort et trois faibles, et la
 * moyenne le sauverait.
 */
export function guideEdgeStep(buf: ImageBuffer, guide: CardQuad): number {
  let worst = Infinity;
  for (let e = 0; e < 4; e++) {
    const a = guide[e] as Pt;
    const b = guide[(e + 1) % 4] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) return 0;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    let sum = 0;
    let n = 0;
    for (let i = 1; i < 24; i++) {
      const t = i / 24;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      const inside = luma(buf, Math.round(px - nx * PROBE_PX), Math.round(py - ny * PROBE_PX));
      const outside = luma(buf, Math.round(px + nx * PROBE_PX), Math.round(py + ny * PROBE_PX));
      sum += Math.abs(outside - inside);
      n++;
    }
    worst = Math.min(worst, sum / n);
  }
  return worst;
}

export interface GuideCheck {
  /** Écart du PIRE coin, en pixels. C'est lui qui décide, jamais la moyenne. */
  worstOffsetPx: number;
  /** 0 = très loin du cadre, 1 = dedans. Sert à la jauge affichée. */
  fill: number;
  /** Vrai si les quatre bords ont parlé ET que les coins sont dans la tolérance. */
  ok: boolean;
}

/**
 * La carte accrochée est-elle dans le cadre ?
 *
 * ⚠️ On regarde le PIRE coin, jamais la moyenne : une carte alignée sur trois
 * coins et décalée sur le quatrième est une carte de travers, et la moyenne la
 * laisserait passer.
 *
 * @param measured bords réellement accrochés sur les pixels (`refineQuadDetailed`).
 */
export function checkCardInGuide(
  snapped: CardQuad,
  guide: CardQuad,
  measured: number,
  edgeStep: number,
): GuideCheck {
  const w = Math.hypot(guide[1].x - guide[0].x, guide[1].y - guide[0].y);
  const tol = GUIDE_TOLERANCE_RATIO * w;

  let worst = 0;
  for (let i = 0; i < 4; i++) {
    const s = snapped[i] as Pt;
    const g = guide[i] as Pt;
    worst = Math.max(worst, Math.hypot(s.x - g.x, s.y - g.y));
  }
  const enough = measured >= REQUIRED_MEASURED_EDGES && edgeStep >= MIN_GUIDE_EDGE_STEP;
  return {
    worstOffsetPx: worst,
    // La jauge montre les DEUX conditions : sans les quatre bords, elle plafonne.
    // La jauge reflète les TROIS conditions, pour que le client comprenne ce qui
    // manque : la position, le contraste au bord, et les bords réellement lus.
    fill:
      Math.max(0, Math.min(1, 1 - worst / (3 * tol))) *
      Math.min(1, edgeStep / MIN_GUIDE_EDGE_STEP) *
      Math.min(1, measured / REQUIRED_MEASURED_EDGES),
    ok: enough && worst <= tol,
  };
}

/**
 * Compteur d'images consécutives conformes.
 *
 * Remis à zéro dès qu'une image ne l'est pas : on ne cumule pas des instants
 * épars, on exige une pose tenue — même très brièvement.
 */
export class GuideLock {
  private streak = 0;

  /** @returns true à l'image EXACTE où le verrouillage est atteint. */
  push(ok: boolean): boolean {
    if (!ok) {
      this.streak = 0;
      return false;
    }
    this.streak++;
    return this.streak === LOCK_FRAMES;
  }

  get progress(): number {
    return Math.min(1, this.streak / LOCK_FRAMES);
  }

  reset(): void {
    this.streak = 0;
  }
}
