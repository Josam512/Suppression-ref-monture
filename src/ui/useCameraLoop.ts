/**
 * ui/useCameraLoop.ts — webcam + boucle de détection (couches 1-4). Monté UNE fois.
 *
 * Durci par le guide de fiabilisation (2026-08-21) :
 *
 *   - le délai d'initialisation couvre TOUTE la chaîne caméra — getUserMedia,
 *     `play()`, l'arrivée de vraies dimensions — CHAQUE étape courant contre la
 *     MÊME échéance via `withDeadline` (complément 25, ré-audit A4 : un budget
 *     calculé mais appliqué à la seule attente de dimensions ne protégeait
 *     rien). L'init du MODÈLE a son propre délai, dans `tracking/faceLoop.ts`,
 *     et `onReady` n'est déclaré qu'avec un modèle RÉELLEMENT vivant (A3) ;
 *   - la vidéo est attendue par CONDITION (`videoWidth > 0 && readyState ≥ 2`),
 *     jamais par un événement qui a pu être émis avant qu'on l'écoute : à
 *     `readyState === 1`, `loadedmetadata` est déjà passé et ne reviendra pas —
 *     l'ancienne attente bloquait 15 s pour rien (point 65) ;
 *   - un `getUserMedia` qui résout APRÈS le démontage stoppe ses pistes au lieu
 *     de laisser un stream fantôme tenir la caméra allumée (point 66) — c'est
 *     aussi ce qui rend le montage StrictMode (mount→unmount→mount) propre ;
 *   - le modèle MediaPipe est PRÉCHARGÉ en parallèle de la caméra (point 7) ;
 *   - deux canaux de sortie : `onWarning` (récupérable — la séance continue) et
 *     `onError` (fatal — plus aucune stratégie ne peut continuer) (point 10).
 */

import { useEffect, useRef, type RefObject } from 'react';
import { startFaceLoop, type FaceLoopControl, type FaceLoopStats, type LostCause } from '../tracking/faceLoop.js';
import type { CoordinateSpace } from '../tracking/detectionPlan.js';
import { preloadLandmarkerAssets } from '../tracking/landmarker.js';
import type { CameraIdentity } from '../core/cameraProfile.js';
import type { NormalizedLandmark } from '../core/geom.js';
import { withDeadline } from './deadline.js';
import { loadNegotiatedStrategy, saveNegotiatedStrategy } from './detectionMemory.js';

export interface CameraHandlers {
  onFrame(
    ctx: CanvasRenderingContext2D,
    lm: readonly NormalizedLandmark[],
    yawRad: number,
    space: CoordinateSpace,
  ): void;
  /**
   * Pas de landmarks sur cette frame. `cause` sépare (§11) l'entrée cassée
   * (`invalid-input`), la sortie du modèle inutilisable (`invalid-landmarks`),
   * l'exception d'inférence (`inference-error`) et le vrai « visage non
   * trouvé » (`no-face`). La pose (« mettez-vous de face ») n'est PAS un état
   * de détection : elle appartient aux gates de mesure.
   */
  onLost(ctx: CanvasRenderingContext2D, n: number, cause: LostCause, reason: string | null): void;
  onProgress(ratio: number): void;
  /**
   * Appelé UNE fois, quand la caméra ET une instance de détection VIVANTE sont
   * prêtes (ré-audit A3) — jamais pendant la compilation WASM : aucun écran de
   * mesure ni chrono métrique ne démarre avant que le modèle puisse répondre.
   */
  onReady(stats: () => Readonly<FaceLoopStats>): void;
  /**
   * 🔴 Ré-audit 2026-08-23 — appelé UNE fois, au PREMIER visage VALIDÉ de la
   * session : `modelCreated` (onReady, UI caméra) ≠ `trackerProven` (ici).
   * C'est le point de départ légitime des collectes métrologiques d'arrière-
   * plan : aucune n'a de sens tant que le backend n'a rien produit.
   */
  onTrackerProven?(): void;
  /** L'identité de l'objectif RÉELLEMENT ouvert (points 39–40) — avant onReady. */
  onCameraIdentity?(identity: CameraIdentity): void;
  /** Dégradation RÉCUPÉRABLE (ex. GPU KO → CPU vivant). La séance continue. */
  onWarning(message: string): void;
  /** Fatal : aucune stratégie ne peut continuer. */
  onError(message: string): void;
}

