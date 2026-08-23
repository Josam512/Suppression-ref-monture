/**
 * tracking/strategyCatalog.ts — le CATALOGUE des stratégies de détection.
 *
 * Extrait de `detectionPlan.ts` (règle des 300 lignes, §3) et ÉLARGI par
 * l'arbitrage humain du 2026-08-22 (test Samsung réel : `detectForVideo` lève
 * « Graph has errors » à CHAQUE frame alors que la création réussit — le
 * pilote/graph d'un appareil réel peut casser sur des axes que le catalogue
 * d'hier ne faisait jamais varier).
 *
 * 🔴 NÉGOCIATION DE CAPACITÉS UNIVERSELLE — les règles :
 *   - AUCUNE règle par appareil (« if Samsung » interdit) : le catalogue est
 *     le même partout, c'est l'ÉLIMINATION RÉELLE qui choisit ;
 *   - il couvre TOUT l'espace {GPU, CPU} × {vidéo directe, canvas} ×
 *     {matrices ON, OFF} (+ marge et seuils abaissés) — chaque axe est une
 *     cause de casse documentée de MediaPipe sur appareil réel ;
 *   - une stratégie n'est déclarée compatible que si elle produit RÉELLEMENT
 *     ≥ 478 landmarks validés sur plusieurs frames (detectionPlan) — jamais
 *     parce que `createFromOptions` a rendu une instance ;
 *   - l'aval (PD, rendu, temporal, verdict) ne sait JAMAIS quelle stratégie a
 *     gagné : il reçoit (landmarks, yaw, espace), rien d'autre.
 *
 * Les index 0–3 sont l'échelle historique (gpu → cpu → marge → seuils),
 * libellés INCHANGÉS : la montée par élimination temporelle (visage trop
 * proche) reste à 3 marches de profondeur, et les bancs qui lisent ces
 * libellés restent vrais. Les index 4+ sont les variantes de négociation,
 * parcourues surtout par la voie des ERREURS d'inférence (modelLifecycle).
 */

import type { Delegate } from './landmarker.js';

/** Une marche du catalogue : comment configurer le landmarker ET son entrée. */
export interface DetectionStrategy {
  id: string;
  delegate: Delegate;
  /**
   * Ce que `detectForVideo` reçoit : l'élément <video> LUI-MÊME, ou le canvas
   * du flux (la recopie d'hier). La vidéo directe est le défaut — un étage de
   * copie de moins — mais certains pilotes cassent sur l'une ou l'autre
   * entrée : les deux variantes existent donc au catalogue. Une marge
   * (padFraction) impose le canvas de travail, quelle que soit cette valeur.
   */
  source: 'video' | 'canvas';
  /**
   * `outputFacialTransformationMatrixes`. OFF retire du graphe tout le
   * sous-graphe de géométrie faciale — suspect documenté de « Graph has
   * errors » sur appareil réel. Sans matrice, le yaw vient de
   * `yawFromLandmarks` (rotation seule, paire symétrique — arbitrage humain
   * 2026-08-22, cf. landmarker.ts).
   */
  matrices: boolean;
  /**
   * Marge (letterbox) ajoutée autour de la frame avant détection, en fraction
   * de chaque dimension (null = aucune). Mécanisme identifié dans le graphe
   * MediaPipe (face_landmarks_detector_graph.cc) : le crop interne est élargi
   * ×1,5 et mis au carré — sur un visage occupant 60-80 % du cadre il déborde
   * massivement hors image, le score de présence s'effondre sous 0,5 et le
   * visage est SUPPRIMÉ du résultat, sans erreur. La marge redonne au crop de
   * la matière ; les landmarks X/Y sont ensuite DÉ-MAPPÉS exactement
   * (`unpadPoint`) : zéro effet sur les mesures.
   *
   * ⚠️ Le Z, lui, n'est PAS remappé (complément 9) : la sortie d'une stratégie
   * paddée est étiquetée `coordinateSpace: 'padded-remapped'` et aucun chemin
   * de production ne doit consommer son Z.
   */
  padFraction: number | null;
  /** Seuils detection/presence/tracking abaissés (null = défauts 0,5). */
  minConfidence: number | null;
  label: string;
}

export const DETECTION_STRATEGIES: readonly DetectionStrategy[] = [
  // — L'échelle historique (0–3) : ids et libellés INCHANGÉS.
  { id: 'gpu', delegate: 'GPU', source: 'video', matrices: true, padFraction: null, minConfidence: null, label: 'délégué GPU, pleine résolution' },
  { id: 'cpu', delegate: 'CPU', source: 'video', matrices: true, padFraction: null, minConfidence: null, label: 'délégué CPU (XNNPACK), pleine résolution' },
  { id: 'cpu-marge', delegate: 'CPU', source: 'canvas', matrices: true, padFraction: 0.25, minConfidence: null, label: 'CPU, marge de 25 % autour du cadre (visage très proche)' },
  { id: 'cpu-seuils', delegate: 'CPU', source: 'canvas', matrices: true, padFraction: 0.25, minConfidence: 0.25, label: 'CPU, marge 25 % + seuils de confiance abaissés à 0,25' },
  // — Les variantes de négociation (4+) : mêmes moteurs, autres entrées/graphes.
  { id: 'gpu-canvas', delegate: 'GPU', source: 'canvas', matrices: true, padFraction: null, minConfidence: null, label: 'délégué GPU, entrée recopiée en canvas' },
  { id: 'cpu-canvas', delegate: 'CPU', source: 'canvas', matrices: true, padFraction: null, minConfidence: null, label: 'délégué CPU, entrée recopiée en canvas' },
  { id: 'gpu-sans-matrice', delegate: 'GPU', source: 'video', matrices: false, padFraction: null, minConfidence: null, label: 'délégué GPU, sans matrice de pose (yaw par landmarks)' },
  { id: 'gpu-canvas-sans-matrice', delegate: 'GPU', source: 'canvas', matrices: false, padFraction: null, minConfidence: null, label: 'délégué GPU, canvas, sans matrice de pose' },
  { id: 'cpu-sans-matrice', delegate: 'CPU', source: 'video', matrices: false, padFraction: null, minConfidence: null, label: 'délégué CPU, sans matrice de pose (yaw par landmarks)' },
  { id: 'cpu-canvas-sans-matrice', delegate: 'CPU', source: 'canvas', matrices: false, padFraction: null, minConfidence: 0.25, label: 'dernier recours : CPU, canvas, sans matrice, seuils abaissés' },
];

/** Index d'une stratégie mémorisée — null si l'id est inconnu du catalogue. */
export function strategyIndexOf(id: string | null): number | null {
  if (id === null) return null;
  const i = DETECTION_STRATEGIES.findIndex((s) => s.id === id);
  return i >= 0 ? i : null;
}

/** Comment les coordonnées de la frame ont été produites (complément 9). */
export type CoordinateSpace = 'direct' | 'padded-remapped';

export function coordinateSpaceOf(strategy: DetectionStrategy): CoordinateSpace {
  return strategy.padFraction === null ? 'direct' : 'padded-remapped';
}

/**
 * Dé-mappe une coordonnée normalisée depuis le cadre AVEC marge vers le cadre
 * d'origine. Un point du centre revient exactement au centre : la marge est
 * connue au pixel près, elle n'introduit AUCUNE approximation dans la chaîne
 * d'échelle (livePxPerMm inchangé).
 */
export function unpadPoint(xNorm: number, padFraction: number): number {
  return xNorm * (1 + 2 * padFraction) - padFraction;
}
