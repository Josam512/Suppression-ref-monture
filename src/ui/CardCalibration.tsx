/**
 * ui/CardCalibration.tsx — calibration carte bancaire (CLAUDE.md §4, niveau 2).
 *
 * Deux secondes, une seule fois, puis la carte disparaît définitivement.
 * Ajustement MANUEL du rectangle, pas de détection automatique : plus robuste
 * sur webcam médiocre, et le client voit ce qu'il fait.
 */

import { useEffect, useRef, useState } from 'react';
import { CARD_MIN_DISTANCE_MM, estimateDistanceMm, isTooCloseForCard } from '../core/calibration.js';

export interface CardCalibrationProps {
  /** Frame figée, déjà dessinée dans un canvas hors écran. */
  frozen: HTMLCanvasElement;
  onValidate(cardWidthPx: number): void;
  onCancel(): void;
}

const HANDLE_R = 14;

export function CardCalibration(props: CardCalibrationProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { width, height } = props.frozen;

  const [left, setLeft] = useState(width * 0.35);
  const [right, setRight] = useState(width * 0.65);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);

  const cardWidthPx = Math.abs(right - left);
  const tooClose = isTooCloseForCard(cardWidthPx, width);
  const distanceMm = estimateDistanceMm(cardWidthPx, width);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas === null || ctx == null) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(props.frozen, 0, 0);

    const y = height * 0.3;
    ctx.strokeStyle = tooClose ? '#ff6b6b' : '#4ade80';
    ctx.lineWidth = 3;
    ctx.strokeRect(Math.min(left, right), y - 40, cardWidthPx, 80);

    for (const x of [left, right]) {
      ctx.beginPath();
      ctx.arc(x, y, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = tooClose ? '#ff6b6b' : '#4ade80';
      ctx.fill();
    }
  }, [props.frozen, left, right, cardWidthPx, tooClose, width, height]);

  function pointerX(e: React.PointerEvent<HTMLCanvasElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    // La scène est miroitée en CSS : on repasse en coordonnées non miroitées.
    return width - ((e.clientX - rect.left) / rect.width) * width;
  }

  return (
    <div>
      <p>
        Posez une carte bancaire à plat sur votre front, bord horizontal, et regardez droit devant
        vous. Ajustez les deux poignées sur les bords de la carte.
      </p>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ maxWidth: '100%', touchAction: 'none' }}
        onPointerDown={(e) => {
          const x = pointerX(e);
          setDragging(Math.abs(x - left) < Math.abs(x - right) ? 'left' : 'right');
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragging === null) return;
          const x = pointerX(e);
          if (dragging === 'left') setLeft(x);
          else setRight(x);
        }}
        onPointerUp={() => setDragging(null)}
      />
      <p>
        Distance estimée : {(distanceMm / 10).toFixed(0)} cm
        {tooClose && (
          <strong style={{ color: '#ff6b6b' }}>
            {' '}
            — reculez un peu (au moins {CARD_MIN_DISTANCE_MM / 10} cm). Trop près, la carte est
            mesurée plus grande que le visage et fausse la mesure.
          </strong>
        )}
      </p>
      <button type="button" disabled={tooClose} onClick={() => props.onValidate(cardWidthPx)}>
        Valider — vous pourrez ranger votre carte
      </button>{' '}
      <button type="button" onClick={props.onCancel}>
        Annuler
      </button>
    </div>
  );
}
