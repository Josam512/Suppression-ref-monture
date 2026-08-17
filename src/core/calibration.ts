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
import { refineCard, type Refinement, type TemporalScene } from './cardRefinement.js';
import { CARD_WIDTH_MM } from './cardOptics.js';
import type { RotatedView } from './parallax.js';

/**
 * Ré-exports de commodité : la carte et sa distance vivent dans
 * `core/cardOptics.ts` (optique pure), mais tout l'aval les importe depuis ici.
 */
export { ASSUMED_HFOV_DEG, CARD_HEIGHT_MM, CARD_TO_TEMPLE_DEPTH_MM } from './cardOptics.js';
export { CARD_WIDTH_MM, ISO_ID1_OBJECTS, estimateDistanceMm } from './cardOptics.js';
export { parallaxRelErrorAt, parallaxRelErrorFromCard } from './cardOptics.js';

export type CalSource = 'iris' | 'card' | 'worn-frame';

export interface UserCalibration {
  /**
   * Largeur RÉELLE du segment 234↔454, en mm. C'est elle, et elle seule, qui
   * pilote l'échelle de rendu dans `frameMetrics` : elle doit rester la
   * grandeur homologue de `faceWidthPx`, jamais l'écart temporal.
   */
  faceWidthMm: number;
  source: CalSource;
  /** iris 0.043 | carte 0.025 (B4) | monture portée 0.02 (T8) */
  relError: number;
  measuredAt: number;

  /**
   * ⭐ Écart temporal MESURÉ sur ce client — la largeur de sa tête à hauteur
   * des yeux, là où passe la face d'une monture (`core/temporalWidth.ts`).
   *
   * ⚠️ Champ AJOUTÉ au contrat sur arbitrage humain du 2026-08-17 : « pour la
   * v1 on dira carte obligatoire une fois au début et tu te débrouilles pour la
   * mesure de l'écart temporal ». Il supplante `FACE_WIDTH_CORRECTION_MM`, qui
   * demandait à une constante unique de représenter un écart de ~20 mm variant
   * d'au moins ±4 mm d'un visage à l'autre.
   *
   * Absent quand la mesure n'a pas abouti : dans ce cas, et dans ce cas
   * seulement, la constante reprend la main.
   */
  temporalWidthMm?: number;
  /** Incertitude relative propre à l'écart temporal. Absente avec lui. */
  temporalRelError?: number;
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

/**
 * Incertitude de pointage des DEUX bords de la carte sur l'image figée.
 *
 * Deux poignées posées à ~3 px près sur une carte qui en fait 300 : c'est le
 * seul terme irréductible de la calibration carte, une fois la parallaxe
 * mesurée. Le reste — les 2,5 % annoncés jusqu'ici — était du biais, pas du
 * bruit, et un biais ne se moyenne pas.
 */
export const CARD_CLICK_REL_ERROR = 0.01;

/** Tout ce que la mesure a produit, au-delà de la calibration elle-même. */
export interface MeasuredCardCalibration {
  cal: UserCalibration;
  refinement: Refinement;
}

/**
 * ⭐ V1 — la carte, une seule fois, complétée par la rotation de tête.
 *
 * ADDITIVE : `calibrateWithCard` reste le chemin nominal du §4. Celle-ci fait
 * trois choses de plus, toutes mesurées — parallaxe B4 corrigée au lieu d'être
 * supposée nulle, écart temporal mesuré au lieu d'une constante, `relError`
 * recalculée sur ce qui a réellement été mesuré. Aucune n'est obligatoire :
 * chacune peut échouer, et la calibration reste celle du §4, annoncée pour ce
 * qu'elle est.
 */
export function calibrateWithCardMeasured(
  cardWidthPx: number,
  imageWidthPx: number,
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
  views: readonly RotatedView[] | null,
  scene: TemporalScene | null,
  /**
   * Distance MESURÉE sur la carte (`core/cardSweep.ts`), ou `null`. Optionnelle
   * et en dernier : son absence n'est pas une erreur, c'est une marge plus
   * large (§14.5).
   */
  measuredDistance: { cardDistanceMm: number; relError: number } | null = null,
): MeasuredCardCalibration {
  void imageWidthPx; // ⭐ plus aucune estimation de distance ici : elle est MESURÉE.
  const naive = calibrateWithCard(cardWidthPx, lm, w, h);

  const refinement = refineCard({
    pxPerMmCard: cardWidthPx / CARD_WIDTH_MM,
    naiveFaceWidthMm: naive.faceWidthMm,
    clickRelError: CARD_CLICK_REL_ERROR,
    views,
    scene,
    measuredDistance,
  });

  const faceWidthMm = naive.faceWidthMm * refinement.parallaxFactor;
  assertPlausibleFaceWidth(faceWidthMm, 'card');

  const cal: UserCalibration = {
    faceWidthMm,
    source: 'card',
    relError: refinement.scaleRelError,
    measuredAt: Date.now(),
  };

  // L'écart temporal est une largeur de visage : il passe le même détecteur de
  // panne que les autres. S'il le rate, on ne le publie pas — on ne le corrige
  // surtout pas pour qu'il rentre.
  const temporal = refinement.temporal;
  if (temporal !== null && temporal.measured) {
    try {
      assertPlausibleFaceWidth(temporal.widthMm, 'card');
      cal.temporalWidthMm = temporal.widthMm;
      cal.temporalRelError = temporal.relError;
    } catch (err) {
      refinement.notes.push(
        `Écart temporal écarté : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { cal, refinement };
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
