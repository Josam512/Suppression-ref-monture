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

import type { Pt } from './geom.js';
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

/**
 * Applique l'affine à un point du sprite.
 * Utilisée par le rendu ET par le décentrement — c'est tout l'intérêt de T3.
 */
export function spriteToScreen(p: Pt, spec: FrameSpec, m: FrameMetrics): Pt {
  const t = spriteAffine(spec, m);
  return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f };
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
