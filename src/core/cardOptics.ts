/**
 * core/cardOptics.ts — la carte ISO et la distance de prise de vue.
 *
 * Séparé de `core/calibration.ts` pour une raison de fond autant que de taille :
 * la distance estimée ici n'appartient PAS à la chaîne de mesure. Elle repose
 * sur un champ de vision supposé. Mélangée aux fonctions de calibration, elle
 * finirait par être prise pour une mesure.
 */

/**
 * Norme ISO/IEC 7810 ID-1 : 85,60 × 53,98 mm.
 *
 * ⚠️ Ce n'est PAS « la carte bancaire ». C'est un format, et **tous** les objets
 * ci-dessous le respectent au dixième de millimètre. N'importe lequel fait
 * l'affaire, et l'application ne doit jamais en exiger un en particulier :
 *
 *   - carte bancaire
 *   - **carte Vitale**
 *   - carte d'identité française (depuis 2021), permis de conduire européen
 *   - carte de fidélité, carte de transport, carte SIM au format pleine taille
 *
 * 🔴 La carte Vitale est même **préférable** à la carte bancaire, et il faut le
 * dire au client : elle ne porte ni numéro de carte, ni cryptogramme, ni date
 * d'expiration. Une capture d'écran ou une photo qui traîne n'expose alors aucun
 * moyen de paiement. Le format est identique, donc la mesure aussi.
 */
export const CARD_WIDTH_MM = 85.6;
export const CARD_HEIGHT_MM = 53.98;

/** Objets au format ISO 7810 ID-1, à proposer au client dans cet ordre. */
export const ISO_ID1_OBJECTS = [
  'une carte Vitale',
  'une carte bancaire',
  'une carte d’identité ou un permis de conduire',
  'une carte de fidélité ou de transport',
] as const;

/**
 * Champ de vision horizontal supposé d'une webcam grand public.
 *
 * ⚠️ N'entre PAS dans la chaîne de mesure. Il ne sert qu'à AFFICHER un ordre de
 * grandeur et à chiffrer la marge ci-dessous, tant que le balayage n'a pas
 * mesuré la vraie focale (`core/cardSweep.ts`).
 */
export const ASSUMED_HFOV_DEG = 60;

/** Distance caméra → carte, approximative, à usage d'affichage et de second ordre. */
export function estimateDistanceMm(cardWidthPx: number, imageWidthPx: number): number {
  if (cardWidthPx <= 0) return Infinity;
  const focalPx = imageWidthPx / 2 / Math.tan((ASSUMED_HFOV_DEG / 2) * (Math.PI / 180));
  return (focalPx * CARD_WIDTH_MM) / cardWidthPx;
}

/**
 * Profondeur du plan de la CARTE ↔ repères 234/454 (sur le contour), en mm.
 *
 * A priori, utilisé UNIQUEMENT tant que la rotation de tête n'a pas mesuré la
 * vraie valeur (`core/parallax.ts`). Dès qu'elle l'a fait, c'est la mesure qui
 * gouverne et cette constante ne sert plus.
 *
 * 🔴 **Corrigé le 2026-08-17, et il faut dire pourquoi.** La carte a été
 * déplacée du front vers le bas du visage, sous la ligne des yeux
 * (`core/cardGuide.ts`). Le raisonnement qui accompagnait ce déplacement
 * annonçait que la parallaxe « disparaissait », le visage étant enfin dans son
 * propre plan. **C'était faux**, et les profondeurs déjà MESURÉES sur ce sujet
 * le disent (`core/framePlane.ts`) : l'arête du nez ressort de plus en plus vers
 * le bas — 40,6 mm au repère 6, 45,9 au 197, 50,8 au 195 devant les coins des
 * yeux, plus 12 mm jusqu'aux tempes. Une carte à plat sous les yeux porte sur le
 * nez, donc à **52–63 mm** devant 234/454 : autant, voire un peu plus, que sur
 * le front.
 *
 * Le déplacement reste justifié — il l'est par la DÉTECTION (quatre bords sur de
 * la peau au lieu d'un bord contre les cheveux) et par le fait que les yeux
 * doivent rester visibles, sans quoi MediaPipe invente les repères sur lesquels
 * la mesure est prise. Mais il n'apporte rien sur la parallaxe, et le prétendre
 * aurait fait annoncer au client une marge qu'on n'a pas.
 */
export const CARD_TO_TEMPLE_DEPTH_MM = 57;
/** Dispersion de la valeur ci-dessus, un seul sujet. */
export const CARD_TO_TEMPLE_DEPTH_SD_MM = 8;

/**
 * ⭐ Ce qui REMPLACE `isTooCloseForCard` — et pourquoi.
 *
 * L'ancienne fonction renvoyait « trop près » sous 60 cm, l'IHM affichait
 * « reculez », et le bouton de validation était **désactivé**.
 *
 * 🔴 C'est un problème de mesure converti en contrainte de tournage — l'erreur
 * que le journal du projet retient déjà (« refilmez avec un mur uni »), et qui
 * a été reprochée à juste titre. Être près de l'objectif n'est pas une faute du
 * client : c'est une condition de prise de vue qui AUGMENTE un biais connu, et
 * un biais connu se corrige ou se chiffre. Il ne se renvoie pas à l'utilisateur.
 *
 * Cette fonction rend donc le biais attendu, en fraction. Il part grossir la
 * marge affichée quand la parallaxe n'a pas été mesurée, et **rien ne bloque**.
 * Quand la rotation aboutit, ce terme disparaît au profit de la mesure.
 */
export function parallaxRelErrorAt(distanceMm: number, depthMm = CARD_TO_TEMPLE_DEPTH_MM): number {
  if (!Number.isFinite(distanceMm) || distanceMm <= depthMm) return 1; // absurde : marge maximale
  return depthMm / distanceMm;
}

/** Même chose depuis la largeur en pixels de la carte, pour l'IHM. */
export function parallaxRelErrorFromCard(cardWidthPx: number, imageWidthPx: number): number {
  return parallaxRelErrorAt(estimateDistanceMm(cardWidthPx, imageWidthPx));
}
