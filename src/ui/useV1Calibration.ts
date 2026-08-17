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

export interface V1Calibration {
  onCardValidated(cardWidthPx: number, frozen: HTMLCanvasElement): void;
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
    (cardWidthPx: number, frozen: HTMLCanvasElement): void => {
      const lm = live.current.lastLandmarks;
      const frontal = frozen
        .getContext('2d', { willReadFrequently: true })
        ?.getImageData(0, 0, frozen.width, frozen.height);

      if (lm === null || frontal === undefined) {
        deps.onFailed(new CalibrationError('Visage perdu pendant la calibration.').message);
        return;
      }

      live.current.pendingCard = { cardWidthPx, lm, frontal, w: frozen.width, h: frozen.height };
      live.current.probe = new RotationProbe(grab);
      live.current.lastProbeRatio = -1;
      deps.onRotationStart();
    },
    [live, grab, deps],
  );

  return { onCardValidated, finish };
}
