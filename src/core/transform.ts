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
  // La charniere sur la FACE : bord externe de la bbox alpha, a hauteur du pont.
  const hingeOnFront = {
    x: side > 0 ? spec.alphaBBox.x + spec.alphaBBox.w : spec.alphaBBox.x,
    y: spec.bridgeCenter.y,
  };
  const anchor = spriteToScreen(hingeOnFront, spec, m);

  // ⭐ La branche ABOUTIT à l'oreille, mesurée sur ce visage-ci.
  //
  // Avant, sa longueur venait du sprite de profil — connue à ±20 %, et le bout
  // flottait donc devant ou derrière l'oreille dès que la tête tournait. Or les
  // deux extrémités sont CONNUES à l'écran : la charnière est projetée par
  // l'affine de la face, l'oreille est un repère mesuré. Deux points suffisent à
  // fixer la similitude — plus rien n'est deduit d'une longueur nominale.
  //
  // 🔴 Le raccourci en sin(yaw) n'est pas perdu, il est MESURÉ : l'écart
  // charnière ↔ oreille à l'écran le porte déjà, puisqu'il est lui-même le long
  // de l'axe avant-arrière de la tête. De face il tend vers zéro et la branche
  // disparaît toute seule — ce que `render/temple.ts` masque de toute façon.
  const ear = side > 0 ? m.ear.right : m.ear.left;
  const vx = ear.x - anchor.x;
  const vy = ear.y - anchor.y;

  // Sur le sprite de profil, la branche part de la charniere et court vers +x.
  const profileScale = spec.profilePxPerMm ?? spec.spritePxPerMm;
  const lengthPx = templeLengthMm(spec) * profileScale;
  if (lengthPx <= 0) {
    throw new CalibrationError(
      `Longueur de branche nulle sur "${spec.slug}" : sprite de profil non préparé.`,
    );
  }

  // Similitude qui envoie (hinge → hinge + lengthPx·x̂) sur (anchor → ear).
  const a = vx / lengthPx;
  const b = vy / lengthPx;
  // L'épaisseur de la branche, elle, reste à l'échelle réelle et ne s'écrase
  // pas : un raccourci de perspective raccourcit, il n'amincit pas.
  const sy = m.livePxPerMm / profileScale;
  const c = (-vy / Math.hypot(vx, vy || 1)) * sy;
  const d = (vx / Math.hypot(vx, vy || 1)) * sy;

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
  return spec.templeRectifiedMm ?? spec.brancheMm;
}

/**
 * Longueur de branche RÉELLEMENT peinte a l'ecran, en pixels.
 *
 * ⚠️ C'est desormais la distance charniere ↔ oreille mesuree, et non plus
 * `longueur nominale × sin(yaw)`. Une seule definition de la longueur, celle
 * qu'applique `templeAffine` — deux notions divergeraient (T3).
 */
export function renderedTempleLengthPx(spec: FrameSpec, m: FrameMetrics, side: 1 | -1): number {
  const hingeOnFront = {
    x: side > 0 ? spec.alphaBBox.x + spec.alphaBBox.w : spec.alphaBBox.x,
    y: spec.bridgeCenter.y,
  };
  const anchor = spriteToScreen(hingeOnFront, spec, m);
  const ear = side > 0 ? m.ear.right : m.ear.left;
  return Math.hypot(ear.x - anchor.x, ear.y - anchor.y);
}
