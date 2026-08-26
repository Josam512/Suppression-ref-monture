/**
 * scripts/movingLaw.mjs — la LOI DE MOUVEMENT de la fixture « visage mobile »
 * (terrain 2026-08-26), partagée entre le générateur (make-face-y4m) et le
 * banc S20 (faults) : le banc reconstruit analytiquement où le visage EST à
 * l'instant video.currentTime et l'oppose au sprite réellement peint.
 *
 * x_centre(t) = MOVING_CX_PX + MOVING_AMPL_PX · sin(2π · t / MOVING_PERIOD_S)
 *
 * ⚠️ Outil de banc uniquement (§0.0.2) — rien de src/ n'importe ce fichier.
 */

/** Cadre PAYSAGE, comme une webcam réelle (les fixtures historiques étaient portrait). */
export const MOVING_W = 640;
export const MOVING_H = 480;
/** Cadence déclarée du y4m — 15 fps, la cadence d'une webcam moyenne. */
export const MOVING_FPS = 15;
/** Période du va-et-vient ; FPS × période = 45 frames, la boucle tombe juste. */
export const MOVING_PERIOD_S = 3;
/** Amplitude du centre du visage (px vidéo) — vitesse crête ≈ 250 px/s. */
export const MOVING_AMPL_PX = 120;
/** Position moyenne du centre du visage (px vidéo). */
export const MOVING_CX_PX = 320;
/** Hauteur du visage dessiné (photo 3:4 → largeur = 3/4 de cette hauteur). */
export const MOVING_FACE_H_PX = 420;

/** Abscisse VRAIE du centre du visage à l'instant t (secondes de flux). */
export function movingCenterX(tS) {
  const phase = (tS % MOVING_PERIOD_S) / MOVING_PERIOD_S;
  return MOVING_CX_PX + MOVING_AMPL_PX * Math.sin(2 * Math.PI * phase);
}
