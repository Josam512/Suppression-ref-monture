/**
 * render/composite.ts — compositing de sprites 2D sur canvas (CLAUDE.md §6.2).
 *
 * ⚠️ Aucune géométrie n'est calculée ici. Toute la transformée vient de
 * `core/transform.ts` (T3). Recomposer une matrice à coups de
 * translate/rotate/scale est barré par le hook (§9.0.g).
 */

import type { FrameMetrics } from '../core/faceMetrics.js';
import { spriteAffine } from '../core/transform.js';
import { smoothstep } from '../core/geom.js';
import type { FrameSpec } from '../core/frameSpec.js';
import { drawTemple, type ProfileSprite } from './temple.js';

export interface FrontSprite {
  img: CanvasImageSource;
  spec: FrameSpec;
}

export interface Sprites {
  front: FrontSprite;
  /**
   * ⭐ Guide point 4 — le profil est INDÉPENDANT du frontal : `null` tant
   * qu'il n'est pas chargé (ou s'il a échoué). La face se dessine sans lui ;
   * seules les branches attendent.
   */
  profile: ProfileSprite | null;
}

/** Seuils de révélation de la branche, en radians de |yaw|. */
const TEMPLE_FADE_IN = 0.1;
const TEMPLE_FADE_FULL = 0.45;

/**
 * Dilatation du sprite pour couvrir la monture RÉELLE portée dessous (§11.6).
 *
 * ⚠️ N'a de sens qu'en mode magasin, et n'est JAMAIS activée d'office : c'est
 * l'appelant qui transmet la valeur. Aucun test de mode ici (§11.4).
 */
export const OVERLAY_PADDING_MM = 1.5;

/** Nombre de directions du halo : 8 suffit à fermer le contour sans coût visible. */
const HALO_STEPS = 8;

/**
 * Décalages du halo, en pixels écran.
 *
 * ⚠️ On DILATE la silhouette, on n'AGRANDIT pas la monture. Un agrandissement
 * (par l'échelle) rendrait la monture plus large qu'elle n'est et casserait le
 * critère de succès du projet — l'image juste au millimètre. Un halo de
 * `paddingMm` épaissit le trait de `paddingMm` sans toucher à la géométrie.
 */
export function haloOffsets(paddingMm: number, livePxPerMm: number): Array<[number, number]> {
  if (paddingMm <= 0) return [];
  const r = paddingMm * livePxPerMm;
  return Array.from({ length: HALO_STEPS }, (_, k) => {
    const a = (k * 2 * Math.PI) / HALO_STEPS;
    return [r * Math.cos(a), r * Math.sin(a)] as [number, number];
  });
}

export interface DrawOptions {
  /**
   * Dilatation en mm réels. 0 en vente en ligne (V1), OVERLAY_PADDING_MM en
   * mode magasin (V2), où une monture physique se trouve sous le sprite.
   */
  overlayPaddingMm?: number;
  /** 🔴 Terrain 2026-08-26 — côté de branche VISIBLE, mesuré par l'appelant
   *  dans la géométrie projetée (visibleTempleSide) ; jamais le signe du yaw. */
  templeSide?: 1 | -1;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  m: FrameMetrics,
  faceOutline: Path2D | null,
  options: DrawOptions = {},
): void {
  // ⚠️ ORDRE CRITIQUE : la branche D'ABORD, la face ensuite.
  //
  // L'occlusion de la branche se fait par `destination-out` sur le contour du
  // visage. Or `destination-out` efface TOUT ce qui est deja peint a cet
  // endroit : en dessinant la face avant, on l'effaçait avec la branche, et la
  // monture disparaissait du milieu du visage des que la tete tournait.
  //
  // Dessiner la branche en premier est aussi le bon ordre physique : la branche
  // passe derriere la tete, la face est devant.
  //
  // ⚠️ Complément 29 — le profil doit porter la MÊME identité de modèle que la
  // face : un front du modèle B avec un profil du modèle A (course de
  // chargement) ne se compose pas, la branche attend le bon sprite.
  const profile = sprites.profile;
  const templeAlpha = smoothstep(TEMPLE_FADE_IN, TEMPLE_FADE_FULL, Math.abs(m.yawRad));
  if (templeAlpha > 0.01 && profile !== null && profile.spec.slug === sprites.front.spec.slug) {
    // 🔴 Terrain 2026-08-26 — le côté vient de la géométrie projetée (mesuré
    // par l'appelant sur les landmarks BRUTS) ; à défaut, l'ancienne règle de
    // signe reste le repli des bancs synthétiques qui n'ont pas de landmarks.
    drawTemple(ctx, profile, m, templeAlpha, faceOutline, options.templeSide ?? (m.yawRad >= 0 ? -1 : 1));
  }

  // ⚠️ yawRad se lit sur `m` (T2). Ne PAS le repasser en paramètre : deux
  // sources pour la même grandeur finissent toujours par diverger.
  const t = spriteAffine(sprites.front.spec, m);

  ctx.save();

  for (const [dx, dy] of haloOffsets(options.overlayPaddingMm ?? 0, m.livePxPerMm)) {
    ctx.setTransform(t.a, t.b, t.c, t.d, t.e + dx, t.f + dy);
    ctx.drawImage(sprites.front.img, 0, 0);
  }

  ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  ctx.drawImage(sprites.front.img, 0, 0); // toute la géométrie est dans l'affine
  ctx.restore();
}
