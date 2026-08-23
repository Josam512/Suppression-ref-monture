/**
 * tracking/frameInput.ts — l'ENTRÉE de l'inférence et la VALIDATION de sortie.
 *
 * Extrait de `faceLoop.ts` (règle des 300 lignes, §3).
 *
 * 🔴 Négociation (arbitrage humain 2026-08-22) — ce que `detectForVideo`
 * reçoit dépend de la stratégie :
 *   - `source: 'video'` → l'élément <video> LUI-MÊME (le défaut : un étage de
 *     copie de moins, et certains pilotes cassent sur l'entrée canvas) ;
 *   - `source: 'canvas'` → le canvas du flux (la recopie d'hier, conservée au
 *     catalogue : d'autres pilotes cassent sur l'entrée vidéo) ;
 *   - une MARGE (padFraction) impose le canvas de travail letterboxé.
 */

import { unpadPoint, type DetectionStrategy } from './strategyCatalog.js';
import type { FrameSnapshot } from './frameFeed.js';

/** Longueur minimale d'une sortie FaceLandmarker exploitable (478 = avec iris). */
export const MIN_LANDMARKS = 478;
/** Repères sans lesquels ni pose, ni rendu, ni métrologie ne tiennent. */
export const CRITICAL_LANDMARKS = [1, 33, 133, 168, 234, 263, 362, 454, 468, 473, 162, 389] as const;

/** L'entrée réellement soumise à l'inférence, avec ses dimensions (diagnostic). */
export interface DetectionInput {
  input: HTMLVideoElement | HTMLCanvasElement;
  w: number;
  h: number;
}

/**
 * Prépare l'entrée d'inférence selon la stratégie. La marge (letterbox) ajoute
 * `padFraction` de chaque dimension autour de la frame : le crop interne du
 * landmarker (×1,5, mis au carré) cesse de déborder hors image sur un visage
 * très proche. Les landmarks sont dé-mappés par `unpadPoint`.
 */
export function detectionInput(
  s: FrameSnapshot,
  video: HTMLVideoElement,
  strategy: DetectionStrategy,
  scratch: HTMLCanvasElement,
): DetectionInput {
  const pad = strategy.padFraction;
  if (pad === null) {
    if (strategy.source === 'video') {
      return { input: video, w: video.videoWidth, h: video.videoHeight };
    }
    return { input: s.source, w: s.w, h: s.h };
  }
  const w = Math.round(s.w * (1 + 2 * pad));
  const h = Math.round(s.h * (1 + 2 * pad));
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const g = scratch.getContext('2d')!;
  g.fillStyle = '#7f7f7f'; // remplissage neutre, comme le letterbox interne de MediaPipe
  g.fillRect(0, 0, w, h);
  g.drawImage(s.source, Math.round(s.w * pad), Math.round(s.h * pad));
  return { input: scratch, w, h };
}

/** Dé-mappe les landmarks du cadre AVEC marge vers le cadre d'origine (X/Y seuls). */
export function unpadLandmarks(
  lm: ReadonlyArray<{ x: number; y: number; z?: number }>,
  pad: number,
): ReadonlyArray<{ x: number; y: number; z?: number }> {
  return lm.map((q) => ({ ...q, x: unpadPoint(q.x, pad), y: unpadPoint(q.y, pad) }));
}

/**
 * ⭐ Guide point 16 — la sortie du modèle est validée ICI, à la frontière.
 * Rend la raison du rejet, ou null si la frame est exploitable.
 */
export function landmarksInvalidReason(
  lm: ReadonlyArray<{ x: number; y: number }> | undefined,
): string | null {
  if (lm === undefined || lm.length === 0) return null; // « aucun visage » n'est pas « sortie invalide »
  if (lm.length < MIN_LANDMARKS) {
    return `sortie partielle : ${lm.length} landmarks au lieu de ${MIN_LANDMARKS}`;
  }
  for (const i of CRITICAL_LANDMARKS) {
    const p = lm[i];
    if (p === undefined || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return `landmark critique ${i} non fini`;
    }
  }
  return null;
}
