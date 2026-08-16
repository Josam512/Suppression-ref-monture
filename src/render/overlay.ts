/**
 * render/overlay.ts — la légende chiffrée et l'état de la détection.
 *
 * ⚠️ N'affiche JAMAIS de jugement (§0.0.1). Deux chiffres, leurs marges, et le
 * statut technique de la mesure. Aucun tri, aucun classement, aucun conseil.
 */

import { legend, type SizeVerdict } from '../core/verdict.js';

const PADDING = 12;
const LINE_HEIGHT = 22;

export interface OverlayState {
  verdict: SizeVerdict | null;
  consecutiveFailures: number;
  /** Message d'aide à la pose, ex. « reculez un peu ». Jamais un avis sur la monture. */
  hint: string | null;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, state: OverlayState): void {
  const lines: string[] = [];

  if (state.verdict !== null) {
    lines.push(legend(state.verdict));
    const d = state.verdict.decentrementMm;
    if (d !== null) {
      const worst = Math.max(d.left, d.right);
      lines.push(`décentrement : ${worst.toFixed(1)} mm`);
    }
  } else {
    // Le null gèle la légende, jamais l'image : la monture reste à l'écran.
    lines.push('mesure indisponible sur cette pose');
  }

  if (state.hint !== null) lines.push(state.hint);
  if (state.consecutiveFailures > 5) {
    lines.push(`détection perdue : ${state.consecutiveFailures} frames`);
  }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = '16px system-ui, sans-serif';
  ctx.textBaseline = 'top';

  const boxH = lines.length * LINE_HEIGHT + PADDING;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, ctx.canvas.width, boxH);

  ctx.fillStyle = '#fff';
  lines.forEach((line, i) => {
    ctx.fillText(line, PADDING, PADDING / 2 + i * LINE_HEIGHT);
  });
  ctx.restore();
}
