/**
 * core/calibration.ts — Échelle 2 : le visage réel (CLAUDE.md §4).
 *
 * ⚠️ SEUL fichier du projet autorisé à lire ou écrire `cal.source`.
 * Partout ailleurs, brancher sur la source est interdit (§4 règle 2, §11.4) :
 * la question légitime porte sur la PRÉCISION (`relError`), jamais sur l'ORIGINE.
 */

import { at, CalibrationError, dist, px, type NormalizedLandmark } from './geom.js';
import { FACE_L, FACE_R } from './faceMetrics.js';
import type { FrameSpec } from './frameSpec.js';

export type CalSource = 'iris' | 'card' | 'worn-frame';

export interface UserCalibration {
  faceWidthMm: number;
  source: CalSource;
  /** iris 0.043 | carte 0.025 (B4) | monture portée 0.02 (T8) */
  relError: number;
  measuredAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plage de plausibilité — correctif B5
// ─────────────────────────────────────────────────────────────────────────────

export const FACE_WIDTH_MIN_MM = 95; // enfant de ~3 ans, marge basse
export const FACE_WIDTH_MAX_MM = 175; // adulte à très forte carrure, marge haute

const CAUSE_BY_SOURCE: Record<CalSource, string> = {
  iris:
    `La mesure automatique des yeux a probablement échoué. ` +
    `Si vous portez des lunettes, retirez-les et recommencez.`,
  card:
    `Le cadre a probablement été mal ajusté sur les bords de la carte. ` +
    `Recommencez en suivant bien le contour.`,
  'worn-frame':
    `La monture de référence sélectionnée ne correspond probablement pas ` +
    `à celle qui est portée, ou ses bords ont été mal pointés.`,
};

/**
 * ⭐ Correctif B5 — la plage 118–165 mm rejetait les visages d'enfants,
 * c'est-à-dire précisément la clientèle des montures à 80 mm.
 *
 * ⚠️ Ce contrôle est un DÉTECTEUR DE PANNE, pas un critère d'éligibilité.
 * Il n'existe que pour attraper une calibration ratée. Il ne doit jamais
 * servir à refuser un client (§0.0.1).
 */
export function assertPlausibleFaceWidth(mm: number, source: CalSource): void {
  if (Number.isFinite(mm) && mm >= FACE_WIDTH_MIN_MM && mm <= FACE_WIDTH_MAX_MM) return;
  throw new CalibrationError(`Mesure obtenue : ${mm.toFixed(1)} mm. ${CAUSE_BY_SOURCE[source]}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Niveau 1 — l'iris (par défaut, zéro friction)
// ─────────────────────────────────────────────────────────────────────────────

export const IRIS_DIAMETER_MM = 11.7; // Google Research, MediaPipe Iris (±0.5 mm)
export const IRIS_REL_ERROR = 0.043; // 4,3 % — plancher biologique, non réductible

/** Levée quand le client porte des lunettes : l'appelant DOIT basculer sur la carte. */
export class GlassesDetectedError extends CalibrationError {
  constructor() {
    super(
      `Des lunettes ont été détectées devant les yeux. La mesure par l'iris serait faussée ` +
        `de 10 % environ par vos verres correcteurs. Retirez-les, ou utilisez une carte bancaire.`,
    );
    this.name = 'GlassesDetectedError';
  }
}

/**
 * ⭐ Correctif S2 — à appeler AVANT `calibrateWithIris`, jamais après.
 *
 * Un myope à −6 D voit son iris minifié d'environ 10 % par ses propres verres,
 * soit 2 à 3 fois le plancher biologique de 4,3 %. L'iris reste net, rond,
 * parfaitement détecté : la mesure est fausse et paraît excellente.
 *
 * En cas de doute, on demande la carte. Le doute coûte deux secondes ;
 * une mesure fausse coûte un retour produit.
 */
export function assertIrisUsable(glassesDetected: boolean): void {
  if (glassesDetected) throw new GlassesDetectedError();
}

/** Échelle automatique. Moyenner les DEUX yeux sur ~30 frames pour tuer le bruit de détection. */
export function scaleFromIris(irisWidthPx: number): number {
  return irisWidthPx / IRIS_DIAMETER_MM; // px par mm
}

/**
 * Pont obligatoire vers UserCalibration. NE PAS improviser une autre voie.
 * L'échelle iris est convertie UNE FOIS en largeur de visage, exactement comme
 * le fait la carte. Ensuite les trois modes suivent le même chemin en aval.
 */
