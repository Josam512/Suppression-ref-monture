/**
 * tests/fixtures/head3d.ts — une tête SYNTHÉTIQUE projetée en perspective.
 *
 * ## Pourquoi ce fixture existe
 *
 * `core/parallax.ts` prétend MESURER un écart de profondeur à partir de deux
 * images. Un test qui lui rendrait des landmarks fabriqués par la même formule
 * que celle qu'il utilise ne prouverait rien : il vérifierait que `a = a`.
 *
 * Ici, les landmarks sont produits par une **projection perspective exacte**
 * `u = f·X/Z` — jamais par le modèle plan `−Δz·sin θ` que la sonde utilise. Les
 * deux modèles diffèrent au second ordre ; c'est précisément cet écart-là que
 * les tests bornent. La vérité terrain (profondeur, largeur réelle, distance)
 * est connue par construction, donc opposable.
 *
 * ⚠️ Ce fichier est un OUTIL DE TEST. Il ne fait pas de 3D dans l'application :
 * aucun chemin de `src/` ne l'importe, et le rendu reste du sprite 2D (§0).
 */

import type { NormalizedLandmark } from '../../src/core/geom.js';
import {
  EYE_L,
  EYE_L_INNER,
  EYE_R,
  EYE_R_INNER,
  FACE_L,
  FACE_R,
  SELLION,
} from '../../src/core/faceMetrics.js';
import { FOREHEAD } from '../../src/core/parallax.js';
import { CARD_WIDTH_MM } from '../../src/core/calibration.js';
import { CARD_H_MM as CARD_HEIGHT_MM } from '../../src/core/cardPose.js';

/** Un point image, en pixels. */
interface Pt2 {
  x: number;
  y: number;
}

const POINT_COUNT = 478;

/** Un point du repère de tête, en mm. X à droite, Y vers le bas, Z vers le fond. */
interface P3 {
  x: number;
  y: number;
  z: number;
}

export interface HeadModel {
  /** Demi-écartement des repères 234/454, en mm. Plan de référence : z = 0. */
  templeHalfMm: number;
  /** Profondeur dont le FRONT est en avant du plan des repères. La vérité cherchée. */
  foreheadAheadMm: number;
  /** Hauteur du repère de front au-dessus de la ligne des yeux, en mm. */
  foreheadRiseMm: number;
  /** Demi-écartement des coins externes des yeux. */
  eyeHalfMm: number;
  /** Demi-écartement des coins internes. */
  eyeInnerHalfMm: number;
  /** Profondeur dont le sellion est en avant du plan des repères. */
  sellionAheadMm: number;
  /** Demi-largeur RÉELLE de la tête aux tempes — ce que les repères ne voient pas. */
  headHalfMm: number;
}

/**
 * Profondeur que la sonde peut RÉELLEMENT mesurer sur ce modèle.
 *
 * ⚠️ Ce n'est pas `foreheadAheadMm`. La référence sagittale n'est plus le milieu
 * des repères 234/454 — ils glissent sur la silhouette quand la tête tourne, ce
 * ne sont pas des points physiques, et la première vraie vidéo l'a démontré en
 * rendant 99 mm quel que soit le point sondé. La référence est désormais les
 * COINS EXTERNES DES YEUX, qui sont eux de vrais points anatomiques. La sonde
 * mesure donc l'écart front ↔ coins externes.
 */
export function probeDepthMm(m: HeadModel): number {
  return m.foreheadAheadMm - m.sellionAheadMm / 2;
}

/** Un adulte plausible : repères à 115 mm, tempes réelles à 136 mm. */
export const ADULTE: HeadModel = {
  templeHalfMm: 57.5,
  foreheadAheadMm: 30,
  foreheadRiseMm: 45,
  eyeHalfMm: 36,
  eyeInnerHalfMm: 15,
  sellionAheadMm: 22,
  headHalfMm: 68,
};

export interface CameraOptions {
  yawRad: number;
  /** Distance caméra ↔ plan des repères temporaux, en mm. */
  distanceMm: number;
  w: number;
  h: number;
  /** Champ horizontal RÉEL de la caméra. 60° = celui que l'app suppose. */
  hfovDeg?: number;
}

export function focalPx(opts: CameraOptions): number {
  const hfov = opts.hfovDeg ?? 60;
  return opts.w / 2 / Math.tan((hfov / 2) * (Math.PI / 180));
}

