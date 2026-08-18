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
import { CardCalibration } from './CardCalibration.js';
import { CardManual } from './CardManual.js';
import type { CardQuad } from '../core/cardPose.js';
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
  /** Consigne, puis « ma carte est en place ». Rien ne mesure encore. */
  | { kind: 'mesure-carte' }
  /**
   * Image figée : le client pose ses deux repères, à son rythme.
   *
   * 🔴 `lm` est relevé À L'INSTANT DU GEL, et voyage avec l'image. La largeur du
   * visage en pixels DOIT être lue sur les mêmes pixels que la carte : c'est
   * leur RAPPORT qui est la mesure. Lire les repères courants — ceux de la
   * boucle live, qui continue de tourner pendant que le client vise — les
   * prendrait plusieurs secondes après, sur une tête qui a bougé, et l'erreur
   * serait parfaitement invisible.
   */
  | { kind: 'mesure-carte-manuelle'; frozen: HTMLCanvasElement; lm: readonly NormalizedLandmark[] }
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
  /** « Ma carte est en place » : fige l'image et passe au pointage. */
  onCardReady(): void;
  /** « Reprendre l'image » : retour à la consigne, image relâchée. */
  onRetakeCard(): void;
  onCardValidated(
    widthPx: number,
    quad: CardQuad,
    frozen: HTMLCanvasElement,
    lm: readonly NormalizedLandmark[],
  ): void;
  onWornFrameValidated(widthPx: number, spec: FrameSpec, lm: readonly NormalizedLandmark[]): void;
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
    return <CardCalibration onCancel={props.onCancel} onReady={props.onCardReady} />;
  }

  if (phase.kind === 'mesure-carte-manuelle') {
    return (
      <CardManual
        frozen={phase.frozen}
        onRetry={props.onRetakeCard}
        onValidate={(widthPx, quad) => props.onCardValidated(widthPx, quad, phase.frozen, phase.lm)}
      />
    );
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
