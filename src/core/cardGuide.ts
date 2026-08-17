/**
 * core/cardGuide.ts — le cadre affiché À L'ÉCRAN, et le verrouillage automatique.
 *
 * ## Le renversement, et pourquoi il vaut mieux qu'une détection
 *
 * L'ancien parcours demandait au client de **traîner un rectangle sur la carte**.
 * Lent, fastidieux, et c'était le seul geste long de la calibration.
 *
 * Quatre tentatives de détection automatique ont échoué sur de vraies images —
 * rapport ISO noté (36 % d'erreur), contours fermés (0 candidat), segments de
 * droite (57 %), recherche contrainte au front (22 % de dispersion). Toutes sur
 * la même cause : **la lisière des cheveux est un bord plus franc que la carte**.
 * Le détail et les mesures sont dans `tests/cardFind.atelier.ts`, pour que
 * personne n'en tente une cinquième.
 *
 * D'où le renversement, qui est celui de tous les scanners de carte en
 * production : au lieu de chercher où est la carte, **on dit où la mettre**.
 *
 * 🔴 Le point clé : **le cadre EST la graine de l'accrochage**. On n'a donc plus
 * rien à détecter — `refineQuad` part du cadre et ne converge que si la carte
 * est réellement là. Le geste du client et la mesure sont le même acte.
 */

import { type NormalizedLandmark, type Pt } from './geom.js';
import { poseAnchorOf, rollRadOf } from './faceMetrics.js';
import { CARD_H_MM, CARD_W_MM, type CardQuad } from './cardPose.js';

/**
 * Fraction de la largeur de l'image occupée par le cadre.
 *
 * ⚠️ Elle fixe la DISTANCE de travail : `d = CARD_W_MM × focale / largeurCadre`.
 * L'ancienne valeur (0,55) n'avait jamais été confrontée à cette formule — elle
 * plaçait le client entre 11 et 22 cm de l'objectif, où le visage ne tient même
 * plus dans le cadre.
 *
 * 0,35 correspond à une tête cadrée naturellement, bras replié. La distance
 * exacte n'est plus critique depuis que la carte se porte dans le plan du visage
 * (voir `guideQuad`) : la parallaxe, seule raison d'exiger du recul, a disparu.
 * Il reste à avoir assez de pixels sur la carte — 0,35 en donne près de 400 sur
 * une image de 1080.
 */
export const GUIDE_WIDTH_RATIO = 0.35;

