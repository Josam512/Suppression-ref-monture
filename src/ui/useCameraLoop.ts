/**
 * ui/useCameraLoop.ts — webcam + boucle de détection. Monté UNE fois.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { startFaceLoop, type FaceLoopControl, type LostCause } from '../tracking/faceLoop.js';
import type { NormalizedLandmark } from '../core/geom.js';

export interface CameraHandlers {
  onFrame(ctx: CanvasRenderingContext2D, lm: readonly NormalizedLandmark[], yawRad: number): void;
  onLost(ctx: CanvasRenderingContext2D, n: number, cause: LostCause, reason: string | null): void;
  onProgress(ratio: number): void;
  /** Appelé quand caméra + modèle sont prêts, avec l'identité caméra réellement ouverte. */
  onReady(settings: MediaTrackSettings): void;
  onError(message: string): void;
}

export const CAMERA_INIT_TIMEOUT_MS = 15_000;

function describeInitError(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  return (
    `Le chargement de la caméra ou du modèle a échoué (réseau coupé, fichier ` +
    `manquant, ou caméra indisponible). Vérifiez votre connexion et réessayez.`
  );
}

export function useCameraLoop(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  handlers: CameraHandlers,
  attempt = 0,
): void {
  const held = useRef(handlers);
  held.current = handlers;

  useEffect(() => {
    let loop: FaceLoopControl | null = null;
    let stream: MediaStream | null = null;
    let disposed = false;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (video === null || canvas === null || disposed) return;

        video.srcObject = stream;
        await video.play();

        if (video.readyState < 2) {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(
              () => reject(new Error(`La caméra n'a pas fourni d'image en ${CAMERA_INIT_TIMEOUT_MS / 1000} s.`)),
              CAMERA_INIT_TIMEOUT_MS,
            );
            video.addEventListener(
              'loadedmetadata',
              () => {
                clearTimeout(t);
                resolve();
              },
              { once: true },
            );
          });
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('Contexte 2D indisponible.');

        const control = await startFaceLoop(video, {
          onLandmarks: (lm, yawRad) => held.current.onFrame(ctx, lm, yawRad),
          onLost: (n, cause, reason) => held.current.onLost(ctx, n, cause, reason),
          onTransition: (reason) => console.warn(`Détection — ${reason}`),
          onProgress: (r) => {
            if (!disposed) held.current.onProgress(r);
          },
          onError: (message) => {
            if (!disposed) held.current.onError(message);
          },
        });
        if (disposed) {
          control.stop();
          return;
        }
        loop = control;
        const track = stream.getVideoTracks()[0];
        held.current.onReady(track?.getSettings() ?? {});
      } catch (err) {
        if (!disposed) held.current.onError(describeInitError(err));
      }
    })();

    return () => {
      disposed = true;
      loop?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [videoRef, canvasRef, attempt]);
}
