/**
 * ui/useV1Calibration.ts — la calibration de la vente en ligne, de bout en bout.
 *
 * Arbitrage humain du 2026-08-17 : **la carte est obligatoire, une seule fois,
 * au début**. Elle est suivie d'une rotation de tête à gauche puis à droite,
 * qui rend mesurables deux grandeurs jusqu'ici supposées :
 *
 *  · la profondeur entre le plan de la carte (sur le front) et celui des
 *    tempes — le biais B4, qui vaut 3 à 7 % et qu'aucune répétition de mesure
 *    ne détecte, puisque toutes les répétitions le partagent ;
 *  · l'écart temporal lui-même, lu à la frontière tête/fond, confirmée par le
 *    mouvement.
 *
 * ⚠️ La rotation reste FACULTATIVE. On peut la passer : la calibration retombe
 * alors exactement sur celle du §4, annoncée avec sa marge réelle. Bloquer un
 * client qui n'y arrive pas serait lui interdire de voir l'image, ce que le
 * §0.0.2 refuse.
 */

import { useCallback, type MutableRefObject, type RefObject } from 'react';

import { calibrateWithCardMeasured, type UserCalibration } from '../core/calibration.js';
import { refineQuad } from '../core/cardEdges.js';
import type { CardQuad } from '../core/cardPose.js';
import { cameraFromSweep, measureDistance } from '../core/cardSweep.js';
import { CalibrationError } from '../core/geom.js';
import { motionMask, type ImageBuffer } from '../core/silhouette.js';
import type { Live } from './liveState.js';
import { RotationProbe } from './rotationProbe.js';

export interface V1CalibrationDeps {
  live: MutableRefObject<Live>;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Appelé une fois la calibration obtenue, avec les notes à afficher. */
  onCalibrated(cal: UserCalibration, notes: string[]): void;
  /** Appelé si rien d'exploitable n'est sorti : on renvoie le client à la carte. */
  onFailed(message: string): void;
  /** Passe à l'étape de rotation, avec sa jauge à zéro. */
  onRotationStart(): void;
}

/** Tolérance d'accrochage pendant le balayage : la tête bouge entre deux images. */
const TRACKING_TOLERANCE_PX = 25;

export interface V1Calibration {
  onCardValidated(cardWidthPx: number, quad: CardQuad, frozen: HTMLCanvasElement): void;
  /** Assemble la calibration avec ce qui a été collecté — rotation ou non. */
  finish(): void;
}

export function useV1Calibration(deps: V1CalibrationDeps): V1Calibration {
  const { live, videoRef } = deps;

  /** Image courante, en pixels bruts. Null tant que la vidéo n'a rien à donner. */
  const grab = useCallback((): ImageBuffer | null => {
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0) return null;
    const off = document.createElement('canvas');
    off.width = video.videoWidth;
    off.height = video.videoHeight;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return null;
    ctx.drawImage(video, 0, 0);
    return ctx.getImageData(0, 0, off.width, off.height);
  }, [videoRef]);

  const finish = useCallback((): void => {
    const card = live.current.pendingCard;
    const probe = live.current.probe;
    if (card === null) return;

    const views = probe?.views() ?? null;

    // ⭐ La carte a été suivie pendant tout le balayage : ses cadres donnent la
    // FOCALE, donc la distance réelle. Sans eux, la chaîne retombe sur la
    // fenêtre de travail supposée — ce qui, sur le premier sujet réel, s'est
    // révélé faux de 46 % (78 cm supposés pour 42 mesurés).
    //
    // ⚠️ Aucune étape n'est bloquante : un échec ici n'est pas une panne, c'est
    // une marge plus large. Le client doit pouvoir essayer des lunettes.
    let measured: { cardDistanceMm: number; relError: number } | null = null;
    const quads = card.quad === null ? [] : [card.quad, ...(probe?.quads() ?? [])];
    if (quads.length > 0 && card.quad !== null) {
      try {
        const sweep = cameraFromSweep(quads, card.w, card.h);
        const d = measureDistance(card.quad, sweep, card.w, card.h);
        measured = { cardDistanceMm: d.cardDistanceMm, relError: d.relError };
      } catch {
        // Carte perdue de vue, ou focale trop dispersée pour valoir mieux que
        // l'a priori. `cardSweep` refuse lui-même dans ce cas : on le suit.
      }
    }

    // ⚠️ Sans rotation, PAS de mesure de silhouette. Le masque de mouvement est
    // la seule chose qui distingue un bord de tête d'un montant de porte : sans
    // lui, on produirait un écart temporal d'allure normale et parfois faux —
    // exactement le mode d'échec que ce projet combat.
    const scene =
      views !== null && probe !== null
        ? {
            frontal: card.frontal,
            motion: motionMask(card.frontal, probe.buffers()),
            lm: card.lm,
            w: card.w,
            h: card.h,
          }
        : null;

    try {
      const { cal, refinement } = calibrateWithCardMeasured(
        card.cardWidthPx,
        card.w,
        card.lm,
        card.w,
        card.h,
        views,
        scene,
        measured,
      );
      live.current.pendingCard = null;
      live.current.probe = null;
      deps.onCalibrated(cal, ['Merci, vous pouvez ranger votre carte.', ...refinement.notes]);
    } catch (err) {
      live.current.pendingCard = null;
      live.current.probe = null;
      deps.onFailed(err instanceof Error ? err.message : String(err));
    }
  }, [live, deps]);

  const onCardValidated = useCallback(
    (cardWidthPx: number, quad: CardQuad, frozen: HTMLCanvasElement): void => {
      const lm = live.current.lastLandmarks;
      const frontal = frozen
        .getContext('2d', { willReadFrequently: true })
        ?.getImageData(0, 0, frozen.width, frozen.height);

      if (lm === null || frontal === undefined) {
        deps.onFailed(new CalibrationError('Visage perdu pendant la calibration.').message);
        return;
      }

      // Le cadre du client n'est qu'une graine : on l'accroche sur les vrais
      // bords. S'il ne s'accroche pas, on ne garde rien — mieux vaut pas de
      // distance mesurée qu'une distance mesurée sur autre chose que la carte.
      let refined: CardQuad | null = null;
      try {
        refined = refineQuad(frontal, quad, TRACKING_TOLERANCE_PX);
      } catch {
        refined = null;
      }

      // Le suivi pendant la rotation repart du cadre précédent, de proche en
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
      deps.onRotationStart();
    },
    [live, grab, deps],
  );

  return { onCardValidated, finish };
}
