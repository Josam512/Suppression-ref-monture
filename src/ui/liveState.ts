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
import type { CameraProfile } from '../core/cameraProfile.js';
import type { FrameSpec } from '../core/frameSpec.js';
import type { CardQuad } from '../core/cardPose.js';
import type { NormalizedLandmark } from '../core/geom.js';
import type { ImageBuffer } from '../core/silhouette.js';
import type { SizeVerdict } from '../core/verdict.js';
import type { FrontSprite } from '../render/composite.js';
import type { FaceLoopStats } from '../tracking/faceLoop.js';
import { PoseFilter } from './poseFilter.js';
import type { RotationProbe } from './rotationProbe.js';
import type { SpritesState } from './useSprites.js';

export type { SpritesState } from './useSprites.js';

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

/** Saut d'échelle aperçu → calibré, mesuré à la transition (complément 6). */
export interface ScaleJump {
  provisionalPxPerMm: number;
  finalPxPerMm: number;
  ratio: number;
  atMs: number;
}

export interface Live {
  cal: UserCalibration | null;
  spec: FrameSpec | null;
  sprites: SpritesState;
  overlayPaddingMm: number;
  /** Profil d'objectif courant — la MÊME optique pour l'aperçu et le final (c5). */
  cameraProfile: CameraProfile | null;
  lastLandmarks: readonly NormalizedLandmark[] | null;
  /** Yaw de la dernière frame détectée — pour le maintien de rendu (par durée). */
  lastYawRad: number;
  /** Horodatage de la dernière frame avec landmarks — le hold est en ms (pt 49). */
  lastLandmarksAtMs: number;
  /** Repère de la dernière frame : `padded-remapped` → Z inexploitable (c9). */
  coordinateSpace: 'direct' | 'padded-remapped';

  /** ⭐ Audit 2026-08-21 point 4 : la monture est posée, mais l'échelle n'a
   *  PAS convergé — aucun millimètre n'est affirmé. Annoncé en clair. */
  provisional: boolean;
  /**
   * ⭐ Ré-audit A6 — AUCUNE échelle de pose n'a encore été vue (iris refusés
   * depuis le début, par exemple lunettes portées) : depuis quand, et pourquoi.
   * L'état est affiché et borné — jamais un canvas muet, jamais une valeur
   * métrologique fabriquée. Remis à null dès la première échelle.
   */
  firstScaleWaitSinceMs: number | null;
  firstScaleRefusal: string | null;
  /** ⚖️ 2026-08-23 — l'échelle VISUELLE de secours est active : la cause du
   *  refus d'iris qu'elle pallie (null = échelle iris ou calibrée). */
  visualFallbackReason: string | null;
  /** 🔴 Ré-audit 2026-08-23 — référence de l'échelle visuelle, FIGÉE à la
   *  première monture affichée de la session. Jamais la monture en cours :
   *  à travers une référence unique, une 150 mm reste 25 % plus large qu'une
   *  120 mm — sans elle, toutes « couvriraient » le visage (interdit). */
  visualRefWidthMm: number | null;
  /** Filtre One-Euro de la POSE (rendu seul, jamais la métrologie — c32). */
  poseFilter: PoseFilter;
  /** Dernière échelle d'aperçu vue — pour instrumenter la transition (c6). */
  lastProvisionalPxPerMm: number | null;
  scaleJump: ScaleJump | null;
  /** 🔴 Terrain 2026-08-26 — la POSE PEINTE est observable : ancre brute de la
   *  frame, ancre filtrée réellement dessinée, instant vidéo correspondant.
   *  C'est ce qui permet au banc « visage mobile » (S20) d'opposer le sprite
   *  peint à la position VRAIE du visage — et au HUD de tracer les écarts. */
  anchorRawPx: { x: number; y: number } | null;
  anchorFilteredPx: { x: number; y: number } | null;
  lastVideoTimeS: number;
  /** Compteurs de rendu — HUD : « le rendu est observable » (point 73). */
  renderedFrames: number;
  skippedRenderFrames: number;
  lastRenderedAtMs: number;

  verdict: SizeVerdict | null;
  /** Non nul pendant la collecte des deux vues tournées (§4, parade B4 n°2). */
  probe: RotationProbe | null;
  lastProbeRatio: number;
  /** Non nul pendant le contrôle de cohérence par l'iris. */
  irisSamples: number[] | null;
  /** La carte validée, en attente de la rotation. */
  pendingCard: PendingCard | null;

  /**
   * ⭐ V2 sans carte — le moteur de calibration automatique, non nul PENDANT la
   * collecte seulement. La caméra tourne toujours, la collecte a un début et
   * une fin.
   */
  auto: AutoCalibrationEngine | null;
  /** Dernier état publié à React — la boucle ne publie que sur changement. */
  lastAutoKey: string;
  /** Dernier compte de vues de carte publié — même règle (bug A1 de l'audit). */
  lastReportedCardViews: number;

  /** Compteurs de la boucle de détection — HUD seulement, aucune décision. */
  loopStats: (() => Readonly<FaceLoopStats>) | null;

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

export function createLive(
  sprites: SpritesState,
  spec: FrameSpec | null,
  cal: UserCalibration | null,
  overlayPaddingMm: number,
): Live {
  return {
    cal,
    spec,
    sprites,
    overlayPaddingMm,
    cameraProfile: null,
    lastLandmarks: null,
    lastYawRad: 0,
    lastLandmarksAtMs: 0,
    coordinateSpace: 'direct',
    provisional: false,
    firstScaleWaitSinceMs: null,
    firstScaleRefusal: null,
    visualFallbackReason: null,
    visualRefWidthMm: null,
    anchorRawPx: null,
    anchorFilteredPx: null,
    lastVideoTimeS: 0,
    poseFilter: new PoseFilter(),
    lastProvisionalPxPerMm: null,
    scaleJump: null,
    renderedFrames: 0,
    skippedRenderFrames: 0,
    lastRenderedAtMs: 0,
    verdict: null,
    probe: null,
    lastProbeRatio: -1,
    irisSamples: null,
    pendingCard: null,
    auto: null,
    lastAutoKey: '',
    lastReportedCardViews: -1,
    loopStats: null,
    wornSprite: null,
    recolorReason: null,
  };
}
