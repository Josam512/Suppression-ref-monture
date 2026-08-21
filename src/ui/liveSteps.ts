/**
 * ui/liveSteps.ts — étapes qui vivent dans la boucle de détection.
 */

import type { AutoStatus } from '../core/autoCalibration.js';
import { crossCheckWithIris } from '../core/crossCheck.js';
import { irisWidthPx, rollRadOf } from '../core/faceMetrics.js';
import type { NormalizedLandmark } from '../core/geom.js';
import type { Live } from './liveState.js';

export const CROSSCHECK_FRAMES = 30;
export const SWEEP_REPORT_EVERY = 5;

export function stepRotation(
  s: Live,
  lm: readonly NormalizedLandmark[],
  yawRad: number,
  w: number,
  h: number,
): { degrees: { left: number; right: number }; cardViews: number } | null {
  if (s.probe === null) return null;
  s.probe.offer(lm, yawRad, rollRadOf(lm, w, h), w, h);

  const cardViews = s.probe.quads().length;
  const reached = s.probe.progress.negative + s.probe.progress.positive;
  const moved = Math.abs(reached - s.lastProbeRatio) > 0.02;
  const countWorthReporting =
    cardViews !== s.lastReportedCardViews && cardViews % SWEEP_REPORT_EVERY === 0;
  if (!moved && !countWorthReporting) return null;

  s.lastProbeRatio = reached;
  s.lastReportedCardViews = cardViews;
  const p = s.probe.progress;
  const deg = (r: number): number => (r * 180) / Math.PI;
  return { degrees: { left: deg(p.negative), right: deg(p.positive) }, cardViews };
}

/**
 * Nourrit le moteur automatique et publie un état uniquement s'il a changé.
 *
 * Audit 2026-08-21 : `attempts` et `lastAttemptFailure` font partie du contrat
 * visible. L'ancienne clé ne contenait que state|usableFrames|whyCode : un
 * réarmement pouvait donc avoir lieu sans aucun rendu React si ces trois champs
 * restaient identiques. L'écran disait alors encore l'état précédent tandis
 * que le moteur était déjà dans la tentative suivante.
 */
export function stepAutoCalibration(
  s: Live,
  lm: readonly NormalizedLandmark[] | null,
  yawRad: number,
  w: number,
  h: number,
  nowMs: number,
): AutoStatus | null {
  if (s.auto === null) return null;
  const roll = lm === null ? 0 : rollRadOf(lm, w, h);
  s.auto.offer(lm, yawRad, roll, w, h, nowMs);

  const status = s.auto.status();
  const key = [
    status.state,
    status.usableFrames,
    status.whyNotDone?.code ?? '',
    status.attempts,
    status.lastAttemptFailure?.code ?? '',
    status.primaryRejectReason ?? '',
  ].join('|');
  if (key === s.lastAutoKey) return null;
  s.lastAutoKey = key;
  return status;
}

export function stepCrossCheck(
  s: Live,
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
): string | null {
  if (s.irisSamples === null || s.cal === null) return null;
  s.irisSamples.push(irisWidthPx(lm, w, h));
  if (s.irisSamples.length < CROSSCHECK_FRAMES) return null;

  const mean = s.irisSamples.reduce((a, b) => a + b, 0) / s.irisSamples.length;
  s.irisSamples = null;
  return crossCheckWithIris(s.cal, mean, lm, w, h);
}
