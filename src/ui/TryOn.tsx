/**
 * ui/TryOn.tsx — l'essayage live, commun aux deux versions.
 *
 * ⚠️ AUCUN slider de taille (§4) ; aucun tri ni recommandation (§0.0.1). La
 * boucle se monte UNE fois et lit un `live` mutable (compteurs, garde S5).
 *
 * Parcours : caméra → quelques secondes de regard → « calibration acquise » →
 * essayage (`core/autoCalibration.ts`, WHY_NOT_DONE à tout instant). La carte
 * ISO reste disponible en mode diagnostic (arbitrage 2026-08-18).
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import type { UserCalibration } from '../core/calibration.js';
import type { FrameSpec } from '../core/frameSpec.js';
import { type NormalizedLandmark } from '../core/geom.js';
import { OVERLAY_PADDING_MM } from '../render/composite.js';
import { CalibrationPanel, type Phase } from './CalibrationPanel.js';
import { wornFrameHandlerOf } from './wornFrameStep.js';
import { stepCrossCheck, stepRotation } from './liveSteps.js';
import { useAutoCalibration } from './useAutoCalibration.js';
import { FramePicker } from './FramePicker.js';
import { createLive, type Live } from './liveState.js';
import { paintLost, paintScene } from './renderScene.js';
import { drawOverlay } from '../render/overlay.js';
import { useCatalogue } from './catalogue.js';
import { useV1Calibration } from './useV1Calibration.js';
import type { CameraProfile } from '../core/cameraProfile.js';
import { loadCameraProfile, saveCameraProfile } from './cameraStorage.js';
import { clearCalibration, loadCalibration, saveCalibration } from './calibrationStorage.js';
import { freezeFrame } from './freezeFrame.js';
import { TryOnHeader } from './TryOnHeader.js';
import { useCameraLoop } from './useCameraLoop.js';
import { useSprites } from './useSprites.js';

export type Mode = 'online' | 'store';

/** Micro-perte repeinte (rendu SEUL) — alignée sur la règle 3 (> 5 = perdu). */
export const RENDER_HOLD_FRAMES = 5;

