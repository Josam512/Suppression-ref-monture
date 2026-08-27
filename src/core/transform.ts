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
 * ⭐ `VERTICAL_OFFSET_MM` a été SUPPRIMÉE — ne pas la réintroduire.
 *
 * Elle décalait le centre du PONT sous le sellion, alors que l'œil juge les
 * CENTRES OPTIQUES (10,4 mm plus bas sur la fiche `severine`, et cet écart
 * change par monture) : les pupilles finissaient tout en haut des verres, et
 * AUCUNE valeur ne pouvait corriger ça. Remplacée par `poseAnchorOf`
 * (`core/faceMetrics.ts`) : médiane du nez en X, ligne des yeux en Y, le
 * sprite ancré par ses PROPRES centres optiques — zéro paramètre libre.
 * Hypothèse assumée : la monture est montrée telle qu'un opticien la
 * réglerait, centre optique à hauteur de pupille (convention déclarée).
 */

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
  //
  // 🔴 C'est l'échelle du plan des TEMPES, et elle doit le rester. La LARGEUR
  // de la monture se réalise à ses tenons, plaqués sur les côtés de la tête —
  // pas à son pont, 48 mm plus avant. Redimensionner le sprite au plan du pont
  // dessinerait la monture 6 % trop large (8 mm sur 132) : le critère de succès
  // du §0 tomberait, sans que rien à l'écran ne le signale.
  // Raisonnement complet et test de verrouillage : `core/framePlane.ts`.
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

  // ⭐ Le point du SPRITE qui doit tomber sur l'ancre de pose :
  //   - en X, le centre du pont : le pont enjambe le nez, il ne coulisse pas.
  //     C'est ce qui laisse le décentrement horizontal être une vraie mesure.
  //   - en Y, la hauteur des CENTRES OPTIQUES : c'est elle que l'opticien règle
  //     pour l'amener à hauteur de pupille, et elle est propre à chaque monture.
  //
  // Ce couple remplace `VERTICAL_OFFSET_MM` (voir l'en-tête de ce fichier).
  const sx0 = spec.bridgeCenter.x;
  const sy0 = (spec.lensCenterL.y + spec.lensCenterR.y) / 2;

  return {
    a,
    b,
    c,
    d,
    e: m.poseAnchor.x - (a * sx0 + c * sy0),
    f: m.poseAnchor.y - (b * sx0 + d * sy0),
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
 * ⭐ Le TENON : point de la photo de FACE d'où la branche part à l'écran.
 *
 * Marqué explicitement dans l'outil de prep (`templeRootL/R`, §12). Les fiches
 * préparées avant 2026-08-19 ne l'ont pas : on retombe alors sur une
 * APPROXIMATION dite en clair — bord externe de la bbox alpha, à hauteur du
 * pont. Ce point n'est PAS « la vraie charnière » (formulation antérieure,
 * corrigée : la charnière est un axe mécanique, souvent invisible de face) ;
 * c'est le point de sortie VISUEL de la branche.
 */
export function templeRootOf(spec: FrameSpec, side: 1 | -1): Pt {
  const explicit = side > 0 ? spec.templeRootR : spec.templeRootL;
  if (explicit !== undefined) return explicit;
  return {
    x: side > 0 ? spec.alphaBBox.x + spec.alphaBBox.w : spec.alphaBBox.x,
    y: spec.bridgeCenter.y,
  };
}

/**
 * Affine de la BRANCHE — arbitrage terrain 2026-08-27 : la branche PROLONGE
 * la face. « Reprendre bêtement le dessin de la jonction de la face avec la
 * branche au niveau du tenon » : cette matrice fait ça, et rien d'autre.
 *
 *  1. Elle PART du tenon de la face, projeté par l'affine unique (T3) — la
 *     jonction face ↔ branche est commune par construction, à tout yaw.
 *  2. Elle vit dans les AXES DE LA FACE : mêmes cos/sin du roll que
 *     `spriteAffine`. Le long de la branche : sin(|yaw|), projection d'un
 *     segment perpendiculaire au plan du visage — nulle de face, maximale de
 *     profil. Perpendiculairement : l'échelle pleine — un raccourci de
 *     perspective raccourcit, il n'amincit pas. L'inclinaison réelle de la
 *     branche (sa montée, la plongée du manchon) vient de la PHOTO, comme la
 *     forme vient de la photo (§1 bug #2).
 *  3. Le côté image-gauche est le MIROIR horizontal du côté droit
 *     (déterminant < 0) : le bas du sprite reste le bas de l'écran des deux
 *     côtés, comme une branche gauche est l'image miroir d'une branche droite.
 *
 * 🔴 Versions précédentes, SUPPRIMÉES — ne réintroduire ni l'une ni l'autre :
 *  - une similitude envoyait l'extrémité exactement sur l'oreille : le slider
 *    de taille (§1 bug #1) appliqué à la branche. `brancheMm` CALIBRE l'échelle
 *    du sprite, il n'étire jamais la branche pour la faire « tomber juste » ;
 *  - la branche était ensuite ORIENTÉE vers le point d'oreille détecté
 *    (162/389). Constaté sur captures réelles (2026-08-27) : cette visée
 *    INVENTAIT une orientation — le landmark de contour n'est pas à la hauteur
 *    du sillon de la branche, qui montait — et le côté gauche, construit par
 *    rotation ≈ 180° au lieu d'un miroir, peignait le sprite TÊTE-BÊCHE,
 *    manchon vers le haut. L'oreille mesurée ne sert plus qu'à l'OCCLUSION
 *    (render/temple.ts) : au-delà de la racine de l'hélix, la branche passe
 *    derrière le pavillon.
 *
 * @param side +1 = branche du côté image-droit, -1 = image-gauche.
 */
