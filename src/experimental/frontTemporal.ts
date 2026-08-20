/**
 * experimental/frontTemporal.ts — 🧪 PROTOTYPE : écart temporal sur UNE VUE
 * FRONTALE, par segmentation sémantique (mission 2026-08-20, §2–3).
 *
 * ⚠️ HORS PRODUCTION. Aucun fichier de `src/core`, `src/render`, `src/ui` ou
 * `src/tracking` n'importe ce module : c'est le feature flag — brancher le
 * candidat exigerait un import explicite, validé par l'humain. Le moteur
 * existant (silhouette + rotation, `core/temporalWidth.ts`) reste la référence
 * comparative interne — PAS une vérité terrain clinique.
 *
 * ## Principe
 *
 * landmarks → ligne des yeux → masque de segmentation (visage/cheveux/fond)
 * → bords latéraux de PEAU → conversion px/mm avec l'échelle EXISTANTE
 * → temporalWidthCandidate + confidence.
 *
 * Le masque vient de MediaPipe Image Segmenter (selfie_multiclass_256x256,
 * même runtime que le FaceLandmarker déjà vendorisé). Ce module n'en dépend
 * PAS : il reçoit un masque de classes déjà calculé, donc il se teste en
 * calcul pur et le modèle reste hors du bundle de production.
 *
 * ## Ce que ce prototype REFUSE de faire
 *
 * 🔴 Mesurer la largeur des CHEVEUX en prétendant que c'est la tempe. Quand la
 * peau s'arrête contre des cheveux, la vraie tempe peut être DESSOUS : le bord
 * est alors classé « occulté », la confiance chute, et si trop de lignes sont
 * occultées la mesure est refusée — jamais complétée par une valeur inventée.
 */

import { at, px, type NormalizedLandmark } from '../core/geom.js';
import { EYE_L, EYE_R, FACE_L, FACE_R } from '../core/faceMetrics.js';
import { MAX_TEMPLE_MARGIN_MM, MIN_TEMPLE_MARGIN_MM } from '../core/temporalRefusals.js';

/** Classes du modèle selfie_multiclass_256x256, dans l'ordre de sa sortie. */
export const SEG_BACKGROUND = 0;
export const SEG_HAIR = 1;
export const SEG_BODY_SKIN = 2;
export const SEG_FACE_SKIN = 3;
export const SEG_CLOTHES = 4;
export const SEG_OTHERS = 5;

/** Masque de classes, une valeur SEG_* par pixel (résolution propre au modèle). */
export interface SegMask {
  w: number;
  h: number;
  classes: Uint8Array; // index y * w + x
}

export interface FrontTemporalInput {
  mask: SegMask;
  lm: readonly NormalizedLandmark[];
  /** Dimensions de l'IMAGE (le masque est rééchantillonné dessus). */
  w: number;
  h: number;
  /** Échelle au plan des tempes, issue de la calibration EXISTANTE. */
  pxPerMmTemple: number;
  scaleRelError: number;
}

export interface FrontTemporalCandidate {
  widthMm: number;
  relError: number;
  /** 0..1 — fraction de lignes propres, pénalisée par l'asymétrie. */
  confidence: number;
  measured: boolean;
  reason: string | null;
  marginMm: { left: number; right: number };
  /** Fraction de lignes dont le bord bute sur des CHEVEUX, par côté. */
  hairBounded: { left: number; right: number };
}

/** Lignes balayées autour de la ligne des yeux — même logique que le moteur rotation. */
export const FT_ROWS = 7;
export const FT_ROW_STEP_PX = 3;
const MIN_CLEAN_ROWS = 3;
/** Bande inspectée AU-DELÀ du bord de peau pour qualifier ce qui l'arrête, en mm. */
const BEYOND_BAND_MM = 4;
/** Le bord d'un masque 256×256 sur une image 1280 px vaut ±2,5 px image : dit, pas caché. */
export const FT_EDGE_NOISE_FRACTION = 0.5; // ± une demi-cellule de masque

