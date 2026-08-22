/**
 * core/verdict.ts — la LÉGENDE CHIFFRÉE (CLAUDE.md §5).
 *
 * ⚠️ Ce module NE DÉCIDE DE RIEN (§0.0.1). Il ne filtre aucun catalogue, ne
 * bloque aucun essayage, ne recommande ni ne classe aucune monture. Il met des
 * chiffres justes sous une image juste. Le nom `verdict` est conservé pour ne
 * pas casser les signatures figées du §7 ; lire « légende », pas « jugement ».
 */

import { at, dist, midpoint, px, type NormalizedLandmark } from './geom.js';
import type { UserCalibration, CalSource } from './calibration.js';
import { totalFrameWidthMm, type FrameSpec } from './frameSpec.js';
import {
  EYE_L,
  EYE_L_INNER,
  EYE_R,
  EYE_R_INNER,
  frameMetrics,
  type FrameMetrics,
} from './faceMetrics.js';
import { spriteToScreen } from './transform.js';
import { BRIDGE_AHEAD_MM, NOMINAL_DISTANCE_MM, planeScale } from './framePlane.js';

export type Status = 'sous-taillee' | 'correcte' | 'surtaillee' | 'indetermine';

export interface SizeVerdict {
  frameWidthMm: number;
  faceWidthMm: number;
  faceWidthUncertaintyMm: number;
  deltaMm: number;
  /** Le seuil effectif de CE visage — il n'est pas constant (voir thresholdFor). */
  thresholdMm: number;
  status: Status;
  decentrementMm: { left: number; right: number } | null;
  /** Traçabilité et affichage SEULEMENT. Aucun calcul ne branche dessus (§4 règle 2). */
  source: CalSource;
}

// ─────────────────────────────────────────────────────────────────────────────
// Règle 1 — le seuil est PROPORTIONNEL et BORNÉ (arbitrage humain)
// ─────────────────────────────────────────────────────────────────────────────

export const THRESHOLD_RATIO = 0.03; // 3 % de la largeur du visage
export const THRESHOLD_MIN_MM = 3; // plancher : sous la précision de mesure, ça n'a plus de sens
export const THRESHOLD_MAX_MM = 5; // plafond : au-delà, la tolérance ne veut plus rien dire

/**
 * Seuil effectif pour CE visage. Jamais de seuil en dur ailleurs.
 *
 * Un seuil fixe de 4 mm était un chiffre d'adulte : sur un visage de 105 mm il
 * est proportionnellement deux fois plus sévère que sur 145 mm — exactement le
 * présupposé de taille interdit au §0.0.3.
 */
export function thresholdFor(faceWidthMm: number): number {
  return Math.min(THRESHOLD_MAX_MM, Math.max(THRESHOLD_MIN_MM, faceWidthMm * THRESHOLD_RATIO));
}

/**
 * ⭐ Correctif B2 — l'incertitude se calcule depuis `relError`, JAMAIS depuis `source`.
 *
 * Arithmétique d'intervalle : on ne conclut que si l'intervalle ENTIER tombe du
 * même côté du seuil. Deux sources de même précision produisent donc exactement
 * le même résultat, quelle que soit leur origine.
 */
export function classify(deltaMm: number, cal: UserCalibration): Status {
  const t = thresholdFor(cal.faceWidthMm);
  const u = cal.faceWidthMm * cal.relError;
  const lo = deltaMm - u;
  const hi = deltaMm + u;

  if (hi < -t) return 'sous-taillee';
  if (lo > t) return 'surtaillee';
  if (lo > -t && hi < t) return 'correcte';
  return 'indetermine'; // l'intervalle chevauche un seuil
}

// ─────────────────────────────────────────────────────────────────────────────
// Règle 2 — décentrement
// ─────────────────────────────────────────────────────────────────────────────

export const DECENTREMENT_THRESHOLD_MM = 3;

/**
 * Incertitude propagée jusqu'au décentrement lui-même.
 *
 * Le décentrement est un petit écart mesuré à ~30 mm du point d'ancrage. Une
 * erreur d'échelle de r % ne le décale que de r % × 30 mm — et non de r % ×
 * largeur du visage. Comparer `relError` au seuil de 3 mm, comme le faisait la
 * version d'origine, revenait à comparer une erreur d'échelle relative à un
 * écart absolu : ±6 mm sur la LARGEUR DU VISAGE ne fait pas ±6 mm sur un
 * DÉCENTREMENT.
 */
export function decentrementUncertaintyMm(spec: FrameSpec, cal: UserCalibration): number {
  const leverPx = Math.abs(spec.lensCenterL.x - spec.bridgeCenter.x);
  const leverMm = leverPx / spec.spritePxPerMm;
  return leverMm * cal.relError;
}

