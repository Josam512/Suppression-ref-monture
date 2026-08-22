/**
 * ui/renderScene.ts — ce qui est peint sur le canvas, à chaque image.
 *
 * Refonte du guide de fiabilisation (2026-08-21) :
 *
 *   - la monture apparaît dès que le FRONT est prêt et qu'une échelle de pose
 *     a été vue UNE fois — plus aucune validation anatomique dans le chemin de
 *     rendu (`core/renderPose.ts`, point 3). Un iris douteux sur une frame ne
 *     retire pas la monture : l'échelle TENUE par le filtre fait la frame
 *     (point 30) ;
 *   - la pose passe par un One-Euro (`ui/poseFilter.ts`), le VERDICT lit les
 *     landmarks BRUTS (complément 32 : le filtre visuel n'entre jamais dans la
 *     métrologie) ;
 *   - AUCUN NaN/Infinity n'atteint le canvas : garde explicite, frame sautée
 *     et comptée, jamais d'exception qui remonte au scheduler (point 56) ;
 *   - la transition aperçu → calibré est INSTRUMENTÉE (`live.scaleJump`),
 *     jamais masquée par un lissage (complément 6) ;
 *   - le profil manquant ne prive que des branches (point 4).
 */

import { IRIS_DISCREPANCY_MAX } from '../core/autoCalibration.js';
import {
  EAR_L,
  EAR_R,
  frameMetrics,
  MAX_YAW_FOR_SCALE_RAD,
  poseAnchorOf,
  rollRadOf,
  type FrameMetrics,
} from '../core/faceMetrics.js';
import { at, px, type NormalizedLandmark } from '../core/geom.js';
import { renderPoseScaleDiagnosed } from '../core/renderPose.js';
import { verdict } from '../core/verdict.js';
import { drawFrame } from '../render/composite.js';
import { drawOverlay } from '../render/overlay.js';
import { drawRecolored } from '../render/recolorLive.js';
import { faceOutlinePath } from '../tracking/landmarker.js';
import type { LostCause } from '../tracking/faceLoop.js';
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

  // ⭐ Point 4 — seul le FRONT conditionne la pose ; le profil ne prive que
  // des branches, et son état est affiché ailleurs.
  const front = live.sprites.front;
  if (front.status !== 'ready') {
    live.verdict = null;
    return;
  }

  // ── Pose de la frame (toujours depuis les landmarks bruts).
  const roll = rollRadOf(lm, w, h);
  const anchor = poseAnchorOf(lm, w, h, roll);

  // ── Échelle de la frame : calibrée si elle existe, sinon échelle de pose.
  live.provisional = live.cal === null;
  let freshScale: number | null = null;
  let refusalDetail: string | null = null;
  if (live.cal !== null) {
    freshScale = frameMetrics(lm, w, h, live.cal, yawRad).livePxPerMm;
  } else {
    const rp = renderPoseScaleDiagnosed(lm, w, h, IRIS_DISCREPANCY_MAX, live.cameraProfile, Date.now());
    if (rp.scale !== null) {
      freshScale = rp.scale.templePlanePxPerMm;
      live.lastProvisionalPxPerMm = rp.scale.templePlanePxPerMm;
    } else {
      refusalDetail = rp.refusal?.detail ?? null;
    }
  }

  // ⭐ Complément 35 — au-delà du yaw exploitable, l'échelle n'est plus
  // réestimée : le filtre TIENT la dernière valeur sûre, 234/454 ne font pas
  // « respirer » la monture.
  const scaleInput = Math.abs(yawRad) <= MAX_YAW_FOR_SCALE_RAD ? freshScale : null;

  const filtered = live.poseFilter.apply(
    { x: anchor.x, y: anchor.y, rollRad: roll, yawRad, scalePxPerMm: scaleInput },
    performance.now(),
  );
  if (filtered === null) {
    // ⭐ Ré-audit A6 — jamais eu d'échelle depuis le reset : rien d'honnête à
    // poser, mais l'attente est DATÉE et DIAGNOSTIQUÉE (hint, santé, HUD) au
    // lieu d'un canvas muet. Aucune valeur métrologique n'est fabriquée.
    live.firstScaleWaitSinceMs ??= performance.now();
    if (refusalDetail !== null) live.firstScaleRefusal = refusalDetail;
    else live.firstScaleRefusal ??= 'en attente d’une frame exploitable de face';
    live.verdict = null;
    return;
  }
  live.firstScaleWaitSinceMs = null;
  live.firstScaleRefusal = null;

  // ⭐ Complément 6 — la PREMIÈRE frame calibrée consigne le saut d'échelle
  // aperçu → final. On le mesure et on l'affiche (HUD) ; on ne le lisse pas.
  if (live.cal !== null && live.scaleJump === null && live.lastProvisionalPxPerMm !== null && freshScale !== null) {
    const ratio = freshScale / live.lastProvisionalPxPerMm;
    live.scaleJump = {
      provisionalPxPerMm: live.lastProvisionalPxPerMm,
      finalPxPerMm: freshScale,
      ratio,
      atMs: performance.now(),
    };
    console.info(
      `aperçu→calibré : ${live.lastProvisionalPxPerMm.toFixed(3)} → ${freshScale.toFixed(3)} px/mm ` +
        `(×${ratio.toFixed(3)})`,
    );
  }

  // 🔴 Point 56 — aucun NaN/Infinity n'atteint le canvas. Frame sautée, dite.
  const finite =
    Number.isFinite(filtered.x) &&
    Number.isFinite(filtered.y) &&
    Number.isFinite(filtered.rollRad) &&
    Number.isFinite(filtered.yawRad) &&
    Number.isFinite(filtered.scalePxPerMm) &&
    filtered.scalePxPerMm > 0;
  if (!finite) {
    live.skippedRenderFrames++;
    live.verdict = null;
    return;
  }

  const m: FrameMetrics = {
    livePxPerMm: filtered.scalePxPerMm,
    rollRad: filtered.rollRad,
    yawRad: filtered.yawRad,
    poseAnchor: { x: filtered.x, y: filtered.y },
    ear: { left: px(at(lm, EAR_L), w, h), right: px(at(lm, EAR_R), w, h) },
  };

  // ⭐ V2 « 2,5 D » : la géométrie, la lumière et la perspective viennent du
  // réel ; seule la matière est substituée.
  const worn = live.wornSprite;
  let recolored = false;
  if (worn !== null && video !== null && worn.spec.slug !== front.sprite.spec.slug) {
    const report = drawRecolored(ctx, video, worn, front.sprite, m);
    live.recolorReason = report.reason;
    recolored = report.reason === null && report.painted > 0;
  } else {
    live.recolorReason = null;
  }

  if (!recolored) {
    const profile = live.sprites.profile;
    drawFrame(
      ctx,
      { front: front.sprite, profile: profile.status === 'ready' ? profile.sprite : null },
      m,
      faceOutlinePath(lm, w, h),
      { overlayPaddingMm: live.overlayPaddingMm },
    );
  }
  live.renderedFrames++;
  live.lastRenderedAtMs = performance.now();

  // La légende chiffrée n'existe QUE sur une mesure convergée, et elle lit les
  // landmarks BRUTS — jamais la pose filtrée (complément 32).
  live.verdict = live.cal === null ? null : verdict(lm, live.cal, front.sprite.spec, w, h, yawRad);
}

