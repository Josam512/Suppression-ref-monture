/**
 * ui/sceneScale.ts — LA décision d'échelle d'une frame de rendu.
 *
 * Extraite de `paintScene` (refonte « VTO autonome », 2026-08-23) pour être
 * PURE et testée branche par branche :
 *
 *   1. calibration présente  → échelle MÉTRIQUE (frameMetrics) ;
 *   2. iris exploitables     → échelle de POSE (renderPose, provisoire) ;
 *   3. iris refusés          → ⚖️ échelle VISUELLE de secours (arbitrage
 *      2026-08-23) : la monture APPARAÎT sur une échelle provisoire de
 *      SESSION (référence figée — ré-audit du soir : jamais la monture en
 *      cours, sans quoi toutes « couvriraient » le visage) — la métrologie
 *      continue en parallèle ;
 *   4. repères dégénérés     → rien d'honnête à poser (seul cas restant).
 *
 * Aucun gate PD / anatomie / qualité d'iris ne bloque les branches 2-3 : le
 * rendu n'est jamais l'otage de la métrologie.
 */

import { IRIS_DISCREPANCY_MAX } from '../core/autoCalibration.js';
import { frameMetrics } from '../core/faceMetrics.js';
import type { NormalizedLandmark } from '../core/geom.js';
import { renderPoseScaleDiagnosed } from '../core/renderPose.js';
import type { CameraProfile } from '../core/cameraProfile.js';
import type { UserCalibration } from '../core/calibration.js';
import { estimateVisualScale } from './visualScale.js';

export interface SceneScaleDecision {
  /** L'échelle à filtrer/poser (px/mm), ou null : rien d'honnête cette frame. */
  scale: number | null;
  /** Cause du refus d'échelle de pose (diagnostic), le cas échéant. */
  refusalDetail: string | null;
  /** Non nul quand la branche VISUELLE de secours est active (sa cause). */
  visualFallbackReason: string | null;
  /** Valeur provisoire à mémoriser pour l'instrumentation du saut (ou null). */
  provisionalPxPerMm: number | null;
}

export function resolveSceneScale(
  cal: UserCalibration | null,
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
  yawRad: number,
  cameraProfile: CameraProfile | null,
  /** Référence de session FIGÉE (ré-audit 2026-08-23) — PAS la monture en cours. */
  visualRefWidthMm: number,
  nowMs: number,
): SceneScaleDecision {
  if (cal !== null) {
    return {
      scale: frameMetrics(lm, w, h, cal, yawRad).livePxPerMm,
      refusalDetail: null,
      visualFallbackReason: null,
      provisionalPxPerMm: null,
    };
  }
  const rp = renderPoseScaleDiagnosed(lm, w, h, IRIS_DISCREPANCY_MAX, cameraProfile, nowMs);
  if (rp.scale !== null) {
    return {
      scale: rp.scale.templePlanePxPerMm,
      refusalDetail: null,
      visualFallbackReason: null,
      provisionalPxPerMm: rp.scale.templePlanePxPerMm,
    };
  }
  const refusalDetail = rp.refusal?.detail ?? null;
  // ⚖️ Arbitrage 2026-08-23 — l'iris refusé ne prive PLUS de monture : échelle
  // VISUELLE de secours sur la RÉFÉRENCE DE SESSION (jamais la monture en
  // cours — ré-audit). Plausible à l'œil, JAMAIS métrologique : rien n'est
  // persisté, la métrologie ne la voit pas, la légende reste gelée.
  const visual = estimateVisualScale(lm, w, h, visualRefWidthMm);
  if (visual !== null) {
    return {
      scale: visual,
      refusalDetail,
      visualFallbackReason: refusalDetail ?? 'échelle de pose indisponible',
      provisionalPxPerMm: visual,
    };
  }
  return { scale: null, refusalDetail, visualFallbackReason: null, provisionalPxPerMm: null };
}
