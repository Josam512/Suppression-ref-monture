import { useEffect, useRef, useState } from 'react';

/**
 * Flux webcam + canvas superposé — CLAUDE.md §2, §1 bug #3, §1 bug #5.
 */

export type CameraStatus = 'loading' | 'ready' | 'error';

/** Résolution demandée. 640×480 était trop juste pour localiser les iris (§2). */
const IDEAL_WIDTH = 1280;
const IDEAL_HEIGHT = 720;

/** Au-delà, on affiche à l'écran que la détection est perdue (§1 bug #3). */
const LOST_DETECTION_WARN_FRAMES = 5;

/** Le HUD ne se rafraîchit pas à chaque frame : ce serait 60 rendus React/s. */
const HUD_REFRESH_MS = 500;

export interface CameraProps {
  /**
   * Appelée à chaque frame, après nettoyage du canvas.
   * Renvoyer `false` signifie « rien de détecté » et alimente le compteur de
   * perte. `true` ou rien signifie que la frame est exploitée.
   */
  onFrame?: (ctx: CanvasRenderingContext2D, video: HTMLVideoElement) => boolean | void;
}

export function Camera({ onFrame }: CameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  // ⚠️ onFrame passe par une ref, JAMAIS par les dépendances de l'effet.
  // Sinon chaque rendu de React (ne serait-ce que le compteur de fps)
  // relancerait getUserMedia et ferait clignoter la caméra.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const [status, setStatus] = useState<CameraStatus>('loading');
  const [message, setMessage] = useState('Ouverture de la caméra…');
  const [lostFrames, setLostFrames] = useState(0);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    /**
     * ⚠️ RÈGLE DÉFINITIVE (§1 bug #3) : cette boucle ne doit JAMAIS pouvoir
     * s'arrêter sur une exception. Elle replanifie avant toute chose, et
     * chaque perte est rendue VISIBLE — un échec silencieux est pire qu'un crash.
     */
    let consecutiveLost = 0;
    let framesSinceHud = 0;
    let hudSince = performance.now();

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (!runningRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!video || !canvas || !ctx) return;

      let lost = false;
      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        lost = onFrameRef.current?.(ctx, video) === false;
      } catch (err) {
        lost = true;
        console.error('Erreur de rendu :', err);
      }

      if (lost) consecutiveLost++;
      else consecutiveLost = 0;

      framesSinceHud++;
      const now = performance.now();
      if (now - hudSince >= HUD_REFRESH_MS) {
        setFps(Math.round((framesSinceHud * 1000) / (now - hudSince)));
        setLostFrames(consecutiveLost);
        framesSinceHud = 0;
        hudSince = now;
      }
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            'navigator.mediaDevices est indisponible. La page doit être servie depuis ' +
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
        // démarrer la boucle. L'inverse donne un canvas 0×0 et un écran noir.
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
  }, []);

  return (
    <div className="camera">
      <div className={`status status--${status}`} role="status">
        <span className="status__dot" />
        {message}
        {status === 'ready' && <span className="status__fps">{fps} fps</span>}
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

      {lostFrames >= LOST_DETECTION_WARN_FRAMES && (
        <div className="status status--error" role="alert">
          détection perdue : {lostFrames} frames
        </div>
      )}
    </div>
  );
}