/** Budget TOTAL de la chaîne caméra : getUserMedia + play + dimensions. */
export const CAMERA_INIT_TIMEOUT_MS = 15_000;
/** Cadence du sondage de l'état vidéo pendant l'init. */
const VIDEO_POLL_MS = 100;

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

/**
 * Attend que la vidéo soit RÉELLEMENT exploitable. Par condition ET par
 * événements : les événements accélèrent, le sondage garantit — aucun des deux
 * ne peut manquer un état déjà atteint (point 65).
 */
function waitForVideoReady(video: HTMLVideoElement, deadlineMs: number): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const events = ['loadedmetadata', 'loadeddata', 'canplay', 'resize'] as const;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = (): void => {
      if (timer !== null) clearTimeout(timer);
      for (const e of events) video.removeEventListener(e, check);
    };
    const check = (): void => {
      if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
        cleanup();
        resolve();
        return;
      }
      const left = deadlineMs - performance.now();
      if (left <= 0) {
        cleanup();
        reject(
          new Error(
            `La caméra n'a pas fourni d'image exploitable en ${CAMERA_INIT_TIMEOUT_MS / 1000} s ` +
              `(readyState ${video.readyState}, ${video.videoWidth}×${video.videoHeight}).`,
          ),
        );
        return;
      }
      timer = setTimeout(check, Math.min(VIDEO_POLL_MS, left));
    };
    for (const e of events) video.addEventListener(e, check);
    check();
  });
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
    let detachResize: (() => void) | null = null;

    // ⚠️ À vérifier après CHAQUE await (complément 26) : stopper ce qui vient
    // d'arriver trop tard, ne jamais le laisser vivant en fantôme.
    const stopStream = (s: MediaStream | null): void => s?.getTracks().forEach((t) => t.stop());

    void (async () => {
      try {
        // ⭐ Point 7 — le modèle part en téléchargement PENDANT que la caméra
        // s'ouvre, pas après.
        preloadLandmarkerAssets((r) => {
          if (!disposed) held.current.onProgress(r);
        });

        // ⭐ Ré-audit A4 — une seule échéance pour TOUTE la chaîne caméra ;
        // chaque étape court contre elle, et une résolution tardive est
        // nettoyée (jamais un stream fantôme, point 66).
        const deadline = performance.now() + CAMERA_INIT_TIMEOUT_MS;
        const budget = `${CAMERA_INIT_TIMEOUT_MS / 1000} s`;
        const fresh = await withDeadline(
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          }),
          deadline,
          `L'accès à la caméra (getUserMedia) n'a pas répondu en ${budget}. ` +
            `Fermez les autres applications qui utilisent la caméra, puis réessayez.`,
          (late) => stopStream(late),
        );
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (video === null || canvas === null || disposed) {
          stopStream(fresh); // 🔴 point 66 — jamais de stream fantôme
          return;
        }
        stream = fresh;

        video.srcObject = stream;
        await withDeadline(
          video.play(),
          deadline,
          `Le démarrage de la vidéo (play) n'a pas répondu en ${budget}. ` +
            `Rechargez la page ; si cela persiste, essayez un autre navigateur.`,
        );
        if (disposed) {
          stopStream(stream);
          return;
        }

        // Dimensionner le canvas PUIS seulement démarrer la boucle (§2).
        await waitForVideoReady(video, deadline);
        if (disposed) {
          stopStream(stream);
          return;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // ⭐ Point 41 — si la piste change de dimensions en cours de session
        // (rotation d'écran, renégociation), le canvas suit : landmarks,
        // canvas d'inférence et canvas de rendu restent dans le même repère.
        const onResize = (): void => {
          if (video.videoWidth > 0 && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
        };
        video.addEventListener('resize', onResize);
        detachResize = () => video.removeEventListener('resize', onResize);

        // ⭐ Points 39–40 — l'identité de l'objectif ouvert, pour que le profil
        // de focale mémorisé ne soit jamais appliqué à un AUTRE objectif.
        // ⭐ AA — zoom (optique différente) et résolution effective (diagnostic)
        // quand l'appareil les donne.
        const settings = fresh.getVideoTracks()[0]?.getSettings() as
          | (MediaTrackSettings & { zoom?: number })
          | undefined;
        if (settings !== undefined) {
          held.current.onCameraIdentity?.({
            ...(settings.deviceId !== undefined ? { deviceId: settings.deviceId } : {}),
            ...(typeof settings.facingMode === 'string' ? { facingMode: settings.facingMode } : {}),
            ...(video.videoHeight > 0 ? { aspect: video.videoWidth / video.videoHeight } : {}),
            ...(typeof settings.zoom === 'number' && Number.isFinite(settings.zoom)
              ? { zoom: settings.zoom }
              : {}),
            ...(video.videoWidth > 0 ? { captureWidthPx: video.videoWidth } : {}),
          });
        }

        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('Contexte 2D indisponible.');

        const control = await startFaceLoop(
          video,
          {
            onLandmarks: (lm, yawRad, space) => held.current.onFrame(ctx, lm, yawRad, space),
            onLost: (n, cause, reason) => held.current.onLost(ctx, n, cause, reason),
            onTransition: (reason) => console.warn(`Détection — ${reason}`),
            onProgress: (r) => {
              if (!disposed) held.current.onProgress(r);
            },
            onWarning: (message) => {
              if (!disposed) held.current.onWarning(message);
            },
            onError: (message) => {
              if (!disposed) held.current.onError(message);
            },
            // 🔴 Négociation — la stratégie PROUVÉE stable (≥ 478 landmarks sur
            // plusieurs frames) est mémorisée pour cet appareil/navigateur : le
            // prochain démarrage l'essaie en premier. Défaillante plus tard, la
            // négociation reprend et la remplaçante écrasera cette mémoire.
            onStrategyStable: (id) => saveNegotiatedStrategy(id),
          },
          { initialStrategyId: loadNegotiatedStrategy() },
        );
        if (disposed) {
          control.stop();
          stopStream(stream);
          return;
        }
        loop = control; // dès maintenant : le cleanup peut le stopper pendant l'attente

        // ⭐ Ré-audit A3 — « prêt » n'est déclaré qu'avec une instance de
        // détection VIVANTE. Le délai du modèle est porté par son échelle de
        // stratégies (watchdog par création), pas par l'échéance caméra.
        const modelAlive = await control.modelReady();
        if (disposed) return; // le cleanup a déjà stoppé boucle et stream
        if (!modelAlive) return; // fatal déjà signalé par onError ; « Réessayer » remonte tout

        held.current.onReady(() => control.stats());

        // 🔴 Ré-audit 2026-08-23 — le PREMIER visage validé arrive quand il
        // arrive : on ne bloque pas l'UI dessus, on notifie (métrologie).
        void control.trackerProven().then((proven) => {
          if (!disposed && proven) held.current.onTrackerProven?.();
        });
      } catch (err) {
        stopStream(stream);
        if (!disposed) held.current.onError(describeInitError(err));
      }
    })();

    return () => {
      disposed = true;
      detachResize?.();
      loop?.stop();
      stopStream(stream);
    };
  }, [videoRef, canvasRef, attempt]);
}
