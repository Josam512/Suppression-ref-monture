/**
 * core/cardRefinement.ts — ce que la rotation de tête ajoute à la carte.
 *
 * Orchestre les deux mesures que le §4 laissait en suspens, et RIEN d'autre :
 *
 *   1. la profondeur front ↔ tempes et la distance caméra (`core/depthFit.ts`),
 *      qui suppriment le biais systématique B4 au lieu de le supposer nul ;
 *   2. l'écart temporal (`core/temporalWidth.ts`), qui remplace la constante
 *      `FACE_WIDTH_CORRECTION_MM` par une mesure faite sur CE client.
 *
 * ⚠️ Ce fichier ne construit aucun `UserCalibration` et ne connaît aucune
 * `CalSource`. Il rend des grandeurs physiques et leurs incertitudes ; c'est
 * `core/calibration.ts` — seul habilité — qui en fait une calibration.
 *
 * ⚠️ Aucune étape n'est bloquante. Chaque échec est converti en note lisible et
 * la chaîne continue avec la mesure moins précise. Un client qui n'arrive pas à
 * tourner la tête doit pouvoir essayer des lunettes ; il doit seulement savoir
 * que sa marge est plus large.
 */

import { depthFromRotation } from './depthFit.js';
import { NOMINAL_DISTANCE_MM, NOMINAL_DISTANCE_REL_ERROR } from './framePlane.js';
import { CalibrationError } from './geom.js';
import { type RotatedView } from './parallax.js';
import {
  measureTemporalWidth,
  type TemporalInput,
  type TemporalMeasurement,
} from './temporalWidth.js';

/** Ce qu'il faut pour tenter la silhouette : l'image figée et ses repères. */
export type TemporalScene = Omit<TemporalInput, 'pxPerMm' | 'scaleRelError'>;

/**
 * Distance de travail attendue, et son incertitude — **imposée, pas supposée**.
 *
 * ⚠️ Une seule définition, dans `core/framePlane.ts`, parce que le rendu en a
 * besoin lui aussi et qu'un import de `cardRefinement` depuis `faceMetrics`
 * créerait un cycle. Deux copies de cette valeur finiraient par diverger.
 */
export {
  NOMINAL_DISTANCE_MM as DISTANCE_PRIOR_MM,
  NOMINAL_DISTANCE_REL_ERROR as DISTANCE_PRIOR_REL_ERROR,
} from './framePlane.js';

export interface RefinementInput {
  /** Échelle lue sur la carte, AU PLAN DE LA CARTE (px par mm). */
  pxPerMmCard: number;
  /** Largeur de visage naïve, issue de la carte sans correction. */
  naiveFaceWidthMm: number;
  /** Incertitude de pointage des deux bords de la carte. */
  clickRelError: number;
  /** Les vues tournées collectées pendant la rotation, dans l'ordre. */
  views: readonly RotatedView[] | null;
  /** L'image de face figée, pour chercher les bords de la tête. */
  scene: TemporalScene | null;
}

export interface Refinement {
  /** Facteur multiplicatif ramenant l'échelle au plan des tempes. 1 si non mesuré. */
  parallaxFactor: number;
  /** Profondeur mesurée, en mm, ou null si la rotation n'a pas abouti. */
  depthMm: number | null;
  /** Distance retenue, en mm : mesure et a priori combinés. */
  distanceMm: number;
  /** Incertitude d'échelle totale APRÈS correction. */
  scaleRelError: number;
  /** Vrai si la parallaxe a réellement été mesurée sur ce client. */
  parallaxMeasured: boolean;
  temporal: TemporalMeasurement | null;
  /** Messages destinés à l'écran, dans l'ordre où ils se sont produits. */
  notes: string[];
}

/**
 * Incertitude d'échelle quand la parallaxe N'A PAS été mesurée.
 *
 * ⚠️ Ce n'est pas une incertitude, c'est un biais non corrigé qu'on comptabilise
 * faute de mieux. Le §4 l'assume explicitement : « tant que rien de tout cela
 * n'est mesuré, 2,5 % ». On ne descend en dessous que lorsque la rotation a
 * effectivement eu lieu.
 */
export const UNMEASURED_PARALLAX_REL_ERROR = 0.025;

/**
 * Au-delà, la profondeur mesurée est trop instable pour servir.
 *
 * ⚠️ Seuil posé APRÈS la première confrontation au réel, pas avant. Une
 * correction de parallaxe vaut ~4 % ; l'appliquer avec 50 % d'incertitude
 * laisse un résidu de 2 %, soit le biais qu'on prétendait supprimer. Au-delà,
 * la correction ne corrige plus rien — elle déplace l'erreur.
 */
