/**
 * ui/renderScene.ts — ce qui est peint sur le canvas, à chaque image.
 *
 * Deux rendus possibles, et le choix ne se fait PAS sur un mode (§11.4) : il se
 * fait sur la présence d'une donnée. Si l'on sait quelle monture la personne
 * porte réellement — donc uniquement en magasin, mais le code ne le sait pas —
 * on repeint cette monture au coloris voulu. Sinon, on pose le sprite.
 */

import { IRIS_DISCREPANCY_MAX } from '../core/autoCalibration.js';
import type { CameraProfile } from '../core/cameraProfile.js';
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
  cameraProfile: CameraProfile | null = null,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (live.sprites.status !== 'ready') {
    live.verdict = null;
    return;
  }

  // TRACKING ≠ MÉTROLOGIE : tant que la mesure absolue n'a pas convergé, on
  // pose la monture avec l'échelle de la frame courante, mais sans verdict mm.
  //
  // Audit 2026-08-21 : le profil caméra doit être IDENTIQUE à celui que la
  // calibration définitive utilisera. Sinon, un appareil déjà profilé faisait
  // l'aperçu avec le HFOV supposé puis le résultat final avec la focale mesurée,
  // recréant un saut de taille aperçu → calibré.
  const provisional =
    live.cal === null
      ? provisionalScale(lm, w, h, IRIS_DISCREPANCY_MAX, Date.now(), cameraProfile)
      : null;
  live.provisional = live.cal === null;
  const cal = live.cal ?? provisional?.cal ?? null;
  if (cal === null) {
    live.verdict = null;
    return;
  }

  const m = frameMetrics(lm, w, h, cal, yawRad);
  const target = { img: live.sprites.sprites.front.img, spec: live.sprites.spec };

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

  live.verdict = live.cal === null ? null : verdict(lm, live.cal, live.sprites.spec, w, h, yawRad);
}

export function sceneHint(live: Live): string | null {
  return live.provisional ? 'aperçu — taille pas encore mesurée' : live.recolorReason;
}

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
    detail: consecutiveFailures > 5 && cause === 'no-face' ? `${reason ?? '—'} · ${browserNote()}` : null,
  });
}

function browserNote(): string {
  const ua = navigator.userAgent;
  const embedded = / wv\)|; wv|FBAN|FBAV|Instagram|WhatsApp|Line\/|MicroMessenger/i.test(ua);
  return embedded ? 'navigateur intégré (essayez d’ouvrir dans Chrome)' : 'navigateur complet';
}
