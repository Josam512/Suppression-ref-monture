/**
 * tracking/faceTopology.ts — la TOPOLOGIE canonique d'un backend de suivi
 * (🔴 ré-audit humain 2026-08-23, axe 1).
 *
 * Le reproche : `FaceTrackingResult` rend un tableau brut, et l'aval indexe
 * en dur le maillage MediaPipe (234, 454, 468, 168…) — le backend était
 * « remplaçable » dans le TypeScript, pas dans la GÉOMÉTRIE : un tracker à
 * 68 points ne pourrait pas se brancher.
 *
 * Cette couche nomme les POINTS SÉMANTIQUES dont le produit vit (pupilles,
 * sellion, côtés du visage, canthi, oreilles, extrêmes d'iris) et laisse le
 * BACKEND déclarer où ils vivent dans SA sortie. Premier consommateur : la
 * validation de sortie (`landmarksInvalidReason`) — plus aucun « 478 » codé
 * en dur hors du backend MediaPipe.
 *
 * ⚠️ Périmètre assumé (consigné au ré-audit) : le rendu et la métrologie
 * indexent encore les constantes MediaPipe de `core/faceMetrics.ts` — leur
 * migration vers ces accesseurs nommés est le lot SUIVANT, avec le second
 * moteur réel (nouvelle dépendance → validation humaine, CLAUDE.md §9.1-8).
 * D'ici là, une seule source de vérité : ce fichier importe les constantes
 * de core, il ne les redéclare pas.
 */

import {
  EAR_L,
  EAR_R,
  EYE_L,
  EYE_L_INNER,
  EYE_R,
  EYE_R_INNER,
  FACE_L,
  FACE_R,
  IRIS_L_INNER,
  IRIS_L_OUTER,
  IRIS_R_INNER,
  IRIS_R_OUTER,
  SELLION,
} from '../core/faceMetrics.js';

/** Les points sémantiques d'un maillage de visage, par INDEX dans sa sortie. */
export interface FaceTopology {
  /** Nombre de points d'une sortie COMPLÈTE de ce backend. */
  pointCount: number;
  noseTip: number;
  sellion: number;
  /** Contour externe au niveau tempes/joues — la largeur du visage. */
  leftFaceSide: number;
  rightFaceSide: number;
  /** Centres de pupilles — la référence iris de la métrologie. */
  leftPupil: number;
  rightPupil: number;
  /** Canthi (coins d'yeux), accrochés au crâne — roll et ancrage vertical. */
  leftCanthusOuter: number;
  leftCanthusInner: number;
  rightCanthusOuter: number;
  rightCanthusInner: number;
  /** Oreilles — branches et occlusion. */
  leftEar: number;
  rightEar: number;
  /** Extrêmes HORIZONTAUX des iris — le diamètre qui calibre. */
  leftIrisOuter: number;
  leftIrisInner: number;
  rightIrisOuter: number;
  rightIrisInner: number;
}

/**
 * Les points sans lesquels ni pose, ni rendu, ni métrologie ne tiennent —
 * dérivés de la topologie, jamais énumérés en dur ailleurs.
 */
export function criticalIndices(t: FaceTopology): readonly number[] {
  return [
    t.noseTip,
    t.leftCanthusOuter,
    t.leftCanthusInner,
    t.sellion,
    t.leftFaceSide,
    t.rightCanthusOuter,
    t.rightCanthusInner,
    t.rightFaceSide,
    t.leftPupil,
    t.rightPupil,
    t.leftEar,
    t.rightEar,
  ];
}

/**
 * La topologie du maillage FaceLandmarker (478 points, iris compris) —
 * déclarée PAR le backend MediaPipe, construite sur les constantes de core
 * (une seule source de vérité, aucun index redéclaré).
 */
export const MEDIAPIPE_FACE_TOPOLOGY: FaceTopology = {
  pointCount: 478,
  noseTip: 1, // bout du nez FaceLandmarker
  sellion: SELLION,
  leftFaceSide: FACE_L,
  rightFaceSide: FACE_R,
  leftPupil: 468, // centre d'iris gauche FaceLandmarker
  rightPupil: 473, // centre d'iris droit FaceLandmarker
  leftCanthusOuter: EYE_L,
  leftCanthusInner: EYE_L_INNER,
  rightCanthusOuter: EYE_R,
  rightCanthusInner: EYE_R_INNER,
  leftEar: EAR_L,
  rightEar: EAR_R,
  leftIrisOuter: IRIS_L_OUTER,
  leftIrisInner: IRIS_L_INNER,
  rightIrisOuter: IRIS_R_OUTER,
  rightIrisInner: IRIS_R_INNER,
};
