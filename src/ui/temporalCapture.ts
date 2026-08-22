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
 *   - 🔴 ré-audit A7 (point 33) : la frontale porte TOUJOURS l'échelle de SA
 *     frame, mesurée AU MOMENT de la capture — y compris pendant la
 *     calibration initiale, via l'échelle de pose (même optique que l'aperçu
 *     et l'assemblage). Sans échelle fiable sur la frame, la capture est
 *     ÉCARTÉE : « photo à 40 cm, échelle médiane à 55 cm » est mort ;
 *   - point 35 : la même mécanique sert au raffinement d'ARRIÈRE-PLAN, après
 *     calibration, si l'écart temporal manque encore.
 */

import { IRIS_DISCREPANCY_MAX } from '../core/autoTuning.js';
import type { AutoTemporalScene } from '../core/autoCalibrate.js';
import type { UserCalibration } from '../core/calibration.js';
import type { CameraProfile } from '../core/cameraProfile.js';
import { frameMetrics } from '../core/faceMetrics.js';
import type { NormalizedLandmark } from '../core/geom.js';
import { renderPoseScale } from '../core/renderPose.js';
import { motionMask, type ImageBuffer } from '../core/silhouette.js';

export const AUTO_FRONTAL_MAX_YAW_RAD = 0.06;
export const AUTO_SIDE_MIN_YAW_RAD = 0.17;
export const AUTO_SIDE_MAX_YAW_RAD = 0.61;

/** L'échelle d'UNE frame, telle que capturée avec elle (A7). */
export interface TemporalFrameScale {
  /** px/mm AU PLAN DES TEMPES de cette frame — l'échelle de la mesure. */
  templePlanePxPerMm: number;
  /** Diagnostic : distance estimée de la frame, quand l'optique la donne. */
  distanceMm?: number;
}

/**
 * ⭐ A7 — l'échelle de CETTE frame, au moment où on la capture : celle de la
 * calibration quand elle existe (frameMetrics), sinon l'échelle de POSE
 * (renderPoseScale — même formule de plan, même choix de focale que
 * l'assemblage). `null` = frame sans échelle fiable → capture à écarter.
 */
export function temporalFrameScaleOf(
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
  cal: UserCalibration | null,
  yawRad: number,
  profile: CameraProfile | null,
  nowMs: number,
): TemporalFrameScale | null {
  if (cal !== null) {
    const scale = frameMetrics(lm, w, h, cal, yawRad).livePxPerMm;
    return Number.isFinite(scale) && scale > 0 ? { templePlanePxPerMm: scale } : null;
  }
  const rp = renderPoseScale(lm, w, h, IRIS_DISCREPANCY_MAX, profile, nowMs);
  if (rp === null) return null;
  return { templePlanePxPerMm: rp.templePlanePxPerMm, distanceMm: rp.distanceMm };
}

interface FrontalShot {
  buf: ImageBuffer;
  lm: NormalizedLandmark[];
  w: number;
  h: number;
  /** L'échelle de CETTE frame — obligatoire : sans elle, pas de capture (A7). */
  scale: TemporalFrameScale;
  atMs: number;
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
   * 🔴 A7 — une frontale SANS échelle fiable n'est pas capturée : on attend
   * une frame qui en porte une, plutôt que de mesurer avec une autre époque.
   */
  offer(
    lm: readonly NormalizedLandmark[],
    yawRad: number,
    w: number,
    h: number,
    generation: number,
    grab: () => ImageBuffer | null,
    frameScale: TemporalFrameScale | null,
  ): void {
    if (generation !== this.generation_) this.reset(generation); // ⭐ purge inter-générations
    const ay = Math.abs(yawRad);
    if (ay <= AUTO_FRONTAL_MAX_YAW_RAD && this.frontal === null) {
      if (frameScale === null) return; // frame sans échelle : capture écartée (A7)
      const buf = grab();
      if (buf !== null) {
        this.frontal = {
          buf,
          lm: lm.map((p) => ({ x: p.x, y: p.y })),
          w,
          h,
          scale: frameScale,
          atMs: Date.now(),
        };
      }
    } else if (ay >= AUTO_SIDE_MIN_YAW_RAD && ay <= AUTO_SIDE_MAX_YAW_RAD) {
      const key = yawRad < 0 ? 'neg' : 'pos';
      if (this.sides[key] === null) this.sides[key] = grab();
    }
  }

  /**
   * La scène pour `assembleTemporal`, ou null — et elle PORTE l'échelle de sa
   * frontale (A7). Silhouette tentée SEULEMENT avec frontale + au moins une
   * vue tournée : sans mouvement, un montant de porte passerait pour un bord
   * de tête.
   */
  scene(): AutoTemporalScene | null {
    const f = this.frontal;
    const buffers = [this.sides.neg, this.sides.pos].filter((b): b is ImageBuffer => b !== null);
    if (f === null || buffers.length === 0) return null;
    return {
      frontal: f.buf,
      motion: motionMask(f.buf, buffers),
      lm: f.lm,
      w: f.w,
      h: f.h,
      frameScalePxPerMm: f.scale.templePlanePxPerMm,
      capturedAtMs: f.atMs,
      ...(f.scale.distanceMm !== undefined ? { distanceMmAtCapture: f.scale.distanceMm } : {}),
    };
  }
}
