/**
 * ui/profileAxis.ts — pente de MISE EN PAGE du sprite de profil (2026-08-27).
 *
 * Une photo de branche posée à plat n'est jamais parfaitement horizontale dans
 * son fichier : l'angle dépend de la pose de la monture sur la table et du
 * redressement (severine : +9° de montée, p8-m252 : +7°, ecaille-claire : ~2°).
 * Cet angle n'est PAS une propriété de la monture — c'est un artefact de mise
 * en page, propre à chaque fichier.
 *
 * Or la projection de la branche écrase la composante LE LONG de son axe en
 * sin(yaw) et garde la composante perpendiculaire à l'échelle pleine : une
 * pente de mise en page non annulée se retrouvait AMPLIFIÉE ~1/sin(yaw) à
 * l'écran (9° → ~30° à petit yaw — constaté sur captures terrain : branche en
 * oblique démesurée, découpes d'occlusion de travers).
 *
 * L'axe est donc MESURÉ ici, une fois par sprite, sur ses pixels réels : la
 * droite charnière → barycentre du canal alpha. Le barycentre est dominé par
 * le corps de la branche (le manchon pèse peu de pixels) : l'axe obtenu est
 * celui du corps, à ~1-2° près. `core/transform.ts` (templeAffine) l'annule.
 *
 * ⚠️ Jamais écrit dans les fiches spec.json : c'est une grandeur d'affichage
 * dérivée du fichier image servi, pas une calibration humaine.
 */

import type { Pt } from '../core/geom.js';

/** Même seuil d'opacité que la bbox alpha de l'outil de prep (B3). */
export const PROFILE_ALPHA_THRESHOLD = 8;

/**
 * En deçà de cette base (px sprite), le barycentre est trop proche de la
 * charnière pour définir une direction : on renvoie 0 (pas de pente connue).
 */
export const MIN_AXIS_BASE_PX = 4;

/**
 * Angle (radians, repère image du sprite) de l'axe charnière → barycentre du
 * canal alpha. 0 en cas d'image illisible, vide, ou hors convention (le
 * barycentre DOIT être à droite de la charnière : les fiches ont la charnière
 * au bord gauche, la branche s'étendant vers +X) — 0 rend le comportement
 * antérieur, jamais une erreur : une pente inconnue n'empêche pas de dessiner.
 *
 * `w`/`h` : dimensions du fichier (naturalWidth/Height pour une image chargée ;
 * width/height pour le canvas d'un banc) — hors de `core/`, B3 ne s'applique
 * pas : on mesure ici une propriété du FICHIER, pas une cote de monture.
 */
export function measureProfileAxisRad(img: CanvasImageSource, w: number, h: number, hinge: Pt): number {
  if (!(w > 0) || !(h > 0)) return 0;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  // willReadFrequently : raster CPU d'emblée — sans lui, le getImageData force
  // une synchronisation GPU→CPU qui peut bloquer le thread principal bien plus
  // longtemps que le comptage lui-même.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return 0;
  ctx.drawImage(img, 0, 0);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return 0; // pixels illisibles (contexte souillé…) : pente inconnue, pas de panne
  }

  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3]! > PROFILE_ALPHA_THRESHOLD) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (n === 0) return 0;

  const dx = sx / n - hinge.x;
  const dy = sy / n - hinge.y;
  if (dx <= 0 || Math.hypot(dx, dy) < MIN_AXIS_BASE_PX) return 0;
  return Math.atan2(dy, dx);
}
