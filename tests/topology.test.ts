/**
 * tests/topology.test.ts — la topologie canonique du tracking (🔴 ré-audit
 * 2026-08-23, axe 1) : les points sémantiques sont NOMMÉS, déclarés par le
 * backend, et la validation de sortie n'a plus de « 478 » à elle.
 */

import { describe, expect, it } from 'vitest';
import { criticalIndices, MEDIAPIPE_FACE_TOPOLOGY, type FaceTopology } from '../src/tracking/faceTopology.js';
import { CRITICAL_LANDMARKS, landmarksInvalidReason, MIN_LANDMARKS } from '../src/tracking/frameInput.js';
import { EAR_L, EAR_R, EYE_L, EYE_R, FACE_L, FACE_R, SELLION } from '../src/core/faceMetrics.js';

/** Un maillage étranger de 68 points (type dlib) — le test de remplaçabilité. */
const FOREIGN_68: FaceTopology = {
  pointCount: 68,
  noseTip: 30,
  sellion: 27,
  leftFaceSide: 0,
  rightFaceSide: 16,
  leftPupil: 37, // approximations : seul le CONTRAT compte ici
  rightPupil: 44,
  leftCanthusOuter: 36,
  leftCanthusInner: 39,
  rightCanthusOuter: 45,
  rightCanthusInner: 42,
  leftEar: 1,
  rightEar: 15,
  leftIrisOuter: 37,
  leftIrisInner: 38,
  rightIrisOuter: 43,
  rightIrisInner: 44,
};

function fullMesh(count: number): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, () => ({ x: 0.5, y: 0.5 }));
}

describe('topologie canonique — le backend déclare son maillage, la frontière valide contre LUI', () => {
  it('la liste critique DÉRIVE des points nommés — identique à la liste historique MediaPipe', () => {
    const historical = [1, 33, 133, 168, 234, 263, 362, 454, 468, 473, 162, 389];
    expect(new Set(criticalIndices(MEDIAPIPE_FACE_TOPOLOGY))).toEqual(new Set(historical));
    expect(new Set(CRITICAL_LANDMARKS)).toEqual(new Set(historical));
    expect(MIN_LANDMARKS).toBe(MEDIAPIPE_FACE_TOPOLOGY.pointCount);
  });

  it('une seule source de vérité : les points nommés SONT les constantes de core', () => {
    const t = MEDIAPIPE_FACE_TOPOLOGY;
    expect(t.sellion).toBe(SELLION);
    expect(t.leftFaceSide).toBe(FACE_L);
    expect(t.rightFaceSide).toBe(FACE_R);
    expect(t.leftCanthusOuter).toBe(EYE_L);
    expect(t.rightCanthusOuter).toBe(EYE_R);
    expect(t.leftEar).toBe(EAR_L);
    expect(t.rightEar).toBe(EAR_R);
    expect(t.pointCount).toBe(478);
  });

  it('🔴 remplaçabilité GÉOMÉTRIQUE : un maillage de 68 points valide par SA topologie', () => {
    // 68 points complets → exploitable pour CE backend (aucun 478 supposé).
    expect(landmarksInvalidReason(fullMesh(68), FOREIGN_68)).toBeNull();
    // 60 points → partiel PAR RAPPORT À SA topologie, cause chiffrée juste.
    expect(landmarksInvalidReason(fullMesh(60), FOREIGN_68)).toMatch(/60 landmarks au lieu de 68/);
    // …et le même tableau de 68 points reste évidemment partiel pour MediaPipe.
    expect(landmarksInvalidReason(fullMesh(68))).toMatch(/au lieu de 478/);
  });

  it('un point critique non fini est nommé, quelle que soit la topologie', () => {
    const mesh = fullMesh(68);
    mesh[FOREIGN_68.sellion] = { x: Number.NaN, y: 0.5 };
    expect(landmarksInvalidReason(mesh, FOREIGN_68)).toMatch(new RegExp(`critique ${FOREIGN_68.sellion}`));
  });
});
