/**
 * ui/renderScene.ts — ce qui est peint sur le canvas, à chaque image.
 *
 * Deux rendus possibles, et le choix ne se fait PAS sur un mode (§11.4) : il se
 * fait sur la présence d'une donnée. Si l'on sait quelle monture la personne
 * porte réellement — donc uniquement en magasin, mais le code ne le sait pas —
 * on repeint cette monture au coloris voulu. Sinon, on pose le sprite.
 *
 * ⚠️ Ordre de repli explicite : si le recoloriage ne retrouve pas la monture
 * dans l'image, on retombe sur le sprite posé. On ne laisse jamais l'écran vide
 * (§0.0.2), et la raison du repli remonte à l'IHM au lieu de disparaître.
 */

import { IRIS_DISCREPANCY_MAX } from '../core/autoCalibration.js';
import { frameMetrics } from '../core/faceMetrics.js';
import { provisionalScale } from '../core/provisionalScale.js';
import type { NormalizedLandmark } from '../core/geom.js';
import { verdict } from '../core/verdict.js';
import { drawFrame } from '../render/composite.js';
import { drawOverlay } from '../render/overlay.js';
import { drawRecolored } from '../render/recolorLive.js';
import { faceOutlinePath } from '../tracking/landmarker.js';
import type { Live } from './liveState.js';

export function paintScene(
  ctx: CanvasRenderingContext2D,
  live: Live,
  lm: readonly NormalizedLandmark[],
  yawRad: number,
  video: CanvasImageSource | null,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (live.sprites.status !== 'ready') {
    live.verdict = null;
    return;
  }

  // ⭐ Audit humain du 2026-08-21, point 4 — TRACKING ≠ MÉTROLOGIE.
  // Tant que la mesure absolue n'a pas convergé, on ne rend plus le produit
  // inutilisable : on pose la monture à l'échelle de la frame courante (même
  // étalon iris, non médianisé) et on GÈLE la légende chiffrée. L'appelant
  // annonce le caractère provisoire ; aucun millimètre n'est affirmé.
  const provisional = live.cal === null ? provisionalScale(lm, w, h, IRIS_DISCREPANCY_MAX, Date.now()) : null;
  live.provisional = live.cal === null;
  const cal = live.cal ?? provisional?.cal ?? null;
  if (cal === null) {
    live.verdict = null;
    return;
  }

  const m = frameMetrics(lm, w, h, cal, yawRad);
  const target = { img: live.sprites.sprites.front.img, spec: live.sprites.spec };

  // ⭐ V2 « 2,5 D » : la géométrie, la lumière et la perspective viennent du
  // réel ; seule la matière est substituée.
  const worn = live.wornSprite;
  let recolored = false;
  if (worn !== null && video !== null && worn.spec.slug !== target.spec.slug) {
    const report = drawRecolored(ctx, video, worn, target, m);
    live.recolorReason = report.reason;
    recolored = report.reason === null && report.painted > 0;
  } else {
    live.recolorReason = null;
  }

  if (!recolored) {
    drawFrame(ctx, live.sprites.sprites, m, faceOutlinePath(lm, w, h), {
      overlayPaddingMm: live.overlayPaddingMm,
    });
  }

  // La légende chiffrée n'existe QUE sur une mesure convergée : une échelle
  // d'une seule frame pose l'image, elle n'affirme aucun millimètre.
  live.verdict = live.cal === null ? null : verdict(lm, live.cal, live.sprites.spec, w, h, yawRad);
}

/**
 * La note affichée sous l'image. Le caractère PROVISOIRE prime sur la note de
 * recoloriage : ne jamais laisser croire à une taille certifiée qui ne l'est
 * pas encore (audit humain du 2026-08-21, point 4).
 */
export function sceneHint(live: Live): string | null {
  return live.provisional ? 'aperçu — taille pas encore mesurée' : live.recolorReason;
}

/**
 * ⚠️ Le chemin d'échec DOIT dessiner (§1 bug #3).
 *
 * Une première implémentation incrémentait le compteur d'échecs sans jamais le
 * peindre : détection perdue = canvas figé sur la dernière image, et l'alarme
 * exigée n'apparaissait jamais. La panne était strictement indiscernable d'un
 * fonctionnement normal. Le banc navigateur le vérifie à chaque exécution.
 *
 * §11 (mission détection) : deux états SÉPARÉS, plus jamais confondus —
 * une entrée caméra cassée n'est pas « mettez-vous de face », et un visage
 * non trouvé non plus : la contrainte de pose appartient aux MESURES.
 */
export function paintLost(
  ctx: CanvasRenderingContext2D,
  consecutiveFailures: number,
  cause: 'invalid-input' | 'no-face',
  reason: string | null,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawOverlay(ctx, {
    verdict: null,
    consecutiveFailures,
    hint:
      cause === 'invalid-input'
        ? `Problème d'entrée caméra : ${reason ?? 'frame invalide'}.`
        : consecutiveFailures > 5
          ? 'Recherche du visage…'
          : null,
  });
}
