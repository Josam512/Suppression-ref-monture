/**
 * core/crossCheck.ts — l'iris relit la carte (V1).
 *
 * La carte est devenue obligatoire au démarrage (arbitrage humain du
 * 2026-08-17), et l'iris n'est donc plus une source de mesure en V1. Il reste
 * pourtant la seule seconde opinion disponible, gratuite et automatique — et il
 * attrape le seul mode d'échec vraiment coûteux de la carte : un cadre mal posé
 * sur ses bords, qui fausse toute la session sans le moindre signe extérieur.
 *
 * ⚠️ Ce fichier ne corrige RIEN et ne rejette RIEN. Il rend une phrase, ou null.
 * Réconcilier les deux mesures reviendrait à moyenner un étalon juste avec un
 * étalon faux, et à produire un troisième nombre que personne n'a mesuré.
 */

import { calibrateWithIris, type UserCalibration } from './calibration.js';
import type { NormalizedLandmark } from './geom.js';

/**
 * Écart au-delà duquel l'iris et la carte ne racontent pas la même histoire.
 *
 * L'iris porte 4,3 % d'incertitude, la carte corrigée environ 2 % : deux
 * mesures justes se séparent rarement de plus de 12 %. Au-delà, l'une des deux
 * est fausse — et comme la carte est celle qui compte, il faut le dire.
 */
export const IRIS_CROSSCHECK_MAX_REL = 0.12;

/** @returns un message à afficher, ou null si les deux mesures concordent. */
export function crossCheckWithIris(
  cal: UserCalibration,
  irisWidthPx: number,
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
): string | null {
  let parIris: number;
  try {
    parIris = calibrateWithIris(irisWidthPx, lm, w, h).faceWidthMm;
  } catch {
    return null; // l'iris n'a rien donné d'exploitable : pas de seconde opinion.
  }

  const ecart = Math.abs(parIris - cal.faceWidthMm) / cal.faceWidthMm;
  if (ecart <= IRIS_CROSSCHECK_MAX_REL) return null;

  return (
    `Contrôle de cohérence : la mesure automatique de vos yeux donne ` +
    `${parIris.toFixed(0)} mm là où la carte donne ${cal.faceWidthMm.toFixed(0)} mm, ` +
    `soit ${(ecart * 100).toFixed(0)} % d'écart. Si vous portiez vos lunettes, c'est attendu — ` +
    `vos verres changent la taille apparente de l'iris. Sinon, refaites la calibration : ` +
    `le cadre a probablement été mal posé sur les bords de la carte.`
  );
}
