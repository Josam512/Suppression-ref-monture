/**
 * ui/TryOn.tsx — l'essayage live, commun aux deux versions.
 *
 * ⚠️ AUCUN slider de taille (§4) ; aucun tri ni recommandation (§0.0.1). La
 * boucle se monte UNE fois et lit un `live` mutable (compteurs, garde S5) —
 * son branchement vit dans `ui/useTryOnLoop.ts` (enveloppes séparées, §17 du
 * guide de fiabilisation).
 *
 * Parcours : caméra → quelques secondes de regard → « calibration acquise » →
 * essayage (`core/autoCalibration.ts`, WHY_NOT_DONE à tout instant). La carte
 * ISO reste disponible en mode diagnostic (arbitrage 2026-08-18).
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import type { UserCalibration } from '../core/calibration.js';
import type { FrameSpec } from '../core/frameSpec.js';
import { OVERLAY_PADDING_MM } from '../render/composite.js';
import { CalibrationPanel, type Phase } from './CalibrationPanel.js';
import { wornFrameHandlerOf } from './wornFrameStep.js';
import { useAutoCalibration } from './useAutoCalibration.js';
import { FramePicker } from './FramePicker.js';
import { createLive, type Live } from './liveState.js';
import { useCatalogue } from './catalogue.js';
import { useV1Calibration } from './useV1Calibration.js';
import { identityCompatible, type CameraIdentity, type CameraProfile } from '../core/cameraProfile.js';
import { loadCameraProfile, saveCameraProfile } from './cameraStorage.js';
import { clearCalibration, loadCalibration, saveCalibration } from './calibrationStorage.js';
import { freezeFrame } from './freezeFrame.js';
import { MeasuresPanel } from './MeasuresPanel.js';
import { emptyMeasurements, type MeasurementSnapshot } from './measurementStore.js';
import { TryOnHeader } from './TryOnHeader.js';
import { useTryOnLoop } from './useTryOnLoop.js';
import { useSprites } from './useSprites.js';

export type Mode = 'online' | 'store';

export function TryOn(props: { mode: Mode; onQuit(): void }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const catalogue = useCatalogue();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', ratio: 0 });
  const [cal, setCal] = useState<UserCalibration | null>(loadCalibration);
  const cameraProfile = useRef<CameraProfile | null>(loadCameraProfile());

  /** Identité de l'objectif réellement ouvert — sert à étiqueter le profil. */
  const cameraIdentity = useRef<CameraIdentity>({});

  const persistCamera = useCallback((next: CameraProfile) => {
    // ⭐ Points 39–40 — le profil part avec l'identité de SON objectif.
    const stamped = { ...next, ...cameraIdentity.current };
    cameraProfile.current = stamped;
    live.current.cameraProfile = stamped;
    saveCameraProfile(stamped);
  }, []);
  const [notices, setNotices] = useState<string[]>([]);
  const pushNotice = useCallback(
    (message: string) => setNotices((prev) => (prev.includes(message) ? prev : [...prev, message])),
    [],
  );

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
  live.current.cameraProfile = cameraProfile.current;
  live.current.wornSprite = wornSprites.front.status === 'ready' ? wornSprites.front.sprite : null;

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
  /** ⭐ Points 27/72 — l'état PAR MÉTRIQUE, affiché en permanence. */
  const [metrics, setMetrics] = useState<MeasurementSnapshot>(emptyMeasurements());

  const { startAuto, startMissing, pump } = useAutoCalibration({
    live,
    videoRef,
    canvasRef,
    cameraProfile,
    setPhase,
    onMetrics: setMetrics,
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

  const { retryCamera } = useTryOnLoop({
    live,
    videoRef,
    canvasRef,
    phaseRef,
    pump,
    setPhase,
    pushNotice,
    onCameraIdentity: (identity) => {
      cameraIdentity.current = identity;
      // 🔴 Complément 23 — un profil mémorisé pour un AUTRE objectif est écarté
      // pour la session : mieux vaut le champ supposé qu'une focale d'un autre
      // capteur. Le stockage, lui, n'est pas touché.
      const stored = cameraProfile.current;
      if (stored !== null && !identityCompatible(stored, identity)) {
        cameraProfile.current = null;
        live.current.cameraProfile = null;
        pushNotice(
          `Le profil d'objectif mémorisé vient d'une autre caméra — il est ignoré pour cette séance.`,
        );
      }
    },
    onReadyAction: () => {
      if (live.current.cal !== null) {
        // ⭐ Point 28 — tests de CAPACITÉS : le rendu part tout de suite, et ce
        // qui MANQUE à cette calibration (PD, temporal) se collecte en fond.
        setPhase({ kind: 'essayage' });
        startMissing();
      } else if (props.mode === 'store') freeze('mesure-monture');
      else startAuto();
    },
    onFatalError: (message) => setPhase({ kind: 'error', message }),
  });

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
        onRetryCamera={retryCamera}
      />

      <MeasuresPanel metrics={metrics} cal={cal} />

      {notices.map((n) => (
        <p key={n}>{n}</p>
      ))}

      {catalogue.status === 'error' && <p style={{ color: '#ff6b6b' }}>{catalogue.message}</p>}
      {catalogue.status === 'ready' &&
        catalogue.failures.map((f) => (
          <p key={f} style={{ color: '#e0b34c' }}>
            {f}
          </p>
        ))}
      {sprites.front.status === 'error' && <p style={{ color: '#ff6b6b' }}>{sprites.front.message}</p>}
      {sprites.profile.status === 'error' && (
        <p style={{ color: '#e0b34c' }}>
          Sprite de profil indisponible ({sprites.profile.message}) — la face reste affichée, les
          branches attendront.
        </p>
      )}

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
