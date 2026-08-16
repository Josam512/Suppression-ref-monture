import { useEffect, useRef, useState } from 'react';

/**
 * Flux webcam + canvas superposé — CLAUDE.md §2 et §1 bug #3 / bug #5.
 *
 * Lot 1 : la boucle ne fait encore que nettoyer le canvas. Elle est écrite
 * dès maintenant sous sa forme définitive (celle qui ne peut pas mourir),
 * pour que le lot 2 n'ait qu'à y brancher le FaceLandmarker.
 */

export type CameraStatus = 'loading' | 'ready' | 'error';

/** Résolution demandée. 640×480 était trop juste pour localiser les iris (§2). */
const IDEAL_WIDTH = 1280;
const IDEAL_HEIGHT = 720;

/** Au-delà, on affiche à l'écran que la détection est perdue (§1 bug #3). */
const LOST_DETECTION_WARN_FRAMES = 5;

export interface CameraProps {
  /** Appelée à chaque frame, après nettoyage du canvas. Ne doit jamais throw silencieusement. */
  onFrame?: (ctx: CanvasRenderingContext2D, video: HTMLVideoElement) => void;
}

export function Camera({ onFrame }: CameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  const [status, setStatus] = useState<CameraStatus>('loading');
  const [message, setMessage] = useState('Ouverture de la caméra…');
  const [failedFrames, setFailedFrames] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    /**
     * ⚠️ RÈGLE DÉFINITIVE (§1 bug #3) : cette boucle ne doit JAMAIS pouvoir
     * s'arrêter sur une exception. Elle replanifie avant toute chose, et
     * chaque échec est rendu VISIBLE — un échec silencieux est pire qu'un crash.
     */
    let consecutiveFailures = 0;

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (!runningRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!video || !canvas || !ctx) return;

      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        onFrame?.(ctx, video);
        if (consecutiveFailures !== 0) {
          consecutiveFailures = 0;
          setFailedFrames(0);
        }
      } catch (err) {
        consecutiveFailures++;
        setFailedFrames(consecutiveFailures);
        // Visible en console ET à l'écran : on ne masque jamais une perte.
        console.error(`Erreur de rendu (frame ${consecutiveFailures}) :`, err);
      }
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "navigator.mediaDevices est indisponible. La page doit être servie depuis " +
              'un secure context : http://localhost:5173 via `npm run dev`, jamais un ' +
              'fichier ouvert en file:// (§1 bug #5).',
          );
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: IDEAL_WIDTH },
            height: { ideal: IDEAL_HEIGHT },
          },
        });
        if (cancelled) return;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;

        // §2 : dimensionner le canvas sur les métadonnées, PUIS SEULEMENT
        // démarrer la boucle. L'inverse donne un canvas à 0×0 et un écran noir.
        video.onloadedmetadata = () => {
          if (cancelled) return;
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          void video.play();
          runningRef.current = true;
          setStatus('ready');
          setMessage(`Caméra active — ${video.videoWidth}×${video.videoHeight}`);
          loop();
        };
      } catch (err) {
        if (cancelled) return;
        runningRef.current = false;
        setStatus('error');
        setMessage(err instanceof Error ? err.message : String(err));
        console.error('Accès caméra impossible :', err);
      }
    };

    void start();

    return () => {
      cancelled = true;
      runningRef.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onFrame]);

  return (
    <div className="camera">
      <div className={`status status--${status}`} role="status">
        <span className="status__dot" />
        {message}
      </div>

      {/*
        Miroir appliqué UNE SEULE FOIS, ici, au niveau du conteneur (§6).
        Les calculs de src/core/ travaillent toujours en coordonnées NON
        miroitées. Ne jamais mélanger les deux — c'est le bug classique
        « les lunettes partent du mauvais côté ».
      */}
      <div className="camera__stage">
        <video ref={videoRef} className="camera__video" playsInline muted />
        <canvas ref={canvasRef} className="camera__canvas" />
      </div>

      {failedFrames >= LOST_DETECTION_WARN_FRAMES && (
        <div className="status status--error" role="alert">
          détection perdue : {failedFrames} frames
        </div>
      )}
    </div>
  );
}
