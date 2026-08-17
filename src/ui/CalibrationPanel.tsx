/**
 * ui/CalibrationPanel.tsx — les étapes de mesure, avant l'essayage.
 *
 * V1 : la carte, puis la rotation de tête. V2 : la monture portée.
 * Extrait de `TryOn.tsx` pour tenir la règle des 300 lignes (§3).
 *
 * ⚠️ Ce composant ne mesure rien : il affiche des consignes et rend des pixels
 * cliqués. Toute la métrologie est dans `core/`.
 */

import type { FrameSpec } from '../core/frameSpec.js';
import type { CardQuad } from '../core/cardPose.js';
import { CardCalibration } from './CardCalibration.js';
import { RotationStep } from './RotationStep.js';
import { WornFrameCalibration } from './WornFrameCalibration.js';

export type Phase =
  | { kind: 'loading'; ratio: number }
  | { kind: 'error'; message: string }
  | { kind: 'mesure-carte'; frozen: HTMLCanvasElement }
  | { kind: 'mesure-rotation'; ratio: number; degrees: { left: number; right: number } }
  | { kind: 'mesure-monture'; frozen: HTMLCanvasElement }
  | { kind: 'essayage' };

export interface CalibrationPanelProps {
  phase: Phase;
  /** Toutes les montures, pour désigner celle qui est physiquement portée (V2). */
  catalogue: readonly FrameSpec[];
  onCardValidated(cardWidthPx: number, quad: CardQuad, frozen: HTMLCanvasElement): void;
  onSkipRotation(): void;
  onWornFrameValidated(widthPx: number, spec: FrameSpec): void;
  onCancel(): void;
}

export function CalibrationPanel(props: CalibrationPanelProps): JSX.Element | null {
  const { phase } = props;

  if (phase.kind === 'loading') {
    return <p>Chargement du modèle : {Math.round(phase.ratio * 100)} %</p>;
  }

  if (phase.kind === 'error') {
    return <p style={{ color: '#ff6b6b' }}>Erreur : {phase.message}</p>;
  }

  if (phase.kind === 'mesure-carte') {
    return (
      <CardCalibration
        frozen={phase.frozen}
        onCancel={props.onCancel}
        onValidate={(cardWidthPx, quad) => props.onCardValidated(cardWidthPx, quad, phase.frozen)}
      />
    );
  }

  if (phase.kind === 'mesure-rotation') {
    return (
      <RotationStep ratio={phase.ratio} degrees={phase.degrees} onSkip={props.onSkipRotation} />
    );
  }

  if (phase.kind === 'mesure-monture') {
    return (
      <WornFrameCalibration
        frozen={phase.frozen}
        catalogue={props.catalogue}
        onCancel={props.onCancel}
        onValidate={props.onWornFrameValidated}
      />
    );
  }

  return null;
}
