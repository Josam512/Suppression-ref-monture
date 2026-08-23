/**
 * tracking/detectionPlan.ts — la MACHINE D'ÉTAT de la détection (calcul pur).
 *
 * Refonte du guide de fiabilisation (2026-08-21, points 6, 11, 12), élargie
 * par la NÉGOCIATION DE CAPACITÉS (arbitrage humain 2026-08-22, Samsung réel) :
 *
 *   - une seule Task MediaPipe lourde vit à la fois ; toutes les montées se
 *     font PAR ÉLIMINATION — et une élimination ne dépend d'aucun témoin ;
 *   - les seuils sont des DURÉES, plus des comptes de frames (point 12) :
 *     l'acquisition initiale monte vite (SWAP_MS), une stratégie qui a DÉJÀ
 *     suivi un visage est traitée avec PRUDENCE (les deux machines du
 *     point 11) ;
 *   - 🔴 ré-audit A2 — un moteur devenu muet SANS lever est d'abord RECRÉÉ à
 *     l'identique après un long silence (SILENT_RECREATE_MS), puis l'avance
 *     reprend. Fenêtres longues exprès : l'absence de l'utilisateur ne
 *     déclenche rien, et jamais de ping-pong ;
 *   - 🔴 négociation — le catalogue (strategyCatalog) couvre TOUT l'espace
 *     {GPU/CPU} × {vidéo/canvas} × {matrices ON/OFF} ; l'avance est
 *     CIRCULAIRE (planState) : partie d'une stratégie mémorisée, elle boucle
 *     et ne déclare « tout essayé » qu'après avoir visité tout le catalogue.
 *     `allStrategiesTried` est LA définition de « plus rien à essayer » —
 *     modelLifecycle n'espace les tentatives qu'à ce moment-là ;
 *   - une stratégie n'est STABLE qu'après NEGOTIATION_STABLE_FRAMES frames de
 *     landmarks VALIDÉS (478 pts, repères finis — faceLoop) : `stableReached`
 *     n'est émis qu'UNE fois, c'est lui qui déclenche la mémorisation par
 *     appareil. `createFromOptions` réussi ne prouve RIEN.
 *
 *   WAITING_VALID_FRAME ──frame valide──▶ SEARCHING (stratégie de départ)
 *   SEARCHING ──landmarks──▶ TRACKING (stratégie verrouillée, tour ré-ancré)
 *   TRACKING ──perte──▶ SEARCHING, même stratégie (sortir du champ ≠ panne)
 *   SEARCHING (jamais suivi) ──muet SWAP_MS + frames──▶ stratégie suivante
 *   SEARCHING (a suivi) ──muet SILENT_RECREATE_MS──▶ RECRÉER la même
 *                       ──encore muet une fenêtre──▶ stratégie suivante
 *   tout le catalogue muet ──▶ on continue de chercher, honnêtement.
 *
 * Les frames INVALIDES (noires, 0×0) n'avancent aucune horloge.
 */

import {
  advanceStrategy,
  allStrategiesTried,
  currentStrategy,
  NEGOTIATION_STABLE_FRAMES,
  type DetectionPlan,
} from './planState.js';

export {
  coordinateSpaceOf,
  DETECTION_STRATEGIES,
  strategyIndexOf,
  unpadPoint,
  type CoordinateSpace,
  type DetectionStrategy,
} from './strategyCatalog.js';
export {
  advanceStrategy,
  allStrategiesTried,
  currentStrategy,
  initialPlan,
  NEGOTIATION_STABLE_FRAMES,
  type DetectionPhase,
  type DetectionPlan,
  type NegotiationEntry,
} from './planState.js';

/**
 * Silence toléré sur une marche avant de monter, en millisecondes.
 * L'ancienne règle (120 frames) coûtait ~8 s par marche à 15 fps ; trois
 * marches ≈ 24 s avant la stratégie qui marche. À 2 500 ms, l'échelle
 * historique est parcourue en moins de 8 s, quelle que soit la cadence.
 */
export const SWAP_SILENT_MS = 2500;
/**
 * Nombre MINIMAL de frames valides muettes en plus de la durée : deux frames
 * espacées de 3 s ne prouvent pas qu'une stratégie est muette, elles prouvent
 * que la caméra est lente.
 */
export const SWAP_MIN_SILENT_FRAMES = 10;

/**
 * ⭐ Ré-audit A2 — silence PRUDENT avant de soupçonner une stratégie qui a
 * déjà suivi un visage. Volontairement long (8× l'acquisition initiale) :
 * quelqu'un qui sort du champ chercher ses lunettes ne déclenche RIEN. Et la
 * première action est une recréation À L'IDENTIQUE — invisible si la personne
 * est simplement absente, salvatrice si le moteur est mort en silence.
 */
export const SILENT_RECREATE_MS = 20_000;
/**
 * Matière minimale de la fenêtre prudente : en dessous de ~3 frames/s sur
 * 20 s, c'est la caméra qui est en cause, pas le détecteur.
 */
