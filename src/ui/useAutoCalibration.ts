/**
 * ui/useAutoCalibration.ts — la calibration automatique, côté IHM.
 *
 * Extrait de `TryOn.tsx` pour tenir la règle des 300 lignes (§3), et parce que
 * c'est ici que vit la réponse au symptôme n°1 de l'audit : le moteur conclut,
 * la collecte S'ARRÊTE (`live.auto = null`), et le succès est ANNONCÉ en clair.
 * La caméra, elle, ne change pas d'état : l'essayage continue dessus.
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

/**
 * ⭐ Fenêtres de capture pour l'écart temporal (§14.2, sans carte) :
 * une image FRONTALE figée (yaw quasi nul, mêmes pixels que ses repères), et
 * une vue tournée de chaque côté pour le masque de mouvement — la seule chose
 * qui distingue un bord de tête d'un montant de porte. Une capture par fenêtre,
 * pas par frame : trois `getImageData` au TOTAL pour toute la séance.
 */
export const AUTO_FRONTAL_MAX_YAW_RAD = 0.06;
export const AUTO_SIDE_MIN_YAW_RAD = 0.17;
export const AUTO_SIDE_MAX_YAW_RAD = 0.61;

/** Refus d'ASSEMBLAGE tolérés avant d'arrêter de ré-armer (audit, point 1). */
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
  /** (Re)lance la mesure : nouveau moteur, compteurs à zéro. */
  startAuto(): void;
  /**
   * À appeler à CHAQUE frame de la boucle (`lm` null si détection perdue).
   * Publie l'état quand il change, assemble et annonce quand le moteur conclut.
   */
  pump(lm: readonly NormalizedLandmark[] | null, yawRad: number, w: number, h: number): void;
}

export function useAutoCalibration(deps: AutoCalibrationDeps): AutoCalibration {
  const { live, videoRef, canvasRef, cameraProfile, onCalibrated, setPhase } = deps;

  /** Canvas de lecture réutilisé — même règle mémoire que `useV1Calibration`. */
  const off = useRef<HTMLCanvasElement | null>(null);
  const frontal = useRef<{ buf: ImageBuffer; lm: NormalizedLandmark[]; w: number; h: number } | null>(null);
  const sides = useRef<{ neg: ImageBuffer | null; pos: ImageBuffer | null }>({ neg: null, pos: null });

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

  /** Combien de fois l'ASSEMBLAGE a refusé. Borne le ré-armement (audit 1). */
  const assemblyFailures = useRef(0);

  const startAuto = useCallback((): void => {
    assemblyFailures.current = 0;
    live.current.probe = null;
    live.current.pendingCard = null;
    live.current.auto = new AutoCalibrationEngine();
    live.current.lastAutoKey = '';
    frontal.current = null;
    sides.current = { neg: null, pos: null };
    setPhase({ kind: 'mesure-auto', status: live.current.auto.status() });
  }, [live, setPhase]);

  /**
   * Le moteur a conclu : on assemble UNE fois.
   *
   * 🔴 Audit humain du 2026-08-21, point 1 : `auto = null` était posé AVANT
   * `calibrateAuto()`. Quand l'assemblage levait (grandeur hors plage
   * anatomique), l'IHM affichait un statut « collecting » alors qu'il
   * n'existait plus AUCUN moteur — la collecte ne repartait jamais. Le verrou
   * ne se pose donc plus qu'au succès ; à l'échec on remonte explicitement un
   * moteur neuf, parce que garder l'ancien reviendrait au même : il est déjà
   * `calibrated`, donc `offer()` en sort immédiatement.
   */
  const finishAuto = useCallback((): void => {
    const m = live.current.auto?.measures() ?? null;
    if (m === null) {
      live.current.auto = null;
      return;
    }

    // ⚠️ Silhouette tentée SEULEMENT avec frontale + au moins une vue tournée :
    // sans mouvement, un montant de porte passerait pour un bord de tête.
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
      live.current.auto = null; // ⭐ le verrou, au SUCCÈS seulement.
      assemblyFailures.current = 0;
      onCalibrated(out.cal, [
        `✅ Calibration acquise — c'est terminé (${m.usableFrames} images utiles). ` +
          `La collecte s'est arrêtée ; la caméra continue pour l'essayage.`,
        ...out.notes,
      ]);
    } catch (err) {
      // Grandeur hors plage anatomique. Recommencer est la seule réparation —
      // encore faut-il qu'il reste quelque chose pour recommencer.
      assemblyFailures.current++;
      if (assemblyFailures.current <= MAX_ASSEMBLY_RETRIES) {
        live.current.auto = new AutoCalibrationEngine();
        frontal.current = null;
        sides.current = { neg: null, pos: null };
      } else {
        // Retry CONTRÔLÉ : après trois refus d'affilée, ce n'est plus du bruit.
        // On cesse de boucler, l'écran dit pourquoi et propose ses deux sorties
        // — et l'essayage, lui, continue de s'afficher en aperçu.
        live.current.auto = null;
      }
      setPhase({
        kind: 'mesure-auto',
        status: failedStatusOf(err, assemblyFailures.current),
      });
    }
  }, [live, canvasRef, cameraProfile, onCalibrated, setPhase]);

  const pump = useCallback(
    (lm: readonly NormalizedLandmark[] | null, yawRad: number, w: number, h: number): void => {
      // — Capture opportuniste pour l'écart temporal, AVANT que le moteur ne
      //   conclue. Les repères sont COPIÉS avec l'image : mêmes pixels, mêmes
      //   landmarks (la leçon de `ui/freezeFrame.ts`).
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
      if (status.state === 'calibrated') finishAuto();
      else setPhase({ kind: 'mesure-auto', status });
    },
    [live, grab, finishAuto, setPhase],
  );

  return { startAuto, pump };
}

/**
 * L'ASSEMBLAGE a refusé (grandeur hors plage anatomique). C'est le SEUL refus
 * qui subsiste, et il se répare en recommençant. On le publie comme une
 * tentative ratée — pas comme un état terminal : depuis l'audit du 2026-08-21,
 * il n'existe plus d'état qui condamne la séance.
 */
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
