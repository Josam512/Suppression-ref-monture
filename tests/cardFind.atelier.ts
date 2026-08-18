/**
 * tests/cardFind.atelier.ts — QUATRIÈME tentative de détection automatique.
 *
 * 🔴 **ELLE A ÉCHOUÉ. Ce fichier ne vit plus dans `src/` et ne doit pas y
 * remonter.** Il est conservé pour que personne ne refasse une cinquième fois
 * la même chose — avec ci-dessous ce qui a été essayé, ce qui a marché, et
 * l'endroit exact où ça casse.
 *
 * ## Verdict mesuré, sur la vidéo réelle du sujet (179 images, 1080×1920)
 *
 * | Indicateur | Valeur | Lecture |
 * |---|---|---|
 * | Images où quelque chose est trouvé | 31 / 179 | maigre |
 * | Bords accrochés au sous-pixel | 25 à 4/4 | l'ajout de l'inclinaison a bien réglé ça |
 * | **Rapport carte / visage** | **dispersion 22,3 %** | 🔴 **rédhibitoire** |
 *
 * Le dernier indicateur est le seul qui compte, et il est non circulaire : le
 * sujet avance et recule, donc les deux largeurs varient ensemble et leur
 * rapport doit rester constant. À 22 % de dispersion, ce qui est mesuré n'est
 * pas la carte. La planche d'images le confirme à l'œil : les rectangles fautifs
 * sont penchés de 25 à 30° et posés sur la **lisière des cheveux**.
 *
 * ## La cause, et pourquoi elle n'est pas contournable par un réglage
 *
 * Le sujet cale la carte contre ses cheveux. Le bord HAUT de la carte est donc
 * violet foncé sur brun foncé : **il n'a presque pas de contraste**. Le score
 * prend le minimum des quatre bords — à raison, une carte en a quatre — et ce
 * minimum est faible pour la vraie carte, fort pour un rectangle qui emprunte la
 * lisière. La bonne réponse est structurellement moins bien notée que la
 * mauvaise. Aucun seuil ne renverse ça.
 *
 * C'est la même cause que les trois tentatives précédentes, et elle survit à la
 * restriction au front : **la lisière traverse le front**, la frange descend
 * dedans. Restreindre la zone était nécessaire, et insuffisant.
 *
 * ## Ce qu'il faut en retenir, et qui a servi
 *
 * ⭐ **La carte NE SUIT PAS l'inclinaison de la tête.** Elle est tenue à la main
 * et penche de plusieurs degrés. Le contrat écrivait « posée à plat sur le
 * front » et le code en déduisait le roll du visage : verrouillé dessus,
 * l'accrochage sous-pixel rendait `measured = 0` sur 40 images trouvées sur 42,
 * en affichant une belle marche de luminance. Le score semblait bon, la
 * géométrie était fausse. Ce constat vaut aussi pour le cadre à remplir.
 *
 * ⭐ **Et il plaide pour le cadre.** Si la consigne place la carte au MILIEU du
 * front, ses quatre bords tombent sur de la peau et ont tous du contraste. Le
 * problème n'est pas de détecter une carte : c'est qu'elle avait été posée à
 * l'endroit le moins mesurable du visage.
 *
 * ---
 * Ce qui suit est le code tel qu'il a été mesuré, inchangé.
 *
 * ## Pourquoi une quatrième tentative après trois échecs
 *
 * Trois détections avaient été essayées et abandonnées : rectangles candidats
 * notés au rapport ISO (36 % d'erreur d'échelle), contours fermés à la mode
 * « scanner de document » (0 candidat), assemblage de segments de droite
 * (57 % d'erreur). Le journal en avait conclu « la détection automatique ne
 * marche pas », avec pour cause commune : *la lisière des cheveux est un bord
 * plus franc que la carte*.
 *
 * 🔴 Cette conclusion était trop large, et c'est une faute de méthode. Les trois
 * essais tournaient sur **l'image entière**, sans rien exploiter de ce qu'on
 * sait déjà. Or on connaît 478 points de visage : **on sait où est la lisière
 * des cheveux**, et on peut simplement ne pas la regarder. Ce qui a été démontré,
 * c'est que la vision classique échoue sur le problème NON CONTRAINT — pas
 * qu'elle échoue ici.
 *
 * Quatre contraintes, toutes tirées de faits déjà établis, aucune inventée :
 *
 * | Contrainte | D'où elle vient | Ce qu'elle élimine |
 * |---|---|---|
 * | Zone limitée au front | sourcils (105/334) ↔ lisière (10) | les cheveux, les sourcils, les yeux |
 * | Inclinaison = celle de la tête | la carte est posée à plat dessus | trois degrés de liberté sur quatre |
 * | Rapport largeur/hauteur = ISO 7810 | la norme | tout rectangle qui n'est pas une carte |
 * | Taille bornée | plage de plausibilité du visage (§4, B5) | les faux positifs minuscules ou géants |
 *
 * ## ⚠️ La borne de taille n'est PAS une mesure déguisée
 *
 * La fenêtre de recherche se déduit de `FACE_WIDTH_MIN_MM` / `FACE_WIDTH_MAX_MM`,
 * qui couvrent l'enfant de 3 ans comme l'adulte à forte carrure. Elle dit
 * seulement *où chercher*, jamais *combien mesure la carte* : la largeur
 * retenue est celle que les pixels donnent, libre à l'intérieur de la fenêtre.
 * Si le résultat venait se coller à un bord de la fenêtre, ce serait le signe
 * d'un faux positif — d'où le refus explicite plus bas.
 *
 * ## Le score, et pourquoi il n'est pas circulaire
 *
 * On note un candidat par la marche de luminance de son bord LE PLUS FAIBLE
 * (`guideEdgeStep`). C'est le seul contrôle non circulaire déjà établi : on lit
 * les pixels de part et d'autre d'un contour **imposé**, sans rien y ajuster.
 * Un rectangle posé sur du front nu n'a aucune marche ; une carte en a quatre.
 */

