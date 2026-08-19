/**
 * core/ocularScale.ts — l'échelle SANS carte : la statistique périoculaire
 * appliquée aux pixels d'une frame.
 *
 * ## Ce que ce fichier mesure, et avec quelle honnêteté
 *
 * Les longueurs périoculaires sont lues sur les landmarks (deux diamètres
 * d'iris, deux fentes palpébrales) et confrontées à leurs statistiques
 * populationnelles par l'estimateur de Mahalanobis de `core/ocularPrior.ts` —
 * covariance complète, jamais d'indépendance supposée entre les deux yeux.
 *
 * Étiquetage imposé par la mission (« MESURÉ / PRIOR / HYPOTHÈSE ») :
 *   - les pixels sont MESURÉS sur ce client ;
 *   - les moyennes/écarts-types sont un PRIOR ANTHROPOMÉTRIQUE, sourcé ;
 *   - la borne rendue (`relError`) est celle du prior : elle ne descend JAMAIS
 *     sous le plancher biologique, quel que soit le nombre de frames moyennées.
 *
 * ## Pourquoi l'iris est le bon étalon, y compris pour les enfants
 *
 * Le diamètre cornéen visible (HVID) atteint sa taille adulte vers 2–3 ans
 * (9,8 mm à la naissance, ~11,7 mm à 24–36 mois) puis ne suit plus la
 * croissance du crâne. C'est le seul étalon anatomique dont le biais ne dépend
 * ni de l'âge (≥3 ans), ni du sexe. Il dépend en revanche de la population
 * (11,10 mm Japon → 11,95 mm Arabie saoudite) et de l'instrument de référence :
 * l'écart-type retenu ci-dessous couvre cette dispersion, pas seulement la
 * dispersion intra-population. Sources : ETAT-DE-L-ART §4.
 *
 * ## Pourquoi la fente palpébrale est GATÉE, jamais imposée
 *
 * La fente palpébrale n'atteint sa taille adulte que vers 8–11 ans : imposer sa
 * moyenne adulte à un enfant biaiserait l'échelle vers le haut. Elle n'est donc
 * fusionnée que si elle CONCORDE avec l'échelle donnée par les iris ; sinon
 * l'estimateur retombe sur les deux iris seuls — plus large, jamais biaisé.
 */

import { at, dist, px, type NormalizedLandmark } from './geom.js';
import {
  EYE_L,
  EYE_L_INNER,
  EYE_R,
  EYE_R_INNER,
  IRIS_L_INNER,
  IRIS_L_OUTER,
  IRIS_R_INNER,
  IRIS_R_OUTER,
} from './faceMetrics.js';
import {
  covarianceOf,
  robustScaleBound,
  scaleFromOcular,
  PALPEBRAL_FISSURE,
  INTEROCULAR_R,
  HVID_PFL_R,
} from './ocularPrior.js';

/** Centres d'iris MediaPipe — pour l'écart pupillaire, jamais pour la pose. */
export const IRIS_L_CENTER = 468;
export const IRIS_R_CENTER = 473;

/**
 * HVID retenu pour l'étalon.
 *
 * PRIOR ANTHROPOMÉTRIQUE — moyenne : Rüfer 2005 (N=390, Orbscan II,
 * 11,71 ± 0,42 mm ; PMID 15778595), cohérente avec Gharaee 2014 (11,65 ± 0,36,
 * N=1001) et avec la constante MediaPipe Iris (11,7 ± 0,5).
 *
 * ⚠️ Écart-type ÉLARGI à 0,50 mm : le 0,42 est INTRA-population européenne ;
 * les moyennes publiées s'étalent de 11,10 (Japon) à 11,95 mm (Arabie
 * saoudite), et deux instruments diffèrent de 0,65 mm sur les mêmes yeux.
 * Annoncer 0,42 reviendrait à présenter comme universel un chiffre qui ne
 * l'est pas (interdiction PARTIE XIV de la mission).
 */
export const HVID_MEAN_MM = 11.71;
export const HVID_SD_MM = 0.5;

/** [HVID_G, HVID_D] — le vecteur de base, valable à tout âge ≥ 3 ans. */
const HVID_MEANS: readonly number[] = [HVID_MEAN_MM, HVID_MEAN_MM];
const HVID_SDS: readonly number[] = [HVID_SD_MM, HVID_SD_MM];
const HVID_CORR: readonly number[][] = [
  [1, INTEROCULAR_R],
  [INTEROCULAR_R, 1],
];

