/**
 * ui/useAutoCalibration.ts — calibration automatique côté IHM.
 */

import { useCallback, useRef, type MutableRefObject, type RefObject } from 'react';

import { AutoCalibrationEngine } from '../core/autoCalibration.js';
import { calibrateAuto, type AutoTemporalScene } from '../core/autoCalibrate.js';
import type { UserCalibration } from '../core/calibration.js';
import type { CameraProfile } from '../core/cameraProfile.js';
import type { NormalizedLandmark } from '../core/geom.js';
import { motionMask, type ImageBuffer } from '../core/silhouette.js';
import type { Phase } from './CalibrationPanel.js';
import { stepAutoCalibration } from './liveSteps.js';
import type { Live } from './liveState.js';

export const AUTO_FRONTAL_MAX_YAW_RAD = 0.06;
export const AUTO_SIDE_MIN_YAW_RAD = 0.17;
export const AUTO_SIDE_MAX_YAW_RAD = 0.61;
export const MAX_ASSEMBLY_RETRIES = 3;

export interface AutoCalibrationDeps {
  live: MutableRefObject<Live>;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cameraProfile: MutableRefObject<CameraProfile | null>;
  onCalibrated(cal: UserCalibration, notes: string[]): void;
  setPhase(phase: Phase): void;
}

export interface AutoCalibration {
  startAuto(): void;
  pump(lm: readonly NormalizedLandmark[] | null, yawRad: number, w: number, h: number): void;
}

export function useAutoCalibration(deps: AutoCalibrationDeps): AutoCalibration {
  const { live, videoRef, canvasRef, cameraProfile, onCalibrated, setPhase } = deps;

  const off = useRef<HTMLCanvasElement | null>(null);
  const frontal = useRef<{ buf: ImageBuffer; lm: NormalizedLandmark[]; w: number; h: number } | null>(null);
  const sides = useRef<{ neg: ImageBuffer | null; pos: ImageBuffer | null }>({ neg: null, pos: null });
  const lastEngineAttempt = useRef(0);

  const resetTemporalCaptures = useCallback((): void => {
    frontal.current = null;
    sides.current = { neg: null, pos: null };
  }, []);

  const grab = useCallback((): ImageBuffer | null => {
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0) return null;
    off.current ??= document.createElement('canvas');
    const canvas = off.current;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return null;
    ctx.drawImage(video, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, [videoRef]);

  const assemblyFailures = useRef(0);

  const startAuto = useCallback((): void => {
    assemblyFailures.current = 0;
    lastEngineAttempt.current = 0;
    live.current.probe = null;
    live.current.pendingCard = null;
    live.current.auto = new AutoCalibrationEngine();
    live.current.lastAutoKey = '';
    resetTemporalCaptures();
    setPhase({ kind: 'mesure-auto', status: live.current.auto.status() });
  }, [live, resetTemporalCaptures, setPhase]);

  const finishAuto = useCallback((): void => {
    const m = live.current.auto?.measures() ?? null;
    if (m === null) {
      live.current.auto = null;
      return;
    }

    const f = frontal.current;
    const buffers = [sides.current.neg, sides.current.pos].filter((b): b is ImageBuffer => b !== null);
    const scene: AutoTemporalScene | null =
      f !== null && buffers.length > 0
        ? { frontal: f.buf, motion: motionMask(f.buf, buffers), lm: f.lm, w: f.w, h: f.h }
        : null;

    try {
      const out = calibrateAuto(
        m,
        canvasRef.current?.width ?? 1280,
        cameraProfile.current,
        Date.now(),
        scene,
      );
      live.current.auto = null;
      assemblyFailures.current = 0;
      onCalibrated(out.cal, [
        `✅ Calibration acquise — c'est terminé (${m.usableFrames} images utiles). ` +
          `La collecte s'est arrêtée ; la caméra continue pour l'essayage.`,
        ...out.notes,
      ]);
    } catch (err) {
      assemblyFailures.current++;
      if (assemblyFailures.current <= MAX_ASSEMBLY_RETRIES) {
        live.current.auto = new AutoCalibrationEngine();
        lastEngineAttempt.current = 0;
        resetTemporalCaptures();
      } else {
        live.current.auto = null;
      }
      setPhase({
        kind: 'mesure-auto',
        status: failedStatusOf(err, assemblyFailures.current),
      });
    }
  }, [live, canvasRef, cameraProfile, onCalibrated, resetTemporalCaptures, setPhase]);

  const pump = useCallback(
    (lm: readonly NormalizedLandmark[] | null, yawRad: number, w: number, h: number): void => {
      if (live.current.auto !== null && lm !== null) {
        const ay = Math.abs(yawRad);
        if (ay <= AUTO_FRONTAL_MAX_YAW_RAD && frontal.current === null) {
          const buf = grab();
          if (buf !== null) frontal.current = { buf, lm: lm.map((p) => ({ x: p.x, y: p.y })), w, h };
        } else if (ay >= AUTO_SIDE_MIN_YAW_RAD && ay <= AUTO_SIDE_MAX_YAW_RAD) {
          const key = yawRad < 0 ? 'neg' : 'pos';
          if (sides.current[key] === null) sides.current[key] = grab();
        }
      }

      const status = stepAutoCalibration(live.current, lm, yawRad, w, h, Date.now());
      if (status === null) return;

      // Audit prédictif 2026-08-21 : quand le moteur réarme une tentative, ses
      // mesures métriques repartent désormais sur une fenêtre fraîche. Les
      // captures de silhouette DOIVENT suivre la même frontière. Sinon une
      // frontale prise 20 s plus tôt à 40 cm pouvait être combinée à une échelle
      // fraîche prise à 60 cm, et produire un écart temporal faux tout en ayant
      // une calibration d'échelle correcte.
      if (status.attempts !== lastEngineAttempt.current) {
        lastEngineAttempt.current = status.attempts;
        resetTemporalCaptures();
      }

      if (status.state === 'calibrated') finishAuto();
      else setPhase({ kind: 'mesure-auto', status });
    },
    [live, grab, finishAuto, resetTemporalCaptures, setPhase],
  );

  return { startAuto, pump };
}

function failedStatusOf(
  err: unknown,
  attempts: number,
): import('../core/autoCalibration.js').AutoStatus {
  const base = err instanceof Error ? err.message : String(err);
  const label =
    attempts <= MAX_ASSEMBLY_RETRIES
      ? `${base} Je continue de mesurer.`
      : `${base} Après ${attempts} essais, je m'arrête là : reprenez la mesure, ou utilisez une carte.`;
  return {
    state: 'collecting',
    usableFrames: 0,
    neededFrames: 0,
    elapsedMs: 0,
    acquisitionMs: 0,
    whyNotDone: { code: 'eyes-too-small', label },
    rejected: { 'no-face': 0, 'eyes-too-small': 0, 'turn-to-front': 0, 'straighten-head': 0 },
    primaryRejectReason: null,
    scaleStandardError: 0,
    attempts,
    lastAttemptFailure: { code: 'eyes-too-small', label },
  };
}
