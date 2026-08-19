/**
 * ui/liveState.ts — l'état mutable que la boucle de rendu lit à chaque frame.
 *
 * ⚠️ Volontairement HORS de React. La boucle se monte une seule fois (garde S5,
 * §1 bug #3) : elle ne peut donc pas lire un état qui change d'identité à chaque
 * rendu. Elle lit cette structure, que le composant met à jour en place.
 *
 * Rien ici n'est une mesure. Ce sont des tampons de travail.
 */

import type { AutoCalibrationEngine } from '../core/autoCalibration.js';
import type { UserCalibration } from '../core/calibration.js';
import type { FrameSpec } from '../core/frameSpec.js';
import type { CardQuad } from '../core/cardPose.js';
import type { NormalizedLandmark } from '../core/geom.js';
import type { ImageBuffer } from '../core/silhouette.js';
import type { SizeVerdict } from '../core/verdict.js';
import type { FrontSprite } from '../render/composite.js';
import type { RotationProbe } from './rotationProbe.js';
import type { useSprites } from './useSprites.js';

export type SpritesState = ReturnType<typeof useSprites>;

/** Ce que la carte a laissé derrière elle, en attendant la rotation. */
export interface PendingCard {
  cardWidthPx: number;
  /**
   * Les quatre coins accrochés sur les vrais bords, ou null si l'accrochage a
   * échoué. Leur présence — et non un mode — décide si la distance sera
   * MESURÉE ou supposée (§11.4, §14.5).
   */
  quad: CardQuad | null;
  lm: readonly NormalizedLandmark[];
  frontal: ImageBuffer;
  w: number;
  h: number;
}

export interface Live {
  cal: UserCalibration | null;
  spec: FrameSpec | null;
  sprites: SpritesState;
  overlayPaddingMm: number;
  lastLandmarks: readonly NormalizedLandmark[] | null;
  verdict: SizeVerdict | null;
  /** Non nul pendant la collecte des deux vues tournées (§4, parade B4 n°2). */
  probe: RotationProbe | null;
  lastProbeRatio: number;
  /** Dernière jauge de cadrage carte publiée à React — évite un rendu par image. */
  /** Non nul pendant le contrôle de cohérence par l'iris. */
  irisSamples: number[] | null;
  /** La carte validée, en attente de la rotation. */
  pendingCard: PendingCard | null;

  /**
   * ⭐ V2 sans carte — le moteur de calibration automatique, non nul PENDANT la
   * collecte seulement. `calibrationCollecting` du §6 de la mission, incarné :
   * la caméra tourne toujours, la collecte a un début et une fin.
   */
  auto: AutoCalibrationEngine | null;
  /** Dernier état publié à React — la boucle ne publie que sur changement. */
  lastAutoKey: string;
  /** Dernier compte de vues de carte publié — même règle (bug A1 de l'audit). */
  lastReportedCardViews: number;

  /**
   * Sprite du modèle PHYSIQUEMENT PORTÉ, quand on le connaît (V2).
   *
   * ⚠️ Sa présence — et non un test de mode — décide du recoloriage 2,5 D
   * (§11.4). En vente en ligne il vaut null, et le rendu reste le sprite posé.
   */
  wornSprite: FrontSprite | null;
  /** Pourquoi le recoloriage a été refusé, le cas échéant. Affiché tel quel. */
  recolorReason: string | null;
}

export function createLive(sprites: SpritesState, spec: FrameSpec | null, cal: UserCalibration | null, overlayPaddingMm: number): Live {
  return {
    cal,
    spec,
    sprites,
    overlayPaddingMm,
    lastLandmarks: null,
    verdict: null,
    probe: null,
    lastProbeRatio: -1,
    irisSamples: null,
    pendingCard: null,
    auto: null,
    lastAutoKey: '',
    lastReportedCardViews: -1,
    wornSprite: null,
    recolorReason: null,
  };
}
