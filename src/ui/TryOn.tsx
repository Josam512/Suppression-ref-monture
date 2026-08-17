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

import type { UserCalibration } from '../core/calibration.js';
import type { FrameSpec } from '../core/frameSpec.js';
import { type NormalizedLandmark } from '../core/geom.js';
import { OVERLAY_PADDING_MM } from '../render/composite.js';
import { CalibrationPanel, type Phase } from './CalibrationPanel.js';
import { CardGuideStep, runCardStep, snapshotVideo } from './cardGuideStep.js';
import { wornFrameCalibration } from './wornFrameStep.js';
import { stepCrossCheck, stepRotation } from './liveSteps.js';
import { FramePicker } from './FramePicker.js';
import { createLive, type Live } from './liveState.js';
import { paintLost, paintScene } from './renderScene.js';
import { drawOverlay } from '../render/overlay.js';
import { useCatalogue } from './catalogue.js';
import { useV1Calibration } from './useV1Calibration.js';
import type { CameraProfile } from '../core/cameraProfile.js';
import { loadCameraProfile, saveCameraProfile } from './cameraStorage.js';
import { useCameraLoop } from './useCameraLoop.js';
import { useSprites } from './useSprites.js';

export type Mode = 'online' | 'store';

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
  const cameraProfile = useRef<CameraProfile | null>(loadCameraProfile());

  const persistCamera = useCallback((next: CameraProfile) => {
    cameraProfile.current = next;
    saveCameraProfile(next);
  }, []);
  const [notices, setNotices] = useState<string[]>([]);

  const entries = catalogue.status === 'ready' ? catalogue.entries : [];
  const essayables = useMemo<FrameSpec[]>(
    () => entries.flatMap((e) => [e.spec, ...e.colorways]),
    [entries],
  );
  const selected = essayables.find((s) => s.slug === selectedSlug) ?? essayables[0] ?? null;
  const sprites = useSprites(selected);

  // ⭐ V2 — le modèle PHYSIQUEMENT PORTÉ. Son sprite sert de masque au
  // recoloriage 2,5 D : on repeint la monture réelle (§11.6, liseré).
  const [wornSpec, setWornSpec] = useState<FrameSpec | null>(null);
  const wornSprites = useSprites(wornSpec);

  // Le mode ne descend jamais dans core/ : c'est une VALEUR qui descend.
  const overlayPaddingMm = props.mode === 'store' ? OVERLAY_PADDING_MM : 0;

  /**
   * ⚠️ La phase, lue DEPUIS LA BOUCLE. `phase` est un état React : la closure de
   * `renderFrame` en capturerait la valeur au moment du rendu et croirait
   * encore être à l'étape carte longtemps après. Une `ref` est la seule
   * lecture juste ici.
   */
  const phaseRef = useRef<Phase['kind']>('loading');
  phaseRef.current = phase.kind;
  const guideStep = useRef(new CardGuideStep());

  const live = useRef<Live>(createLive(sprites, selected, cal, overlayPaddingMm));
  live.current.cal = cal;
  live.current.spec = selected;
  live.current.sprites = sprites;
  live.current.overlayPaddingMm = overlayPaddingMm;
  live.current.wornSprite = wornSprites.status === 'ready' ? wornSprites.sprites.front : null;

  const persist = useCallback((next: UserCalibration) => {
    live.current.cal = next;
    live.current.probe = null;
    live.current.irisSamples = [];
    setCal(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setPhase({ kind: 'essayage' });
  }, []);

  /** Fige la frame courante : seule exception au « live et jamais différé » (§0.0.2). */
  const freeze = useCallback((kind: 'mesure-monture') => {
    const video = videoRef.current;
    if (video === null) return;
    live.current.probe = null;
    const off = document.createElement('canvas');
    off.width = video.videoWidth;
    off.height = video.videoHeight;
    off.getContext('2d')?.drawImage(video, 0, 0);
    setPhase({ kind, frozen: off });
  }, []);

  /** (Re)commencer l'étape carte, compteurs à zéro. */
  const enterGuide = useCallback(() => {
    guideStep.current.reset();
    live.current.lastGuideFill = -1;
    setPhase({ kind: 'mesure-carte', fill: 0 });
  }, []);

  /** Repartir à zéro : la calibration mémorisée est jetée, l'étape carte reprend. */
  const restart = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    live.current.cal = null;
    live.current.irisSamples = null;
    setCal(null);
    setNotices([]);
    if (props.mode === 'store') freeze('mesure-monture');
    else enterGuide();
  }, [enterGuide, freeze, props.mode]);

  const v1 = useV1Calibration({
    live,
    videoRef,
    onCalibrated: (next, notes) => {
      setNotices(notes);
      persist(next);
    },
    onFailed: (message) => {
      setNotices([message]);
      enterGuide();
    },
    onRotationStart: () =>
      setPhase({ kind: 'mesure-rotation', ratio: 0, degrees: { left: 0, right: 0 } }),
    cameraProfile: cameraProfile.current,
    onCameraProfile: persistCamera,
  });
  const finishCalibration = v1.finish;

  const renderFrame = useCallback(
    (ctx: CanvasRenderingContext2D, lm: readonly NormalizedLandmark[], yawRad: number): void => {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const s = live.current;
      s.lastLandmarks = lm;

      // ⭐ Étape carte LIVE : mesure prise à l'image exacte du remplissage.
      if (phaseRef.current === 'mesure-carte') {
        runCardStep(guideStep.current, ctx, lm, videoRef.current, {
          locked: v1.onCardValidated,
          stalled: (frozen) => setPhase({ kind: 'mesure-carte-manuelle', frozen }),
          fill: (ratio) => {
            // Comme à la rotation : pas un rendu React par image.
            if (Math.abs(ratio - s.lastGuideFill) <= 0.02) return;
            s.lastGuideFill = ratio;
            setPhase({ kind: 'mesure-carte', fill: ratio });
          },
        });
        return;
      }

      const rot = stepRotation(s, lm, yawRad, w, h);
      if (rot !== null) {
        setPhase({ kind: 'mesure-rotation', ratio: rot.ratio, degrees: rot.degrees });
        if (rot.complete) finishCalibration();
      }

      const warn = stepCrossCheck(s, lm, w, h);
      if (warn !== null) setNotices((prev) => [...prev, warn]);

      paintScene(ctx, s, lm, yawRad, videoRef.current);

      drawOverlay(ctx, { verdict: s.verdict, consecutiveFailures: 0, hint: s.recolorReason });
    },
    [finishCalibration, v1],
  );

  const renderLost = useCallback((ctx: CanvasRenderingContext2D, n: number): void => {
    live.current.verdict = null;
    paintLost(ctx, n);
  }, []);

  useCameraLoop(videoRef, canvasRef, {
    onFrame: renderFrame,
    onLost: renderLost,
    onProgress: (ratio) => setPhase({ kind: 'loading', ratio }),
    onReady: () => {
      if (live.current.cal !== null) setPhase({ kind: 'essayage' });
      else if (props.mode === 'store') freeze('mesure-monture');
      else enterGuide();
    },
    onError: (message) => setPhase({ kind: 'error', message }),
  });

  /** V2 — la monture physiquement portée sert d'étalon (§11.3). */
  const onWornFrameValidated = useCallback(
    (widthPx: number, worn: FrameSpec) => {
      const canvas = canvasRef.current;
      if (canvas === null) return;
      try {
        const out = wornFrameCalibration(widthPx, worn, live.current.lastLandmarks, canvas.width, canvas.height);
        persist(out.cal);
        setWornSpec(worn);
        setNotices(out.notices);
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
        onManual={() => {
          const shot = snapshotVideo(videoRef.current, canvasRef.current);
          if (shot !== null) setPhase({ kind: 'mesure-carte-manuelle', frozen: shot });
        }}
        onRetryGuide={enterGuide}
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
          <button type="button" onClick={restart}>
            Refaire la calibration
          </button>
        </p>
      )}
    </main>
  );
}