/** Silence toléré avant d'EXPLIQUER l'attente de première échelle (A6). */
export const WAITING_FIRST_SCALE_EXPLAIN_MS = 1500;

/**
 * ⭐ Ré-audit A6 — le message d'attente de première échelle, ou null.
 *
 * Pur et testé : en dessous du seuil, rien (une frame refusée isolée n'est pas
 * un état) ; au-delà, la durée ET la cause — jamais un écran qui se tait.
 */
export function firstScaleWaitHint(sinceMs: number | null, refusal: string | null, nowMs: number): string | null {
  if (sinceMs === null || nowMs - sinceMs < WAITING_FIRST_SCALE_EXPLAIN_MS) return null;
  const seconds = ((nowMs - sinceMs) / 1000).toFixed(0);
  return (
    `monture en attente depuis ${seconds} s — ${refusal ?? 'aucune échelle de pose exploitable'} · ` +
    `le suivi du visage fonctionne, la monture apparaîtra dès que possible`
  );
}

/**
 * La note affichée sous l'image. L'ATTENTE DE PREMIÈRE ÉCHELLE (expliquée)
 * prime sur tout ; puis le caractère PROVISOIRE prime sur la note de
 * recoloriage : ne jamais laisser croire à une taille certifiée qui ne l'est
 * pas encore (audit humain du 2026-08-21, point 4 ; ré-audit A6).
 */
export function sceneHint(live: Live): string | null {
  const waiting = firstScaleWaitHint(live.firstScaleWaitSinceMs, live.firstScaleRefusal, performance.now());
  if (waiting !== null) return waiting;
  return live.provisional ? 'aperçu — taille en cours de mesure' : live.recolorReason;
}

/**
 * ⚠️ Le chemin d'échec DOIT dessiner (§1 bug #3).
 *
 * Une première implémentation incrémentait le compteur d'échecs sans jamais le
 * peindre : détection perdue = canvas figé sur la dernière image, et l'alarme
 * exigée n'apparaissait jamais. La panne était strictement indiscernable d'un
 * fonctionnement normal. Le banc navigateur le vérifie à chaque exécution.
 */
export function paintLost(
  ctx: CanvasRenderingContext2D,
  consecutiveFailures: number,
  cause: LostCause,
  reason: string | null,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // ⭐ Guide point 71 — chaque étage fautif a SA phrase. Plus jamais tout
  // résumer sous « visage non détecté ».
  const hint =
    cause === 'invalid-input'
      ? `Problème d'entrée caméra : ${reason ?? 'frame invalide'}.`
      : cause === 'model-pending'
        ? `Détection en préparation : ${reason ?? 'modèle en cours de création'}.`
        : cause === 'inference-error'
          ? `Erreur d'inférence (la boucle continue) : ${reason ?? '—'}.`
          : cause === 'invalid-landmarks'
            ? `Sortie du modèle inutilisable sur cette frame : ${reason ?? '—'}.`
            : consecutiveFailures > 5
              ? 'Recherche du visage…'
              : null;
  drawOverlay(ctx, {
    verdict: null,
    consecutiveFailures,
    hint,
    // ⭐ 2026-08-21 : sans ces deux informations, une capture d'écran ne permet
    // PAS de savoir où en est la machine ni dans quel navigateur elle tourne.
    detail: consecutiveFailures > 5 && cause === 'no-face' ? `${reason ?? '—'} · ${browserNote()}` : null,
  });
}

/**
 * Le navigateur, dit en clair. Un navigateur INTÉGRÉ (celui qui s'ouvre depuis
 * une messagerie) n'a ni les mêmes accélérations ni les mêmes permissions qu'un
 * navigateur complet : c'est une piste de diagnostic, jamais une excuse.
 */
function browserNote(): string {
  const ua = navigator.userAgent;
  const embedded = / wv\)|; wv|FBAN|FBAV|Instagram|WhatsApp|Line\/|MicroMessenger/i.test(ua);
  return embedded ? 'navigateur intégré (essayez d’ouvrir dans Chrome)' : 'navigateur complet';
}
