/**
 * ui/CalibrationPanel.tsx — les étapes de mesure, avant l'essayage.
 *
 * V1 : la carte, puis la rotation de tête. V2 : la monture portée.
 * Extrait de `TryOn.tsx` pour tenir la règle des 300 lignes (§3).
 *
 * ⚠️ Ce composant ne mesure rien : il affiche des consignes et rend des pixels
 * cliqués. Toute la métrologie est dans `core/`.
 */

import type { AutoStatus } from '../core/autoCalibration.js';
import type { FrameSpec } from '../core/frameSpec.js';
import { AutoCalibrationStep } from './AutoCalibrationStep.js';
import { CardCalibration } from './CardCalibration.js';
import type { NormalizedLandmark } from '../core/geom.js';
import { RotationStep } from './RotationStep.js';
import { WornFrameCalibration } from './WornFrameCalibration.js';

/**
 * Les étapes de la V1, dans l'ordre où le client les traverse.
 *
 * 🔴 Aucune transition n'est automatique entre `mesure-carte` et `essayage` :
 * chacune attend un bouton. L'ancienne phase portait un `fill` — l'avancement
 * d'un verrouillage qui décidait à la place du client — et elle a disparu avec
 * lui (arbitrage du 2026-08-18).
 */
export type Phase =
  | { kind: 'loading'; ratio: number }
  | { kind: 'error'; message: string }
  /** ⭐ V2 — la mesure automatique. Le MOTEUR décide quand c'est terminé. */
  | { kind: 'mesure-auto'; status: AutoStatus }
  /** Mode diagnostic : consigne carte, puis « je filme ». Rien ne mesure encore. */
  | { kind: 'mesure-carte' }
  /** La séance filmée. Ne se termine QUE sur « J'ai fini ». */
  | { kind: 'mesure-rotation'; degrees: { left: number; right: number }; cardViews: number }
  /** V2 — même exigence : les repères sont ceux de l'image figée. */
  | { kind: 'mesure-monture'; frozen: HTMLCanvasElement; lm: readonly NormalizedLandmark[] }
  | { kind: 'essayage' };

export interface CalibrationPanelProps {
  phase: Phase;
  /** Toutes les montures, pour désigner celle qui est physiquement portée (V2). */
  catalogue: readonly FrameSpec[];
  /** « J'ai fini » : le client met un terme à la séance filmée. */
  onFinishSweep(): void;
  /** « Je filme » : la séance commence. Rien à viser, rien à pointer. */
  onCardReady(): void;
  onWornFrameValidated(widthPx: number, spec: FrameSpec, lm: readonly NormalizedLandmark[]): void;
  onCancel(): void;
  /** ⭐ V2 — relancer la mesure automatique après un échec. */
  onRetryAuto(): void;
  /** Basculer vers le mode diagnostic carte. */
  onUseCard(): void;
  /** Réessayer après une erreur caméra/modèle — l'état `error` n'est plus un cul-de-sac. */
  onRetryCamera(): void;
}

export function CalibrationPanel(props: CalibrationPanelProps): JSX.Element | null {
  const { phase } = props;

  if (phase.kind === 'loading') {
    return <p>Chargement du modèle : {Math.round(phase.ratio * 100)} %</p>;
  }

  if (phase.kind === 'error') {
    return (
      <section>
        <p style={{ color: '#ff6b6b' }}>Erreur : {phase.message}</p>
        <button type="button" onClick={props.onRetryCamera} style={{ fontWeight: 700 }}>
          Réessayer
        </button>
      </section>
    );
  }

  if (phase.kind === 'mesure-auto') {
    return (
      <AutoCalibrationStep status={phase.status} onRetry={props.onRetryAuto} onUseCard={props.onUseCard} />
    );
  }

  if (phase.kind === 'mesure-carte') {
    return <CardCalibration onCancel={props.onCancel} onReady={props.onCardReady} />;
  }

  if (phase.kind === 'mesure-rotation') {
    return (
      <RotationStep
        degrees={phase.degrees}
        cardViews={phase.cardViews}
        onFinish={props.onFinishSweep}
      />
    );
  }

  if (phase.kind === 'mesure-monture') {
    return (
      <WornFrameCalibration
        frozen={phase.frozen}
        catalogue={props.catalogue}
        onCancel={props.onCancel}
        onValidate={(widthPx, spec) => props.onWornFrameValidated(widthPx, spec, phase.lm)}
      />
    );
  }

  return null;
}