/**
 * Écart horizontal œil ↔ centre optique, projeté sur l'axe HORIZONTAL DE LA MONTURE.
 *
 * ⚠️ Volontairement pas `dist()` : une distance euclidienne mélangerait le
 * décentrement (horizontal, qui traduit un pont inadapté) avec l'erreur de pose
 * verticale, laquelle relève de VERTICAL_OFFSET_MM et n'est pas encore calibrée.
 * On mesurerait alors le réglage vertical en croyant mesurer le nez.
 */
function horizontalOffsetMm(
  eyeOuter: NormalizedLandmark,
  eyeInner: NormalizedLandmark,
  lensCenterSprite: { x: number; y: number },
  spec: FrameSpec,
  m: FrameMetrics,
  w: number,
  h: number,
  distanceMm: number | undefined,
): number {
  const eye = midpoint(px(eyeOuter, w, h), px(eyeInner, w, h));
  const lens = spriteToScreen(lensCenterSprite, spec, m);
  const ux = Math.cos(m.rollRad);
  const uy = Math.sin(m.rollRad);
  const dxPx = (eye.x - lens.x) * ux + (eye.y - lens.y) * uy;
  // ⭐ Le centre optique est sur la FACE AVANT de la monture, au plan du pont.
  // C'est donc l'échelle de ce plan-là qui convertit l'écart en millimètres —
  // avec la distance MESURÉE de la calibration quand elle existe (guide pt 38),
  // le nominal n'étant plus qu'un dernier recours.
  return Math.abs(dxPx) / planeScale(m.livePxPerMm, BRIDGE_AHEAD_MM, distanceMm ?? NOMINAL_DISTANCE_MM);
}

// ─────────────────────────────────────────────────────────────────────────────
// Règle 3 — conditions de pose
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_YAW_RAD = (12 * Math.PI) / 180;
export const MAX_ROLL_RAD = (15 * Math.PI) / 180;

// ─────────────────────────────────────────────────────────────────────────────
// La constante de correction — appliquée ICI, et nulle part ailleurs (§7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Écart entre les landmarks 234/454 et les tempes anatomiques : 5 à 10 mm,
 * c'est-à-dire DAVANTAGE que le seuil de décision lui-même.
 *
 * ⚠️ VALEUR NON ENCORE CALIBRÉE. Tant qu'elle vaut 0, la légende est
 * systématiquement décalée d'un cran. Protocole au §5, exécution au lot 8.
 * Ne jamais la retoucher pour faire passer un test.
 */
export const FACE_WIDTH_CORRECTION_MM = 0; // calibrée le : —  | sur N mesures : 0

/**
 * Second paramètre du même écart, en PROPORTION.
 *
 * L'écart entre les repères et la largeur réelle peut être un décalage
 * constant en millimètres, ou une proportion qui suit la taille de la tête.
 * Les premières mesures ne permettent pas de trancher : les deux modèles
 * laissent la même erreur résiduelle. `prep/fitCorrection.ts` ajuste les deux
 * et laisse une validation croisée par sujet choisir.
 *
 * À 1, ce paramètre est neutre : seul le décalage agit. Un seul des deux est
 * publié à la fois — jamais les deux, sous peine d'ajuster deux fois le même
 * écart et de perdre toute lisibilité sur ce qui a été mesuré.
 */
export const FACE_WIDTH_CORRECTION_RATIO = 1; // calibré le : —  | sur N mesures : 0

/**
 * La largeur à laquelle on compare la monture, et son incertitude.
 *
 * ⭐ Deux chemins, dans cet ordre de préférence :
 *
 *  1. l'écart temporal **mesuré sur ce client** pendant la calibration
 *     (`core/temporalWidth.ts`) — la largeur de sa tête à hauteur des yeux ;
 *  2. à défaut, l'écartement des repères 234/454 corrigé par les deux
 *     constantes ci-dessus, qui valent aujourd'hui « aucune correction » —
 *     ce repli s'AFFICHE (largeur estimée + marge) mais ne porte JAMAIS un
 *     statut catégorique (ré-audit A16, voir `verdict()`).
 *
 * ⚠️ Ce n'est PAS un branchement sur la source (§4 règle 2) : la question posée
 * est « cette grandeur a-t-elle été mesurée ? », pas « d'où vient-elle ? ». Une
 * calibration carte sans rotation et une calibration iris prennent exactement le
 * même chemin ici, comme l'exige le garde-fou §11.4.
 */
export function comparisonWidth(cal: UserCalibration): { mm: number; relError: number } {
  const measured = cal.temporalWidthMm;
  const measuredRel = cal.temporalRelError;
  if (measured !== undefined && measuredRel !== undefined) {
    return { mm: measured, relError: measuredRel };
  }
  return {
    mm: cal.faceWidthMm * FACE_WIDTH_CORRECTION_RATIO + FACE_WIDTH_CORRECTION_MM,
    relError: cal.relError,
  };
}