export const MAX_DEPTH_REL_ERROR = 0.5;

/**
 * Dernier tronçon : des COINS EXTERNES DES YEUX au plan des TEMPES.
 *
 * ## Ce que les coins des yeux sont, et ne sont pas
 *
 * Rien ne se pose au coin des yeux. Ce n'est pas un plan d'intérêt, c'est le
 * ZÉRO DU RÉGLET : quand la tête tourne, il faut un point de départ qui ne
 * bouge pas sur la peau, et les repères du contour temporal, eux, glissent le
 * long de la silhouette — c'est ce qui rendait la profondeur à 99 mm quel que
 * soit le point sondé. Les coins externes sont les seuls repères symétriques
 * qui soient de vrais points physiques. La profondeur carte ↔ coins des yeux
 * est un intermédiaire ; elle n'est jamais affichée et ne sert à rien d'autre.
 *
 * ## Le seul maillon non mesuré de la chaîne — et pourquoi il le reste
 *
 * Ce dernier tronçon n'est PAS mesurable sur ces images, et ce n'est pas faute
 * d'avoir cherché : il faudrait soit un modèle de forme de crâne — donc une
 * morphologie supposée, interdite au §0.0.3 —, soit un second objet de
 * dimension connue à hauteur des tempes. Avec une seule carte sur le front, le
 * système est sous-déterminé. C'est une propriété de la prise de vue, pas un
 * manque de traitement.
 *
 * ## Ce qui a été corrigé : une PROPORTION, pas une longueur en dur
 *
 * ⚠️ Cette valeur était `12 mm`, en absolu. C'était un chiffre d'adulte : sur
 * un visage d'enfant de 120 mm il surestimait le tronçon de moitié, soit
 * exactement le présupposé de taille que le §0.0.3 interdit — et le §5 avait
 * déjà tranché le même dilemme pour le seuil, en le rendant proportionnel.
 *
 * Le rapport est calé sur le sujet réel (12 mm mesurés sur ~152 mm de largeur
 * de tête) et il est sans dimension, donc il suit la personne. Il reste une
 * hypothèse de FORME ; il n'est plus une hypothèse de TAILLE.
 *
 * Son poids : la correction totale vaut ~6 %, ce tronçon en fait le quart. Se
 * tromper de 50 % dessus coûte **0,8 % sur la largeur finale**, soit 1,2 mm sur
 * 152 — à comparer aux 3 à 7 % de biais que l'ensemble de la correction
 * supprime. Il est déclaré, avec son incertitude, plutôt que posé à zéro en
 * silence comme il l'était.
 */
export const CANTHI_TO_TEMPLE_DEPTH_RATIO = 0.079;
export const CANTHI_TO_TEMPLE_DEPTH_SD_RATIO = 0.04;

/** Le tronçon, pour CE client, d'après sa propre largeur de visage. */
export function canthiToTempleDepthMm(faceWidthMm: number): number {
  return faceWidthMm * CANTHI_TO_TEMPLE_DEPTH_RATIO;
}

interface Parallax {
  factor: number;
  depthMm: number | null;
  distanceMm: number;
  scaleRelError: number;
  note: string;
}

