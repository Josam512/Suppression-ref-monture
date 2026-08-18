/**
 * core/cardAssembly.ts — de la séance filmée à la calibration, sans cul-de-sac.
 *
 * ## Pourquoi ce fichier existe
 *
 * L'assemblage vivait dans l'IHM (`ui/useV1Calibration.ts`) : une cascade de
 * `try/catch` dont chaque branche pouvait, au bout du compte, **renvoyer le
 * client à l'étape carte**. C'était le cul-de-sac du §0.0.2 sous une autre
 * forme : refaire la mesure ne répare rien quand ce qui a échoué est un raffinement
 * facultatif, et le client, lui, n'a aucun moyen de savoir lequel.
 *
 * 🔴 **La règle de ce fichier, et c'est la seule qui compte :** une carte pointée
 * produit TOUJOURS une calibration. Les raffinements — focale mesurée, parallaxe
 * mesurée, écart temporal mesuré — sont facultatifs un par un ; chaque échec
 * élargit la marge annoncée et laisse une note, il n'interrompt jamais rien.
 * Le seul refus possible est une largeur de visage hors plage anatomique, qui
 * ne veut dire qu'une chose : les repères n'étaient pas sur la carte.
 *
 * ⚠️ Ce fichier ne connaît ni React, ni caméra, ni `localStorage` — il est du
 * calcul pur, donc testable sans navigateur, ce que la version en IHM n'était
 * pas. C'est précisément pour ça qu'elle avait pu rester fausse.
 */

import {
  calibrateWithCard,
  calibrateWithCardMeasured,
  type UserCalibration,
} from './calibration.js';
import { cardDistanceWithFocal, type CardQuad } from './cardPose.js';
import { cameraFromSweep, measureDistance } from './cardSweep.js';
import {
  focalPxFor,
  isProfileUsable,
  mergeProfile,
  profileFromSweep,
  type CameraProfile,
} from './cameraProfile.js';
import type { TemporalScene } from './cardRefinement.js';
import type { NormalizedLandmark } from './geom.js';
import type { RotatedView } from './parallax.js';

/** Ce que le pointage sur l'image figée a produit. */
export interface PointedCard {
  /** Largeur de la carte à l'écran, en pixels image. */
  cardWidthPx: number;
  /** Les quatre coins accrochés sur les bords, ou `null` s'ils n'ont pas pris. */
  quad: CardQuad | null;
  lm: readonly NormalizedLandmark[];
  w: number;
  h: number;
}

/** Ce que la séance filmée a produit. Chacun de ces champs peut être vide. */
export interface SweepHarvest {
  /** Cadres de la carte relevés pendant la séance. Plus il y en a, mieux c'est. */
  quads: readonly CardQuad[];
  /** Vues tournées exploitables, étalées en angle. */
  views: readonly RotatedView[] | null;
  /** L'image de face et ses repères, pour la silhouette. */
  scene: TemporalScene | null;
}

export interface AssembledCalibration {
  cal: UserCalibration;
  /** À afficher tel quel. Dit ce qui a été mesuré et ce qui ne l'a pas été. */
  notes: string[];
  /**
   * Profil d'objectif à mémoriser, ou `null` si la séance n'a rien appris de
   * neuf. La focale appartient à l'appareil du client, pas à cette séance.
   */
  profile: CameraProfile | null;
}

/**
 * Distance caméra ↔ carte, par ordre de préférence décroissant.
 *
 * 1. **La séance elle-même.** Le balayage donne la focale par médiane sur
 *    toutes ses vues ; la vue de face donne ensuite la distance. C'est le seul
 *    chemin entièrement mesuré.
 * 2. **L'objectif déjà connu.** Si une séance précédente a mesuré cette caméra,
 *    la distance redevient une division : elle ne dépend plus que de la taille
 *    apparente de la carte, grandeur du premier ordre, donc robuste.
 * 3. **Rien.** L'aval retombe sur la fenêtre de travail supposée et le dit.
 */