function classAt(mask: SegMask, imgW: number, imgH: number, x: number, y: number): number {
  const mx = Math.min(mask.w - 1, Math.max(0, Math.round((x / imgW) * mask.w)));
  const my = Math.min(mask.h - 1, Math.max(0, Math.round((y / imgH) * mask.h)));
  return mask.classes[my * mask.w + mx] ?? SEG_BACKGROUND;
}

const isSkin = (c: number): boolean => c === SEG_FACE_SKIN || c === SEG_BODY_SKIN;

interface RowEdge {
  x: number;
  /**
   * 'clean' = fond/vêtement au-delà (vraie frontière tête/monde) ;
   * 'hair' = cheveux collés au bord (la tempe peut être dessous) ;
   * 'accessory' = classe « autres » collée au bord — branche de lunettes
   * PORTÉE, exactement le piège que le moteur rotation refuse aussi ;
   * 'none' = pas de peau trouvée sur cette ligne.
   */
  kind: 'clean' | 'hair' | 'accessory' | 'none';
}

/** Dernier pixel de PEAU en partant du repère facial vers l'extérieur. */
function skinEdge(input: FrontTemporalInput, y: number, fromX: number, dir: -1 | 1): RowEdge {
  const { mask, w, h, pxPerMmTemple } = input;
  const maxPx = Math.round(MAX_TEMPLE_MARGIN_MM * pxPerMmTemple);

  // Le repère 234/454 peut tomber SUR un occulteur (branche portée, mèche) :
  // on cherche d'abord une graine de peau en glissant vers l'INTÉRIEUR, sans
  // jamais dépasser le débord maximal — au-delà, la ligne est inexploitable.
  let seed = fromX;
  for (let k = 0; k <= maxPx; k++) {
    const x = fromX - dir * k;
    if (x < 0 || x >= w) break;
    if (isSkin(classAt(mask, w, h, x, y))) {
      seed = x;
      break;
    }
    if (k === maxPx) return { x: fromX, kind: 'none' };
  }
  if (!isSkin(classAt(mask, w, h, seed, y))) return { x: fromX, kind: 'none' };

  let edge = seed;
  for (let k = 1; k <= maxPx + Math.abs(seed - fromX); k++) {
    const x = seed + dir * k;
    if (x < 0 || x >= w) break;
    if (isSkin(classAt(mask, w, h, x, y))) edge = x;
    else break;
  }

  // Qu'est-ce qui arrête la peau ? Des cheveux collés au bord peuvent recouvrir
  // la vraie tempe ; la classe « autres » collée au bord à hauteur des yeux est
  // une branche de lunettes portée. Dans les deux cas le bord de peau N'EST PAS
  // la tempe : la ligne est occultée, jamais convertie en millimètres.
  const bandPx = Math.max(2, Math.round(BEYOND_BAND_MM * pxPerMmTemple));
  for (let k = 1; k <= bandPx; k++) {
    const x = edge + dir * k;
    if (x < 0 || x >= w) break;
    const c = classAt(mask, w, h, x, y);
    if (c === SEG_HAIR) return { x: edge, kind: 'hair' };
    if (c === SEG_OTHERS) return { x: edge, kind: 'accessory' };
  }
  return { x: edge, kind: 'clean' };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
}

/**
 * Estime la largeur de la tête à hauteur des yeux, sans rotation.
 *
 * Les bords viennent de la frontière PEAU/non-peau du masque, jamais des
 * cheveux ; la plausibilité réutilise les mêmes bornes de débord (1–18 mm par
 * côté) que le moteur rotation, pour que les deux refusent les mêmes horreurs.
 */
