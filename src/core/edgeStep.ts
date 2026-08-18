/**
 * core/edgeStep.ts — « y a-t-il vraiment un bord ici ? », mesuré dans les pixels.
 *
 * ⚠️ Ce fichier vient de `core/cardGuideLock.ts`, supprimé avec le cadre à
 * remplir (arbitrage du 2026-08-18). Les noms gardent le préfixe `guide` parce
 * que la valeur du seuil a été FIGÉE sur des mesures faites avec ce cadre-là :
 * renommer couperait le chiffre de sa justification.
 *
 * 🔴 Ce n'est plus un contrôle de passage. Rien, dans l'application, ne refuse
 * quoi que ce soit sur ce critère — le client n'a aucune barre à franchir, et
 * c'est précisément ce que l'arbitrage a tranché. La mesure reste ici parce
 * qu'elle est le seul contrôle NON CIRCULAIRE que le projet ait établi sur des
 * bords de carte, et que l'atelier s'en sert pour comparer des tentatives de
 * détection entre elles (`tests/cardFind.atelier.ts`).
 */

import type { Pt } from './geom.js';
import { luma, type ImageBuffer } from './silhouette.js';
import type { CardQuad } from './cardPose.js';

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
