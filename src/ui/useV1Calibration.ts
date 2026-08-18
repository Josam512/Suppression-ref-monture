/**
 * ui/useV1Calibration.ts — la calibration de la vente en ligne, de bout en bout.
 *
 * ## Le déroulé, décidé par le CLIENT (arbitrage humain du 2026-08-18)
 *
 * > « fais juste une vidéo où j'ai la main pour me montrer de face et de profil,
 * > et que JE décide moi quand la vidéo est finie, après tu prends tes 3 secondes
 * > pour te faire ta règle de 3 »
 *
 *   1. Il tient sa carte contre son visage et appuie quand il est prêt.
 *   2. Il pose deux repères sur les bords de la carte, sur une image FIGÉE, à son
 *      rythme. Aucun chronomètre, aucune cible mouvante à poursuivre.
 *   3. Il filme : de face, de profil à gauche, de profil à droite, dans l'ordre
 *      qu'il veut, aussi longtemps qu'il veut. **Il garde la carte en main.**
 *   4. Il appuie sur « J'ai fini ». Le calcul se fait alors, une fois.
 *
 * 🔴 **Rien d'automatique ne décide à sa place** — ni verrouillage, ni délai, ni
 * seuil de complétude. Le seul événement qui termine la séance est son doigt.
 *
 * ## Ce que la séance donne, et ce qu'elle ne bloque jamais
 *
 *   · la focale de son objectif, donc sa DISTANCE réelle (`core/cardSweep.ts`) ;
 *   · la profondeur carte ↔ tempes, donc le biais B4 mesuré au lieu de supposé ;
 *   · son écart temporal, lu à la frontière tête/fond confirmée par le mouvement.
 *
 * ⚠️ Aucune des trois n'est obligatoire. Chaque échec élargit la marge annoncée
 * et laisse une note ; **aucun ne renvoie le client à la case départ** — c'est
 * `core/cardAssembly.ts` qui en porte la garantie, et elle est testée.
 */

import { useCallback, useRef, type MutableRefObject, type RefObject } from 'react';

import { assembleCardCalibration } from '../core/cardAssembly.js';
import type { UserCalibration } from '../core/calibration.js';
import { refineQuad } from '../core/cardEdges.js';
import type { CardQuad } from '../core/cardPose.js';
import type { CameraProfile } from '../core/cameraProfile.js';
import { CalibrationError } from '../core/geom.js';
import type { NormalizedLandmark } from '../core/geom.js';
import { motionMask, type ImageBuffer } from '../core/silhouette.js';
import type { Live } from './liveState.js';
import { RotationProbe } from './rotationProbe.js';

export interface V1CalibrationDeps {
  live: MutableRefObject<Live>;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Appelé une fois la calibration obtenue, avec les notes à afficher. */
  onCalibrated(cal: UserCalibration, notes: string[]): void;
  /** Appelé si les repères n'étaient pas sur la carte — le seul cas réparable. */
  onFailed(message: string): void;
  /** Passe à l'étape filmée, compteurs à zéro. */
  onSweepStart(): void;
  /**
   * ⭐ Profil d'objectif déjà mesuré lors d'une séance précédente, ou `null`.
   * La focale est une propriété de l'APPAREIL : mesurée une fois, elle sert
   * pour toutes les vues suivantes (`core/cameraProfile.ts`).
   */
  cameraProfile: CameraProfile | null;
  /** Appelé quand le balayage a produit un profil meilleur ou nouveau. */
  onCameraProfile(profile: CameraProfile): void;
}

/** Tolérance d'accrochage pendant la séance : la tête bouge entre deux images. */
const TRACKING_TOLERANCE_PX = 25;

export interface V1Calibration {
  /**
   * @param lm repères relevés À L'INSTANT DU GEL, jamais ceux de la boucle live.
   *        La carte et le visage doivent être mesurés sur les MÊMES pixels :
   *        c'est leur rapport qui est la mesure.
   */
  onCardValidated(
    cardWidthPx: number,
    quad: CardQuad,
    frozen: HTMLCanvasElement,
    lm: readonly NormalizedLandmark[],
  ): void;
  /** Assemble avec ce que la séance a donné. Appelée UNIQUEMENT par le client. */
  finish(): void;
}

