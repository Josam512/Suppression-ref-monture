/**
 * ui/devHud.ts — le HUD de développement (guide points 71–73, compléments
 * 6, 10–11, 38, 41).
 *
 * Activé par `?hud=1`, jamais par défaut. Il AFFICHE — il ne décide de rien
 * (règle de non-interférence : une fonction de diagnostic n'entre jamais dans
 * le chemin produit). Une seule capture d'écran doit suffire à dire OÙ la
 * chaîne s'est arrêtée :
 *
 *   caméra → snapshots → inférences → landmarks → rendu → métrologie
 *
 * « pas de lunettes » ne signifie plus « rien ne marche » : le PD est
 * observable même si le rendu est cassé, et le rendu même sans calibration.
 */

import { modelSha, preloadErrorsOf } from '../tracking/landmarker.js';
import { APP_BUILD_TAG, AUTO_METROLOGY_VERSION, GIT_SHA } from '../core/versions.js';
import { irisQualityOf } from '../core/irisQuality.js';
import { IRIS_DISCREPANCY_MAX } from '../core/autoTuning.js';
import { ocularPixelsOf } from '../core/ocularScale.js';
import type { Live } from './liveState.js';

let enabled: boolean | null = null;

/** `?hud=1` — lu une fois. Le HUD est un outil d'atelier, pas le produit. */
export function hudEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = new URLSearchParams(window.location.search).get('hud') === '1';
    } catch {
      enabled = false;
    }
  }
  return enabled;
}

const fmt = (v: number, d = 2): string => (Number.isFinite(v) ? v.toFixed(d) : '—');

