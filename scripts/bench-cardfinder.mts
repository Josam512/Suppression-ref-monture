/**
 * scripts/bench-cardfinder.mts — coût réel d'UNE image de la séance filmée.
 * Outil d'audit, hors application. `npx vite-node scripts/bench-cardfinder.mts`
 */
import { findCard } from '../src/core/cardFinder.js';
import { refineQuad } from '../src/core/cardEdges.js';
import { CARD_H_MM, CARD_W_MM } from '../src/core/cardPose.js';
import { at, px } from '../src/core/geom.js';
import { FACE_L, FACE_R } from '../src/core/faceMetrics.js';
import type { ImageBuffer } from '../src/core/silhouette.js';
import { H, W, makeFace } from '../tests/fixtures/landmarks.js';

const lm = makeFace({ faceWidthPx: 420 });
const faceWidthPx = Math.hypot(
  px(at(lm, FACE_R), W, H).x - px(at(lm, FACE_L), W, H).x,
  px(at(lm, FACE_R), W, H).y - px(at(lm, FACE_L), W, H).y,
);
const cxFace = (px(at(lm, FACE_L), W, H).x + px(at(lm, FACE_R), W, H).x) / 2;
const cyEyes = (px(at(lm, 33), W, H).y + px(at(lm, 263), W, H).y) / 2;

function scene(widthPx: number, cx: number, cy: number, luma: number): ImageBuffer {
  const data = new Uint8ClampedArray(W * H * 4);
  const half = (widthPx * CARD_H_MM) / CARD_W_MM / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = 190;
      if (Math.abs(x - cx) <= widthPx / 2 && Math.abs(y - cy) <= half) v = luma;
      v += ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 3;
      const o = (y * W + x) * 4;
      data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

const buf = scene(0.62 * faceWidthPx, cxFace, cyEyes - 0.55 * faceWidthPx, 90);

// échauffement
findCard(buf, lm, W, H);

const N = 15;
let t0 = performance.now();
let found: ReturnType<typeof findCard> = null;
for (let i = 0; i < N; i++) found = findCard(buf, lm, W, H);
const tFind = (performance.now() - t0) / N;

t0 = performance.now();
for (let i = 0; i < N; i++) {
  try { refineQuad(buf, found!.quad, 25); } catch { /* sans importance ici */ }
}
const tRefine = (performance.now() - t0) / N;

console.log(`findCard   : ${tFind.toFixed(1)} ms / image`);
console.log(`refineQuad : ${tRefine.toFixed(1)} ms / image`);
console.log(`total/frame: ${(tFind + tRefine).toFixed(1)} ms  (+ getImageData ~3-8 ms + détection MediaPipe ~10-30 ms)`);
console.log(`fps théorique de la séance filmée: ${(1000 / (tFind + tRefine + 20)).toFixed(1)}`);
