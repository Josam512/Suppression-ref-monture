/**
 * core/transform.ts — ⭐ T3 : L'AFFINE UNIQUE sprite → écran (CLAUDE.md §6.1).
 *
 * Le décentrement (§5) projette le centre optique du verre depuis le repère
 * sprite vers l'écran. Le rendu (§6.2) fait exactement la même projection.
 * Si `render/` et `verdict.ts` calculaient chacun la leur, elles divergeraient
 * à la première modification — et le symptôme serait un décentrement faux
 * alors que l'image paraît correcte.
 *
 * ⚠️ `render/` n'a PAS le droit de recomposer sa propre matrice à coups de
 * translate/rotate/scale. Barrage mécanique au §9.0.g.
 */

import { CalibrationError, type Pt } from './geom.js';
import type { FrameSpec } from './frameSpec.js';
import type { FrameMetrics } from './faceMetrics.js';

/**
 * ⭐ T1 — décalage vertical du centre du pont SOUS le sellion, en mm réels.
 *
 * L'ancrage est le sellion (landmark 168, creux entre les yeux), mais une
 * monture ne se pose pas AU sellion : ses plaquettes portent légèrement plus
 * bas sur l'arête du nez.
 *
 * Compté en millimètres réels et converti par `livePxPerMm` — jamais en pixels
 * en dur, sinon la pose changerait avec la distance à la caméra.
 *
 * ⚠️ VALEUR PROVISOIRE — se calibre au lot 8, puis se fige avec sa date.
 * ⚠️ Ce n'est PAS un slider déguisé (§1 bug #1) : c'est une constante
 * d'anatomie, identique pour toutes les montures et tous les clients.
 */
export const VERTICAL_OFFSET_MM = 3; // calibrée le : —  | sur N montures : 0

/** Matrice affine au format `ctx.setTransform(a, b, c, d, e, f)`. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Repère sprite (px, origine au coin du fichier) → repère écran (px).
 * Ancrage sur le centre du pont, rotation de roll, écrasement horizontal de yaw.
 */
export function spriteAffine(spec: FrameSpec, m: FrameMetrics): Affine {
  // Échelle isotrope : le yaw a déjà été retiré de livePxPerMm (S1, moitié 1/2).
  const s = m.livePxPerMm / spec.spritePxPerMm;

  // ⭐ Correctif S1, moitié 2/2 — le cos du yaw, UNE seule fois, sur X seulement.
  // Un yaw ne raccourcit RIEN verticalement : `sy` ne le porte jamais.
  const sx = s * Math.cos(m.yawRad);
  const sy = s;

  const cosR = Math.cos(m.rollRad);
  const sinR = Math.sin(m.rollRad);

  const a = cosR * sx;
  const b = sinR * sx;
  const c = -sinR * sy;
  const d = cosR * sy;

  // Le centre du pont du sprite doit tomber sur l'ancre écran, décalée de
  // VERTICAL_OFFSET_MM vers le bas.
  const anchorX = m.anchor.x;
  const anchorY = m.anchor.y + VERTICAL_OFFSET_MM * m.livePxPerMm;

  const bx = spec.bridgeCenter.x;
  const by = spec.bridgeCenter.y;

  return {
    a,
    b,
    c,
    d,
    e: anchorX - (a * bx + c * by),
    f: anchorY - (b * bx + d * by),
  };
}

/** Applique une affine à un point. Une seule définition, ici (T3). */
export function apply(t: Affine, p: Pt): Pt {
  return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f };
}

/**
 * Applique l'affine à un point du sprite.
 * Utilisée par le rendu ET par le décentrement — c'est tout l'intérêt de T3.
 */
export function spriteToScreen(p: Pt, spec: FrameSpec, m: FrameMetrics): Pt {
  return apply(spriteAffine(spec, m), p);
}

/**
 * Affine inverse : écran → sprite.
 *
 * Indispensable au recoloriage V2 (§11), qui part d'un pixel de la vidéo et doit
 * savoir à quel endroit de la monture il correspond. Elle vit ICI, et non dans
 * `render/`, pour la même raison que l'affine directe : deux définitions de la
 * même géométrie finissent toujours par diverger (T3).
 *
 * @throws si la matrice est dégénérée — ce qui n'arrive que si l'échelle est
 *         nulle, c'est-à-dire si la calibration est absurde. Mieux vaut le
 *         signaler que rendre une matrice de zéros qui replierait tout sur un
 *         point sans que rien ne le dise.
 */
