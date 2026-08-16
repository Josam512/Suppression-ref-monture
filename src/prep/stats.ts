/**
 * prep/stats.ts — statistiques du protocole de calibration (§5, lot 8).
 *
 * Isolées dans un module pur pour être testables sans navigateur : ces deux
 * fonctions décident si une constante qui pèse plus lourd que le seuil de
 * décision a le droit d'être figée.
 */

/**
 * MÉDIANE, et pas moyenne — le protocole l'exige.
 *
 * Un seul essai aberrant (pointage raté, photo de trois quarts) déplacerait
 * une moyenne sans rien signaler. La médiane l'ignore.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Étendue des écarts. Au-delà du seuil, on ne fige pas : on cherche la cause. */
export function dispersion(values: readonly number[]): number {
  return values.length === 0 ? NaN : Math.max(...values) - Math.min(...values);
}

/** Seuil du protocole : au-delà, un autre maillon est faux (B3 ou B4 en premier suspect). */
export const MAX_DISPERSION_MM = 3;

export interface ProtocolState {
  essais: number;
  montures: number;
  visages: number;
  dispersionMm: number;
}

/**
 * Le protocole du §5 en une fonction : au moins 3 essais, 3 montures de
 * largeurs nettement différentes, 2 morphologies, et une dispersion tenue.
 */
export function protocolSatisfied(s: ProtocolState): boolean {
  return (
    s.essais >= 3 &&
    s.montures >= 3 &&
    s.visages >= 2 &&
    Number.isFinite(s.dispersionMm) &&
    s.dispersionMm <= MAX_DISPERSION_MM
  );
}
