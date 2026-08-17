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

import { fitDepthAndDistance } from './depthFit.js';
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
 * ⚠️ Ce n'est PAS un retour du champ de vision supposé. C'est la fenêtre que
 * l'application fait respecter : en deçà de 60 cm elle refuse (parade B4 n°1),
 * et au-delà d'environ 1 m la carte devient trop petite en pixels pour être
 * pointée utilement. La distance réelle vit donc dans cette fourchette parce
 * qu'on l'y contraint, et non parce qu'on la devine.
 *
 * Elle sert d'a priori que la mesure par rotation vient corriger — quand cette
 * mesure vaut mieux que l'a priori, ce qui n'est pas toujours le cas.
 */
export const DISTANCE_PRIOR_MM = 780;
export const DISTANCE_PRIOR_REL_ERROR = 0.17; // couvre ~600–1000 mm

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

/** Combinaison par pondération inverse des variances. */
function fuse(
  a: { value: number; rel: number },
  b: { value: number; rel: number },
): { value: number; rel: number } {
  if (!Number.isFinite(a.value) || a.rel >= 1) return b;
  const wa = 1 / (a.value * a.rel) ** 2;
  const wb = 1 / (b.value * b.rel) ** 2;
  if (!Number.isFinite(wa) || wa <= 0) return b;
  if (!Number.isFinite(wb) || wb <= 0) return a;
  const value = (wa * a.value + wb * b.value) / (wa + wb);
  return { value, rel: Math.sqrt(1 / (wa + wb)) / value };
}

interface Parallax {
  factor: number;
  depthMm: number | null;
  distanceMm: number;
  scaleRelError: number;
  note: string;
}

function measureParallax(input: RefinementInput): Parallax {
  const prior = { value: DISTANCE_PRIOR_MM, rel: DISTANCE_PRIOR_REL_ERROR };

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

  const fit = fitDepthAndDistance(input.views, input.naiveFaceWidthMm);

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

  // 🔴 La distance EST mesurée — mais elle est portée par un effet perspectif du
  // second ordre, et le bruit des repères la dégrade massivement. Au banc,
  // ±0,5 px de bruit donnent ±300 mm d'écart-type sur 700. On la fusionne donc
  // avec la fenêtre de travail imposée, chacune pesée par son incertitude : la
  // mesure prend le dessus si elle est bonne, s'efface si elle ne l'est pas.
  // C'est le contraire d'un choix a priori — c'est la donnée qui décide.
  const distance = fuse({ value: fit.distanceMm, rel: fit.distanceRelError }, prior);

  const delta = fit.depthMm / distance.value;
  const deltaRel = Math.hypot(fit.depthRelError, distance.rel);
  const factor = 1 / (1 - delta);

  return {
    factor,
    depthMm: fit.depthMm,
    distanceMm: distance.value,
    // d(facteur)/facteur ≈ δ × (incertitude relative sur δ).
    scaleRelError: Math.hypot(input.clickRelError, delta * deltaRel),
    note:
      `Profondeur front ↔ tempes mesurée : ${fit.depthMm.toFixed(0)} mm sur ${fit.views} vues. ` +
      `Distance retenue : ${(distance.value / 10).toFixed(0)} cm ` +
      `(mesurée ${(fit.distanceMm / 10).toFixed(0)} cm à ±${(fit.distanceRelError * 100).toFixed(0)} %). ` +
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
      distanceMm: DISTANCE_PRIOR_MM,
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