function measureCardDistance(
  card: PointedCard,
  harvest: SweepHarvest,
  stored: CameraProfile | null,
  nowMs: number,
  notes: string[],
): {
  measured: { cardDistanceMm: number; relError: number } | null;
  profile: CameraProfile | null;
} {
  if (card.quad !== null && harvest.quads.length > 0) {
    try {
      const sweep = cameraFromSweep(harvest.quads, card.w, card.h);
      const d = measureDistance(card.quad, sweep, card.w, card.h);

      let profile: CameraProfile | null = null;
      try {
        profile = mergeProfile(stored, profileFromSweep(sweep, card.w, nowMs));
      } catch {
        // Focale hors bornes : on ne persiste RIEN. Un profil absurde
        // contaminerait toutes les séances suivantes — bien pire qu'une séance
        // ratée, parce qu'il survivrait à celle-ci.
        profile = null;
      }

      notes.push(
        `Distance mesurée sur votre carte : ${(d.cardDistanceMm / 10).toFixed(0)} cm ` +
          `(${sweep.views} vues retenues sur ${sweep.offered}).`,
      );
      return { measured: { cardDistanceMm: d.cardDistanceMm, relError: d.relError }, profile };
    } catch {
      // Pas assez de vues, ou focale trop dispersée pour valoir mieux que
      // l'a priori. `cardSweep` refuse lui-même dans ce cas : on le suit, en
      // silence — c'est un raffinement, pas une panne.
    }
  }

  if (card.quad !== null && isProfileUsable(stored, nowMs)) {
    const profile = stored as CameraProfile;
    try {
      const cardDistanceMm = cardDistanceWithFocal(
        card.quad,
        card.w,
        card.h,
        focalPxFor(profile, card.w),
      );
      notes.push(
        `Distance déduite de votre appareil, déjà mesuré : ${(cardDistanceMm / 10).toFixed(0)} cm.`,
      );
      return { measured: { cardDistanceMm, relError: profile.relError }, profile: null };
    } catch {
      // Cadre inexploitable pour la distance : l'aval élargit la marge.
    }
  }

  return { measured: null, profile: null };
}

/**
 * Assemble tout ce que la séance a donné. **Ne renvoie jamais le client à la
 * case départ pour un raffinement manqué.**
 *
 * @throws CalibrationError seulement si la largeur de visage obtenue est hors
 *         plage anatomique — c'est-à-dire si les repères n'étaient pas sur la
 *         carte. C'est le seul cas où recommencer sert réellement à quelque chose.
 */
export function assembleCardCalibration(
  card: PointedCard,
  harvest: SweepHarvest,
  storedProfile: CameraProfile | null,
  nowMs: number,
): AssembledCalibration {
  const notes: string[] = [];
  const { measured, profile } = measureCardDistance(card, harvest, storedProfile, nowMs, notes);

  if (measured === null) {
    notes.push(
      `Distance non mesurée : votre carte n’a pas pu être suivie assez longtemps. ` +
        `La mesure reste valable, avec une marge plus large.`,
    );
  }

  try {
    const out = calibrateWithCardMeasured(
      card.cardWidthPx,
      card.w,
      card.lm,
      card.w,
      card.h,
      harvest.views,
      harvest.scene,
      measured,
    );
    return { cal: out.cal, notes: [...notes, ...out.refinement.notes], profile };
  } catch (err) {
    // 🔴 Le raffinement a produit une largeur invraisemblable — parallaxe
    // aberrante, silhouette accrochée sur autre chose que la tête. La mesure de
    // base, elle, ne dépend d'aucun de ces maillons : elle reste due au client.
    // Si elle échoue à son tour, alors seulement le pointage est en cause, et
    // c'est la seule chose que recommencer peut réparer.
    const cal = calibrateWithCard(card.cardWidthPx, card.lm, card.w, card.h);
    return {
      cal,
      notes: [
        ...notes,
        `Correction de perspective écartée : ${err instanceof Error ? err.message : String(err)}`,
        `La largeur reste celle lue sur votre carte, avec sa marge.`,
      ],
      profile,
    };
  }
}
