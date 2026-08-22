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
export const CAMERA_PROFILE_VERSION = 2; // identité d'objectif (deviceId/facing/aspect/zoom)

/**
 * ⭐ Ré-audit A17a — versions PAR MÉTRIQUE : la version d'AUTO_METROLOGY à
 * laquelle l'algorithme ACTUEL de chaque grandeur a été introduit. Une valeur
 * stockée sous la version V n'est relue que si ALGO ≤ V ≤ version courante
 * (`metricCompatible`, ui/calibrationStorage). Corriger demain un bug de
 * largeur = incrémenter FACE_SCALE_ALGO_VERSION : les largeurs anciennes
 * tombent MÉCANIQUEMENT — plus jamais « conservée pour tout changement ».
 */
export const FACE_SCALE_ALGO_VERSION = 1; // la grandeur (largeur aux repères 234/454, mm ± rel) est inchangée depuis v1
export const PD_ALGO_VERSION = 3; // v3 : PD DIRECT pupille↔pupille
export const TEMPORAL_ALGO_VERSION = 3; // v3 : époque de capture liée à la frame (A7)
export const DISTANCE_ALGO_VERSION = 3; // v3 : distance MESURÉE publiée

/**
 * Tampon de build, AFFICHÉ à l'écran. Les pages autonomes sont servies par des
 * CDN qui cachent : sans tampon visible, impossible de savoir depuis une
 * capture d'écran quelle version le client teste. Trois allers-retours ont été
 * perdus exactement là-dessus.
 */
export const APP_BUILD_TAG = 'b12 · 2026-08-21';

declare const __GIT_SHA__: string | undefined;

/**
 * SHA du commit injecté au BUILD (vite `define`, complément 38) : le HUD dit
 * exactement quel code tourne — un `?v=…` d'URL n'a jamais rien prouvé.
 * « dev » hors build (serveur de dev, tests).
 */
export const GIT_SHA: string = typeof __GIT_SHA__ === 'string' ? __GIT_SHA__ : 'dev';
