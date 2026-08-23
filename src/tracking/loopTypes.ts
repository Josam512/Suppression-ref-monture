/**
 * tracking/loopTypes.ts — les TYPES publics de la boucle de détection.
 *
 * Extrait de `faceLoop.ts` (règle des 300 lignes, §3). Aucune logique ici :
 * les contrats de données que la boucle publie (compteurs, contexte d'erreur,
 * tableau de négociation) et les rappels qu'elle consomme.
 */

import type { FrameFeedStats } from './frameFeed.js';
import type { ModelState } from './modelLifecycle.js';
import type { TrackerHealth } from './FaceTracker.js';
import type { CoordinateSpace, DetectionPlan, NegotiationEntry } from './detectionPlan.js';

export type LostCause =
  | 'invalid-input'
  | 'no-face'
  | 'invalid-landmarks'
  | 'inference-error'
  | 'model-pending';

/** L'erreur intégrale est bornée — assez pour le calculator fautif, pas un fichier. */
export const FULL_ERROR_MAX_CHARS = 2000;
/** Lignes conservées du tableau de négociation (les plus récentes). */
export const NEGOTIATION_HISTORY_MAX = 20;
/** Angle franc à partir duquel l'accord matrice ↔ landmarks est observé. */
export const YAW_AGREEMENT_MIN_RAD = 0.14; // ~8°

/** Le CONTEXTE de la dernière erreur d'inférence — tout ce qu'une capture doit dire. */
export interface InferenceContext {
  strategyId: string;
  delegate: string;
  source: 'video' | 'canvas';
  matrices: boolean;
  inputW: number;
  inputH: number;
  videoW: number;
  videoH: number;
  tsMs: number;
  videoTimeS: number;
  generation: number;
}

/** Compteurs par étage — le HUD lit ici « où la chaîne s'est arrêtée ». */
export interface FaceLoopStats {
  validFrames: number;
  inferenceAttempts: number;
  inferenceSuccess: number;
  inferenceErrors: number;
  landmarkFrames: number;
  invalidLandmarkFrames: number;
  lastLandmarkAt: number;
  /** Version courte (une ligne de HUD)… */
  lastInferenceError: string | null;
  /** …et l'erreur INTÉGRALE (≤ FULL_ERROR_MAX_CHARS) avec son contexte. */
  lastInferenceErrorFull: string | null;
  lastInferenceContext: InferenceContext | null;
  /** Accord de signe matrice ↔ landmarks, observé aux angles francs (null = pas encore vu). */
  yawAgreement: boolean | null;
  /** La santé PROUVÉE du backend (sonde réelle) — jamais déduite d'un init. */
  trackerHealth: TrackerHealth;
  /** Génération de la Task courante (recréations comprises). */
  generation: number;
  /** Le tableau de négociation : chaque stratégie essayée et son verdict. */
  negotiation: NegotiationEntry[];
  modelState: ModelState;
  /** Stratégie de l'instance VIVANTE (l'index du plan peut viser plus loin). */
  runningStrategy: string | null;
  feed: Readonly<FrameFeedStats> | null;
}

export interface FaceLoopHandlers {
  /** Couche 4 OK : landmarks bruts de CETTE frame (coordonnées normalisées).
   *  `space` dit si le Z est exploitable : `padded-remapped` → X/Y dé-mappés,
   *  Z NON transformé, interdit de production (complément 9). */
  onLandmarks(
    lm: ReadonlyArray<{ x: number; y: number; z?: number }>,
    yawRad: number,
    space: CoordinateSpace,
  ): void;
  /** Pas de landmarks sur cette frame. `cause` nomme l'étage fautif (§11). */
  onLost(consecutive: number, cause: LostCause, reason: string | null): void;
  /** Montée de stratégie, avec sa raison (§17). */
  onTransition?(reason: string): void;
  onProgress?(ratio: number): void;
  /** Dégradation RÉCUPÉRABLE : la séance continue (guide, point 10). */
  onWarning?(message: string): void;
  /** FATAL : plus aucune stratégie ne peut continuer. */
  onError?(message: string): void;
  /** 🔴 Négociation — la stratégie vient d'être PROUVÉE stable : à mémoriser. */
  onStrategyStable?(strategyId: string): void;
}

export interface FaceLoopOptions {
  /** Stratégie mémorisée pour cet appareil — essayée EN PREMIER (id inconnu : ignoré). */
  initialStrategyId?: string | null;
}

export interface FaceLoopControl {
  stop(): void;
  plan(): Readonly<DetectionPlan>;
  stats(): Readonly<FaceLoopStats>;
  /**
   * ⭐ Ré-audit A3 — résout `true` quand une instance de détection est
   * RÉELLEMENT vivante (fin de la compilation WASM comprise), `false` si plus
   * aucune stratégie ne peut se créer (fatal déjà signalé par onError) ou si
   * la boucle est stoppée avant. L'IHM ne déclare « prêt » qu'après.
   */
  modelReady(): Promise<boolean>;
  /**
   * 🔴 Ré-audit 2026-08-23 — résout `true` au PREMIER visage VALIDÉ de la
   * session (`modelCreated` ≠ `trackerProven`) : c'est LÀ que la métrologie a
   * le droit de démarrer. `false` si fatal/arrêt sans jamais avoir vu un
   * visage.
   */
  trackerProven(): Promise<boolean>;
}
