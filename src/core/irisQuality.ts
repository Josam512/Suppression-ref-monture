/**
 * core/irisQuality.ts — le gate iris, en QUALITÉ métrologique et non en taille.
 *
 * ## Pourquoi `MIN_IRIS_PX = 8` était un mauvais critère
 *
 * Un seuil absolu en pixels mélange trois choses sans rapport : la résolution
 * du capteur, la distance de la personne, et le bruit de détection. Il rejette
 * un iris de 7,8 px parfaitement stable et accepte un iris de 8,2 px qui saute
 * d'une frame à l'autre. Or ce qui compte en aval n'est ni l'un ni l'autre :
 * c'est l'erreur qui subsiste SUR LA MÉDIANE de n frames.
 *
 * ## Ce qui décide vraiment, et où
 *
 * Le bruit de détection s'atténue en 1/√n : trente frames un peu bruitées
 * valent mieux qu'une frame nette. C'est donc `MAX_SCALE_STANDARD_ERROR`
 * (l'erreur-type de la médiane d'échelle, dans `autoCalibration.ts`) qui porte
 * la décision de précision — et lui seul, parce que lui seul connaît n.
 *
 * Ce fichier ne garde donc que ce qu'aucune statistique ne rattrape :
 *
 *   1. la QUANTIFICATION — sous quelques pixels, les repères de contour d'iris
 *      tombent dans le même pixel et la largeur ne porte plus de signe. Aucun
 *      moyennage ne recrée une information absente.
 *   2. l'ABERRATION — un iris masqué (paupière, reflet, mèche) donne une
 *      largeur fausse et STABLE, donc invisible pour l'erreur-type. On la
 *      détecte par l'écart ENTRE LES DEUX YEUX sur la MÊME frame : deux iris
 *      d'une même personne, à la même distance, ont la même largeur.
 *
 * L'écart inter-yeux est un estimateur instantané, donc INSENSIBLE AU
 * MOUVEMENT : quand la personne avance, les deux largeurs montent ensemble.
 * Un écart-type sur les frames successives, lui, aurait confondu « la personne
 * bouge » et « la détection tremble », et aurait rejeté les bonnes frames.
 */

/**
 * Plancher de QUANTIFICATION, pas de taille. Les deux repères de contour
 * horizontal d'un iris de 3 px sont distants de 3 pixels : un pixel d'erreur de
 * placement vaut déjà 33 %. En deçà, la largeur n'a plus de signe exploitable.
 * ⚠️ Ce n'est PAS un critère de qualité — il n'existe que pour borner l'absurde.
 */
export const IRIS_ABSOLUTE_FLOOR_PX = 3;

/** Un ordre de grandeur au-dessus de l'asymétrie géométrique — voir ci-dessous. */
export const IRIS_DISCREPANCY_MARGIN = 10;

/**
 * Écart maximal admis entre l'œil gauche et l'œil droit, sur la MÊME frame.
 *
 * Dérivation, et non réglage : à la limite du gate frontal (`frontalGateRad`),
 * le raccourci perspectif ne creuse qu'environ `1 − cos(gate)` d'écart
 * géométrique entre les deux iris — 1 % à 8°. Le seuil est placé un ordre de
 * grandeur au-dessus : ce qu'il attrape ne peut donc PAS être de la géométrie,
 * c'est forcément un iris mal détecté.
 *
 * Passé en paramètre plutôt qu'importé : ce fichier ne dépend de rien, et le
 * lien avec le gate frontal reste verrouillé par un test.
 */
export function irisDiscrepancyMax(frontalGateRad: number): number {
  return IRIS_DISCREPANCY_MARGIN * (1 - Math.cos(frontalGateRad));
}

export interface IrisQuality {
  /** Largeur retenue pour la mesure : la moyenne des deux yeux. */
  widthPx: number;
  /** Écart relatif entre les deux yeux — l'estimateur d'aberration. */
  discrepancy: number;
  ok: boolean;
  /** Nommée quand le gate refuse ; null sinon. */
  reason: 'quantification' | 'iris-aberrant' | null;
}

export function irisQualityOf(
  leftPx: number,
  rightPx: number,
  discrepancyMax: number,
): IrisQuality {
  const widthPx = (leftPx + rightPx) / 2;
  const sum = leftPx + rightPx;
  // Moitié de l'écart relatif : c'est le bruit qui subsiste sur leur MOYENNE,
  // qui est la grandeur réellement utilisée en aval.
  const discrepancy = sum > 0 ? Math.abs(leftPx - rightPx) / sum : 1;

  if (Math.min(leftPx, rightPx) < IRIS_ABSOLUTE_FLOOR_PX) {
    return { widthPx, discrepancy, ok: false, reason: 'quantification' };
  }
  if (discrepancy > discrepancyMax) {
    return { widthPx, discrepancy, ok: false, reason: 'iris-aberrant' };
  }
  return { widthPx, discrepancy, ok: true, reason: null };
}
