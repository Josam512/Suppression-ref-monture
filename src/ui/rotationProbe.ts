/**
 * ui/rotationProbe.ts — collecte les deux vues tournées de la calibration V1.
 *
 * Le client tourne lentement la tête à gauche puis à droite. On ne lui demande
 * pas d'atteindre un angle précis : on regarde passer les images et on retient,
 * de chaque côté, la MEILLEURE — celle dont l'angle est le plus franc tout en
 * restant dans la plage exploitable, et dont la tête n'est pas penchée.
 *
 * ⚠️ Deux images seulement sont conservées. Ce n'est pas une vidéo, ce n'est pas
 * une reconstruction : c'est l'entrée d'une mesure qui rend deux scalaires
 * (§4, parade B4 n°2).
 */

import { isUsableProbeView, MAX_PROBE_YAW_RAD, type RotatedView } from '../core/parallax.js';
import type { ImageBuffer } from '../core/silhouette.js';
import type { NormalizedLandmark } from '../core/geom.js';

export interface ProbeSnapshot {
  view: RotatedView;
  buf: ImageBuffer;
}

/** Marge d'amélioration exigée pour remplacer une vue déjà retenue, en radians. */
const IMPROVEMENT_RAD = 0.02;

export class RotationProbe {
  private negative: ProbeSnapshot | null = null;
  private positive: ProbeSnapshot | null = null;

  /** @param capture rend l'image courante, ou null si elle n'est pas lisible. */
  constructor(private readonly capture: () => ImageBuffer | null) {}

  /** Meilleur angle atteint de chaque côté, en radians. Sert à la jauge d'IHM. */
  get progress(): { negative: number; positive: number } {
    return {
      negative: Math.abs(this.negative?.view.yawRad ?? 0),
      positive: Math.abs(this.positive?.view.yawRad ?? 0),
    };
  }

  get complete(): boolean {
    return this.negative !== null && this.positive !== null;
  }

  /** Propose une frame. Sans effet si elle n'améliore rien. */
  offer(lm: readonly NormalizedLandmark[], yawRad: number, rollRad: number, w: number, h: number): void {
    const view: RotatedView = { lm, yawRad, rollRad, w, h };
    if (!isUsableProbeView(view)) return;

    const side = yawRad < 0 ? 'negative' : 'positive';
    const held = this[side];
    if (held !== null && Math.abs(yawRad) <= Math.abs(held.view.yawRad) + IMPROVEMENT_RAD) return;

    const buf = this.capture();
    if (buf === null) return;
    this[side] = { view, buf };
  }

  /** Les deux vues, prêtes pour `calibrateWithCardMeasured`. */
  views(): readonly [RotatedView, RotatedView] | null {
    if (this.negative === null || this.positive === null) return null;
    return [this.negative.view, this.positive.view];
  }

  /** Les deux images, pour le masque de mouvement de la silhouette. */
  buffers(): ImageBuffer[] {
    return [this.negative, this.positive].flatMap((s) => (s === null ? [] : [s.buf]));
  }

  /** Fraction de la consigne accomplie, 0..1. Purement indicative. */
  ratio(): number {
    const target = MAX_PROBE_YAW_RAD * 0.6;
    const p = this.progress;
    return Math.min(1, (Math.min(p.negative, target) + Math.min(p.positive, target)) / (2 * target));
  }

  reset(): void {
    this.negative = null;
    this.positive = null;
  }
}