/** Projection perspective EXACTE, en pixels image. */
export function project(p: P3, opts: CameraOptions): { x: number; y: number } {
  const c = Math.cos(opts.yawRad);
  const s = Math.sin(opts.yawRad);
  const xr = p.x * c + p.z * s;
  const zr = -p.x * s + p.z * c;

  const zc = opts.distanceMm + zr;
  const f = focalPx(opts);
  return { x: opts.w / 2 + (f * xr) / zc, y: opts.h / 2 + (f * p.y) / zc };
}

/** Les 478 repères d'une tête synthétique, vue par une caméra donnée. */
export function projectHead(
  model: HeadModel,
  opts: CameraOptions,
): { lm: NormalizedLandmark[]; headEdgesPx: { left: number; right: number } } {
  const lm: NormalizedLandmark[] = Array.from({ length: POINT_COUNT }, () => ({ x: 0.5, y: 0.5 }));

  const put = (index: number, p: P3): void => {
    const q = project(p, opts);
    lm[index] = { x: q.x / opts.w, y: q.y / opts.h };
  };

  put(FACE_L, { x: -model.templeHalfMm, y: 0, z: 0 });
  put(FACE_R, { x: model.templeHalfMm, y: 0, z: 0 });
  put(EYE_L, { x: -model.eyeHalfMm, y: 0, z: -model.sellionAheadMm / 2 });
  put(EYE_R, { x: model.eyeHalfMm, y: 0, z: -model.sellionAheadMm / 2 });
  put(EYE_L_INNER, { x: -model.eyeInnerHalfMm, y: 0, z: -model.sellionAheadMm });
  put(EYE_R_INNER, { x: model.eyeInnerHalfMm, y: 0, z: -model.sellionAheadMm });
  put(SELLION, { x: 0, y: 0, z: -model.sellionAheadMm });
  put(FOREHEAD, { x: 0, y: -model.foreheadRiseMm, z: -model.foreheadAheadMm });

  const left = project({ x: -model.headHalfMm, y: 0, z: 0 }, opts).x;
  const right = project({ x: model.headHalfMm, y: 0, z: 0 }, opts).x;

  return { lm, headEdgesPx: { left, right } };
}

/**
 * Les QUATRE coins de la carte, en pixels image — ce que le client ajuste.
 *
 * La carte est posée sur le front, donc **inclinée** : un front n'est pas
 * vertical, il fuit vers l'arrière. C'est cette inclinaison qui donne la
 * perspective, et donc la focale (`core/cardPose.ts`). Le fixture la reproduit
 * au lieu de poser une carte fronto-parallèle qui serait le cas dégénéré.
 *
 * @param tiltDeg inclinaison du haut de la carte vers l'arrière.
 */
export function cardCornersPx(
  model: HeadModel,
  opts: CameraOptions,
  tiltDeg = 20,
): [Pt2, Pt2, Pt2, Pt2] {
  const t = (tiltDeg * Math.PI) / 180;
  const hw = CARD_WIDTH_MM / 2;
  const hh = CARD_HEIGHT_MM / 2;

  const corner = (u: number, v: number): Pt2 =>
    project(
      {
        x: u,
        y: -model.foreheadRiseMm + v * Math.cos(t),
        z: -model.foreheadAheadMm - v * Math.sin(t),
      },
      opts,
    );

  return [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
}

/** Distance caméra ↔ CENTRE de la carte, en mm. La vérité que la pose doit rendre. */
export function cardDistanceMm(model: HeadModel, opts: CameraOptions): number {
  const z = -model.foreheadAheadMm;
  return opts.distanceMm + z * Math.cos(opts.yawRad); // zr = −x·sin + z·cos, avec x = 0
}

/**
 * Largeur apparente, en pixels, d'une carte ISO posée à plat sur le front.
 *
 * Elle est dans le PLAN DU FRONT, donc plus près de la caméra que les repères
 * temporaux : c'est très exactement le biais B4, ici reproduit fidèlement.
 */
export function cardWidthPx(model: HeadModel, opts: CameraOptions): number {
  const z = -model.foreheadAheadMm;
  const y = -model.foreheadRiseMm;
  const l = project({ x: -CARD_WIDTH_MM / 2, y, z }, opts);
  const r = project({ x: CARD_WIDTH_MM / 2, y, z }, opts);
  return r.x - l.x;
}
