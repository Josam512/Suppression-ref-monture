/**
 * ui/temporalCapture.ts — les fenêtres de capture pour l'écart temporal.
 *
 * Une image FRONTALE figée (yaw quasi nul, mêmes pixels que ses repères), et
 * une vue tournée de chaque côté pour le masque de mouvement — la seule chose
 * qui distingue un bord de tête d'un montant de porte. Une capture par
 * fenêtre, pas par frame : trois `getImageData` au TOTAL.
 *
 * Guide de fiabilisation :
 *   - compléments 20–21 : chaque capture porte la GÉNÉRATION de collecte qui
 *     l'a produite ; un changement de génération PURGE tout — une frontale de
 *     la tentative N ne nourrit jamais l'assemblage de la tentative N+1 ;
 *   - point 33 : la frontale porte AUSSI l'échelle de SA frame quand elle est
 *     connue (calibration présente) — jamais « photo à 40 cm, échelle médiane
 *     à 55 cm » ;
 *   - point 35 : la même mécanique sert au raffinement d'ARRIÈRE-PLAN, après
 *     calibration, si l'écart temporal manque encore.
 */

import type { AutoTemporalScene } from '../core/autoCalibrate.js';
import type { NormalizedLandmark } from '../core/geom.js';
import { motionMask, type ImageBuffer } from '../core/silhouette.js';

export const AUTO_FRONTAL_MAX_YAW_RAD = 0.06;
export const AUTO_SIDE_MIN_YAW_RAD = 0.17;
export const AUTO_SIDE_MAX_YAW_RAD = 0.61;

interface FrontalShot {
  buf: ImageBuffer;
  lm: NormalizedLandmark[];
  w: number;
  h: number;
  /** Échelle plan des tempes de CETTE frame, si connue au moment de la capture. */
  frameScalePxPerMm: number | null;
}

export class TemporalCapture {
  private frontal: FrontalShot | null = null;
  private sides: { neg: ImageBuffer | null; pos: ImageBuffer | null } = { neg: null, pos: null };
  private generation_ = 0;

  reset(generation: number): void {
    this.frontal = null;
    this.sides = { neg: null, pos: null };
    this.generation_ = generation;
  }

  get generation(): number {
    return this.generation_;
  }

  /**
   * Propose une frame. `grab` n'est appelé que si une fenêtre est ouverte —
   * la capture coûte un `getImageData`, on n'en fait pas un par frame.
   */
  offer(
    lm: readonly NormalizedLandmark[],
    yawRad: number,
    w: number,
    h: number,
    generation: number,
    grab: () => ImageBuffer | null,
    frameScalePxPerMm: number | null,
  ): void {
    if (generation !== this.generation_) this.reset(generation); // ⭐ purge inter-générations
    const ay = Math.abs(yawRad);
    if (ay <= AUTO_FRONTAL_MAX_YAW_RAD && this.frontal === null) {
      const buf = grab();
      if (buf !== null) {
        this.frontal = { buf, lm: lm.map((p) => ({ x: p.x, y: p.y })), w, h, frameScalePxPerMm };
      }
    } else if (ay >= AUTO_SIDE_MIN_YAW_RAD && ay <= AUTO_SIDE_MAX_YAW_RAD) {
      const key = yawRad < 0 ? 'neg' : 'pos';
      if (this.sides[key] === null) this.sides[key] = grab();
    }
  }

  /** L'échelle propre à la frame frontale capturée, si elle était connue. */
  frontalFrameScale(): number | null {
    return this.frontal?.frameScalePxPerMm ?? null;
  }

  /**
   * La scène pour `assembleTemporal`, ou null. Silhouette tentée SEULEMENT
   * avec frontale + au moins une vue tournée : sans mouvement, un montant de
   * porte passerait pour un bord de tête.
   */
  scene(): AutoTemporalScene | null {
    const f = this.frontal;
    const buffers = [this.sides.neg, this.sides.pos].filter((b): b is ImageBuffer => b !== null);
    if (f === null || buffers.length === 0) return null;
    return { frontal: f.buf, motion: motionMask(f.buf, buffers), lm: f.lm, w: f.w, h: f.h };
  }
}
