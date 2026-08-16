/**
 * ui/App.tsx — orchestration de l'essayage (CLAUDE.md §0.0.2 : live, jamais différé).
 *
 * ⚠️ AUCUN slider de taille, nulle part. L'échelle est calculée (§4), jamais réglée.
 * ⚠️ Aucun tri, aucune recommandation : on affiche deux chiffres et une image (§0.0.1).
 *
 * La boucle de rendu se monte UNE fois et lit un `live` mutable. Les valeurs
 * React ne peuvent pas la traverser : une boucle recréée à chaque état perdrait
 * ses compteurs et son timestamp monotone (garde S5).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  assertIrisUsable,
  calibrateWithCard,
  calibrateWithIris,
  type UserCalibration,
} from '../core/calibration.js';
import { frameMetrics, irisWidthPx } from '../core/faceMetrics.js';
import { CalibrationError, type NormalizedLandmark } from '../core/geom.js';
import { verdict, type SizeVerdict } from '../core/verdict.js';
import { drawFrame } from '../render/composite.js';
import { drawOverlay } from '../render/overlay.js';
import { createLandmarker, faceOutlinePath, startLoop } from '../tracking/landmarker.js';
import { CardCalibration } from './CardCalibration.js';
import { useSprites, type SpritesState } from './useSprites.js';

const IRIS_FRAMES = 30;
const STORAGE_KEY = 'essayage.calibration.v1';

type Phase =
  | { kind: 'loading'; ratio: number }
  | { kind: 'error'; message: string }
  | { kind: 'question-lunettes' }
  | { kind: 'mesure-iris'; collected: number }
  | { kind: 'carte'; frozen: HTMLCanvasElement }
  | { kind: 'essayage' };

/** Tout ce que la boucle de rendu doit voir sans être recréée. */
interface Live {
  cal: UserCalibration | null;
  sprites: SpritesState;
  collectingIris: boolean;
  irisSamples: number[];
  lastLandmarks: readonly NormalizedLandmark[] | null;
  verdict: SizeVerdict | null;
  failures: number;
}

function loadStoredCalibration(): UserCalibration | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : (JSON.parse(raw) as UserCalibration);
  } catch {
    return null;
  }
}