export function templeAffine(spec: FrameSpec, m: FrameMetrics, side: 1 | -1): Affine {
  const anchor = spriteToScreen(templeRootOf(spec, side), spec, m);

  // Échelle PHYSIQUE, sans paramètre libre.
  //
  // ⭐ Complément 30 — le sprite redressé est corrigé du rapport
  // `brancheMm / profileReferenceLengthMm` : sa longueur PEINTE est la cote
  // FABRICANT, pas ce que le redressement a cru lire (145 → 174,5 constaté).
  const s = (m.livePxPerMm * profileScaleCorrection(spec)) / (spec.profilePxPerMm ?? spec.spritePxPerMm);
  const along = s * Math.sin(Math.abs(m.yawRad));

  // R(roll) · diag(side·along, s). À yaw = 0 la colonne X est nulle : une
  // branche vue dans son axe n'a pas d'étendue — et le fondu de
  // render/temple.ts la masque de toute façon sous 0,10 rad.
  const cosR = Math.cos(m.rollRad);
  const sinR = Math.sin(m.rollRad);
  const a = side * cosR * along;
  const b = side * sinR * along;
  const c = -sinR * s;
  const d = cosR * s;

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

/**
 * ⭐ Complément 30 / point 51 — la longueur de RÉFÉRENCE du sprite de profil :
 * ce que la calibration du sprite a lu, jamais ce que le renderer peint.
 */
export function profileReferenceLengthMm(spec: FrameSpec): number | null {
  return spec.profileReferenceLengthMm ?? spec.templeRectifiedMm ?? null;
}

/**
 * Correction d'échelle du sprite de profil : `brancheMm / référence`.
 * Vaut 1 quand le profil a été photographié à plat (aucune référence) —
 * `profilePxPerMm`/`spritePxPerMm` y est déjà la vraie échelle.
 */
export function profileScaleCorrection(spec: FrameSpec): number {
  const ref = profileReferenceLengthMm(spec);
  if (ref === null || !(ref > 0) || !(spec.brancheMm > 0)) return 1;
  return spec.brancheMm / ref;
}

/**
 * Longueur PHYSIQUE de la branche, en mm : la cote FABRICANT, toujours.
 *
 * 🔴 Point 51 — l'ancienne version rendait `templeRectifiedMm ?? brancheMm` :
 * la longueur issue du redressement photo SERVAIT de longueur physique, avec
 * des contradictions énormes sur les fiches réelles (147 → 137,1 mm ;
 * 145 → 174,5 mm). La référence du sprite ne calibre que ses pixels
 * (`profileScaleCorrection`) ; la longueur peinte est celle du fabricant.
 */
export function templeLengthMm(spec: FrameSpec): number {
  if (!(spec.brancheMm > 0)) {
    throw new CalibrationError(
      `Longueur de branche nulle sur "${spec.slug}" : sprite de profil non préparé.`,
    );
  }
  return spec.brancheMm;
}

/**
 * Longueur de branche RÉELLEMENT peinte à l'écran, en pixels.
 *
 * C'est la longueur PHYSIQUE raccourcie par la perspective — et non plus la
 * distance tenon ↔ oreille : l'oreille ne donne que la DIRECTION (voir
 * `templeAffine`). Une seule définition, celle qu'applique l'affine (T3) ;
 * elle est identique pour les deux côtés, la physique ne distinguant pas
 * la branche qui s'approche de celle qui s'éloigne (l'occlusion s'en charge).
 */
export function renderedTempleLengthPx(spec: FrameSpec, m: FrameMetrics, _side: 1 | -1): number {
  return templeLengthMm(spec) * m.livePxPerMm * Math.sin(Math.abs(m.yawRad));
}
