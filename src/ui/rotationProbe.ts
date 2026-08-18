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
 *
 * ## 🔴 La carte reste en main PENDANT toute la séance
 *
 * Elle ne sert pas qu'à l'image de face : chaque image où elle est retrouvée
 * donne une estimation de la focale, et la focale ne sort que de leur médiane.
 * Le chiffre est sans appel (`core/cardSweep.ts`) : une vue donne ±20 à 25 %,
 * cinquante vues donnent ±4 %.
 *
 * ⚠️ **Ce qui était faux jusqu'ici.** La carte n'était relevée qu'au moment où
 * une tranche d'angle NEUVE se remplissait, soit huit fois au grand maximum —
 * exactement le plancher `MIN_SWEEP_VIEWS`, qu'une seule vue refusée par le
 * solveur suffisait à faire passer sous la barre. Pire, l'écran de rotation
 * disait « vous pouvez ranger votre carte » : la focale mesurée ne pouvait
 * donc à peu près jamais aboutir, et la chaîne retombait en silence sur la
 * distance supposée — celle qui s'est révélée fausse de 46 % sur le premier
 * sujet réel. Le relevé se fait désormais à CHAQUE image proposée.
 */

import { isUsableProbeView, MAX_PROBE_YAW_RAD, MIN_PROBE_YAW_RAD, type RotatedView } from '../core/parallax.js';
import type { ImageBuffer } from '../core/silhouette.js';
import type { NormalizedLandmark } from '../core/geom.js';
import type { CardQuad } from '../core/cardPose.js';

/** Nombre de tranches d'angle PAR CÔTÉ. */
export const BANDS_PER_SIDE = 4;

/**
 * Plafond du nombre de cadres de carte conservés.
 *
 * ⚠️ Ce n'est PAS un critère d'arrêt de la séance : le client filme aussi
 * longtemps qu'il veut (§0.0.2), et rien ne l'interrompt. C'est une borne
 * mémoire — quatre coins par vue, soit quelques dizaines de kilo-octets au
 * total. Au-delà, la médiane ne gagne plus rien : son incertitude décroît en
 * 1/√n, donc passer de 400 à 800 vues ne fait que 30 % de mieux.
 */
export const MAX_SWEEP_QUADS = 400;

/** Ce que la recherche de carte rend sur une image. */
export type CardFinder = (
  buf: ImageBuffer,
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
) => { quad: CardQuad; widthRatio: number } | null;

/** La vue la plus frontale, conservée en entier pour porter la mesure. */
export interface FrontalSighting {
  lm: readonly NormalizedLandmark[];
  buf: ImageBuffer;
  quad: CardQuad;
  w: number;
  h: number;
}

/** Copie profonde d'un tampon d'image — celui de lecture est réutilisé. */
function copyBuffer(b: ImageBuffer): ImageBuffer {
  return { data: new Uint8ClampedArray(b.data), width: b.width, height: b.height };
}

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

  /** Les largeurs relevées, en fraction de largeur de visage. */
  private readonly ratios: number[] = [];

  /**
   * La vue la plus FRONTALE de toute la séance, avec son image et ses repères.
   *
   * 🔴 C'est elle qui portera la mesure : la largeur du visage s'y lit sans
   * raccourci de perspective, et la carte y est le moins inclinée. On la garde
   * en entier — image comprise — parce que l'écart temporal se mesure dessus.
   */
  private frontalView: FrontalSighting | null = null;
  private frontalYaw = Infinity;

  /**
   * @param capture rend l'image courante, ou null si elle n'est pas lisible.
   * @param findCardIn cherche la carte sur cette image. Facultatif : sans lui,
   *        le balayage ne sert qu'à la profondeur, et la distance reste supposée.
   */
  constructor(
    private readonly capture: () => ImageBuffer | null,
    private readonly findCardIn: CardFinder | null = null,
  ) {
    this.slots = Array.from({ length: 2 * BANDS_PER_SIDE }, () => null);
  }

  /**
   * Relève la carte sur l'image fournie et empile son cadre.
   *
   * ⚠️ Le suivi est de proche en proche : `trackQuad` repart du cadre précédent.
   * Une image où la carte est perdue ne casse donc rien — elle ne fournit
   * simplement pas de vue, et la graine reste celle de la dernière réussite.
   */
  private harvestCard(
    buf: ImageBuffer,
    lm: readonly NormalizedLandmark[],
    yawRad: number,
    w: number,
    h: number,
  ): void {
    if (this.findCardIn === null) return;
    const found = this.findCardIn(buf, lm, w, h);
    if (found === null) return;

    if (this.quadsFound.length < MAX_SWEEP_QUADS) {
      this.quadsFound.push(found.quad);
      this.ratios.push(found.widthRatio);
    }

    // La vue la plus frontale, gardée en entier : c'est sur elle que la mesure
    // se fera, et l'image lui est indispensable (silhouette, écart temporal).
    const a = Math.abs(yawRad);
    if (a < this.frontalYaw) {
      this.frontalYaw = a;
      this.frontalView = { lm, buf: copyBuffer(buf), quad: found.quad, w, h };
    }
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
    // ⚠️ UNE seule lecture de pixels par image, partagée par les deux usages.
    // `getImageData` sur 1280×720 coûte 3,7 Mo : l'appeler deux fois par image
    // ferait tomber la cadence de détection au moment précis où le client bouge.
    const buf = this.capture();

    // ⭐ La carte se relève sur TOUTE image, y compris de face et y compris
    // après que toutes les tranches sont pourvues : c'est le nombre de vues qui
    // fait la précision de la focale, et le client filme aussi longtemps qu'il
    // le veut. Sans cadre de départ (pointage non accroché), on ne tente rien.
    if (buf !== null) this.harvestCard(buf, lm, yawRad, w, h);

    const view: RotatedView = { lm, yawRad, rollRad, w, h };
    if (!isUsableProbeView(view)) return;

    const band = RotationProbe.bandOf(yawRad);
    if (band < 0) return;

    if (this.slots[band] === null) this.slots[band] = view;

    // Une seule image par côté, celle de l'angle le plus franc : le masque de
    // mouvement est d'autant plus net que la tête a bougé.
    //
    // ⚠️ Cette image-là est CONSERVÉE : il lui faut sa propre copie, puisque le
    // tampon de lecture, lui, est réutilisé d'une image à l'autre.
    if (buf === null) return;
    const a = Math.abs(yawRad);
    if (yawRad < 0 && a > this.bestNegative) {
      this.negativeImage = copyBuffer(buf);
      this.bestNegative = a;
    } else if (yawRad >= 0 && a > this.bestPositive) {
      this.positiveImage = copyBuffer(buf);
      this.bestPositive = a;
    }
  }

  /** Toutes les vues retenues, prêtes pour `fitDepthAndDistance`. */
  views(): readonly RotatedView[] | null {
    const kept = this.slots.filter((v): v is RotatedView => v !== null);
    return kept.length > 0 ? kept : null;
  }

  /** Les cadres de carte relevés pendant la séance. */
  quads(): readonly CardQuad[] {
    return this.quadsFound;
  }

  /** Les largeurs relevées, en fraction de largeur de visage. */
  widthRatios(): readonly number[] {
    return this.ratios;
  }

  /** La vue la plus frontale, ou `null` si la carte n'a jamais été vue. */
  frontal(): FrontalSighting | null {
    return this.frontalView;
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
    this.ratios.length = 0;
    this.frontalView = null;
    this.frontalYaw = Infinity;
  }
}
