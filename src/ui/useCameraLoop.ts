/**
 * ui/useCameraLoop.ts — webcam, modèle, boucle de rendu. Montés UNE fois.
 *
 * Extrait de `TryOn.tsx` pour tenir la règle des 300 lignes (§3), mais aussi
 * parce que c'est la partie du code où une régression coûte le plus cher :
 * elle porte la garde de monotonie S5 et le chemin d'échec qui DOIT dessiner
 * (§1 bug #3). Isolée, elle se relit d'un seul tenant.
 *
 * ⚠️ Les gestionnaires sont lus dans une `ref` à chaque frame. Recréer la
 * boucle à chaque rendu React lui ferait perdre son compteur d'échecs et son
 * timestamp monotone — c'est-à-dire les deux choses qui empêchent le bug #3 de
 * revenir.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { createLandmarker, startLoop } from '../tracking/landmarker.js';
import type { NormalizedLandmark } from '../core/geom.js';

export interface CameraHandlers {
  onFrame(ctx: CanvasRenderingContext2D, lm: readonly NormalizedLandmark[], yawRad: number): void;
  onLost(ctx: CanvasRenderingContext2D, consecutiveFailures: number): void;
  onProgress(ratio: number): void;
  /** Appelé une fois, quand la caméra et le modèle sont prêts. */
  onReady(): void;
  onError(message: string): void;
}

/** Au-delà, l'init est déclarée en échec au lieu de rester `loading` à vie (audit A3). */
export const CAMERA_INIT_TIMEOUT_MS = 15_000;

/**
 * Un échec d'init peut remonter un `Event` (chargement WASM, piste vidéo) dont
 * `String(err)` donne « [object Event] » — le message vide de sens que l'audit a
 * reproduit sur un clone frais. On nomme la cause probable à la place.
 */
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
  /** Incrémenté par le bouton « Réessayer » : tout se remonte proprement. */
  attempt = 0,
): void {
  const held = useRef(handlers);
  held.current = handlers;

  useEffect(() => {
    let stopLoop: (() => void) | null = null;
    let stream: MediaStream | null = null;
    let close: (() => void) | null = null;
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

        // Dimensionner le canvas PUIS seulement démarrer la boucle (§2).
        // ⚠️ Avec délai : une promesse qui n'arrive jamais laissait la page en
        // `loading` pour toujours, sans raison affichée (audit A3).
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

        const landmarker = await createLandmarker((ratio) => {
          if (!disposed) held.current.onProgress(ratio);
        });
        // Le modèle tient des ressources WASM/GPU : il se ferme TOUJOURS au
        // démontage (audit A2 — fuite à chaque entrée/sortie d'essayage).
        close = () => landmarker.close();
        if (disposed) {
          close();
          return;
        }

        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('Contexte 2D indisponible.');

        held.current.onReady();

        const control = startLoop(landmarker, video, {
          onFrame: (lm, yawRad) => held.current.onFrame(ctx, lm, yawRad),
          onLost: (n) => held.current.onLost(ctx, n),
        });
        stopLoop = () => control.stop();
      } catch (err) {
        if (!disposed) held.current.onError(describeInitError(err));
      }
    })();

    return () => {
      disposed = true;
      stopLoop?.();
      close?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [videoRef, canvasRef, attempt]);
}