import { refineQuadDetailed } from '../src/core/cardEdges.js';
import { guideEdgeStep } from '../src/core/edgeStep.js';
import { CARD_H_MM, CARD_W_MM, type CardQuad } from '../src/core/cardPose.js';
import { FACE_WIDTH_MAX_MM, FACE_WIDTH_MIN_MM } from '../src/core/calibration.js';
import { BROW_L, BROW_R, HAIRLINE, faceWidthPx, rollRadOf } from '../src/core/faceMetrics.js';
import { at, midpoint, px, type NormalizedLandmark, type Pt } from '../src/core/geom.js';
import type { ImageBuffer } from '../src/core/silhouette.js';

/**
 * Élargissement de la fenêtre de taille, au-delà de la seule plage de visages.
 *
 * La carte est ~5 cm DEVANT les repères 234/454 : à 40 cm de l'objectif elle
 * paraît une bonne dizaine de pour cent plus grande qu'un objet au plan des
 * tempes (parallaxe, B4). La fenêtre doit donc déborder des deux côtés, sinon
 * elle exclurait la bonne réponse dans le cas le plus courant — un client qui
 * tient son téléphone à bout de bras plié.
 */
export const SEARCH_SLACK = 0.3;

/** Largeur minimale cherchée, en fraction de la largeur du visage en pixels. */
export const CARD_SEARCH_MIN_RATIO = ((CARD_W_MM / FACE_WIDTH_MAX_MM) * 1) / (1 + SEARCH_SLACK);
/** Largeur maximale cherchée, même unité. */
export const CARD_SEARCH_MAX_RATIO = (CARD_W_MM / FACE_WIDTH_MIN_MM) * (1 + SEARCH_SLACK);

/**
 * Marche de luminance en dessous de laquelle on déclare qu'il n'y a pas de carte.
 *
 * ⚠️ VALEUR À FIGER SUR MESURE, pas à choisir. Voir `tests/guide-on-video.ts` :
 * le profil temporel d'une vraie séquence doit montrer un pic net, et le seuil
 * se place entre le pic et le fond. Tant qu'il n'est pas relevé, cette constante
 * est provisoire et la fonction ne doit pas piloter l'application seule.
 */
