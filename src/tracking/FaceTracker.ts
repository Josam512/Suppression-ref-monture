/**
 * tracking/FaceTracker.ts — l'ABSTRACTION unique de suivi de visage
 * (refonte ciblée, arbitrage humain 2026-08-23).
 *
 * 🔴 Règle produit : le backend de tracking est REMPLAÇABLE. Hors de
 * `tracking/backends/`, plus AUCUN fichier n'importe FaceLandmarker ni
 * n'appelle `detectForVideo` : le reste de l'application consomme des
 * `FaceTrackingResult` et ne sait pas quel moteur les produit. Un backend
 * futur (natif, TF.js, WebNN…) s'ajoute ici sans toucher ni au rendu ni à la
 * métrologie.
 *
 * ⚠️ `detect` est SYNCHRONE : le backend actuel (MediaPipe VIDEO) l'est, et la
 * boucle de frames (rvfc) consomme la frame dans son propre tick. Un backend
 * réellement asynchrone exigera d'abord une politique de contre-pression dans
 * `frameFeed` (frames sautées pendant l'inférence) — à concevoir à ce
 * moment-là, pas à singer d'avance.
 */

import type { DetectionStrategy } from './strategyCatalog.js';
import type { FaceTopology } from './faceTopology.js';

/** Ce que `detect` reçoit : l'élément vidéo LUI-MÊME ou un canvas préparé. */
export type VideoFrameSource = HTMLVideoElement | HTMLCanvasElement;

/** La sortie UNIQUE du tracking — le rendu et la métrologie ne voient qu'elle. */
export interface FaceTrackingResult {
  timestampMs: number;
  landmarks: ReadonlyArray<{ x: number; y: number; z?: number }>;
  yawRad: number;
  rollRad: number;
  /** FaceLandmarker (mode VIDEO) n'expose PAS de score de visage : 1 quand un
   *  visage est rendu — documenté, jamais présenté comme une confiance mesurée. */
  confidence: number;
  /** Id de la stratégie/backend qui a produit CE résultat (traçabilité). */
  backend: string;
  /** Diagnostic : accord de signe matrice ↔ landmarks quand les deux voies
   *  coexistent à angle franc (null = pas observé sur cette frame). */
  yawAgreement?: boolean | null;
}

export interface TrackerInitContext {
  onProgress?(ratio: number): void;
}

/**
 * UN moteur de suivi, pour UNE stratégie. `init` peut réussir sans que le
 * backend soit sain : seule une SONDE réelle (plusieurs `detect` propres —
 * modelLifecycle) déclare la santé. `detect` rend null quand aucun visage
 * n'est vu (ce n'est PAS une panne) et LÈVE quand le graph casse (c'en est
 * une) — les deux ne sont jamais confondus.
 */
export interface FaceTracker {
  readonly id: string;
  readonly strategy: DetectionStrategy;
  /** 🔴 Ré-audit 2026-08-23 — la topologie du maillage que CE backend produit
   *  (points sémantiques nommés + taille de sortie). La validation de sortie
   *  la consomme : plus aucun « 478 » supposé hors du backend. */
  readonly topology: FaceTopology;
  init(ctx: TrackerInitContext): Promise<void>;
  detect(frame: VideoFrameSource, timestampMs: number): FaceTrackingResult | null;
  dispose(): void;
}

/** Inférences PROPRES exigées après l'adoption avant de déclarer « healthy ».
 *  Une création qui réussit puis lève au premier `detect` = backend KO. */
export const PROBE_REQUIRED_SUCCESSES = 3;

/** La santé d'un backend, dérivée de PREUVES (jamais de `init` seul). */
export type TrackerHealth =
  | { state: 'idle' }
  | { state: 'initializing' }
  | { state: 'probing'; successes: number }
  | { state: 'healthy'; sinceMs: number }
  | { state: 'degraded'; reason: string }
  | { state: 'failed'; reason: string };
