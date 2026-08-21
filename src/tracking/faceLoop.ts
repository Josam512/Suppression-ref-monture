/**
 * tracking/faceLoop.ts — l'orchestration des couches 1 à 4.
 *
 *   Couche 1-2  frameFeed.ts      → une frame caméra VALIDE, pixels normalisés
 *   Couche 3    faceProbe.ts      → « y a-t-il un visage ? » (second avis)
 *   Couche 4    landmarker.ts     → les 478 landmarks
 *   Décision    detectionPlan.ts  → échelle de stratégies, montées PROUVÉES
 *
 * L'échelle (GPU → CPU → entrée réduite → seuils abaissés) vient du cas prouvé
 * sur l'appareil réel : FaceDetector 0,91 / FaceLandmarker 0 sur la même
 * frame. Chaque montée est annoncée avec sa raison. La séparation stricte
 * demeure : « entrée invalide » ≠ « visage non trouvé » ≠ « pose inadaptée »
 * (cette dernière appartient aux couches de MESURE, jamais à la détection).
 *
 * Concurrence (§16) : une seule inférence à la fois — les rappels de snapshot
 * sont sériels et `detectForVideo` est synchrone ; pendant une montée de
 * stratégie (asynchrone), les frames sont ignorées, aucun compteur n'avance.
 */

import { createLandmarker, yawFromMatrix } from './landmarker.js';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { attachFrameFeed, type FrameSnapshot } from './frameFeed.js';
import { createFaceProbe, type FaceProbe, type FaceProbeResult } from './faceProbe.js';
import {
  currentStrategy,
  initialPlan,
  planStep,
  shouldProbe,
  unpadPoint,
  type DetectionPlan,
  type DetectionStrategy,
} from './detectionPlan.js';

export type LostCause = 'invalid-input' | 'no-face';

export interface FaceLoopHandlers {
  /** Couche 4 OK : landmarks bruts de CETTE frame (coordonnées normalisées). */
  onLandmarks(lm: ReadonlyArray<{ x: number; y: number; z?: number }>, yawRad: number): void;
  /**
   * Pas de landmarks sur cette frame. `cause` sépare (§11) « entrée caméra
   * cassée » (raison nommée) de « frame valide, visage non trouvé ».
   */
  onLost(consecutive: number, cause: LostCause, reason: string | null): void;
  /** Montée de stratégie, avec sa raison (§17). */
  onTransition?(reason: string): void;
  onProgress?(ratio: number): void;
  /** Erreur fatale (création de stratégie impossible…). */
  onError?(message: string): void;
}

export interface FaceLoopControl {
  stop(): void;
  plan(): Readonly<DetectionPlan>;
}

/** Ajoute la marge (letterbox) de la stratégie autour de la frame : le crop
 *  interne du landmarker (×1,5, mis au carré) cesse de déborder hors image sur
 *  un visage très proche — le mécanisme prouvé du « FaceDetector voit,
 *  FaceLandmarker rend 0 ». Les landmarks sont dé-mappés par `unpadPoint`. */
function inputFor(
  s: FrameSnapshot,
  strategy: DetectionStrategy,
  scratch: HTMLCanvasElement,
): HTMLCanvasElement {
  const pad = strategy.padFraction;
  if (pad === null) return s.source;
  const w = Math.round(s.w * (1 + 2 * pad));
  const h = Math.round(s.h * (1 + 2 * pad));
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const g = scratch.getContext('2d')!;
  g.fillStyle = '#7f7f7f'; // remplissage neutre, comme le letterbox interne de MediaPipe
  g.fillRect(0, 0, w, h);
  g.drawImage(s.source, Math.round(s.w * pad), Math.round(s.h * pad));
  return scratch;
}

/** Dé-mappe les landmarks du cadre AVEC marge vers le cadre d'origine. */
function unpadLandmarks(
  lm: ReadonlyArray<{ x: number; y: number; z?: number }>,
  pad: number,
): ReadonlyArray<{ x: number; y: number; z?: number }> {
  return lm.map((q) => ({ ...q, x: unpadPoint(q.x, pad), y: unpadPoint(q.y, pad) }));
}