function measureParallax(input: RefinementInput): Parallax {
  const prior = { value: NOMINAL_DISTANCE_MM, rel: NOMINAL_DISTANCE_REL_ERROR };

  if (input.views === null || input.views.length === 0) {
    return {
      factor: 1,
      depthMm: null,
      distanceMm: prior.value,
      scaleRelError: UNMEASURED_PARALLAX_REL_ERROR,
      note:
        `Rotation de tête non effectuée : le biais de parallaxe de la carte n'est pas mesuré, ` +
        `et il compte pour ${(UNMEASURED_PARALLAX_REL_ERROR * 100).toFixed(1)} % dans votre marge.`,
    };
  }

  // ⚠️ La distance n'est PAS ajustée : elle est fixée à la fenêtre de travail.
  // Elle ne pèse que dans le petit terme perspectif du milieu — ±17 % dessus ne
  // font que 3,4 % sur la profondeur. Vouloir l'ajuster en même temps rendait le
  // système presque singulier et faisait tripler la profondeur d'une image à
  // l'autre : c'est la première vraie vidéo qui l'a montré.
  const fit = depthFromRotation(input.views, input.naiveFaceWidthMm, prior.value);

  // 🔴 Une profondeur mesurée mais INSTABLE ne vaut pas mieux que pas de mesure.
  //
  // Corriger de δ avec une incertitude relative de 100 % sur δ ajoute autant
  // d'erreur qu'on en retire — et l'ajoute sous couvert d'une correction, donc
  // sans que rien ne le signale. La première vraie vidéo est tombée exactement
  // là : le jackknife annonçait ±100 % sur la profondeur, et la valeur passait
  // de 15 à 44 mm selon l'image frontale retenue.
  if (fit.depthRelError > MAX_DEPTH_REL_ERROR) {
    return {
      factor: 1,
      depthMm: null,
      distanceMm: prior.value,
      scaleRelError: UNMEASURED_PARALLAX_REL_ERROR,
      note:
        `Rotation exploitée sur ${fit.views} vues, mais la profondeur en ressort instable ` +
        `(±${(fit.depthRelError * 100).toFixed(0)} %) : je ne corrige pas la parallaxe plutôt que ` +
        `de la corriger au hasard. Refaites la rotation plus lentement, tête bien droite, ` +
        `caméra posée et immobile.`,
    };
  }

  const distance = prior;

  // La profondeur totale carte → tempes : la part mesurée, plus le dernier
  // tronçon que l'imagerie ne peut pas atteindre — proportionné à CE visage,
  // et non posé en millimètres d'adulte.
  const lastLegMm = canthiToTempleDepthMm(input.naiveFaceWidthMm);
  const depthTotalMm = fit.depthMm + lastLegMm;
  const depthSdMm = Math.hypot(
    fit.depthMm * fit.depthRelError,
    input.naiveFaceWidthMm * CANTHI_TO_TEMPLE_DEPTH_SD_RATIO,
  );

  const delta = depthTotalMm / distance.value;
  const deltaRel = Math.hypot(depthSdMm / depthTotalMm, distance.rel);
  const factor = 1 / (1 - delta);

  return {
    factor,
    depthMm: depthTotalMm,
    distanceMm: distance.value,
    // d(facteur)/facteur ≈ δ × (incertitude relative sur δ).
    scaleRelError: Math.hypot(input.clickRelError, delta * deltaRel),
    note:
      `Profondeur de la carte mesurée sur ${fit.views} vues (±${(fit.depthRelError * 100).toFixed(0)} %), ` +
      `plus ${lastLegMm.toFixed(0)} mm de dernier tronçon jusqu'au plan des tempes, ` +
      `seul segment non mesurable sur ces images. ` +
      `Le biais de parallaxe de la carte, ${((factor - 1) * 100).toFixed(1)} %, est corrigé ` +
      `au lieu d'être supposé nul.`,
  };
}

export function refineCard(input: RefinementInput): Refinement {
  const notes: string[] = [];

  let p: Parallax;
  try {
    p = measureParallax(input);
  } catch (err) {
    p = {
      factor: 1,
      depthMm: null,
      distanceMm: NOMINAL_DISTANCE_MM,
      scaleRelError: UNMEASURED_PARALLAX_REL_ERROR,
      note:
        (err instanceof CalibrationError ? err.message : String(err)) +
        ` La mesure reste utilisable, avec une marge plus large.`,
    };
  }
  notes.push(p.note);

  let temporal: TemporalMeasurement | null = null;
  if (input.scene !== null) {
    temporal = measureTemporalWidth({
      ...input.scene,
      // ⭐ L'échelle des tempes, pas celle de la carte : c'est tout l'objet du
      // correctif B4. Diviser par le facteur, puisque le facteur multiplie les
      // longueurs, donc divise les échelles.
      pxPerMm: input.pxPerMmCard / p.factor,
      scaleRelError: p.scaleRelError,
    });
    notes.push(
      temporal.measured
        ? `Écart temporal mesuré sur votre image : ${temporal.widthMm.toFixed(0)} mm ` +
          `(${temporal.marginMm.left.toFixed(0)} et ${temporal.marginMm.right.toFixed(0)} mm ` +
          `au-delà du contour du visage).`
        : `Écart temporal non mesurable. ${temporal.reason ?? ''}`,
    );
  }

  return {
    parallaxFactor: p.factor,
    depthMm: p.depthMm,
    distanceMm: p.distanceMm,
    scaleRelError: p.scaleRelError,
    parallaxMeasured: p.depthMm !== null,
    temporal,
    notes,
  };
}