export function frontOnlyTemporalCandidate(input: FrontTemporalInput): FrontTemporalCandidate {
  const { lm, w, h, pxPerMmTemple } = input;
  const eyeY = Math.round((px(at(lm, EYE_L), w, h).y + px(at(lm, EYE_R), w, h).y) / 2);
  const fL = px(at(lm, FACE_L), w, h);
  const fR = px(at(lm, FACE_R), w, h);
  const innerLeft = Math.round(Math.min(fL.x, fR.x));
  const innerRight = Math.round(Math.max(fL.x, fR.x));

  const clean = { left: [] as number[], right: [] as number[] };
  const hairRows = { left: 0, right: 0 };
  let accessoryRows = 0;
  const first = -Math.floor(FT_ROWS / 2);
  for (let k = 0; k < FT_ROWS; k++) {
    const y = eyeY + (first + k) * FT_ROW_STEP_PX;
    const l = skinEdge(input, y, innerLeft, -1);
    const r = skinEdge(input, y, innerRight, 1);
    if (l.kind === 'clean') clean.left.push(l.x);
    else if (l.kind === 'hair') hairRows.left++;
    else if (l.kind === 'accessory') accessoryRows++;
    if (r.kind === 'clean') clean.right.push(r.x);
    else if (r.kind === 'hair') hairRows.right++;
    else if (r.kind === 'accessory') accessoryRows++;
  }

  const hairBounded = { left: hairRows.left / FT_ROWS, right: hairRows.right / FT_ROWS };
  const fail = (reason: string): FrontTemporalCandidate => ({
    widthMm: 0,
    relError: 1,
    confidence: 0,
    measured: false,
    reason,
    marginMm: { left: 0, right: 0 },
    hairBounded,
  });

  if (clean.left.length < MIN_CLEAN_ROWS || clean.right.length < MIN_CLEAN_ROWS) {
    if (accessoryRows > hairRows.left + hairRows.right) {
      return fail(
        `Lunettes (ou accessoire) portées à hauteur des yeux : le bord mesuré serait ` +
          `celui de la branche, pas de la tempe. Retirez-les et recommencez — même règle que S2.`,
      );
    }
    return fail(
      hairRows.left + hairRows.right > 0
        ? `Tempe(s) sous les cheveux : le bord de peau n'est pas la tempe. ` +
            `Dégagez les tempes, ou tournez la tête pour la mesure par silhouette.`
        : `Segmentation inexploitable à hauteur des yeux (peau non trouvée).`,
    );
  }

  const left = median(clean.left);
  const right = median(clean.right);
  const widthMm = (right - left) / pxPerMmTemple;
  const marginMm = {
    left: (innerLeft - left) / pxPerMmTemple,
    right: (right - innerRight) / pxPerMmTemple,
  };
  if (marginMm.left < MIN_TEMPLE_MARGIN_MM || marginMm.right < MIN_TEMPLE_MARGIN_MM) {
    return fail(`Aucun débord de peau au-delà des repères : bord non trouvé.`);
  }
  if (marginMm.left > MAX_TEMPLE_MARGIN_MM || marginMm.right > MAX_TEMPLE_MARGIN_MM) {
    return fail(`Débord invraisemblable (${Math.max(marginMm.left, marginMm.right).toFixed(0)} mm).`);
  }

  // Bruit de bord : une demi-cellule de masque par côté, en quadrature ; plus
  // l'échelle. La confiance reflète les lignes perdues et l'asymétrie cheveux.
  const cellPx = w / input.mask.w;
  const edgeRel =
    (FT_EDGE_NOISE_FRACTION * cellPx * Math.SQRT2) /
    Math.sqrt(Math.min(clean.left.length, clean.right.length)) /
    (widthMm * pxPerMmTemple);
  const cleanFraction = (clean.left.length + clean.right.length) / (2 * FT_ROWS);
  const confidence = cleanFraction * (1 - Math.max(hairBounded.left, hairBounded.right));

  return {
    widthMm,
    relError: Math.hypot(input.scaleRelError, edgeRel),
    confidence,
    measured: true,
    reason: null,
    marginMm,
    hairBounded,
  };
}