export const MIN_FOUND_EDGE_STEP = 14; // ⚠️ PROVISOIRE — cf. MIN_GUIDE_EDGE_STEP.

/** Pas de la grille grossière, en fraction de la largeur cherchée. */
export const COARSE_STEP_RATIO = 0.12;
/** Nombre d'échelles essayées entre les deux bornes, au premier passage. */
export const COARSE_SCALES = 9;

/**
 * Débattement d'inclinaison exploré AUTOUR de celle de la tête.
 *
 * 🔴 Relevé sur la vidéo du sujet, et il condamne une hypothèse trop commode :
 * « la carte est posée à plat sur le front, donc elle suit le roll de la tête ».
 * Elle est TENUE À LA MAIN. Sur la séquence réelle elle penche de plusieurs
 * degrés par rapport au visage, et une recherche verrouillée sur le roll ne
 * s'aligne alors sur aucun de ses bords : l'accrochage sous-pixel rendait
 * `measured = 0` sur 40 images trouvées sur 42, tout en affichant une belle
 * marche de luminance. Le score paraissait bon, la géométrie était fausse.
 */
export const ROLL_SPAN_RAD = 0.32; // ~±18°
/** Inclinaisons essayées dans ce débattement, au premier passage. */
export const COARSE_ROLLS = 7;

/** Pas de la grille fine, en fraction de la largeur — sous le pixel utile. */
export const FINE_STEP_RATIO = 0.02;
/** Demi-débattement du second passage, en fraction du pas grossier. */
export const FINE_SPAN = 1.2;
/** Échantillons par axe au second passage. */
export const FINE_STEPS = 5;

export interface FoundCard {
  quad: CardQuad;
  widthPx: number;
  /** Inclinaison retenue, en radians. À comparer au roll de la tête. */
  rollRad: number;
  /** Marche de luminance du bord le plus faible. Sert à refuser, pas à mesurer. */
  edgeStep: number;
  /** Bords réellement accrochés au sous-pixel, sur 4. */
  measured: number;
}

interface Cand {
  dx: number;
  dy: number;
  widthPx: number;
  roll: number;
  score: number;
}

