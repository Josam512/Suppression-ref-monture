/**
 * ui/CardCalibration.tsx — V1, calibration carte bancaire (CLAUDE.md §4, niveau 2).
 *
 * Deux secondes, une seule fois, puis la carte disparaît définitivement.
 */

import { useState } from 'react';
import { CARD_MIN_DISTANCE_MM, estimateDistanceMm, isTooCloseForCard } from '../core/calibration.js';
import { TwoPointMeasure } from './TwoPointMeasure.js';

export interface CardCalibrationProps {
  frozen: HTMLCanvasElement;
  onValidate(cardWidthPx: number): void;
  onCancel(): void;
}

export function CardCalibration(props: CardCalibrationProps): JSX.Element {
  const [widthPx, setWidthPx] = useState(0);

  const imageWidth = props.frozen.width;
  const tooClose = widthPx > 0 && isTooCloseForCard(widthPx, imageWidth);
  const distanceCm = widthPx > 0 ? estimateDistanceMm(widthPx, imageWidth) / 10 : null;

  return (
    <section>
      <h2>Mesure avec une carte bancaire</h2>
      <p>
        Posez une carte bancaire <strong>à plat sur votre front</strong>, bord horizontal, et
        regardez droit devant vous. Amenez les deux poignées sur les bords de la carte.
      </p>

      <TwoPointMeasure
        frozen={props.frozen}
        onChange={setWidthPx}
        blocker={tooClose ? 'trop près' : null}
      />

      <p>
        Distance estimée : {distanceCm === null ? '—' : `${distanceCm.toFixed(0)} cm`}
        {tooClose && (
          <strong style={{ color: '#ff6b6b' }}>
            {' '}
            — reculez, il faut au moins {CARD_MIN_DISTANCE_MM / 10} cm. Trop près, la carte posée
            sur le front est vue plus grande que les tempes, et la mesure serait faussée sans que
            rien ne le signale.
          </strong>
        )}
      </p>

      <button type="button" disabled={tooClose || widthPx <= 0} onClick={() => props.onValidate(widthPx)}>
        Valider — vous pourrez ranger votre carte
      </button>{' '}
      <button type="button" onClick={props.onCancel}>
        Annuler
      </button>
    </section>
  );
}
