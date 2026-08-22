/**
 * ui/MeasuresPanel.tsx — l'état PERMANENT des mesures (guide, points 27 et 72,
 * complément 28).
 *
 * « PD pas encore mesuré » et « PD mesuré mais UI silencieuse » étaient
 * indiscernables : la valeur ne vivait que dans des notices éphémères, que le
 * changement de monture effaçait. Ce panneau lit le STORE de mesures — il
 * survit à tout, il dit l'état de CHAQUE métrique, et il n'est jamais un
 * jugement : des chiffres et leurs marges (§0.0.1).
 */

import type { UserCalibration } from '../core/calibration.js';
import type { MeasurementSnapshot, MetricPhase } from './measurementStore.js';
import { MIN_SPLIT_FRAMES } from '../core/autoCalibration.js';
import { pdDisplayOf } from './pdCarry.js';

function phaseLabel(phase: MetricPhase): string | null {
  switch (phase) {
    case 'idle':
      return null;
    case 'collecting':
      return 'collecte en cours…';
    case 'retrying':
      return 'nouvelle tentative…';
    case 'unavailable':
      return 'indisponible';
    case 'ready':
      return null;
  }
}

const mm = (v: number, u: number, digits = 1): string => `${v.toFixed(digits)} ± ${u.toFixed(digits)} mm`;

export function MeasuresPanel(props: {
  metrics: MeasurementSnapshot;
  cal: UserCalibration | null;
}): JSX.Element | null {
  const { metrics, cal } = props;
  const anyActive =
    metrics.pd.phase !== 'idle' || metrics.faceScale.phase !== 'idle' || metrics.temporal.phase !== 'idle';
  if (!anyActive && cal === null) return null;

  // ⭐ Ré-audit A12 — le store (plus frais) prime, la calibration PERSISTÉE
  // est le repli : au rechargement, le PD mémorisé s'affiche immédiatement.
  const pd = metrics.pd;
  const shown = pdDisplayOf(pd, cal);
  const pdCollecting = pd.phase === 'collecting' || pd.phase === 'retrying';
  const pdLine =
    shown !== null
      ? `PD total : ${mm(shown.pdMm, shown.uncertaintyMm)}` +
        (!shown.fromStore && pdCollecting ? ' (séance mémorisée — nouvelle mesure en cours)' : '')
      : `PD total : ${phaseLabel(pd.phase) ?? '—'}${pd.failure !== null ? ` (${pd.failure.label})` : ''}`;

  let halvesLine: string;
  if (shown !== null && shown.right !== null && shown.left !== null) {
    halvesLine =
      `demi-PD — OD : ${mm(shown.right.mm, shown.right.u)} · OG : ${mm(shown.left.mm, shown.left.u)}` +
      (shown.splitFrames !== null ? ` (${shown.splitFrames} images strictes)` : ' (séance mémorisée)');
  } else if (shown !== null && shown.splitFrames !== null) {
    halvesLine = `demi-PD : en attente de face stricte (${shown.splitFrames}/${MIN_SPLIT_FRAMES} images) — le total, lui, est acquis`;
  } else if (shown !== null) {
    halvesLine = pdCollecting
      ? `demi-PD : collecte en cours (regardez l’écran bien en face) — le total, lui, est acquis`
      : `demi-PD : non mesurées — le total, lui, est acquis`;
  } else {
    halvesLine = `demi-PD : ${phaseLabel(pd.phase) ?? '—'}`;
  }

  const face = metrics.faceScale;
  const faceLine =
    cal !== null
      ? `largeur de visage (repères) : ${mm(cal.faceWidthMm, cal.faceWidthMm * cal.relError, 0)}`
      : `largeur de visage : ${phaseLabel(face.phase) ?? '—'}${face.failure !== null ? ` (${face.failure.label})` : ''}`;

  const t = metrics.temporal;
  const temporalLine =
    cal?.temporalWidthMm !== undefined && cal.temporalRelError !== undefined
      ? `écart temporal : ${mm(cal.temporalWidthMm, cal.temporalWidthMm * cal.temporalRelError, 0)}`
      : t.phase === 'collecting'
        ? `écart temporal : tournez brièvement la tête d'un côté puis de l'autre — mesure en arrière-plan`
        : `écart temporal : ${phaseLabel(t.phase) ?? 'non mesuré (facultatif)'}`;

  const distanceLine =
    cal?.distanceMm !== undefined ? `distance mesurée : ${(cal.distanceMm / 10).toFixed(0)} cm` : null;

  return (
    <section aria-live="polite" style={{ opacity: 0.85, fontSize: '.92em', lineHeight: 1.5 }}>
      <p style={{ margin: '4px 0' }}>
        {pdLine}
        <br />
        {halvesLine}
        <br />
        {faceLine}
        <br />
        {temporalLine}
        {distanceLine !== null && (
          <>
            <br />
            {distanceLine}
          </>
        )}
      </p>
    </section>
  );
}
