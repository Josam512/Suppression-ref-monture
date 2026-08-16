/**
 * ui/TryOn.tsx — l'essayage live, commun aux deux versions.
 *
 * ⚠️ AUCUN slider de taille. L'échelle est calculée (§4), jamais réglée.
 * ⚠️ Aucun tri, aucune recommandation : deux chiffres et une image (§0.0.1).
 *
 * La boucle de rendu se monte UNE fois et lit un `live` mutable : une boucle
 * recréée à chaque état perdrait son compteur d'échecs et son timestamp
 * monotone (garde S5).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  assertIrisUsable,
  calibrateWithCard,
  calibrateWithIris,
  calibrateWithWornFrame,
  type UserCalibration,
} from '../core/calibration.js';
import { frameMetrics, irisWidthPx } from '../core/faceMetrics.js';
import { assertSameModel, type FrameSpec } from '../core/frameSpec.js';
import { CalibrationError, type NormalizedLandmark } from '../core/geom.js';
import { verdict, type SizeVerdict } from '../core/verdict.js';
import { drawFrame, OVERLAY_PADDING_MM } from '../render/composite.js';
import { drawOverlay } from '../render/overlay.js';
import { createLandmarker, faceOutlinePath, startLoop } from '../tracking/landmarker.js';
import { CardCalibration } from './CardCalibration.js';
import { WornFrameCalibration } from './WornFrameCalibration.js';
import { useCatalogue } from './catalogue.js';
import { useSprites } from './useSprites.js';

export type Mode = 'online' | 'store';

const IRIS_FRAMES = 30;
const STORAGE_KEY = 'essayage.calibration.v1';

type Phase =
  | { kind: 'loading'; ratio: number }
  | { kind: 'error'; message: string }
  | { kind: 'question-lunettes' }
  | { kind: 'mesure-iris'; collected: number }
  | { kind: 'mesure-carte'; frozen: HTMLCanvasElement }
  | { kind: 'mesure-monture'; frozen: HTMLCanvasElement }
  | { kind: 'essayage' };

interface Live {
  cal: UserCalibration | null;
  spec: FrameSpec | null;
  sprites: ReturnType<typeof useSprites>;
  overlayPaddingMm: number;
  collectingIris: boolean;
  irisSamples: number[];
  lastLandmarks: readonly NormalizedLandmark[] | null;
  verdict: SizeVerdict | null;
}

function loadStored(): UserCalibration | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : (JSON.parse(raw) as UserCalibration);
  } catch {
    return null;
  }
}

export function TryOn(props: { mode: Mode; onQuit(): void }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const catalogue = useCatalogue();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', ratio: 0 });
  const [cal, setCal] = useState<UserCalibration | null>(loadStored);
  const [notice, setNotice] = useState<string | null>(null);

  const entries = catalogue.status === 'ready' ? catalogue.entries : [];

  /** Toutes les montures essayables, coloris compris. Aucun tri (§0.0.1). */
  const essayables = useMemo<FrameSpec[]>(
    () => entries.flatMap((e) => [e.spec, ...e.colorways]),
    [entries],
  );

  const selected = essayables.find((s) => s.slug === selectedSlug) ?? essayables[0] ?? null;
  const sprites = useSprites(selected);

  // Le mode ne descend jamais dans core/ ni render/ : c'est une VALEUR qui descend.
  const overlayPaddingMm = props.mode === 'store' ? OVERLAY_PADDING_MM : 0;

  const live = useRef<Live>({
    cal,
    spec: selected,
    sprites,
    overlayPaddingMm,
    collectingIris: false,
    irisSamples: [],
    lastLandmarks: null,
    verdict: null,
  });
  live.current.cal = cal;
  live.current.spec = selected;
  live.current.sprites = sprites;
  live.current.overlayPaddingMm = overlayPaddingMm;

  const persist = useCallback((next: UserCalibration) => {
    live.current.cal = next;
    live.current.collectingIris = false;
    setCal(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setPhase({ kind: 'essayage' });
  }, []);

  /** Fige la frame courante : seule exception au « live et jamais différé » (§0.0.2). */
  const freeze = useCallback((kind: 'mesure-carte' | 'mesure-monture') => {
    const video = videoRef.current;
    if (video === null) return;
    live.current.collectingIris = false;
    const off = document.createElement('canvas');
    off.width = video.videoWidth;
    off.height = video.videoHeight;
    off.getContext('2d')?.drawImage(video, 0, 0);
    setPhase({ kind, frozen: off });
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

      // Moyenner sur ~30 frames tue le bruit de DÉTECTION, pas la variabilité
      // biologique de l'iris, qui est un biais fixe propre à la personne (§4).
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
            freeze('mesure-carte');
          }
        } else {
          setPhase({ kind: 'mesure-iris', collected: s.irisSamples.length });
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (s.cal !== null && s.sprites.status === 'ready') {
        const m = frameMetrics(lm, w, h, s.cal, yawRad);
        drawFrame(ctx, s.sprites.sprites, m, faceOutlinePath(lm, w, h), {
          overlayPaddingMm: s.overlayPaddingMm,
        });
        s.verdict = verdict(lm, s.cal, s.sprites.spec, w, h, yawRad);
      }

      drawOverlay(ctx, { verdict: s.verdict, consecutiveFailures: 0, hint: null });
    }

    /**
     * ⚠️ Le chemin d'échec DOIT dessiner (§1 bug #3). Sans cela, la détection
     * perdue laissait un canvas vide et le compteur exigé n'apparaissait jamais :
     * la panne était indiscernable du fonctionnement normal.
     */
    function renderLost(ctx: CanvasRenderingContext2D, n: number): void {
      live.current.verdict = null;
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
          await new Promise<void>((r) => {
            video.onloadedmetadata = () => r();
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

        setPhase(
          live.current.cal !== null
            ? { kind: 'essayage' }
            : props.mode === 'store'
              ? { kind: 'loading', ratio: 1 }
              : { kind: 'question-lunettes' },
        );
        if (live.current.cal === null && props.mode === 'store') freeze('mesure-monture');

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
  }, [persist, freeze, props.mode]);

  const modeLabel = props.mode === 'store' ? 'V2 — Mode magasin' : 'V1 — Vente en ligne';

  return (
    <main style={{ maxWidth: 900, margin: '0 auto' }}>
      <p>
        <button type="button" onClick={props.onQuit}>
          ← Changer de version
        </button>{' '}
        <strong>{modeLabel}</strong>
        {props.mode === 'store' && (
          <span style={{ opacity: 0.75 }}>
            {' '}
            — sprite dilaté de {OVERLAY_PADDING_MM} mm pour couvrir la monture réelle portée
            dessous. La silhouette est épaissie ; la largeur mesurée, elle, reste exacte.
          </span>
        )}
      </p>

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
            Vos verres correcteurs modifient la taille apparente de vos yeux d’environ 10 %, ce qui
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
            Non, je n’en porte pas
          </button>{' '}
          <button
            type="button"
            onClick={() => {
              setNotice('Mesure par l’iris écartée : vos verres la fausseraient. On passe par la carte.');
              freeze('mesure-carte');
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

      {phase.kind === 'mesure-carte' && (
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

      {phase.kind === 'mesure-monture' && (
        <WornFrameCalibration
          frozen={phase.frozen}
          catalogue={essayables}
          onCancel={props.onQuit}
          onValidate={(widthPx, wornSpec) => {
            const canvas = canvasRef.current;
            const lm = live.current.lastLandmarks;
            if (canvas === null) return;
            try {
              if (lm === null) throw new CalibrationError('Visage perdu pendant l’étalonnage.');
              persist(calibrateWithWornFrame(widthPx, wornSpec, lm, canvas.width, canvas.height));
              setNotice(`Étalonné sur « ${wornSpec.slug} » — précision 2 %.`);
            } catch (err) {
              setNotice(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}

      {notice !== null && <p>{notice}</p>}

      {catalogue.status === 'error' && <p style={{ color: '#ff6b6b' }}>{catalogue.message}</p>}
      {sprites.status === 'error' && <p style={{ color: '#ff6b6b' }}>{sprites.message}</p>}

      {essayables.length > 0 && (
        <section>
          <h2>Montures essayables</h2>
          <p style={{ opacity: 0.75 }}>
            Toutes les montures sont essayables, y compris celles qui ne sont manifestement pas à
            votre taille : c’est en la voyant que vous le constatez.
          </p>
          {essayables.map((s) => (
            <button
              key={s.slug}
              type="button"
              onClick={() => {
                const ref = entries.find((e) => e.colorways.some((c) => c.slug === s.slug))?.spec;
                try {
                  // Garde-fou §11.5 : un coloris est le MÊME modèle.
                  if (ref !== undefined) assertSameModel(ref, s);
                  setSelectedSlug(s.slug);
                  setNotice(null);
                } catch (err) {
                  setNotice(err instanceof Error ? err.message : String(err));
                }
              }}
              style={{ fontWeight: s.slug === selected?.slug ? 700 : 400, marginRight: 8 }}
            >
              {s.slug} · {s.totalWidthMm.toFixed(0)} mm
            </button>
          ))}
        </section>
      )}

      {cal !== null && (
        <p>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(STORAGE_KEY);
              live.current.cal = null;
              setCal(null);
              setPhase(
                props.mode === 'store' ? { kind: 'essayage' } : { kind: 'question-lunettes' },
              );
              if (props.mode === 'store') freeze('mesure-monture');
            }}
          >
            Refaire la calibration
          </button>
        </p>
      )}
    </main>
  );
}