export function calibrateWithIris(
  irisWidthPx: number,
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
): UserCalibration {
  const pxPerMm = scaleFromIris(irisWidthPx);
  const faceWidthMm = dist(px(at(lm, FACE_L), w, h), px(at(lm, FACE_R), w, h)) / pxPerMm;

  assertPlausibleFaceWidth(faceWidthMm, 'iris');
  return { faceWidthMm, source: 'iris', relError: IRIS_REL_ERROR, measuredAt: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Niveau 2 — la carte bancaire (déclenchée en zone grise)
// ─────────────────────────────────────────────────────────────────────────────

export const CARD_WIDTH_MM = 85.6; // norme ISO/IEC 7810 ID-1

/**
 * ⚠️ Correctif B4 — 2,5 %, PAS 1,5 %.
 *
 * La carte est posée sur le FRONT ; les landmarks 234/454 sont 20 à 35 mm en
 * arrière. En projection perspective l'échelle varie en 1/z, ce qui produit un
 * biais SYSTÉMATIQUE de 4 à 7 % à 50 cm. Les « 3 mesures concordantes » ne le
 * détectent pas : elles le confirment, puisqu'elles partagent le même biais.
 *
 * Tant que ce biais n'est pas mesuré (rotation de tête, cf. §4), on n'annonce
 * pas une précision qu'on n'a pas vérifiée.
 */
export const CARD_REL_ERROR = 0.025;

export const CARD_MIN_DISTANCE_MM = 600; // en deçà, la parallaxe devient dominante

/**
 * Champ de vision horizontal supposé d'une webcam grand public.
 *
 * ⚠️ N'entre PAS dans la chaîne de mesure. Sert uniquement à afficher
 * « reculez un peu » : une estimation grossière suffit pour cela, et une
 * erreur de 20 % sur cette valeur ne fausse aucune mesure en millimètres.
 */
const ASSUMED_HFOV_DEG = 60;

/** Distance caméra→carte, approximative, à usage d'IHM seulement (parade B4 n°1). */
export function estimateDistanceMm(cardWidthPx: number, imageWidthPx: number): number {
  if (cardWidthPx <= 0) return Infinity;
  const focalPx = imageWidthPx / 2 / Math.tan((ASSUMED_HFOV_DEG / 2) * (Math.PI / 180));
  return (focalPx * CARD_WIDTH_MM) / cardWidthPx;
}

/** Vrai si le client est trop près pour que la parallaxe reste tolérable. */
export function isTooCloseForCard(cardWidthPx: number, imageWidthPx: number): boolean {
  return estimateDistanceMm(cardWidthPx, imageWidthPx) < CARD_MIN_DISTANCE_MM;
}

/**
 * La carte ne sert PAS à mesurer la carte : elle sert à mesurer le VISAGE.
 * Une fois le visage connu en mm, il devient sa propre règle graduée
 * et la carte peut être retirée définitivement.
 */
export function calibrateWithCard(
  cardWidthPx: number,
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
): UserCalibration {
  const mmPerPx = CARD_WIDTH_MM / cardWidthPx;
  const faceWidthMm = dist(px(at(lm, FACE_L), w, h), px(at(lm, FACE_R), w, h)) * mmPerPx;

  assertPlausibleFaceWidth(faceWidthMm, 'card');
  return { faceWidthMm, source: 'card', relError: CARD_REL_ERROR, measuredAt: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 — la monture portée comme étalon (§11.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⭐ Correctif T8 — 2 %, pas 1 %.
 *
 * 1 % supposait deux clics d'opticien justes à 4 px près sur 400, sur un bord
 * d'acétate flou et arrondi, PLUS le même biais de profondeur que la carte (B4).
 * Reste la source la plus précise des trois, mais annoncée à sa valeur réelle.
 */
export const WORN_FRAME_REL_ERROR = 0.02;

/**
 * Mode magasin : la monture PORTÉE sert d'étalon.
 * Même signature de sortie que les deux autres → tout l'aval est inchangé.
 */
export function calibrateWithWornFrame(
  wornFrameWidthPx: number,
  wornFrameSpec: FrameSpec,
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
): UserCalibration {
  const pxPerMm = wornFrameWidthPx / wornFrameSpec.totalWidthMm;
  const faceWidthMm = dist(px(at(lm, FACE_L), w, h), px(at(lm, FACE_R), w, h)) / pxPerMm;

  assertPlausibleFaceWidth(faceWidthMm, 'worn-frame');
  return {
    faceWidthMm,
    source: 'worn-frame',
    relError: WORN_FRAME_REL_ERROR,
    measuredAt: Date.now(),
  };
}