export function App(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const slug = new URLSearchParams(location.search).get('monture');
  const sprites = useSprites(slug);

  const [phase, setPhase] = useState<Phase>({ kind: 'loading', ratio: 0 });
  const [cal, setCal] = useState<UserCalibration | null>(loadStoredCalibration);
  const [notice, setNotice] = useState<string | null>(null);

  const live = useRef<Live>({
    cal,
    sprites,
    collectingIris: false,
    irisSamples: [],
    lastLandmarks: null,
    verdict: null,
    failures: 0,
  });

  live.current.cal = cal;
  live.current.sprites = sprites;

  const persist = useCallback((next: UserCalibration) => {
    live.current.cal = next;
    live.current.collectingIris = false;
    setCal(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setPhase({ kind: 'essayage' });
  }, []);

  /** Fige la frame courante pour la calibration carte (seule exception au §0.0.2). */
  const freeze = useCallback(() => {
    const video = videoRef.current;
    if (video === null) return;
    live.current.collectingIris = false;
    const off = document.createElement('canvas');
    off.width = video.videoWidth;
    off.height = video.videoHeight;
    off.getContext('2d')?.drawImage(video, 0, 0);
    setPhase({ kind: 'carte', frozen: off });
  }, []);

  useEffect(() => {
    let stopLoop: (() => void) | null = null;
    let stream: MediaStream | null = null;
    let disposed = false;

    function renderFrame(
      ctx: CanvasRenderingContext2D,
      lm: readonly NormalizedLandmark[],
      yawRad: number,
    ): void {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const s = live.current;
      s.lastLandmarks = lm;
      s.failures = 0;

      // Moyenner sur ~30 frames tue le bruit de DÉTECTION. Cela n'améliore pas
      // la variabilité biologique de l'iris, qui est un biais fixe (§4).
      if (s.collectingIris) {
        s.irisSamples.push(irisWidthPx(lm, w, h));
        if (s.irisSamples.length >= IRIS_FRAMES) {
          const mean = s.irisSamples.reduce((a, b) => a + b, 0) / s.irisSamples.length;
          s.irisSamples = [];
          s.collectingIris = false;
          try {
            persist(calibrateWithIris(mean, lm, w, h));
          } catch (err) {
            setNotice(err instanceof CalibrationError ? err.message : String(err));
            freeze();
          }
        } else {
          setPhase({ kind: 'mesure-iris', collected: s.irisSamples.length });
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (s.cal !== null && s.sprites.status === 'ready') {
        const m = frameMetrics(lm, w, h, s.cal, yawRad);
        drawFrame(ctx, s.sprites.sprites, m, faceOutlinePath(lm, w, h));
        s.verdict = verdict(lm, s.cal, s.sprites.spec, w, h, yawRad);
      }

      drawOverlay(ctx, { verdict: s.verdict, consecutiveFailures: s.failures, hint: null });
    }

    /**
     * ⚠️ Un échec silencieux est pire qu'un crash (§1 bug #3).
     *
     * Sans ce chemin, la perte de détection ne dessinait RIEN : le canvas
     * gardait la dernière image ou restait vide, et le compteur d'échecs que le
     * contrat exige d'afficher n'apparaissait jamais. La panne était donc
     * strictement indiscernable d'un fonctionnement normal — exactement le mode
     * d'échec vécu sur les versions précédentes.
     */
    function renderLost(ctx: CanvasRenderingContext2D, n: number): void {
      const s = live.current;
      s.failures = n;
      s.verdict = null;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      drawOverlay(ctx, {
        verdict: null,
        consecutiveFailures: n,
        hint: n > 5 ? 'Placez votre visage bien en face de la caméra.' : null,
      });
    }

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
        if (video.readyState < 2) {
          await new Promise<void>((resolve) => {
            video.onloadedmetadata = () => resolve();
          });
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const landmarker = await createLandmarker((ratio) => {
          if (!disposed) setPhase({ kind: 'loading', ratio });
        });
        if (disposed) return;

        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error('Contexte 2D indisponible.');

        setPhase(live.current.cal !== null ? { kind: 'essayage' } : { kind: 'question-lunettes' });

        const control = startLoop(landmarker, video, {
          onFrame: (lm, yawRad) => renderFrame(ctx, lm, yawRad),
          onLost: (n) => renderLost(ctx, n),
        });
        stopLoop = () => control.stop();
      } catch (err) {
        if (!disposed) {
          setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();

    return () => {
      disposed = true;
      stopLoop?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [persist, freeze]);

  return (
    <main style={{ maxWidth: 900 }}>
      <h1>Essayage virtuel</h1>

      <div className="stage">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
      </div>

      {phase.kind === 'loading' && <p>Chargement du modèle : {Math.round(phase.ratio * 100)} %</p>}
      {phase.kind === 'error' && <p style={{ color: '#ff6b6b' }}>Erreur : {phase.message}</p>}

      {phase.kind === 'question-lunettes' && (
        <section>
          <h2>Portez-vous des lunettes en ce moment ?</h2>
          <p>
            Vos verres correcteurs modifient la taille apparente de vos yeux d'environ 10 %, ce qui
            fausserait la mesure sans que rien ne le signale.
          </p>
          <button
            type="button"
            onClick={() => {
              try {
                assertIrisUsable(false);
                live.current.irisSamples = [];
                live.current.collectingIris = true;
                setPhase({ kind: 'mesure-iris', collected: 0 });
              } catch (err) {
                setNotice(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            Non, je n'en porte pas
          </button>{' '}
          <button
            type="button"
            onClick={() => {
              setNotice(
                "Mesure par l'iris écartée : vos verres la fausseraient. On passe par la carte.",
              );
              freeze();
            }}
          >
            Oui — utiliser une carte bancaire
          </button>
        </section>
      )}

      {phase.kind === 'mesure-iris' && (
        <p>
          Mesure en cours : {phase.collected}/{IRIS_FRAMES} images. Regardez droit devant vous.
        </p>
      )}

      {phase.kind === 'carte' && (
        <CardCalibration
          frozen={phase.frozen}
          onCancel={() => setPhase({ kind: 'question-lunettes' })}
          onValidate={(cardWidthPx) => {
            const canvas = canvasRef.current;
            const lm = live.current.lastLandmarks;
            if (canvas === null) return;
            try {
              if (lm === null) throw new CalibrationError('Visage perdu pendant la calibration.');
              persist(calibrateWithCard(cardWidthPx, lm, canvas.width, canvas.height));
              setNotice('Merci, vous pouvez ranger votre carte. Plus jamais nécessaire.');
            } catch (err) {
              setNotice(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}

      {notice !== null && <p>{notice}</p>}

      {sprites.status === 'idle' && (
        <p>
          Aucune monture chargée. Ajoutez <code>?monture=&lt;slug&gt;</code> à l'URL, après avoir
          préparé la monture avec l'outil de détourage.
        </p>
      )}
      {sprites.status === 'error' && <p style={{ color: '#ff6b6b' }}>{sprites.message}</p>}

      {cal !== null && (
        <p>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(STORAGE_KEY);
              live.current.cal = null;
              setCal(null);
              setPhase({ kind: 'question-lunettes' });
            }}
          >
            Refaire la calibration
          </button>
        </p>
      )}
    </main>
  );
}