/**
 * Assemble tout. SEUL point d'entrée de la légende — l'UI n'appelle rien d'autre.
 *
 * @returns null si aucune calibration, ou si la pose est hors tolérance (règle 3).
 *          Un null n'est PAS une erreur : c'est « je ne peux pas répondre », et
 *          l'UI doit l'afficher comme tel, jamais le remplacer par une valeur
 *          par défaut. Le null gèle LA LÉGENDE, jamais L'IMAGE (§0.0.2).
 *
 * ⚠️ Écart assumé avec le §7 d'origine, qui figeait 5 paramètres : `yawRad` est
 * indispensable ici, puisque la règle 3 refuse justement de répondre au-delà de
 * 12° de yaw. Sans ce paramètre, la règle 3 était inimplémentable. Documenté
 * comme trou de contrat T9.
 */
export function verdict(
  lm: readonly NormalizedLandmark[],
  cal: UserCalibration | null,
  spec: FrameSpec,
  w: number,
  h: number,
  yawRad: number,
): SizeVerdict | null {
  if (cal === null) return null;

  const m = frameMetrics(lm, w, h, cal, yawRad);

  // Règle 3 — jamais de chiffre à l'air confiant sur une mesure dégradée.
  if (Math.abs(m.yawRad) > MAX_YAW_RAD) return null;
  if (Math.abs(m.rollRad) > MAX_ROLL_RAD) return null;

  const compared = comparisonWidth(cal);
  const faceWidthMm = compared.mm;
  const corrected: UserCalibration = { ...cal, faceWidthMm, relError: compared.relError };

  const frameWidthMm = totalFrameWidthMm(spec);
  const deltaMm = frameWidthMm - faceWidthMm;

  // ⭐ Ré-audit A16 — un statut CATÉGORIQUE exige une largeur MESURÉE sur ce
  // client (l'écart temporal). Le repli 234/454 dépend de constantes NON
  // CALIBRÉES (ratio = 1, décalage = 0 mm) dont l'écart connu aux tempes
  // anatomiques (5–10 mm) dépasse le seuil de décision lui-même (3–5 mm) :
  // la largeur estimée et sa marge restent AFFICHÉES, le statut reste
  // 'indetermine' — qui n'est de toute façon jamais montré comme un jugement
  // (§0.0.1). Question posée à la DONNÉE, jamais à la source (§4 règle 2).
  const widthMeasured = cal.temporalWidthMm !== undefined && cal.temporalRelError !== undefined;

  // Le décentrement n'est affiché que si la mesure peut réellement trancher
  // les 3 mm. Masqué s'il n'est pas concluant — pas approximé, masqué.
  //
  // ⚠️ Il se propage depuis l'incertitude d'ÉCHELLE (`cal.relError`), pas depuis
  // celle de l'écart temporal : le décentrement est une longueur mesurée à
  // l'écran, il ne dépend pas de la largeur à laquelle on compare la monture.
  const u = decentrementUncertaintyMm(spec, cal);
  const conclusive = u < DECENTREMENT_THRESHOLD_MM / 2;

  const decentrementMm = conclusive
    ? {
        left: horizontalOffsetMm(at(lm, EYE_L), at(lm, EYE_L_INNER), spec.lensCenterL, spec, m, w, h, cal.distanceMm),
        right: horizontalOffsetMm(at(lm, EYE_R), at(lm, EYE_R_INNER), spec.lensCenterR, spec, m, w, h, cal.distanceMm),
      }
    : null;

  return {
    frameWidthMm,
    faceWidthMm,
    faceWidthUncertaintyMm: faceWidthMm * compared.relError,
    deltaMm,
    thresholdMm: thresholdFor(faceWidthMm),
    status: widthMeasured ? classify(deltaMm, corrected) : 'indetermine',
    decentrementMm,
    source: cal.source,
  };
}

/**
 * Libellé destiné à l'écran. Deux chiffres et leurs marges — jamais un jugement.
 * `'indetermine'` ne produit AUCUN libellé de statut (§0.0.1).
 */
export function legend(v: SizeVerdict): string {
  const u = v.faceWidthUncertaintyMm;
  return (
    `monture ${v.frameWidthMm.toFixed(0)} mm · ` +
    `votre visage ${v.faceWidthMm.toFixed(0)} mm (± ${u.toFixed(0)} mm)`
  );
}

/** Exportée pour l'overlay : distance entre les deux coins externes des yeux. */
export function eyeSpanPx(lm: readonly NormalizedLandmark[], w: number, h: number): number {
  return dist(px(at(lm, EYE_L), w, h), px(at(lm, EYE_R), w, h));
}