/** Rectangle de rapport ISO, centré en `c`, incliné de `roll`. */
function isoQuad(c: Pt, widthPx: number, roll: number): CardQuad {
  const halfW = widthPx / 2;
  const halfH = (halfW * CARD_H_MM) / CARD_W_MM;
  const ux = { x: Math.cos(roll), y: Math.sin(roll) };
  const uy = { x: -Math.sin(roll), y: Math.cos(roll) };
  const corner = (sx: number, sy: number): Pt => ({
    x: c.x + ux.x * sx * halfW + uy.x * sy * halfH,
    y: c.y + ux.y * sx * halfW + uy.y * sy * halfH,
  });
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

/**
 * Cherche la carte dans la bande du front. `null` si rien de convaincant.
 *
 * 🔴 Renvoyer `null` est un résultat, pas un échec : le cadre à remplir
 * (`core/cardGuide.ts`) reste la voie sûre, et le client vise lui-même. Cette
 * fonction lui épargne le geste quand elle y arrive, elle ne le remplace pas.
 */
export function findCardOnForehead(
  buf: ImageBuffer,
  lm: readonly NormalizedLandmark[],
  imageWidthPx: number,
  imageHeightPx: number,
): FoundCard | null {
  const brow = midpoint(
    px(at(lm, BROW_L), imageWidthPx, imageHeightPx),
    px(at(lm, BROW_R), imageWidthPx, imageHeightPx),
  );
  const hair = px(at(lm, HAIRLINE), imageWidthPx, imageHeightPx);
  const centre = midpoint(brow, hair);
  const roll = rollRadOf(lm, imageWidthPx, imageHeightPx);

  const facePx = faceWidthPx(lm, imageWidthPx, imageHeightPx);
  if (!(facePx > 0)) return null;

  // La zone balayée : la hauteur du front, et une bonne moitié de sa largeur.
  // Au-delà on sortirait du front, ce qui est exactement ce qu'on veut éviter.
  const bandPx = Math.hypot(hair.x - brow.x, hair.y - brow.y);
  const spanX = 0.25 * facePx;
  const spanY = 0.5 * bandPx;

  const ux = { x: Math.cos(roll), y: Math.sin(roll) };
  const uy = { x: -Math.sin(roll), y: Math.cos(roll) };

  const quadAt = (c: Cand): CardQuad =>
    isoQuad(
      { x: centre.x + ux.x * c.dx + uy.x * c.dy, y: centre.y + ux.y * c.dx + uy.y * c.dy },
      c.widthPx,
      c.roll,
    );

  const minW = facePx * CARD_SEARCH_MIN_RATIO;
  const maxW = facePx * CARD_SEARCH_MAX_RATIO;

  // — Premier passage : grossier, mais il explore TOUT le domaine, inclinaison comprise.
  let best: Cand | null = null;
  for (let s = 0; s < COARSE_SCALES; s++) {
    const widthPx = minW + (s / (COARSE_SCALES - 1)) * (maxW - minW);
    const step = Math.max(2, COARSE_STEP_RATIO * widthPx);
    for (let r = 0; r < COARSE_ROLLS; r++) {
      const rr = roll + ROLL_SPAN_RAD * (-1 + (2 * r) / (COARSE_ROLLS - 1));
      for (let dy = -spanY; dy <= spanY; dy += step) {
        for (let dx = -spanX; dx <= spanX; dx += step) {
          const cand: Cand = { dx, dy, widthPx, roll: rr, score: 0 };
          cand.score = guideEdgeStep(buf, quadAt(cand));
          if (best === null || cand.score > best.score) best = cand;
        }
      }
    }
  }
  if (best === null) return null;

  // — Second passage : local, fin, sur les quatre paramètres à la fois.
  const dStep = Math.max(1, FINE_STEP_RATIO * best.widthPx);
  const dPos = FINE_SPAN * COARSE_STEP_RATIO * best.widthPx;
  const dW = FINE_SPAN * ((maxW - minW) / (COARSE_SCALES - 1));
  const dR = FINE_SPAN * ((2 * ROLL_SPAN_RAD) / (COARSE_ROLLS - 1));
  const axis = (span: number, n: number): number[] =>
    Array.from({ length: n }, (_, i) => -span + (2 * span * i) / (n - 1));

  for (const ddx of axis(dPos, Math.max(3, Math.round((2 * dPos) / dStep)))) {
    for (const ddy of axis(dPos, Math.max(3, Math.round((2 * dPos) / dStep)))) {
      for (const ddw of axis(dW, FINE_STEPS)) {
        for (const ddr of axis(dR, FINE_STEPS)) {
          const cand: Cand = {
            dx: best.dx + ddx,
            dy: best.dy + ddy,
            widthPx: best.widthPx + ddw,
            roll: best.roll + ddr,
            score: 0,
          };
          if (cand.widthPx < minW || cand.widthPx > maxW) continue;
          cand.score = guideEdgeStep(buf, quadAt(cand));
          if (cand.score > best.score) best = cand;
        }
      }
    }
  }

  if (best.score < MIN_FOUND_EDGE_STEP) return null;

  // Un candidat collé à une borne de la fenêtre de recherche n'est pas une
  // mesure : c'est la fenêtre qui a décidé. On refuse plutôt que de rendre un
  // chiffre que la recherche a contraint.
  const ratio = best.widthPx / facePx;
  const marge = 0.02 * (CARD_SEARCH_MAX_RATIO - CARD_SEARCH_MIN_RATIO);
  if (ratio <= CARD_SEARCH_MIN_RATIO + marge || ratio >= CARD_SEARCH_MAX_RATIO - marge) return null;

  const coarse = quadAt(best);
  try {
    const refined = refineQuadDetailed(buf, coarse);
    return {
      quad: refined.quad,
      widthPx: Math.hypot(refined.quad[1].x - refined.quad[0].x, refined.quad[1].y - refined.quad[0].y),
      rollRad: best.roll,
      edgeStep: guideEdgeStep(buf, refined.quad),
      measured: refined.measured,
    };
  } catch {
    return null;
  }
}
