/**
 * ui/rotationProbe.ts — collecte le BALAYAGE de la calibration V1.
 *
 * Le client tourne lentement la tête à gauche puis à droite. On ne lui demande
 * pas d'atteindre un angle précis : on regarde passer les images et on retient
 * une vue par tranche d'angle, de chaque côté.
 *
 * ⚠️ Retenir seulement les deux extrêmes ne suffit PAS. La profondeur et la
 * distance se séparent parce qu'elles dépendent de l'angle différemment —
 * `sin θ` contre `sin θ·cos θ` — et deux points ne distinguent pas deux courbes
 * qui se ressemblent. Il faut un ÉTALEMENT d'angles, d'où les tranches.
 *
 * ⚠️ Seules deux IMAGES sont conservées, une par côté : elles ne servent qu'au
 * masque de mouvement de la silhouette. Les autres vues ne gardent que leurs
 * repères — quelques centaines d'octets. Ce n'est ni une vidéo ni une
 * reconstruction : c'est l'entrée d'une régression à deux inconnues.
 */

import { isUsableProbeView, MAX_PROBE_YAW_RAD, MIN_PROBE_YAW_RAD, type RotatedView } from '../core/parallax.js';
import type { ImageBuffer } from '../core/silhouette.js';
import type { NormalizedLandmark } from '../core/geom.js';
import type { CardQuad } from '../core/cardPose.js';

/** Nombre de tranches d'angle PAR CÔTÉ. */
export const BANDS_PER_SIDE = 4;

export class RotationProbe {
  /** Une vue au plus par tranche : index 0..2·BANDS−1, négatifs puis positifs. */
  private readonly slots: Array<RotatedView | null>;
  private negativeImage: ImageBuffer | null = null;
  private positiveImage: ImageBuffer | null = null;
  private bestNegative = 0;
  private bestPositive = 0;

  /**
   * Cadres de la carte relevés pendant le balayage — la matière de la focale.
   *
   * ⚠️ On ne garde QUE les quatre coins, pas l'image : le suivi est fait à la
   * volée et le tampon est relâché aussitôt. Conserver huit images de
   * 1280×720 coûterait 30 Mo pour rien.
   */
  private readonly quadsFound: CardQuad[] = [];

  /**
   * @param capture rend l'image courante, ou null si elle n'est pas lisible.
   * @param trackQuad accroche la carte sur cette image, ou rend null si elle
   *        n'y est plus. Facultatif : sans lui, le balayage ne sert qu'à la
   *        profondeur, et la distance reste supposée.
   */
  constructor(
    private readonly capture: () => ImageBuffer | null,
    private readonly trackQuad: ((buf: ImageBuffer) => CardQuad | null) | null = null,
  ) {
    this.slots = Array.from({ length: 2 * BANDS_PER_SIDE }, () => null);
  }

  /** Tranche d'angle d'une vue, ou −1 si hors plage exploitable. */
  private static bandOf(yawRad: number): number {
    const a = Math.abs(yawRad);
    if (a < MIN_PROBE_YAW_RAD || a > MAX_PROBE_YAW_RAD) return -1;
    const t = (a - MIN_PROBE_YAW_RAD) / (MAX_PROBE_YAW_RAD - MIN_PROBE_YAW_RAD);
    const band = Math.min(BANDS_PER_SIDE - 1, Math.floor(t * BANDS_PER_SIDE));
    return yawRad < 0 ? band : BANDS_PER_SIDE + band;
  }

  /** Angle maximal atteint de chaque côté, en radians. Sert à la jauge d'IHM. */
  get progress(): { negative: number; positive: number } {
    return { negative: this.bestNegative, positive: this.bestPositive };
  }

  /** Nombre de tranches remplies, tous côtés confondus. */
  get filled(): number {
    return this.slots.filter((v) => v !== null).length;
  }

  /**
   * Assez de matière pour la régression ?
   *
   * Trois tranches par côté au moins : c'est ce qui garantit à la fois le
   * nombre de vues et l'étalement d'angles qu'exige `fitDepthAndDistance`.
   */
  get complete(): boolean {
    const left = this.slots.slice(0, BANDS_PER_SIDE).filter((v) => v !== null).length;
    const right = this.slots.slice(BANDS_PER_SIDE).filter((v) => v !== null).length;
    return left >= 3 && right >= 3 && this.negativeImage !== null && this.positiveImage !== null;
  }

  /** Propose une frame. Sans effet si sa tranche est déjà pourvue. */
  offer(lm: readonly NormalizedLandmark[], yawRad: number, rollRad: number, w: number, h: number): void {
    const view: RotatedView = { lm, yawRad, rollRad, w, h };
    if (!isUsableProbeView(view)) return;

    const band = RotationProbe.bandOf(yawRad);
    if (band < 0) return;

    if (this.slots[band] === null) {
      this.slots[band] = view;

      // Une tranche neuve : c'est le bon moment pour relever la carte, puisque
      // ces vues sont justement celles qui sont bien étalées en angle.
      if (this.trackQuad !== null) {
        const buf = this.capture();
        if (buf !== null) {
          const q = this.trackQuad(buf);
          if (q !== null) this.quadsFound.push(q);
        }
      }
    }

    // Une seule image par côté, celle de l'angle le plus franc : le masque de
    // mouvement est d'autant plus net que la tête a bougé.
    const a = Math.abs(yawRad);
    if (yawRad < 0 && a > this.bestNegative) {
      const buf = this.capture();
      if (buf !== null) {
        this.negativeImage = buf;
        this.bestNegative = a;
      }
    } else if (yawRad >= 0 && a > this.bestPositive) {
      const buf = this.capture();
      if (buf !== null) {
        this.positiveImage = buf;
        this.bestPositive = a;
      }
    }
  }

  /** Toutes les vues retenues, prêtes pour `fitDepthAndDistance`. */
  views(): readonly RotatedView[] | null {
    const kept = this.slots.filter((v): v is RotatedView => v !== null);
    return kept.length > 0 ? kept : null;
  }

  /** Les cadres de carte relevés pendant le balayage. */
  quads(): readonly CardQuad[] {
    return this.quadsFound;
  }

  /** Les deux images, pour le masque de mouvement de la silhouette. */
  buffers(): ImageBuffer[] {
    return [this.negativeImage, this.positiveImage].filter((b): b is ImageBuffer => b !== null);
  }

  /** Fraction de la consigne accomplie, 0..1. Purement indicative. */
  ratio(): number {
    return this.filled / this.slots.length;
  }

  reset(): void {
    this.slots.fill(null);
    this.negativeImage = null;
    this.positiveImage = null;
    this.bestNegative = 0;
    this.bestPositive = 0;
    this.quadsFound.length = 0;
  }
}
