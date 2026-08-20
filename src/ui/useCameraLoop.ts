/**
 * ui/useCameraLoop.ts — webcam + boucle de détection (couches 1-4). Monté UNE fois.
 *
 * Reprise de fond (mission détection 2026-08-20) : la boucle elle-même vit dans
 * `tracking/faceLoop.ts` — acquisition, normalisation et validité des frames
 * (frameFeed), second avis FaceDetector (faceProbe), landmarks (landmarker),
 * décisions PROUVÉES (detectionPlan). Ici, il ne reste que ce qui est propre à
 * l'IHM : getUserMedia, le dimensionnement du canvas, le cycle de vie React.
 *
 * ⚠️ Les gestionnaires sont lus dans une `ref` à chaque frame : recréer la
 * boucle à chaque rendu React lui ferait perdre ses compteurs (§1 bug #3).
 */

import { useEffect, useRef, type RefObject } from 'react';
import { startFaceLoop, type FaceLoopControl, type LostCause } from '../tracking/faceLoop.js';
import type { NormalizedLandmark } from '../core/geom.js';

export interface CameraHandlers {
  onFrame(ctx: CanvasRenderingContext2D, lm: readonly NormalizedLandmark[], yawRad: number): void;
  /**
   * Pas de landmarks sur cette frame. `cause` sépare (§11) :
   *  - 'invalid-input' : problème d'ENTRÉE caméra (frame noire, 0×0…), nommé ;
   *  - 'no-face'       : frame valide, visage non trouvé — « recherche… ».
   * La pose (« mettez-vous de face ») n'est PAS un état de détection : elle
   * appartient aux gates de mesure.
   */
  onLost(ctx: CanvasRenderingContext2D, n: number, cause: LostCause, reason: string | null): void;
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
        held.current.onReady();
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