/**
 * Cadre au rapport ISO, posé LÀ OÙ IRONT LES LUNETTES, et incliné comme la tête.
 *
 * ## 🔴 Pourquoi le plan des yeux, et pas le front
 *
 * Le front a été essayé, et c'est une fausse bonne idée sur les deux tableaux :
 *
 * 1. **Détection.** Sur le front, la carte se cale contre les cheveux : son bord
 *    haut devient sombre sur sombre et n'a plus de contraste. Mesuré sur la
 *    séquence réelle, le minimum sur les quatre bords tombe alors à 6,5 —
 *    au niveau du fond. Quatre tentatives de détection automatique s'y sont
 *    cassées, toujours sur la lisière (cf. `tests/cardFind.atelier.ts`). Plus
 *    bas, les quatre bords tombent sur de la peau : 27,9 mesuré au banc.
 * 2. **Repères observés, jamais inventés.** Voir ci-dessous : c'est l'argument
 *    décisif, et il porte sur la mesure elle-même.
 *
 * ⚠️ **Ce que ce déplacement n'apporte PAS.** Une première rédaction annonçait
 * que la parallaxe (correctif B4) disparaissait, la carte étant enfin dans le
 * plan du visage. C'est faux : une carte à plat sous les yeux porte sur le NEZ,
 * qui ressort autant que le front — 52 à 63 mm devant 234/454 selon les
 * profondeurs mesurées dans `core/framePlane.ts`. La parallaxe reste entière et
 * c'est la rotation de tête qui la mesure. Voir `CARD_TO_TEMPLE_DEPTH_MM`.
 *
 * ## 🔴 Mais JUSTE SOUS la ligne des yeux, jamais devant
 *
 * Mesuré : une carte qui recouvre les yeux ne fait pas perdre le visage à
 * MediaPipe — elle fait pire. Le modèle **continue de rendre 478 points**, en
 * inventant ceux qu'il ne voit plus. Le cadre, ancré dessus, se déplace de
 * plusieurs dizaines de pixels dès que la carte monte, et le client court après
 * une cible mouvante. Surtout, `faceWidthPx` — la grandeur qui EST la mesure —
 * serait lue sur des repères hallucinés, sans que rien ne le signale.
 *
 * Le cadre est donc glissé vers le bas d'exactement une demi-hauteur de carte :
 * son **bord haut tombe sur la ligne des yeux**, la carte occupe le nez et les
 * joues, et les yeux restent visibles. Aucun paramètre libre — c'est la
 * géométrie de la carte qui fixe le décalage, pas une constante choisie.
 *
 * Le plan, lui, ne change pas : pommettes et tempes sont à la même profondeur,
 * donc la parallaxe reste nulle. Et l'ancrage horizontal reste `poseAnchorOf`,
 * celui-là même que la monture utilisera (§14.6).
 *
 * ## 🔴 La séparation qui empêche la mesure d'être circulaire
 *
 * Deux grandeurs, deux origines, à ne JAMAIS échanger :
 *
 * | Grandeur | Vient de | Pourquoi |
 * |---|---|---|
 * | **Position** et **inclinaison** | les repères du visage | la carte se pose sur le visage, et elle penche avec la tête |
 * | **Taille** | l'IMAGE seule (`GUIDE_WIDTH_RATIO`) | voir ci-dessous |
 *
 * ⚠️ **Le piège, et il est mortel.** Dimensionner le cadre en fraction du visage
 * paraît plus élégant — le cadre suivrait la personne. Mais remplir le cadre
 * imposerait alors `carteEnPx = k × visageEnPx`, donc
 * `largeurVisageMm = CARD_W_MM / k` : **la même largeur pour tout le monde**,
 * enfant compris. Une constante déguisée en mesure (§0.0.3). La taille reste
 * donc étrangère au visage, et c'est ce qui laisse `visageEnPx` libre de varier
 * d'une personne à l'autre — c'est là que la mesure a lieu. Un test balaie un
 * domaine de morphologies pour le verrouiller.
 *
 * Bénéfice au passage : à taille fixée dans l'image, remplir le cadre **fixe la
 * distance**. Une inconnue disparaît au lieu de s'ajouter.
 */
export function guideQuad(
  lm: readonly NormalizedLandmark[],
  imageWidthPx: number,
  imageHeightPx: number,
): CardQuad {
  // Le cadre penche avec la tête, et se pose à l'ancrage même de la monture.
  const roll = rollRadOf(lm, imageWidthPx, imageHeightPx);
  const c = poseAnchorOf(lm, imageWidthPx, imageHeightPx, roll);
  const ux = { x: Math.cos(roll), y: Math.sin(roll) }; // le long de la ligne des yeux
  const uy = { x: -Math.sin(roll), y: Math.cos(roll) }; // vers le bas du visage

  const halfW = guideWidthPx(imageWidthPx) / 2; // ⚠️ de l'IMAGE, jamais du visage
  const halfH = (halfW * CARD_H_MM) / CARD_W_MM;

  // ⭐ Glissé d'une demi-hauteur vers le bas : le bord HAUT tombe sur la ligne
  // des yeux, qui restent donc visibles. Voir l'en-tête de la fonction.
  const corner = (sx: number, sy: number): Pt => ({
    x: c.x + ux.x * sx * halfW + uy.x * (sy + 1) * halfH,
    y: c.y + ux.y * sx * halfW + uy.y * (sy + 1) * halfH,
  });
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

/** Largeur du cadre, en pixels. */
export function guideWidthPx(imageWidthPx: number): number {
  return GUIDE_WIDTH_RATIO * imageWidthPx;
}

