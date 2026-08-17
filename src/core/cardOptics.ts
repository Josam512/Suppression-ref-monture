/**
 * core/cardOptics.ts — la carte ISO et la distance de prise de vue.
 *
 * Séparé de `core/calibration.ts` pour une raison de fond autant que de taille :
 * la distance estimée ici n'appartient PAS à la chaîne de mesure. Elle repose
 * sur un champ de vision supposé, et elle ne sert qu'à dire « reculez un peu »
 * et à pondérer un terme correctif du second ordre. Mélangée aux fonctions de
 * calibration, elle finirait par être prise pour une mesure.
 */

/** Norme ISO/IEC 7810 ID-1 : la carte bancaire, universelle et gratuite. */
export const CARD_WIDTH_MM = 85.6;

/** En deçà, la parallaxe carte ↔ tempes devient dominante (correctif B4, parade n°1). */
export const CARD_MIN_DISTANCE_MM = 600;

/**
 * Champ de vision horizontal supposé d'une webcam grand public.
 *
 * ⚠️ N'entre PAS dans la chaîne de mesure principale. Il sert à afficher
 * « reculez un peu », et à pondérer la correction de parallaxe — laquelle vaut
 * quelques pour cent : une erreur de 20 % sur ce champ y pèse donc quelques
 * dixièmes de pour cent au total. C'est la seule raison pour laquelle une
 * valeur supposée est tolérée quelque part dans ce projet.
 */
export const ASSUMED_HFOV_DEG = 60;

/** Distance caméra → carte, approximative, à usage d'IHM et de second ordre. */
export function estimateDistanceMm(cardWidthPx: number, imageWidthPx: number): number {
  if (cardWidthPx <= 0) return Infinity;
  const focalPx = imageWidthPx / 2 / Math.tan((ASSUMED_HFOV_DEG / 2) * (Math.PI / 180));
  return (focalPx * CARD_WIDTH_MM) / cardWidthPx;
}

/** Vrai si le client est trop près pour que la parallaxe reste tolérable. */
export function isTooCloseForCard(cardWidthPx: number, imageWidthPx: number): boolean {
  return estimateDistanceMm(cardWidthPx, imageWidthPx) < CARD_MIN_DISTANCE_MM;
}