export function useV1Calibration(deps: V1CalibrationDeps): V1Calibration {
  const { live, videoRef } = deps;

  /**
   * Canvas de lecture, réutilisé d'une image à l'autre.
   *
   * ⚠️ En créer un par image — ce que faisait la version précédente — laisse au
   * ramasse-miettes un canvas de 1280×720 à chaque frame, pendant que la
   * détection tourne. C'est le genre de coût qui ne se voit pas sur un portable
   * de développement et qui fait saccader un téléphone.
   */
  const off = useRef<HTMLCanvasElement | null>(null);

  /** Image courante, en pixels bruts. Null tant que la vidéo n'a rien à donner. */
  const grab = useCallback((): ImageBuffer | null => {
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0) return null;

    off.current ??= document.createElement('canvas');
    const canvas = off.current;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return null;
    ctx.drawImage(video, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, [videoRef]);

  const finish = useCallback((): void => {
    const card = live.current.pendingCard;
    const probe = live.current.probe;
    if (card === null) return;

    // ⚠️ Sans rotation, PAS de mesure de silhouette. Le masque de mouvement est
    // la seule chose qui distingue un bord de tête d'un montant de porte : sans
    // lui, on produirait un écart temporal d'allure normale et parfois faux —
    // exactement le mode d'échec que ce projet combat.
    const buffers = probe?.buffers() ?? [];
    const scene =
      probe !== null && buffers.length > 0
        ? {
            frontal: card.frontal,
            motion: motionMask(card.frontal, buffers),
            lm: card.lm,
            w: card.w,
            h: card.h,
          }
        : null;

    live.current.pendingCard = null;
    live.current.probe = null;

    try {
      const out = assembleCardCalibration(
        {
          cardWidthPx: card.cardWidthPx,
          quad: card.quad,
          lm: card.lm,
          w: card.w,
          h: card.h,
        },
        {
          quads: card.quad === null ? [] : [card.quad, ...(probe?.quads() ?? [])],
          views: probe?.views() ?? null,
          scene,
        },
        deps.cameraProfile,
        Date.now(),
      );

      // ⭐ La focale ne part pas à la poubelle : elle appartient à l'objectif du
      // client, pas à cette séance. La séance suivante n'aura plus à la mesurer.
      if (out.profile !== null) deps.onCameraProfile(out.profile);

      deps.onCalibrated(out.cal, ['Merci, vous pouvez ranger votre carte.', ...out.notes]);
    } catch (err) {
      // Seul cas restant : la largeur obtenue est hors plage anatomique, donc
      // les repères n'étaient pas sur la carte. C'est le seul échec que
      // recommencer répare réellement.
      deps.onFailed(err instanceof Error ? err.message : String(err));
    }
  }, [live, deps]);

  const onCardValidated = useCallback(
    (
      cardWidthPx: number,
      quad: CardQuad,
      frozen: HTMLCanvasElement,
      lm: readonly NormalizedLandmark[],
    ): void => {
      const frontal = frozen
        .getContext('2d', { willReadFrequently: true })
        ?.getImageData(0, 0, frozen.width, frozen.height);

      if (frontal === undefined) {
        deps.onFailed(new CalibrationError('Image perdue pendant la mesure.').message);
        return;
      }

      // Les deux repères du client ne sont qu'une graine : on les accroche sur
      // les vrais bords. S'ils ne s'accrochent pas, on ne garde rien — mieux
      // vaut pas de distance mesurée qu'une distance mesurée sur autre chose.
      let refined: CardQuad | null = null;
      try {
        refined = refineQuad(frontal, quad, TRACKING_TOLERANCE_PX);
      } catch {
        refined = null;
      }

      // Le suivi pendant la séance repart du cadre précédent, de proche en
      // proche. Seuls les quatre coins sont conservés, jamais les images.
      let seed = refined;
      const track = (buf: ImageBuffer): CardQuad | null => {
        if (seed === null) return null;
        try {
          seed = refineQuad(buf, seed, TRACKING_TOLERANCE_PX);
          return seed;
        } catch {
          return null; // carte perdue sur cette image : on garde la graine
        }
      };

      live.current.pendingCard = {
        cardWidthPx,
        quad: refined,
        lm,
        frontal,
        w: frozen.width,
        h: frozen.height,
      };
      live.current.probe = new RotationProbe(grab, refined === null ? null : track);
      live.current.lastProbeRatio = -1;
      deps.onSweepStart();
    },
    [live, grab, deps],
  );

  return { onCardValidated, finish };
}
