/**
 * core/cardGuideLock.ts — la carte remplit-elle le cadre, et depuis quand ?
 *
 * Scindé de `core/cardGuide.ts`, qui ne garde que la GÉOMÉTRIE du cadre. La
 * couture est réelle et pas administrative : d'un côté « où dessiner le cadre »,
 * de l'autre « les pixels disent-ils qu'une carte est dedans ». Le premier ne
 * lit aucune image ; le second ne place rien.
 *
 * 🔴 Les deux contrôles de ce fichier ont coûté deux essais ratés chacun. Lire
 * les commentaires avant d'y toucher : le mode d'échec est la CIRCULARITÉ, et il
 * ne se voit pas — un contrôle circulaire est toujours vert.
 */

import type { Pt } from './geom.js';
import { luma, type ImageBuffer } from './silhouette.js';
import type { CardQuad } from './cardPose.js';

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
 * ⚠️ Non nul, et délibérément. À 30 images/s, trois images font un dixième de
 * seconde — imperceptible, mais suffisant pour qu'un reflet ou une image floue
 * ne déclenche pas la mesure. « Instantané » ≠ « sur la première image venue ».
 */
export const LOCK_FRAMES = 3;

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
export const MIN_GUIDE_EDGE_STEP = 14;

/*
 * ✅ FIGÉE LE 2026-08-17, sur la séquence webcam réelle du sujet.
 * 179 images, 1080×1920, visage détecté sur 100 % d'entre elles.
 *
 * Les deux distributions ont été mesurées séparément, avec CETTE fonction, sur
 * ces images-là (`tests/guide-on-video.ts`) :
 *
 * | Grandeur | Comment | Valeur |
 * |---|---|---|
 * | Plafond du FOND — cadre posé sur peau nue, aucune carte dedans | 179 images | **7,6** |
 * | Médiane du SIGNAL — min sur les 4 bords d'une carte accrochée 4/4 | 9 images | **27,0** |
 *
 * Le seuil est placé à leur **moyenne géométrique**, `√(7,6 × 27,0) = 14,29`,
 * c'est-à-dire au même facteur (×1,84) au-dessus du bruit qu'en dessous du
 * signal. Ce n'est pas un nombre choisi pour faire passer quoi que ce soit :
 * `tests/guide.test.ts` verrouille la règle et rougit si la valeur sort de
 * l'intervalle mesuré.
 *
 * ⚠️ Cette estimation est CONSERVATRICE, et il faut savoir pourquoi. Dans cette
 * séquence la carte est calée contre les cheveux : son bord haut est sombre sur
 * sombre, et comme on retient le minimum des quatre bords, c'est lui qui fixe le
 * signal. À hauteur des yeux — la consigne désormais donnée au client — les
 * quatre bords tombent sur de la peau, et les bords latéraux mesurés ici
 * atteignent 54,6 en médiane. Le vrai signal sera donc plus fort que 27, jamais
 * plus faible. Le seuil ne peut se tromper que dans le sens prudent.
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
