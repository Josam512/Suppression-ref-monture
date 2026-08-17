/**
 * core/cardRefinement.ts — ce que la rotation de tête ajoute à la carte.
 *
 * Orchestre les deux mesures que le §4 laissait en suspens, et RIEN d'autre :
 *
 *   1. la profondeur front ↔ tempes (`core/parallax.ts`), qui supprime le biais
 *      systématique B4 au lieu de le supposer nul ;
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

import { CalibrationError } from './geom.js';
import {
  depthOffsetMm,
  parallaxFactor,
  parallaxResidualRelError,
  type RotatedView,
} from './parallax.js';
import {
  measureTemporalWidth,
  type TemporalInput,
  type TemporalMeasurement,
} from './temporalWidth.js';

/** Ce qu'il faut pour tenter la silhouette : l'image figée et ses repères. */
export type TemporalScene = Omit<TemporalInput, 'pxPerMm' | 'scaleRelError'>;

export interface RefinementInput {
  /** Échelle lue sur la carte, AU PLAN DE LA CARTE (px par mm). */
  pxPerMmCard: number;
  /** Distance caméra estimée, en mm. N'entre que dans un terme du second ordre. */
  distanceMm: number;
  /** Largeur de visage naïve, issue de la carte sans correction. */
  naiveFaceWidthMm: number;
  /** Incertitude de pointage des deux bords de la carte. */
  clickRelError: number;
  /** Une vue tournée à gauche et une à droite, ou null si non collectées. */
  views: readonly [RotatedView, RotatedView] | null;
  /** L'image de face figée, pour chercher les bords de la tête. */
  scene: TemporalScene | null;
}

export interface Refinement {
  /** Facteur multiplicatif ramenant l'échelle au plan des tempes. 1 si non mesuré. */
  parallaxFactor: number;
  /** Profondeur mesurée, en mm, ou null si la rotation n'a pas abouti. */
  depthMm: number | null;
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

export function refineCard(input: RefinementInput): Refinement {
  const notes: string[] = [];

  let depthMm: number | null = null;
  let factor = 1;
  let scaleRelError = UNMEASURED_PARALLAX_REL_ERROR;

  if (input.views !== null) {
    try {
      const [a, b] = input.views;
      depthMm = depthOffsetMm(a, b, input.naiveFaceWidthMm, input.distanceMm);
      factor = parallaxFactor(depthMm, input.distanceMm);
      scaleRelError = Math.hypot(
        input.clickRelError,
        parallaxResidualRelError(depthMm, input.distanceMm),
      );
      notes.push(
        `Profondeur front ↔ tempes mesurée : ${depthMm.toFixed(0)} mm. ` +
          `Le biais de parallaxe de la carte (${((factor - 1) * 100).toFixed(1)} %) est corrigé, ` +
          `il n'est plus supposé nul.`,
      );
    } catch (err) {
      depthMm = null;
      factor = 1;
      scaleRelError = UNMEASURED_PARALLAX_REL_ERROR;
      notes.push(
        (err instanceof CalibrationError ? err.message : String(err)) +
          ` La mesure reste utilisable, avec une marge plus large.`,
      );
    }
  } else {
    notes.push(
      `Rotation de tête non effectuée : le biais de parallaxe de la carte n'est pas mesuré, ` +
        `et il compte pour ${(UNMEASURED_PARALLAX_REL_ERROR * 100).toFixed(1)} % dans votre marge.`,
    );
  }

  let temporal: TemporalMeasurement | null = null;
  if (input.scene !== null) {
    temporal = measureTemporalWidth({
      ...input.scene,
      // ⭐ L'échelle des tempes, pas celle de la carte : c'est tout l'objet du
      // correctif B4. Diviser par le facteur, puisque le facteur multiplie les
      // longueurs, donc divise les échelles.
      pxPerMm: input.pxPerMmCard / factor,
      scaleRelError,
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
    parallaxFactor: factor,
    depthMm,
    scaleRelError,
    parallaxMeasured: depthMm !== null,
    temporal,
    notes,
  };
}
