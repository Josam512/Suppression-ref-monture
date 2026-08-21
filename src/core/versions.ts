/**
 * core/versions.ts — les VERSIONS, séparées par ce qu'elles versionnent
 * (guide point 58, complément 43).
 *
 * Un unique numéro magique forçait à tout jeter pour chaque changement — ou,
 * pire, à ne rien jeter du tout : un `?v=12` pouvait exécuter un algorithme
 * nouveau sur une calibration ancienne. Quatre compteurs, quatre raisons
 * d'incrémenter :
 *
 *   - `AUTO_METROLOGY_VERSION` : TOUT changement qui affecte HVID, largeur de
 *     visage, profondeur, PD ou correction focale. Une calibration stockée
 *     sous une autre version voit ses parties MÉTROLOGIQUES invalidées
 *     (PD, temporal — recollectées en arrière-plan) ; la largeur, qui ne
 *     pilote que l'échelle de rendu, est conservée si elle reste plausible
 *     (migration, complément 44).
 *   - `FRAME_SPEC_VERSION` : le schéma des fiches spec.json.
 *   - `CAMERA_PROFILE_VERSION` : le schéma du profil d'objectif.
 *   - `APP_BUILD_TAG` : l'identité de build affichée (HUD, complément 38) —
 *     la traçabilité, jamais une décision.
 *
 * Historique AUTO_METROLOGY :
 *   1 — schéma d'origine (essayage.calibration.v1) ;
 *   2 — demi-PD + écart temporal ;
 *   3 — refonte 2026-08-21 : PD DIRECT (pupille↔pupille), estimateur
 *       verrouillé, distance mesurée publiée, fenêtres propres.
 */

export const AUTO_METROLOGY_VERSION = 3;
export const FRAME_SPEC_VERSION = 2; // profileReferenceLengthMm (ex-templeRectifiedMm)
export const CAMERA_PROFILE_VERSION = 2; // identité d'objectif (deviceId/facing/aspect)

/**
 * Tampon de build, AFFICHÉ à l'écran. Les pages autonomes sont servies par des
 * CDN qui cachent : sans tampon visible, impossible de savoir depuis une
 * capture d'écran quelle version le client teste. Trois allers-retours ont été
 * perdus exactement là-dessus.
 */
export const APP_BUILD_TAG = 'b12 · 2026-08-21';