export function TryOn(props: { mode: Mode; onQuit(): void }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const catalogue = useCatalogue();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', ratio: 0 });
  const [cal, setCal] = useState<UserCalibration | null>(loadCalibration);
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

  // ⚠️ La phase, lue DEPUIS LA BOUCLE : une closure capturerait une valeur
  // périmée (stale closure) — seule une ref est une lecture juste ici.
  const phaseRef = useRef<Phase['kind']>('loading');
  phaseRef.current = phase.kind;

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
    saveCalibration(next);
    setPhase({ kind: 'essayage' });
  }, []);

  /** Gèle l'image ET ses repères d'un seul geste (`ui/freezeFrame.ts`) :
   *  la chaîne aval mesure sur les MÊMES pixels que l'étalon (§0.0.2). */
  const freeze = useCallback((kind: 'mesure-monture') => {
    const shot = freezeFrame(videoRef.current, live.current.lastLandmarks);
    if (shot === null) {
      setNotices(['Je ne vous vois pas encore — replacez-vous face à la caméra et réessayez.']);
      return;
    }
    live.current.probe = null;
    setPhase({ kind, frozen: shot.frozen, lm: shot.lm });
  }, []);

  /** Mode diagnostic : la consigne carte. Aucune mesure ne tourne à ce stade. */
  const enterCard = useCallback(() => {
    Object.assign(live.current, { probe: null, pendingCard: null, auto: null });
    setPhase({ kind: 'mesure-carte' });
  }, []);

  /**
   * ⭐ V2 — la calibration automatique (`ui/useAutoCalibration.ts`) : le moteur
   * décide seul de sa fin, l'annonce, et la collecte s'arrête — pas la caméra.
   */
  const { startAuto, pump } = useAutoCalibration({
    live,
    videoRef,
    canvasRef,
    cameraProfile,
    setPhase,
    onCalibrated: (next, notes) => {
      setNotices(notes);
      persist(next);
    },
  });

  /** Repartir à zéro : la calibration mémorisée est jetée, la mesure reprend. */
  const restart = useCallback(() => {
    clearCalibration();
    live.current.cal = null;
    live.current.irisSamples = null;
    setCal(null);
    setNotices([]);
    if (props.mode === 'store') freeze('mesure-monture');
    else startAuto();
  }, [startAuto, freeze, props.mode]);

  const v1 = useV1Calibration({
    live,
    videoRef,
    onCalibrated: (next, notes) => {
      setNotices(notes);
      persist(next);
    },
    onFailed: (message) => {
      setNotices([message]);
      enterCard();
    },
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
      s.lastYawRad = yawRad;

      // ⭐ V2 — la mesure automatique. Publiée seulement quand son état change ;
      // le moteur décide seul de sa fin, et sa fin est annoncée.
      pump(lm, yawRad, w, h);

      // Étape carte (diagnostic) : rien ne mesure, la vidéo passe sous un
      // canvas vide — le client lit la consigne et appuie quand il veut.
      if (phaseRef.current === 'mesure-carte') {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        return;
      }

      // 🔴 Compte rendu de la séance filmée : seul « J'ai fini » déclenche le calcul.
      const rot = stepRotation(s, lm, yawRad, w, h);
      if (rot !== null) {
        setPhase({ kind: 'mesure-rotation', degrees: rot.degrees, cardViews: rot.cardViews });
      }

      const warn = stepCrossCheck(s, lm, w, h);
      if (warn !== null) setNotices((prev) => [...prev, warn]);

      paintScene(ctx, s, lm, yawRad, videoRef.current);

      drawOverlay(ctx, { verdict: s.verdict, consecutiveFailures: 0, hint: s.recolorReason });
    },
    [finishCalibration, pump, v1],
  );

  const renderLost = useCallback(
    (ctx: CanvasRenderingContext2D, n: number, cause: 'invalid-input' | 'no-face', reason: string | null): void => {
      // La perte nourrit le moteur automatique (« je ne vous vois pas »),
      // JAMAIS le maintien de rendu ci-dessous, qui ne mesure rien : une
      // micro-perte (≤ 5 frames) repeint la dernière pose connue au lieu de
      // faire clignoter la monture ; au-delà, l'alarme brute (§1 bug #3).
      pump(null, 0, ctx.canvas.width, ctx.canvas.height);
      const s = live.current;
      if (cause === 'no-face' && n <= RENDER_HOLD_FRAMES && s.lastLandmarks !== null && phaseRef.current === 'essayage') {
        paintScene(ctx, s, s.lastLandmarks, s.lastYawRad, videoRef.current);
        return;
      }
      s.verdict = null;
      paintLost(ctx, n, cause, reason);
    },
    [pump],
  );

  /** Après une erreur caméra/modèle, tout se remonte : plus de cul-de-sac (audit E1). */
  const [attempt, setAttempt] = useState(0);

  useCameraLoop(
    videoRef,
    canvasRef,
    {
      onFrame: renderFrame,
      onLost: renderLost,
      onProgress: (ratio) => setPhase({ kind: 'loading', ratio }),
      onReady: () => {
        if (live.current.cal !== null) setPhase({ kind: 'essayage' });
        else if (props.mode === 'store') freeze('mesure-monture');
        else startAuto();
      },
      onError: (message) => setPhase({ kind: 'error', message }),
    },
    attempt,
  );

  /** V2 — la monture physiquement portée sert d'étalon (§11.3). */
  const onWornFrameValidated = useMemo(
    () =>
      wornFrameHandlerOf({
        canvasWidth: () => canvasRef.current?.width ?? null,
        canvasHeight: () => canvasRef.current?.height ?? null,
        onDone: (out, worn) => {
          persist(out.cal);
          setWornSpec(worn);
          setNotices(out.notices);
        },
        onError: (message) => setNotices([message]),
      }),
    [persist],
  );

  return (
    <main style={{ maxWidth: 900, margin: '0 auto' }}>
      <TryOnHeader mode={props.mode} onQuit={props.onQuit} />

      <div className="stage">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
      </div>

      <CalibrationPanel
        phase={phase}
        catalogue={essayables}
        onCancel={props.onQuit}
        onCardReady={() => {
          v1.start();
          setPhase({ kind: 'mesure-rotation', degrees: { left: 0, right: 0 }, cardViews: 0 });
        }}
        onFinishSweep={finishCalibration}
        onWornFrameValidated={onWornFrameValidated}
        onRetryAuto={startAuto}
        onUseCard={enterCard}
        onRetryCamera={() => {
          setPhase({ kind: 'loading', ratio: 0 });
          setAttempt((a) => a + 1);
        }}
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
