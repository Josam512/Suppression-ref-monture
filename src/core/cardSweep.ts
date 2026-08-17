/**
 * core/cardSweep.ts — la focale sort du BALAYAGE, jamais d'une image.
 *
 * ## Le fait mesuré qui commande tout ce fichier
 *
 * La focale se lit dans le raccourci de perspective d'un bord de la carte à
 * l'autre : un ou deux pixels sur 85 mm vus à 78 cm. Le signal est donc au
 * niveau du bruit de pointage, et les chiffres sont sans appel (tests de
 * `cardPose`) :
 *
 * | vues | pointage ±0,5 px | dispersion sur la distance |
 * |---|---|---|
 * | 1 | | **±20 à 25 %** — pire que l'a priori de 780 mm ± 17 % |
 * | 50 | | **±4 %**, sans biais |
 *
 * 🔴 Une seule vue ne remplace donc PAS la constante : elle la remplacerait par
 * quelque chose de plus bruité mais qui *ressemble* à une mesure. C'est le mode
 * d'échec que tout ce projet combat. On n'accepte la focale mesurée qu'à partir
 * d'un balayage réellement exploité, et on refuse de descendre en dessous.
 *
 * Ce qui rend le moyennage légitime ici, et illégitime ailleurs : le bruit de
 * POINTAGE est indépendant d'une image à l'autre. Le biais de parallaxe, lui,
 * ne l'est pas — c'est pourquoi le §4 interdit de le moyenner.
 */

import { cameraFromCard, cardDistanceWithFocal, type CardQuad } from './cardPose.js';
import { CalibrationError } from './geom.js';

/** En deçà, le moyennage n'a pas assez de matière : on garde l'a priori. */
export const MIN_SWEEP_VIEWS = 8;

/**
 * Au-delà, la focale mesurée n'est pas meilleure que l'a priori qu'elle
 * remplace (±17 %) et on ne gagne rien à la préférer.
 */
export const MAX_FOCAL_REL_ERROR = 0.12;

function median(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? Number.NaN) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

export interface SweepCamera {
  focalPx: number;
  /** Incertitude relative sur la focale, issue de la dispersion entre vues. */
  focalRelError: number;
  /** Nombre de vues réellement exploitées. */
  views: number;
  /** Nombre de vues proposées — l'écart avec `views` est un diagnostic. */
  offered: number;
}

/**
 * Focale, par médiane sur toutes les vues exploitables du balayage.
 *
 * La médiane plutôt que la moyenne : une carte partiellement masquée par une
 * main, une image floue, un cadre qui a décroché produisent des valeurs très
 * éloignées, pas des petits écarts. C'est le même choix qu'au §depthFit, et
 * pour la même raison.
 */
export function cameraFromSweep(
  quads: readonly CardQuad[],
  w: number,
  h: number,
): SweepCamera {
  const fs: number[] = [];
  for (const q of quads) {
    try {
      fs.push(cameraFromCard(q, w, h).focalPx);
    } catch {
      // Vue refusée par le solveur (trop frontale, coins incohérents). Ce n'est
      // pas un échec : c'est le rôle du refus. On passe à la suivante.
    }
  }

  if (fs.length < MIN_SWEEP_VIEWS) {
    throw new CalibrationError(
      `Seulement ${fs.length} vue(s) de carte exploitable(s) sur ${quads.length}. ` +
        `Gardez la carte bien visible pendant toute la rotation.`,
    );
  }

  const focalPx = median(fs);
  const mad = median(fs.map((x) => Math.abs(x - focalPx))) * 1.4826;
  const focalRelError = mad / Math.sqrt(fs.length) / Math.max(focalPx, 1e-9);

  if (focalRelError > MAX_FOCAL_REL_ERROR) {
    throw new CalibrationError(
      `La focale mesurée reste dispersée à ±${(focalRelError * 100).toFixed(0)} % sur ` +
        `${fs.length} vues : elle ne vaut pas mieux que la distance supposée. ` +
        `Refaites la rotation plus lentement, carte bien à plat.`,
    );
  }

  return { focalPx, focalRelError, views: fs.length, offered: quads.length };
}

export interface MeasuredDistance {
  /** Distance caméra ↔ plan de la CARTE, en millimètres. Mesurée. */
  cardDistanceMm: number;
  relError: number;
  focalPx: number;
  views: number;
}

/**
 * Distance de la carte sur l'image de face, focale prise sur le balayage.
 *
 * ⚠️ Deux rôles bien séparés, et il ne faut pas les confondre : le balayage
 * donne la FOCALE (effet du second ordre, besoin de beaucoup de vues), et
 * l'image de face donne la DISTANCE (effet du premier ordre : la carte est
 * simplement plus ou moins grande). Estimer la distance en même temps que la
 * focale sur une seule vue, c'est l'erreur que `depthFit` a déjà payée.
 */
export function measureDistance(
  frontalQuad: CardQuad,
  sweep: SweepCamera,
  w: number,
  h: number,
): MeasuredDistance {
  const cardDistanceMm = cardDistanceWithFocal(frontalQuad, w, h, sweep.focalPx);
  return {
    cardDistanceMm,
    // La distance est proportionnelle à la focale : leurs erreurs relatives
    // sont les mêmes. S'y ajoute le pointage du cadre frontal, du premier ordre.
    relError: sweep.focalRelError,
    focalPx: sweep.focalPx,
    views: sweep.views,
  };
}