/** [HVID_G, HVID_D, PFL_G, PFL_D] — le vecteur étendu, adultes seulement. */
const FULL_MEANS: readonly number[] = [
  HVID_MEAN_MM,
  HVID_MEAN_MM,
  PALPEBRAL_FISSURE.meanMm,
  PALPEBRAL_FISSURE.meanMm,
];
const FULL_SDS: readonly number[] = [
  HVID_SD_MM,
  HVID_SD_MM,
  PALPEBRAL_FISSURE.sdMm,
  PALPEBRAL_FISSURE.sdMm,
];
const FULL_CORR: readonly number[][] = [
  [1, INTEROCULAR_R, HVID_PFL_R, HVID_PFL_R],
  [INTEROCULAR_R, 1, HVID_PFL_R, HVID_PFL_R],
  [HVID_PFL_R, HVID_PFL_R, 1, INTEROCULAR_R],
  [HVID_PFL_R, HVID_PFL_R, INTEROCULAR_R, 1],
];

/**
 * ⭐ Bornes d'information du prior, calculées UNE fois (pire cas sur les
 * corrélations, `robustScaleBound`). Ce sont les planchers de la V2 sans
 * carte : aucune accumulation de frames ne descend en dessous.
 */
export const HVID_ONLY_REL_ERROR = robustScaleBound(HVID_MEANS, HVID_SDS, HVID_CORR);
export const OCULAR_PRIOR_REL_ERROR = robustScaleBound(FULL_MEANS, FULL_SDS, FULL_CORR);

/**
 * Écart toléré entre la fente palpébrale observée (convertie par l'échelle
 * iris) et sa moyenne adulte, en écarts-types adultes. Au-delà, la fente est
 * écartée : soit un enfant (fente non mature), soit un œil mi-clos, soit un
 * landmark décroché — trois cas où l'imposer fausserait l'échelle.
 */
export const PFL_GATE_SD = 2;

/** Les quatre longueurs, en pixels, sur UNE frame. */
export interface OcularPixels {
  hvidLeftPx: number;
  hvidRightPx: number;
  pflLeftPx: number;
  pflRightPx: number;
}

/** Lit les quatre longueurs sur les landmarks. Pure lecture, aucun seuil. */
export function ocularPixelsOf(
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
): OcularPixels {
  return {
    hvidLeftPx: dist(px(at(lm, IRIS_L_OUTER), w, h), px(at(lm, IRIS_L_INNER), w, h)),
    hvidRightPx: dist(px(at(lm, IRIS_R_OUTER), w, h), px(at(lm, IRIS_R_INNER), w, h)),
    pflLeftPx: dist(px(at(lm, EYE_L), w, h), px(at(lm, EYE_L_INNER), w, h)),
    pflRightPx: dist(px(at(lm, EYE_R), w, h), px(at(lm, EYE_R_INNER), w, h)),
  };
}

export interface EyePlaneScale {
  /** Échelle au plan des yeux. MESURÉ (pixels) × PRIOR (millimètres). */
  mmPerPx: number;
  /** Borne du prior utilisé — jamais plus optimiste que le plancher biologique. */
  relError: number;
  /** Vrai si les fentes palpébrales ont concordé et participé à la fusion. */
  pflUsed: boolean;
}

/**
 * Échelle mm/px AU PLAN DES YEUX, estimée sur une frame.
 *
 * @returns null si les iris ne sont pas exploitables (œil fermé, profil).
 */
export function eyePlaneScale(p: OcularPixels): EyePlaneScale | null {
  if (!(p.hvidLeftPx > 1) || !(p.hvidRightPx > 1)) return null;

  const base = scaleFromOcular(
    [p.hvidLeftPx, p.hvidRightPx],
    HVID_MEANS,
    covarianceOf(HVID_SDS, HVID_CORR),
  );
  if (!Number.isFinite(base.mmPerPx) || base.mmPerPx <= 0) return null;

  // La fente palpébrale n'entre que si, convertie par l'échelle iris, elle
  // tombe dans la plage adulte : gating anti-biais (enfants, œil mi-clos).
  const pflOk = (v: number): boolean =>
    v > 1 &&
    Math.abs(v * base.mmPerPx - PALPEBRAL_FISSURE.meanMm) <=
      PFL_GATE_SD * PALPEBRAL_FISSURE.sdMm;

  if (pflOk(p.pflLeftPx) && pflOk(p.pflRightPx)) {
    const full = scaleFromOcular(
      [p.hvidLeftPx, p.hvidRightPx, p.pflLeftPx, p.pflRightPx],
      FULL_MEANS,
      covarianceOf(FULL_SDS, FULL_CORR),
    );
    if (Number.isFinite(full.mmPerPx) && full.mmPerPx > 0) {
      return { mmPerPx: full.mmPerPx, relError: OCULAR_PRIOR_REL_ERROR, pflUsed: true };
    }
  }

  return { mmPerPx: base.mmPerPx, relError: HVID_ONLY_REL_ERROR, pflUsed: false };
}