export function invertAffine(t: Affine): Affine {
  const det = t.a * t.d - t.b * t.c;
  if (det === 0 || !Number.isFinite(det)) {
    throw new CalibrationError(
      `Transformée sprite → écran non inversible (déterminant ${det}). ` +
        `L'échelle de rendu est nulle : la calibration est à refaire.`,
    );
  }
  const a = t.d / det;
  const b = -t.b / det;
  const c = -t.c / det;
  const d = t.a / det;
  return { a, b, c, d, e: -(a * t.e + c * t.f), f: -(b * t.e + d * t.f) };
}

/**
 * Largeur de la monture telle qu'elle est RENDUE à l'écran, en pixels.
 *
 * Mesurée le long de l'axe horizontal du sprite : la rotation de roll ne change
 * pas une longueur. Sert au test INVARIANT de distance (§8, correctif S4).
 */
export function renderedFrameWidthPx(spec: FrameSpec, m: FrameMetrics): number {
  const s = m.livePxPerMm / spec.spritePxPerMm;
  return spec.alphaBBox.w * s * Math.cos(m.yawRad);
}

/**
 * Hauteur rendue. Ne dépend PAS du yaw — c'est la signature du bug S1,
 * et le seul moyen de l'attraper sans œil humain (§8).
 */
export function renderedFrameHeightPx(spec: FrameSpec, m: FrameMetrics): number {
  const s = m.livePxPerMm / spec.spritePxPerMm;
  return spec.alphaBBox.h * s;
}


/**
 * Affine de la BRANCHE (CLAUDE.md §6).
 *
 * Une branche n'est pas une face : elle est perpendiculaire a celle-ci. Sa
 * projection ne se raccourcit donc pas en cos(yaw) mais grandit en sin(yaw) —
 * nulle de face, maximale de profil. Elle est ancree a la CHARNIERE, au bord
 * externe de la face, et non au centre du pont.
 *
 * ⚠️ Une premiere implementation appliquait a la branche l'affine de la face.
 * La branche etait alors posee au centre du visage et retrecissait quand la
 * tete tournait — soit l'exact inverse du comportement physique.
 *
 * @param side +1 si la branche visible est celle de droite du sprite, -1 sinon.
 */
export function templeAffine(spec: FrameSpec, m: FrameMetrics, side: 1 | -1): Affine {
  const profileScale = spec.profilePxPerMm ?? spec.spritePxPerMm;
  const s = m.livePxPerMm / profileScale;

  // ⭐ Le sin, symetrique du cos de la face : la branche apparait en tournant.
  const sx = s * Math.sin(Math.abs(m.yawRad)) * side;
  const sy = s;

  const cosR = Math.cos(m.rollRad);
  const sinR = Math.sin(m.rollRad);

  const a = cosR * sx;
  const b = sinR * sx;
  const c = -sinR * sy;
  const d = cosR * sy;

  // La charniere sur la FACE : bord externe de la bbox alpha, a hauteur du pont.
  const hingeOnFront = {
    x: side > 0 ? spec.alphaBBox.x + spec.alphaBBox.w : spec.alphaBBox.x,
    y: spec.bridgeCenter.y,
  };
  const anchor = spriteToScreen(hingeOnFront, spec, m);

  // Sur le sprite de profil, la charniere est le bord gauche (x = 0).
  const hx = spec.hingeProfile.x;
  const hy = spec.hingeProfile.y;

  return {
    a,
    b,
    c,
    d,
    e: anchor.x - (a * hx + c * hy),
    f: anchor.y - (b * hx + d * hy),
  };
}

/** Longueur de branche rendue a l'ecran, en pixels. Nulle de face. */
export function renderedTempleLengthPx(spec: FrameSpec, m: FrameMetrics, widthPx: number): number {
  const profileScale = spec.profilePxPerMm ?? spec.spritePxPerMm;
  return (widthPx * m.livePxPerMm * Math.sin(Math.abs(m.yawRad))) / profileScale;
}