/** Compose les lignes du HUD — pur, testable sans canvas. */
export function hudLines(live: Live, nowMs: number): string[] {
  const lines: string[] = [];
  lines.push(
    `${APP_BUILD_TAG} · ${GIT_SHA} · algo v${AUTO_METROLOGY_VERSION} · modèle ${modelSha()?.slice(0, 12) ?? '…'}`,
  );

  const s = live.loopStats?.() ?? null;
  if (s !== null) {
    const feed = s.feed;
    lines.push(
      `flux ${feed?.method ?? '—'} : cam ${feed?.cameraFrames ?? 0} · err ${feed?.snapshotErrors ?? 0} · stalls ${feed?.stalls ?? 0} · ` +
        `♥ ${feed ? fmt((nowMs - feed.lastFrameAt) / 1000, 1) : '—'} s`,
    );
    lines.push(
      `détection [${s.runningStrategy ?? s.modelState}] : inf ${s.inferenceSuccess}/${s.inferenceAttempts} · ` +
        `lm ${s.landmarkFrames} · invalides ${s.invalidLandmarkFrames} · errs ${s.inferenceErrors} · ` +
        `♥ ${fmt((nowMs - s.lastLandmarkAt) / 1000, 1)} s`,
    );
    if (s.lastInferenceError !== null) lines.push(`dernière erreur inf : ${s.lastInferenceError}`);
  }

  // ⭐ Ré-audit A5 — un préchargement mort n'est plus invisible : il s'affiche.
  const pre = preloadErrorsOf();
  if (pre.model !== null || pre.fileset !== null) {
    const parts = [
      ...(pre.model !== null ? [`modèle : ${pre.model}`] : []),
      ...(pre.fileset !== null ? [`fileset : ${pre.fileset}`] : []),
    ];
    lines.push(`préchargement KO — ${parts.join(' · ')}`);
  }

  lines.push(
    `rendu ${live.provisional ? 'PROVISOIRE' : live.cal !== null ? 'calibré' : '—'} : ` +
      `${live.renderedFrames} frames · sautées ${live.skippedRenderFrames} · ` +
      `♥ ${fmt((nowMs - live.lastRenderedAtMs) / 1000, 1)} s · ` +
      `sprites F:${live.sprites.front.status} P:${live.sprites.profile.status} · repère ${live.coordinateSpace}`,
  );

  const held = live.poseFilter.heldScale();
  const waiting =
    live.firstScaleWaitSinceMs !== null
      ? ` · ATTENTE 1re échelle ${fmt((nowMs - live.firstScaleWaitSinceMs) / 1000, 0)} s` +
        (live.firstScaleRefusal !== null ? ` (${live.firstScaleRefusal})` : '')
      : '';
  lines.push(`échelle de pose : ${held === null ? '—' : `${fmt(held, 3)} px/mm`}${waiting}`);

  // ⭐ Complément 18 — l'instrumentation iris (L, R, écart, yaw) qui permet de
  // JUGER le seuil sur données réelles avant de jamais le retoucher.
  if (live.lastLandmarks !== null) {
    try {
      const eyes = ocularPixelsOf(live.lastLandmarks, 1, 1); // normalisé : le ratio suffit
      const q = irisQualityOf(eyes.hvidLeftPx, eyes.hvidRightPx, IRIS_DISCREPANCY_MAX);
      lines.push(
        `iris (norm.) G ${fmt(eyes.hvidLeftPx * 1000, 2)}‰ · D ${fmt(eyes.hvidRightPx * 1000, 2)}‰ · ` +
          `écart ${fmt(q.discrepancy * 100, 2)} % (max ${fmt(IRIS_DISCREPANCY_MAX * 100, 2)} %) · ` +
          `yaw ${fmt((live.lastYawRad * 180) / Math.PI, 1)}°`,
      );
    } catch {
      // landmarks partiels : l'iris n'est simplement pas affichable cette frame
    }
  }
  if (live.scaleJump !== null) {
    lines.push(
      `saut aperçu→calibré : ${fmt(live.scaleJump.provisionalPxPerMm, 3)} → ${fmt(live.scaleJump.finalPxPerMm, 3)} ` +
        `(×${fmt(live.scaleJump.ratio, 3)})`,
    );
  }

  const auto = live.auto;
  if (auto !== null) {
    const st = auto.status();
    lines.push(
      `mesure g${st.generation} [${st.phase}] : ${st.usableFrames}/${st.neededFrames} utiles · ` +
        `rejets ${st.rejectedFramesAny} (visage ${st.rejected['no-face']} yeux ${st.rejected['eyes-too-small']} ` +
        `yaw ${st.rejected['turn-to-front']} roll ${st.rejected['straighten-head']}) · ` +
        `SE ${fmt(st.scaleStandardError * 100, 2)} % · tentatives ${st.attempts}`,
    );
    // ⭐ A9/A10 — l'estimateur candidat et la stabilité de SA série, en clair.
    lines.push(
      `série [${st.candidateEstimator}] : dispersion ${fmt(st.scaleSpreadRel * 100, 1)} %/frame · ` +
        `dérive ${fmt(st.scaleDriftRel * 100, 1)} % · hors-série ${fmt(st.scaleOutlierRatio * 100, 0)} %`,
    );
    if (st.lastFrameViolations.length > 1) {
      lines.push(`frame rejetée pour : ${st.lastFrameViolations.join(' + ')}`);
    }
  }

  const cal = live.cal;
  if (cal !== null) {
    lines.push(
      `cal : visage ${fmt(cal.faceWidthMm, 0)}±${fmt(cal.faceWidthMm * cal.relError, 0)} mm · ` +
        `PD ${cal.pdMm !== undefined ? `${fmt(cal.pdMm, 1)} mm` : 'collecte…'} · ` +
        `OD/OG ${cal.pdRightMm !== undefined ? `${fmt(cal.pdRightMm, 1)}/${fmt(cal.pdLeftMm ?? NaN, 1)}` : '—'} · ` +
        `temporal ${cal.temporalWidthMm !== undefined ? `${fmt(cal.temporalWidthMm, 0)} mm` : '—'} · ` +
        `D ${cal.distanceMm !== undefined ? `${fmt(cal.distanceMm / 10, 0)} cm` : '—'}`,
    );
  }
  return lines;
}

/** Peint le HUD en bas du canvas. Ne lève jamais (le HUD n'a pas ce droit). */
export function drawDevHud(ctx: CanvasRenderingContext2D, live: Live): void {
  try {
    const lines = hudLines(live, performance.now());
    const lh = 16;
    const boxH = lines.length * lh + 10;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, ctx.canvas.height - boxH, ctx.canvas.width, boxH);
    // Contre-miroir, comme l'overlay : le conteneur est en scaleX(-1).
    ctx.setTransform(-1, 0, 0, 1, ctx.canvas.width, 0);
    ctx.font = '12px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#9fe89f';
    lines.forEach((line, i) => {
      ctx.fillText(line, 8, ctx.canvas.height - boxH + 5 + i * lh);
    });
    ctx.restore();
  } catch {
    // Un HUD qui casse le rendu serait un comble : silence absolu.
  }
}
