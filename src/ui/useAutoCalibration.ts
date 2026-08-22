/**
 * ui/useAutoCalibration.ts — la calibration automatique, côté IHM.
 *
 * Refonte du guide de fiabilisation (2026-08-21, points 18–28, 35, 68–69) :
 *
 *   - l'assemblage est SCINDÉ : le PD et l'échelle de visage réussissent ou
 *     échouent CHACUN POUR SOI (codes typés, complément 3). Un PD validé
 *     SURVIT à un échec de largeur (point 20, prolongé par pdCarry — A11) ;
 *   - une calibration publiée sans PD, ou sans demi-PD, ne ferme pas la
 *     porte : la collecte REPART en arrière-plan, l'essayage affiché (pt 28) ;
 *   - l'écart temporal manquant se raffine aussi en arrière-plan, et ne touche
 *     JAMAIS que ses deux champs (points 35 et 46) ; après trop de refus,
 *     l'état publié est `unavailable` — plus jamais un faux `collecting` sans
 *     moteur (68–69). Le rendu, lui, continue.
 */

import { useCallback, useRef, type MutableRefObject, type RefObject } from 'react';

import { AutoCalibrationEngine } from '../core/autoCalibration.js';
import {
  assembleDistanceMm,
  assembleFaceScale,
  assemblePd,
  assembleTemporal,
  distanceNotes,
  focalChoiceFor,
  pdFieldsOf,
} from '../core/autoCalibrate.js';
import type { UserCalibration } from '../core/calibration.js';
import type { CameraProfile } from '../core/cameraProfile.js';
import type { NormalizedLandmark } from '../core/geom.js';
import type { ImageBuffer } from '../core/silhouette.js';
import type { Phase } from './CalibrationPanel.js';
import { stepAutoCalibration } from './liveSteps.js';
import type { Live } from './liveState.js';
import {
  emptyMeasurements,
  failureOf,
  snapshotOf,
  unavailableStatus,
  type MeasurementSnapshot,
} from './measurementStore.js';
import { carriedPdFields, missingPdCapacities } from './pdCarry.js';
import { TemporalCapture, temporalFrameScaleOf } from './temporalCapture.js';

/** Refus d'ASSEMBLAGE tolérés avant de cesser de ré-armer (point 69). */
export const MAX_ASSEMBLY_RETRIES = 3;
/** Entre deux tentatives de raffinement temporal d'arrière-plan. */
export const BACKGROUND_TEMPORAL_RETRY_MS = 10_000;

export interface AutoCalibrationDeps {
  live: MutableRefObject<Live>;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cameraProfile: MutableRefObject<CameraProfile | null>;
  onCalibrated(cal: UserCalibration, notes: string[]): void;
  /** Publication du store de mesures — le panneau permanent lit ça (point 27). */
  onMetrics(snapshot: MeasurementSnapshot): void;
  setPhase(phase: Phase): void;
}

export interface AutoCalibration {
  /** (Re)lance la mesure : nouveau moteur, compteurs à zéro, store remis à plat. */
  startAuto(): void;
  /** ⭐ Points 28/A11 — tests de CAPACITÉS : toute pièce manquante (PD total,
   *  demi-PD, temporal) relance SA collecte en arrière-plan, essayage affiché. */
  startMissing(): void;
  /** À appeler à CHAQUE frame de la boucle (`lm` null si détection perdue). */
  pump(lm: readonly NormalizedLandmark[] | null, yawRad: number, w: number, h: number): void;
}

