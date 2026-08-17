/**
 * ui/TryOn.tsx — l'essayage live, commun aux deux versions.
 *
 * ⚠️ AUCUN slider de taille. L'échelle est calculée (§4), jamais réglée.
 * ⚠️ Aucun tri, aucune recommandation : deux chiffres et une image (§0.0.1).
 *
 * La boucle de rendu se monte UNE fois et lit un `live` mutable : une boucle
 * recréée à chaque état perdrait son compteur d'échecs et son timestamp
 * monotone (garde S5).
 *
 * ## V1 : la carte d'abord, puis la rotation
 *
 * Arbitrage humain du 2026-08-17 : « pour la v1 on dira carte obligatoire une
 * fois au début et tu te débrouilles pour la mesure de l'écart temporal, quitte
 * à lui demander de tourner sa tête à droite et à gauche ». L'iris n'est donc
 * plus une source de mesure en V1 — il reste le contrôle de cohérence qui
 * relit la carte (`crossCheckWithIris`).
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { calibrateWithWornFrame, type UserCalibration } from '../core/calibration.js';
import { crossCheckWithIris } from '../core/crossCheck.js';
import { frameMetrics, irisWidthPx, rollRadOf } from '../core/faceMetrics.js';
import type { FrameSpec } from '../core/frameSpec.js';
import { CalibrationError, type NormalizedLandmark } from '../core/geom.js';
import { verdict } from '../core/verdict.js';
import { drawFrame, OVERLAY_PADDING_MM } from '../render/composite.js';
import { drawOverlay } from '../render/overlay.js';
import { faceOutlinePath } from '../tracking/landmarker.js';
import { CalibrationPanel, type Phase } from './CalibrationPanel.js';
import { FramePicker } from './FramePicker.js';
import { createLive, type Live } from './liveState.js';
import { useCatalogue } from './catalogue.js';
import { useV1Calibration } from './useV1Calibration.js';
import { useCameraLoop } from './useCameraLoop.js';
import { useSprites } from './useSprites.js';

export type Mode = 'online' | 'store';

const CROSSCHECK_FRAMES = 30;
const STORAGE_KEY = 'essayage.calibration.v1';

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
  const [notices, setNotices] = useState<string[]>([]);

  const entries = catalogue.status === 'ready' ? catalogue.entries : [];
  const essayables = useMemo<FrameSpec[]>(
    () => entries.flatMap((e) => [e.spec, ...e.colorways]),
    [entries],
  );
  const selected = essayables.find((s) => s.slug === selectedSlug) ?? essayables[0] ?? null;
  const sprites = useSprites(selected);

  // Le mode ne descend jamais dans core/ ni render/ : c'est une VALEUR qui descend.
  const overlayPaddingMm = props.mode === 'store' ? OVERLAY_PADDING_MM : 0;

  const live = useRef<Live>(createLive(sprites, selected, cal, overlayPaddingMm));
  live.current.cal = cal;
  live.current.spec = selected;
  live.current.sprites = sprites;
  live.current.overlayPaddingMm = overlayPaddingMm;

  const persist = useCallback((next: UserCalibration) => {
    live.current.cal = next;
    live.current.probe = null;
    live.current.irisSamples = [];
    setCal(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setPhase({ kind: 'essayage' });
  }, []);

  /** Fige la frame courante : seule exception au « live et jamais différé » (§0.0.2). */
  const freeze = useCallback((kind: 'mesure-carte' | 'mesure-monture') => {
    const video = videoRef.current;
    if (video === null) return;
    live.current.probe = null;
    const off = document.createElement('canvas');
    off.width = video.videoWidth;
    off.height = video.videoHeight;
    off.getContext('2d')?.drawImage(video, 0, 0);
    setPhase({ kind, frozen: off });
  }, []);

  const v1 = useV1Calibration({
    live,
    videoRef,
    onCalibrated: (next, notes) => {
      setNotices(notes);
      persist(next);
    },
    onFailed: (message) => {
      setNotices([message]);
      freeze('mesure-carte');
    },
    onRotationStart: () =>
      setPhase({ kind: 'mesure-rotation', ratio: 0, degrees: { left: 0, right: 0 } }),
  });
  const finishCalibration = v1.finish;

  const renderFrame = useCallback(
    (ctx: CanvasRenderingContext2D, lm: readonly NormalizedLandmark[], yawRad: number): void => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const s = live.current;
      s.lastLandmarks = lm;

      if (s.probe !== null) {
        s.probe.offer(lm, yawRad, rollRadOf(lm, w, h), w, h);

        // ⚠️ On ne repeint l'IHM que quand l'avancement change vraiment : un
        // `setPhase` par frame ferait rendre React soixante fois par seconde,
        // au moment précis où la boucle de détection a besoin du processeur.
        const ratio = s.probe.ratio();
        if (Math.abs(ratio - s.lastProbeRatio) > 0.02 || s.probe.complete) {
          s.lastProbeRatio = ratio;
          const p = s.probe.progress;
          const deg = (r: number): number => (r * 180) / Math.PI;
          setPhase({
            kind: 'mesure-rotation',
            ratio,
            degrees: { left: deg(p.negative), right: deg(p.positive) },
          });
        }
        if (s.probe.complete) finishCalibration();
      }

      // Contrôle de cohérence : l'iris relit la carte, une fois, en silence.
      if (s.irisSamples !== null && s.cal !== null) {
        s.irisSamples.push(irisWidthPx(lm, w, h));
        if (s.irisSamples.length >= CROSSCHECK_FRAMES) {
          const mean = s.irisSamples.reduce((a, b) => a + b, 0) / s.irisSamples.length;
          s.irisSamples = null;
          const warn = crossCheckWithIris(s.cal, mean, lm, w, h);
          if (warn !== null) setNotices((prev) => [...prev, warn]);
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
    },
    [finishCalibration],
  );

  /**
   * ⚠️ Le chemin d'échec DOIT dessiner (§1 bug #3). Sans cela, la détection
   * perdue laissait un canvas vide et le compteur exigé n'apparaissait jamais :
   * la panne était indiscernable du fonctionnement normal.
   */
  const renderLost = useCallback((ctx: CanvasRenderingContext2D, n: number): void => {
    live.current.verdict = null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    drawOverlay(ctx, {
      verdict: null,
      consecutiveFailures: n,
      hint: n > 5 ? 'Placez votre visage bien en face de la caméra.' : null,
    });
  }, []);

  useCameraLoop(videoRef, canvasRef, {
    onFrame: renderFrame,
    onLost: renderLost,
    onProgress: (ratio) => setPhase({ kind: 'loading', ratio }),
    onReady: () => {
      if (live.current.cal !== null) setPhase({ kind: 'essayage' });
      else freeze(props.mode === 'store' ? 'mesure-monture' : 'mesure-carte');
    },
    onError: (message) => setPhase({ kind: 'error', message }),
  });

  /** V2 — la monture physiquement portée sert d'étalon (§11.3). */
  const onWornFrameValidated = useCallback(
    (widthPx: number, wornSpec: FrameSpec) => {
      const canvas = canvasRef.current;
      const lm = live.current.lastLandmarks;
      if (canvas === null) return;
      try {
        if (lm === null) throw new CalibrationError('Visage perdu pendant l’étalonnage.');
        persist(calibrateWithWornFrame(widthPx, wornSpec, lm, canvas.width, canvas.height));
        setNotices([`Étalonné sur « ${wornSpec.slug} » — précision 2 %.`]);
      } catch (err) {
        setNotices([err instanceof Error ? err.message : String(err)]);
      }
    },
    [persist],
  );

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

      <CalibrationPanel
        phase={phase}
        catalogue={essayables}
        onCancel={props.onQuit}
        onCardValidated={v1.onCardValidated}
        onSkipRotation={() => {
          live.current.probe = null;
          finishCalibration();
        }}
        onWornFrameValidated={onWornFrameValidated}
      />

      {notices.map((n) => (
        <p key={n}>{n}</p>
      ))}

      {catalogue.status === 'error' && <p style={{ color: '#ff6b6b' }}>{catalogue.message}</p>}
      {sprites.status === 'error' && <p style={{ color: '#ff6b6b' }}>{sprites.message}</p>}

      <FramePicker
        frames={essayables}
        referenceFor={(slug) => entries.find((e) => e.colorways.some((c) => c.slug === slug))?.spec}
        selectedSlug={selected?.slug ?? null}
        onSelect={(slug) => {
          setSelectedSlug(slug);
          setNotices([]);
        }}
        onError={(message) => setNotices([message])}
      />

      {cal !== null && (
        <p>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(STORAGE_KEY);
              live.current.cal = null;
              live.current.irisSamples = null;
              setCal(null);
              setNotices([]);
              freeze(props.mode === 'store' ? 'mesure-monture' : 'mesure-carte');
            }}
          >
            Refaire la calibration
          </button>
        </p>
      )}
    </main>
  );
}
