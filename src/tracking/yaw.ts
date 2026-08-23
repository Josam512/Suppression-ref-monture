/**
 * tracking/yaw.ts — les DEUX lectures de la rotation de tête (yaw).
 *
 * Extrait de `landmarker.ts` (règle des 300 lignes, §3).
 *
 * 1. `yawFromMatrix` — la voie nominale : la matrice de pose MediaPipe.
 * 2. `yawFromLandmarks` — le REPLI des stratégies « sans matrice » de la
 *    négociation de capacités (arbitrage humain 2026-08-22) : sur certains
 *    appareils réels, le sous-graphe de géométrie faciale fait lever tout le
 *    graph (« Graph has errors ») ; le catalogue contient donc des stratégies
 *    avec `outputFacialTransformationMatrixes: false`, et le yaw doit venir
 *    d'ailleurs. L'aval reçoit (landmarks, yaw) dans les deux cas — il ne
 *    sait pas quelle voie a servi.
 */

import { FACE_L, FACE_R } from '../core/faceMetrics.js';

/**
 * Yaw depuis la matrice de pose MediaPipe (colonne-major, 4×4).
 *
 * 🔴 SEULE lecture autorisée de cette matrice, et seulement sa partie rotation.
 * Sa TRANSLATION et son ÉCHELLE sont exprimées dans le repère du modèle
 * canonique : les utiliser reviendrait au « visage moyen habillé en
 * mathématiques » banni au §4. La rotation, elle, ne dépend pas de la taille
 * du visage — c'est pourquoi elle seule est admise.
 */
export function yawFromMatrix(m: ArrayLike<number>): number {
  const r02 = m[8];
  const r22 = m[10];
  if (r02 === undefined || r22 === undefined) return 0;
  return Math.atan2(r02, r22);
}

/**
 * Yaw depuis les landmarks EUX-MÊMES — rotation seule, paire symétrique.
 *
 * Géométrie : 234 et 454 sont une paire symétrique du maillage, à ±X0 du plan
 * médian. Sous un yaw θ, leur écart projeté vaut 2·X0·cos θ et leur écart de
 * profondeur (le z du modèle, à l'échelle de x) vaut 2·X0·sin θ :
 *
 *     θ = atan2(z454 − z234, hypot(Δx, Δy))     — X0 S'ANNULE.
 *
 * Aucun terme de morphologie ne survit : ce n'est PAS l'« estimateur 2D
 * bricolé » que le §4 interdit (celui-ci dépendait du rapport profondeur du
 * nez / largeur du visage). C'est la même information de ROTATION que la
 * matrice, lue sur deux points de la même sortie du modèle. Le §4 reste
 * intact : ni translation, ni échelle, ni z en aval — un scalaire d'angle.
 *
 * ⚠️ Le SIGNE suit la convention z de MediaPipe (plus petit = plus proche de
 * la caméra) et est aligné analytiquement sur `yawFromMatrix`. Les stratégies
 * AVEC matrice observent l'accord des deux voies en continu
 * (`yawAgreement`, faceLoop) : un désaccord de signe serait VISIBLE dans la
 * santé, jamais silencieux. Un z absent ou dégénéré rend 0 (frontal supposé,
 * la légende reste gelée par la règle 3 au-delà de 12°).
 */
export function yawFromLandmarks(
  lm: ReadonlyArray<{ x: number; y: number; z?: number }>,
): number {
  const a = lm[FACE_L];
  const b = lm[FACE_R];
  if (a === undefined || b === undefined) return 0;
  if (a.z === undefined || b.z === undefined || !Number.isFinite(a.z) || !Number.isFinite(b.z)) return 0;
  const spread = Math.hypot(b.x - a.x, b.y - a.y); // invariant au roll
  if (!Number.isFinite(spread) || spread <= 0) return 0;
  return Math.atan2(b.z - a.z, spread);
}