export const SILENT_RECREATE_MIN_FRAMES = 60;

export interface DetectionObservation {
  frameValid: boolean;
  landmarksFound: boolean;
  /** Horloge de la frame — les décisions sont des durées, pas des comptes. */
  nowMs: number;
}

export interface DetectionTransition {
  /** Index de la nouvelle stratégie à instancier, ou null. */
  advanceTo: number | null;
  /** Raison nommée, affichable telle quelle (§17 : savoir POURQUOI). */
  reason: string | null;
  /** Vrai : recréer la MÊME stratégie (A2) — l'hôte doit forcer la création. */
  recreate?: boolean;
  /** Vrai UNE fois : la stratégie vient d'être prouvée STABLE (négociation). */
  stableReached?: boolean;
}

/** Avance la machine d'une frame. Mute `plan` et rend la transition éventuelle. */
export function planStep(plan: DetectionPlan, obs: DetectionObservation): DetectionTransition {
  if (!obs.frameValid) {
    plan.invalidFrames++;
    // Une entrée cassée ne dit RIEN sur les détecteurs : aucune horloge n'avance.
    return { advanceTo: null, reason: null };
  }
  plan.invalidFrames = 0;

  if (obs.landmarksFound) {
    plan.phase = 'tracking';
    plan.silentValidFrames = 0;
    plan.silentSinceMs = null;
    plan.strategyEverTracked = true;
    plan.recoveryAttempts = 0; // épisode clos : la machine de reprise repart de zéro
    plan.visitedStrategies = 1; // la stratégie qui SUIT redevient l'ancre du tour
    plan.stableFrames++;
    if (plan.stableFrames >= NEGOTIATION_STABLE_FRAMES && !plan.stableNotified) {
      plan.stableNotified = true; // une seule notification : c'est elle qui mémorise
      return { advanceTo: null, reason: null, stableReached: true };
    }
    return { advanceTo: null, reason: null };
  }

  plan.phase = 'searching';
  plan.silentValidFrames++;
  plan.silentSinceMs ??= obs.nowMs;

  // Une stratégie qui a déjà suivi n'est pas soupçonnée à la légère : la
  // machine de REPRISE (A2) a ses propres fenêtres, longues et prudentes.
  if (plan.strategyEverTracked) return recoveryStep(plan, obs);
  if (allStrategiesTried(plan)) return { advanceTo: null, reason: null };

  const silentMs = obs.nowMs - plan.silentSinceMs;
  if (silentMs < SWAP_SILENT_MS || plan.silentValidFrames < SWAP_MIN_SILENT_FRAMES) {
    return { advanceTo: null, reason: null };
  }

  const from = currentStrategy(plan).label;
  advanceStrategy(plan);
  return {
    advanceTo: plan.strategyIndex,
    reason:
      `rien détecté pendant ${(silentMs / 1000).toFixed(1)} s de frames valides ` +
      `(« ${from} ») → « ${currentStrategy(plan).label} » par élimination`,
  };
}

/**
 * ⭐ Ré-audit A2 — la machine de REPRISE d'une stratégie qui a déjà suivi.
 *
 * Un moteur peut mourir SANS lever : plus un landmark, plus une exception,
 * caméra vivante. La reprise est volontairement lente et en deux temps :
 * recréer LA MÊME stratégie, puis avancer si la recréation reste muette une
 * fenêtre complète. Le retour du visage remet `recoveryAttempts` à zéro
 * (planStep) : chaque épisode repaie la fenêtre prudente entière — pas de
 * ping-pong. Tout le catalogue visité : une seule recréation par épisode,
 * puis on cherche, honnêtement.
 */
function recoveryStep(plan: DetectionPlan, obs: DetectionObservation): DetectionTransition {
  const silentMs = obs.nowMs - (plan.silentSinceMs ?? obs.nowMs);
  if (silentMs < SILENT_RECREATE_MS || plan.silentValidFrames < SILENT_RECREATE_MIN_FRAMES) {
    return { advanceTo: null, reason: null };
  }
  if (plan.recoveryAttempts === 0) {
    plan.recoveryAttempts = 1;
    plan.silentValidFrames = 0;
    plan.silentSinceMs = null;
    return {
      advanceTo: plan.strategyIndex,
      recreate: true,
      reason:
        `« ${currentStrategy(plan).label} » a suivi un visage puis est restée muette ` +
        `${(silentMs / 1000).toFixed(0)} s de frames valides — je la recrée à l'identique.`,
    };
  }
  if (allStrategiesTried(plan)) return { advanceTo: null, reason: null }; // on continue de chercher, honnêtement
  const from = currentStrategy(plan).label;
  advanceStrategy(plan);
  return {
    advanceTo: plan.strategyIndex,
    reason:
      `« ${from} » recréée reste muette après une nouvelle fenêtre complète — ` +
      `j'essaie « ${currentStrategy(plan).label} » par élimination.`,
  };
}
