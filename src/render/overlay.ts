import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { px } from '../core/geom';

/**
 * Overlay de contrôle — CLAUDE.md §3 (`render/overlay.ts`).
 *
 * Lot 2 : les 478 points, dessinés pour prouver que la détection tourne.
 * Les guides de mesure et les cotes affichées viendront avec le verdict.
 *
 * Les iris sont mis en évidence parce qu'ils ne sont pas des points comme les
 * autres : ce sont eux qui portent l'échelle du §4. Les voir accrocher
 * proprement, c'est voir la mesure tenir.
 */

/** Contours d'iris fournis par le modèle à 478 points (§1 bug #4). */
export const IRIS_LANDMARK_FIRST = 468;
export const IRIS_LANDMARK_LAST = 477;

const POINT_RADIUS_PX = 1.1;
const IRIS_POINT_RADIUS_PX = 2.4;
const MESH_COLOR = '#7fd8ff';
const IRIS_COLOR = '#3ddc97';
const MESH_ALPHA = 0.55;

export function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly NormalizedLandmark[],
  w: number,
  h: number,
): void {
  ctx.save();

  // — Le maillage, en un seul chemin : 478 arcs séparés coûteraient trop cher
  //   pour tenir les 25 fps du critère d'acceptation.
  ctx.globalAlpha = MESH_ALPHA;
  ctx.fillStyle = MESH_COLOR;
  ctx.beginPath();
  for (let i = 0; i < landmarks.length; i++) {
    if (i >= IRIS_LANDMARK_FIRST && i <= IRIS_LANDMARK_LAST) continue;
    const lm = landmarks[i];
    if (!lm) continue;
    const p = px(lm, w, h);
    ctx.moveTo(p.x + POINT_RADIUS_PX, p.y);
    ctx.arc(p.x, p.y, POINT_RADIUS_PX, 0, Math.PI * 2);
  }
  ctx.fill();

  // — Les iris, par-dessus : référence de mesure, donc lisibles à l'œil nu.
  ctx.globalAlpha = 1;
  ctx.fillStyle = IRIS_COLOR;
  ctx.beginPath();
  for (let i = IRIS_LANDMARK_FIRST; i <= IRIS_LANDMARK_LAST; i++) {
    const lm = landmarks[i];
    if (!lm) continue;
    const p = px(lm, w, h);
    ctx.moveTo(p.x + IRIS_POINT_RADIUS_PX, p.y);
    ctx.arc(p.x, p.y, IRIS_POINT_RADIUS_PX, 0, Math.PI * 2);
  }
  ctx.fill();

  ctx.restore();
}
