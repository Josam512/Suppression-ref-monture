/**
 * ui/TwoPointMeasure.tsx — mesure d'une largeur par DEUX poignées sur frame figée.
 *
 * Sert aux deux versions :
 *   • V1 — les deux bords d'une carte bancaire posée sur le front (§4, niveau 2) ;
 *   • V2 — les deux bords externes de la monture portée (§11.7, lot V2-3).
 *
 * ⚠️ Aucune détection automatique. Sur webcam médiocre, deux clics sont plus
 * fiables, plus rapides à coder et testables — et l'opérateur VOIT ce qu'il
 * fait. L'automatisation viendra si le besoin se confirme, pas avant.
 *
 * ⚠️ Ce composant ne connaît ni carte, ni monture, ni mode : il renvoie une
 * largeur en pixels. C'est l'appelant qui sait ce qu'elle mesure (§11.4).
 */

import { useEffect, useRef, useState } from 'react';

export interface TwoPointMeasureProps {
  /** Frame figée, déjà dessinée dans un canvas hors écran. */
  frozen: HTMLCanvasElement;
  /** Hauteur relative de la ligne de mesure dans l'image (0..1). */
  guideY?: number;
  /** Largeur mesurée, en pixels image, à chaque déplacement. */
  onChange(widthPx: number): void;
  /** `null` = mesure acceptable ; sinon, la raison du refus, affichée à l'écran. */
  blocker?: string | null;
}

const HANDLE_R = 16;

export function TwoPointMeasure(props: TwoPointMeasureProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { width, height } = props.frozen;
  const guideY = (props.guideY ?? 0.3) * height;

  const [left, setLeft] = useState(width * 0.35);
  const [right, setRight] = useState(width * 0.65);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);

  const blocked = props.blocker != null;
  const onChange = props.onChange;

  useEffect(() => {
    onChange(Math.abs(right - left));
  }, [left, right, onChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas === null || ctx == null) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(props.frozen, 0, 0);

    const color = blocked ? '#ff6b6b' : '#4ade80';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(left, guideY);
    ctx.lineTo(right, guideY);
    ctx.stroke();

    for (const x of [left, right]) {
      ctx.beginPath();
      ctx.moveTo(x, guideY - 45);
      ctx.lineTo(x, guideY + 45);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, guideY, HANDLE_R, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [props.frozen, left, right, blocked, width, height, guideY]);

  /** La scène est miroitée en CSS : on repasse en coordonnées non miroitées. */
  function pointerX(e: React.PointerEvent<HTMLCanvasElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    return width - ((e.clientX - rect.left) / rect.width) * width;
  }

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ maxWidth: '100%', touchAction: 'none', cursor: 'ew-resize' }}
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
      onPointerCancel={() => setDragging(null)}
    />
  );
}