export function useAutoCalibration(deps: AutoCalibrationDeps): AutoCalibration {
  const { live, videoRef, canvasRef, cameraProfile, onCalibrated, onMetrics, setPhase } = deps;

  /** Canvas de lecture réutilisé — même règle mémoire que `useV1Calibration`. */
  const off = useRef<HTMLCanvasElement | null>(null);
  const captures = useRef(new TemporalCapture());
  const metrics = useRef<MeasurementSnapshot>(emptyMeasurements());
  const assemblyFailures = useRef(0);
  const lastBgTemporalMs = useRef(0);

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

  const publishMetrics = useCallback((): void => onMetrics(snapshotOf(metrics.current)), [onMetrics]);

  const rearmEngine = useCallback((): void => {
    live.current.auto = new AutoCalibrationEngine();
    live.current.lastAutoKey = '';
    captures.current.reset(live.current.auto.generation);
  }, [live]);

  const startAuto = useCallback((): void => {
    assemblyFailures.current = 0;
    live.current.probe = null;
    live.current.pendingCard = null;
    metrics.current = emptyMeasurements();
    metrics.current.pd.phase = 'collecting';
    metrics.current.faceScale.phase = 'collecting';
    metrics.current.temporal.phase = 'collecting';
    rearmEngine();
    publishMetrics();
    setPhase({ kind: 'mesure-auto', status: live.current.auto!.status() });
  }, [live, rearmEngine, publishMetrics, setPhase]);

  const startMissing = useCallback((): void => {
    const cal = live.current.cal;
    if (cal === null) {
      startAuto();
      return;
    }
    // ⭐ A11 — capacités séparées : total sans demi-PD ⇒ collecte de face
    // stricte en arrière-plan ; le total persisté survit (pdCarry).
    const { hasPdTotal, hasHalfPd } = missingPdCapacities(cal);
    if (!hasPdTotal || !hasHalfPd) {
      metrics.current.pd = { ...metrics.current.pd, phase: 'collecting' };
      rearmEngine(); // l'essayage reste affiché : la collecte est d'arrière-plan
    }
    if (cal.temporalWidthMm === undefined) {
      metrics.current.temporal = { ...metrics.current.temporal, phase: 'collecting' };
    }
    publishMetrics();
  }, [live, startAuto, rearmEngine, publishMetrics]);

  /** Le moteur a conclu : assemblages SÉPARÉS, survie par métrique (pts 20–26). */
  const finishAuto = useCallback((): void => {
    const s = live.current;
    const m = s.auto?.measures() ?? null;
    if (m === null) {
      s.auto = null;
      return;
    }
    const st = metrics.current;
    const notes: string[] = [];
    const focal = focalChoiceFor(canvasRef.current?.width ?? 1280, cameraProfile.current, Date.now());

    let distanceMm: number | null = null;
    try {
      distanceMm = assembleDistanceMm(m, focal);
      notes.push(...distanceNotes(focal, distanceMm));
    } catch (err) {
      const f = failureOf(err);
      if (st.pd.phase !== 'ready') st.pd = { ...st.pd, phase: 'retrying', failure: f };
      if (st.faceScale.phase !== 'ready') st.faceScale = { ...st.faceScale, phase: 'retrying', failure: f };
    }

    if (distanceMm !== null) {
      try {
        const pd = assemblePd(m, focal, distanceMm);
        st.pd = { phase: 'ready', value: pd, failure: null, generation: m.generation };
        notes.push(...pd.notes);
      } catch (err) {
        // ⭐ Point 20 — un PD DÉJÀ publié n'est jamais jeté par un nouvel échec.
        if (st.pd.phase !== 'ready') st.pd = { ...st.pd, phase: 'retrying', failure: failureOf(err) };
        else notes.push(`Nouvelle mesure du PD écartée (${failureOf(err).label}) — la précédente reste valable.`);
      }
      try {
        const face = assembleFaceScale(m, focal, distanceMm);
        st.faceScale = { phase: 'ready', value: face, failure: null, generation: m.generation };
        notes.push(...face.notes);
      } catch (err) {
        if (st.faceScale.phase !== 'ready') {
          st.faceScale = { ...st.faceScale, phase: 'retrying', failure: failureOf(err) };
        }
      }
    }

    const face = st.faceScale.generation === m.generation ? st.faceScale.value : null;
    if (face !== null && st.faceScale.phase === 'ready') {
      // — Écart temporal : la scène doit venir de la MÊME génération (c21) et
      // elle PORTE l'échelle de SA frontale (A7) — plus jamais la médiane.
      let temporalFields: Pick<UserCalibration, 'temporalWidthMm' | 'temporalRelError'> = {};
      const scene = captures.current.generation === m.generation ? captures.current.scene() : null;
      if (scene !== null) {
        const t = assembleTemporal(scene, face.relError);
        temporalFields = t.fields;
        notes.push(t.note);
      } else {
        notes.push(
          `Écart temporal non mesuré : montrez brièvement vos deux profils ` +
            `pour qu'il le soit — la mesure continuera en arrière-plan pendant l'essayage.`,
        );
      }
      if (temporalFields.temporalWidthMm !== undefined && temporalFields.temporalRelError !== undefined) {
        st.temporal = {
          phase: 'ready',
          value: { widthMm: temporalFields.temporalWidthMm, relError: temporalFields.temporalRelError },
          failure: null,
          generation: m.generation,
        };
      }

      const pd = st.pd.phase === 'ready' ? st.pd.value : null; // possiblement d'une génération antérieure (pt 20)
      const cal: UserCalibration = {
        faceWidthMm: face.faceWidthMm,
        source: 'auto',
        relError: face.relError,
        measuredAt: Date.now(),
        distanceMm: face.distanceMm,
        // ⭐ A11 — rien de frais ? Le PD PERSISTANT est reporté, jamais jeté
        // (point 20 par-delà les rechargements). Une mesure fraîche remplace.
        ...(pd !== null ? pdFieldsOf(pd) : carriedPdFields(s.cal)),
        ...temporalFields,
      };
      s.auto = null;
      assemblyFailures.current = 0;
      onCalibrated(cal, [
        `✅ Calibration acquise — c'est terminé (${m.usableFrames} images utiles). ` +
          `La collecte s'est arrêtée ; la caméra continue pour l'essayage.`,
        ...notes,
      ]);
      // ⭐ Point 28 — un PD manquant continue de se mesurer PENDANT l'essayage.
      if (pd === null) {
        st.pd = { ...st.pd, phase: 'collecting' };
        rearmEngine();
      }
      publishMetrics();
      return;
    }

    // — La largeur a refusé : tentative suivante ou arrêt honnête (68–69).
    assemblyFailures.current++;
    if (assemblyFailures.current <= MAX_ASSEMBLY_RETRIES) {
      rearmEngine();
      if (s.cal === null) setPhase({ kind: 'mesure-auto', status: s.auto!.status() });
    } else {
      s.auto = null;
      st.faceScale = { ...st.faceScale, phase: 'unavailable' };
      if (st.pd.phase === 'collecting' || st.pd.phase === 'retrying') {
        st.pd = { ...st.pd, phase: st.pd.value !== null ? 'ready' : 'unavailable' };
      }
      if (s.cal === null) {
        setPhase({
          kind: 'mesure-auto',
          status: unavailableStatus(st.faceScale.failure, assemblyFailures.current),
        });
      }
    }
    publishMetrics();
  }, [live, canvasRef, cameraProfile, onCalibrated, publishMetrics, rearmEngine, setPhase]);

  const pump = useCallback(
    (lm: readonly NormalizedLandmark[] | null, yawRad: number, w: number, h: number): void => {
      const s = live.current;
      // — Captures pour l'écart temporal, étiquetées par génération (c20–21).
      // ⭐ A7 — l'échelle de LA frame est mesurée AU MOMENT de la capture, y
      // compris pendant la calibration initiale (échelle de pose, même optique).
      if (s.auto !== null && lm !== null) {
        const frameScale = temporalFrameScaleOf(lm, w, h, s.cal, yawRad, cameraProfile.current, Date.now());
        captures.current.offer(lm, yawRad, w, h, s.auto.generation, grab, frameScale);
      }

      // ⭐ Pt 35 — raffinement d'ARRIÈRE-PLAN : ne touche QUE temporal*.
      if (s.auto === null && s.cal !== null && s.cal.temporalWidthMm === undefined && lm !== null) {
        const frameScale = temporalFrameScaleOf(lm, w, h, s.cal, yawRad, cameraProfile.current, Date.now());
        captures.current.offer(lm, yawRad, w, h, -1, grab, frameScale);
        const scene = captures.current.scene(); // porte l'échelle de SA frontale (A7)
        const now = Date.now();
        if (scene !== null && now - lastBgTemporalMs.current > BACKGROUND_TEMPORAL_RETRY_MS) {
          lastBgTemporalMs.current = now;
          const t = assembleTemporal(scene, s.cal.relError);
          if (t.fields.temporalWidthMm !== undefined && t.fields.temporalRelError !== undefined) {
            metrics.current.temporal = {
              phase: 'ready',
              value: { widthMm: t.fields.temporalWidthMm, relError: t.fields.temporalRelError },
              failure: null,
              generation: -1,
            };
            publishMetrics();
            onCalibrated({ ...s.cal, ...t.fields }, [t.note]);
          } else {
            captures.current.reset(-1); // matière suivante — sans spammer
          }
        }
      }

      const status = stepAutoCalibration(s, lm, yawRad, w, h, Date.now());
      if (status === null) return;
      if (status.state === 'calibrated') finishAuto();
      else if (s.cal === null) setPhase({ kind: 'mesure-auto', status });
    },
    [live, grab, finishAuto, publishMetrics, onCalibrated, setPhase],
  );

  return { startAuto, startMissing, pump };
}