export async function startFaceLoop(
  video: HTMLVideoElement,
  handlers: FaceLoopHandlers,
): Promise<FaceLoopControl> {
  const plan = initialPlan();
  let landmarker: FaceLandmarker | null = await createLandmarker(
    (r) => handlers.onProgress?.(r),
    currentStrategy(plan).delegate,
    currentStrategy(plan).minConfidence,
  );
  let probe: FaceProbe | null = null;
  let probeLoading = false;
  let swapping = false;
  let disposed = false;
  /** Dernière erreur de CRÉATION d'un modèle. Jamais avalée : affichée. */
  let modelError: string | null = null;
  /** Erreur de chargement de la SONDE. Idem — `.catch(() => {})` était un
   *  échec silencieux, très exactement ce que le §1 bug #3 interdit. */
  let probeError: string | null = null;
  let lostStreak = 0;
  let lastTs = -1;
  const scratch = document.createElement('canvas');

  const onSnapshot = (s: FrameSnapshot): void => {
    if (disposed) return;
    // 🔴 2026-08-21 — ce `return` muet figeait l'écran. Quand la création du
    // modèle suivant échouait, `swapping` restait vrai et `landmarker` nul
    // POUR TOUJOURS : plus aucun `onLost`, compteur gelé, séance morte, et
    // rien à l'écran pour le dire. Constaté sur l'appareil réel : figé à 130.
    if (swapping || landmarker === null) {
      lostStreak++;
      handlers.onLost(lostStreak, 'no-face', modelError ?? 'changement de stratégie en cours');
      if (landmarker === null && !swapping) ensureLandmarker();
      return;
    }

    if (!s.validity.valid) {
      lostStreak++;
      planStep(plan, { frameValid: false, landmarksFound: false, probeFound: null });
      handlers.onLost(lostStreak, 'invalid-input', s.validity.reason);
      return;
    }

    const ts = Math.max(performance.now(), lastTs + 1);
    lastTs = ts;

    let lm: ReadonlyArray<{ x: number; y: number; z?: number }> | undefined;
    let yaw = 0;
    const strategy = currentStrategy(plan);
    try {
      const res = landmarker.detectForVideo(inputFor(s, strategy, scratch), ts);
      lm = res.faceLandmarks[0];
      const mat = res.facialTransformationMatrixes[0];
      if (mat !== undefined) yaw = yawFromMatrix(mat.data); // rotation : insensible à la marge
    } catch (err) {
      console.error('Detection error:', err);
    }
    if (lm !== undefined && strategy.padFraction !== null) {
      lm = unpadLandmarks(lm, strategy.padFraction);
    }

    if (lm !== undefined && lm.length > 0) {
      lostStreak = 0;
      planStep(plan, { frameValid: true, landmarksFound: true, probeFound: null });
      handlers.onLandmarks(lm, yaw);
      return;
    }

    lostStreak++;
    // — Second avis, seulement quand la machine le demande (couche 3).
    let probeFound: boolean | null = null;
    if (shouldProbe(plan)) {
      if (probe !== null) probeFound = probe.probe(s.source, ts + 0.5).found;
      else if (!probeLoading) {
        probeLoading = true;
        void createFaceProbe('CPU')
          .then((p) => {
            if (disposed) p.close();
            else probe = p;
          })
          .catch((err: unknown) => {
            // 🔴 L'erreur était jetée à la poubelle : impossible de savoir
            // POURQUOI la sonde manquait. Elle est désormais retenue et
            // affichée — la machine, elle, monte quand même par élimination.
            probeError = err instanceof Error ? err.message.slice(0, 80) : String(err).slice(0, 80);
            probeLoading = false;
          });
      }
    }

    const t = planStep(plan, { frameValid: true, landmarksFound: false, probeFound });
    // La raison NOMME l'état de la machine : sans elle, une capture d'écran
    // ne distingue pas « bloqué sur la 1re marche » de « échelle gravie en
    // vain ». C'est ce qui a coûté un aller-retour complet le 2026-08-21.
    handlers.onLost(
      lostStreak,
      'no-face',
      `${strategy.label} · sonde ${
        probe !== null ? `${plan.probeHits}/${plan.probeTried}` : (probeError ?? 'en chargement')
      }`,
    );

    if (t.advanceTo !== null) {
      handlers.onTransition?.(t.reason ?? currentStrategy(plan).label);
      landmarker.close();
      landmarker = null;
      ensureLandmarker();
    }
  };

  /**
   * (Re)crée le modèle de la stratégie courante. Idempotente, et surtout : un
   * échec ne laisse JAMAIS la boucle sans issue — on redescend d'une marche
   * (celle qui s'était créée) et on réessaie à la frame suivante. Le seul état
   * durable possible est « un modèle vivant », ou « une erreur affichée ».
   */
  function ensureLandmarker(): void {
    if (disposed || swapping || landmarker !== null) return;
    swapping = true;
    const target = currentStrategy(plan);
    void createLandmarker(() => {}, target.delegate, target.minConfidence)
      .then((fresh) => {
        if (disposed) fresh.close();
        else {
          landmarker = fresh;
          modelError = null;
          lastTs = -1; // nouvelle instance → nouveau domaine de timestamps
        }
      })
      .catch((err: unknown) => {
        modelError = `modèle « ${target.label} » indisponible : ${
          err instanceof Error ? err.message.slice(0, 70) : String(err).slice(0, 70)
        }`;
        handlers.onError?.(modelError);
        // Repli : la marche précédente s'était créée, elle vaut mieux que rien.
        if (plan.strategyIndex > 0) plan.strategyIndex--;
      })
      .finally(() => {
        swapping = false;
      });
  }

  const feed = attachFrameFeed(video, onSnapshot);
  return {
    stop(): void {
      disposed = true;
      feed.stop();
      landmarker?.close();
      landmarker = null;
      probe?.close();
      probe = null;
    },
    plan(): Readonly<DetectionPlan> {
      return plan;
    },
  };
}

/** Résultat de sonde ré-exporté pour les pages de diagnostic. */
export type { FaceProbeResult };
