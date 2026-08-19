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
 * ⭐ `VERTICAL_OFFSET_MM` a été SUPPRIMÉE. Ce commentaire prend sa place pour
 * que personne ne la réintroduise en croyant combler un trou.
 *
 * ## Pourquoi elle était incalibrable, et pas seulement non calibrée
 *
 * Elle décalait le centre du PONT sous le sellion. Or ce n'est pas le pont que
 * l'œil juge, ce sont les CENTRES OPTIQUES — et sur une monture réelle ils sont
 * franchement plus bas que le pont : 10,4 mm sur la fiche `severine`, valeur
 * lue dans son `spec.json`, et qui change d'une monture à l'autre. Ancrer le
 * pont à 3 mm sous le sellion envoyait donc les centres optiques ~13 mm sous la
 * ligne des yeux. C'est ce que montrent les photos de vérification : les
 * pupilles se retrouvent tout en haut des verres.
 *
 * Aucune valeur de cette constante ne pouvait corriger ça, parce qu'elle
 * ignorait la seule grandeur qui décide : l'écart pont ↔ centres optiques,
 * propre à CHAQUE monture.
 *
 * ## Ce qui la remplace : rien à calibrer
 *
 * `core/faceMetrics.ts` → `poseAnchorOf` : la médiane du nez donne le X, la
 * ligne des yeux donne le Y. Le sprite est ancré par ses PROPRES centres
 * optiques. Il n'y a plus de paramètre libre, donc plus de séance d'opticien
 * pour cette grandeur — c'est le lot 8 amputé de sa moitié.
 *
 * ⚠️ Hypothèse assumée, et qui doit rester écrite : la monture est montrée
 * telle qu'un opticien l'ajusterait, plaquettes réglées pour amener le centre
 * optique à hauteur de pupille. Une monture dont les plaquettes ne le
 * permettraient pas sur ce nez-là n'est pas modélisée. C'est une convention de
 * pose déclarée, pas une constante cachée.
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
 * Affine de la BRANCHE — arbitrage 2026-08-19 : « branche physiquement
 * cohérente + fin cachée » plutôt que « branche déformée + extrémité parfaite ».
 *
 * Trois décisions, dans cet ordre :
 *  1. Elle PART du tenon de la face, projeté par l'affine unique (T3).
 *  2. Elle est à l'échelle PHYSIQUE : la longueur réelle du sprite, raccourcie
 *     en sin(|yaw|) — projection d'un segment perpendiculaire au plan du
 *     visage, nulle de face, maximale de profil. `brancheMm` CALIBRE l'échelle
 *     du sprite ; il ne fabrique JAMAIS une transformation qui étire ou
 *     comprime la branche pour la faire « tomber juste ».
 *  3. Elle est ORIENTÉE vers l'oreille mesurée — la DIRECTION seulement.
 *     Son extrémité tombe où la physique la met : sur l'oreille si la branche
 *     est à la taille de ce crâne, avant ou après sinon. C'est une information
 *     (une branche trop courte SE VOIT), et l'occlusion de `render/temple.ts`
 *     cache naturellement ce qui passe derrière la tête ou l'oreille.
 *
 * 🔴 Version précédente, SUPPRIMÉE : une similitude envoyait l'extrémité
 * nominale exactement sur l'oreille — elle étirait donc une branche de 140 mm
 * et comprimait une branche de 150 mm jusqu'à ce que les deux « aillent ».
 * C'était le slider de taille (§1 bug #1) appliqué à la branche : quelle que
 * soit la longueur réelle, l'extrémité tombait juste. Ne pas la réintroduire.
 *
 * @param side +1 si la branche visible est celle de droite du sprite, -1 sinon.
 */
export function templeAffine(spec: FrameSpec, m: FrameMetrics, side: 1 | -1): Affine {
  const anchor = spriteToScreen(templeRootOf(spec, side), spec, m);

  // Direction MESURÉE : du tenon vers l'oreille de ce visage-ci. On n'en tire
  // que l'orientation — jamais une échelle, qui serait l'étirement supprimé.
  const ear = side > 0 ? m.ear.right : m.ear.left;
  const vx = ear.x - anchor.x;
  const vy = ear.y - anchor.y;
  const norm = Math.hypot(vx, vy);
  // Cas dégénéré (tenon et oreille confondus à l'écran, strictement de face) :
  // la branche y est de toute façon invisible (sin(yaw) ≈ 0, et le fondu de
  // render/temple.ts la masque sous 0,10 rad). Une direction horizontale
  // évite seulement le NaN.
  const ux = norm > 1e-6 ? vx / norm : side;
  const uy = norm > 1e-6 ? vy / norm : 0;

  // Échelle PHYSIQUE, sans paramètre libre. Le long de la branche : sin(|yaw|).
  // Perpendiculairement : l'épaisseur reste à l'échelle réelle — un raccourci
  // de perspective raccourcit, il n'amincit pas.
  const s = m.livePxPerMm / (spec.profilePxPerMm ?? spec.spritePxPerMm);
  const along = s * Math.sin(Math.abs(m.yawRad));

  const a = ux * along;
  const b = uy * along;
  const c = -uy * s;
  const d = ux * s;

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

/** Longueur de branche du sprite de profil, en mm. Redressée si elle l'a été. */
export function templeLengthMm(spec: FrameSpec): number {
  const mm = spec.templeRectifiedMm ?? spec.brancheMm;
  if (!(mm > 0)) {
    throw new CalibrationError(
      `Longueur de branche nulle sur "${spec.slug}" : sprite de profil non préparé.`,
    );
  }
  return mm;
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
