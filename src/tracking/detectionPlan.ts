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
 *   - 🔴 ré-audit 2026-08-23 (soir) — une stratégie n'est STABLE qu'après
 *     NEGOTIATION_STABLE_FRAMES frames de landmarks VALIDÉS **CONSÉCUTIVES**
 *     (une frame sans visage remet le compteur à zéro) : `stableReached`
 *     n'est émis qu'UNE fois, c'est lui qui déclenche la mémorisation par
 *     appareil. C'est aussi la PREUVE (`strategyProven`) qui confère la
 *     fenêtre prudente de 20 s et le ré-ancrage du tour — une frame
 *     chanceuse ne confère RIEN : un backend qui donne une frame puis se
 *     tait est éliminé aussi vite qu'un backend muet ;
 *   - 🔴 ré-audit 2026-08-23 (soir) — catalogue entier muet SANS qu'aucune
 *     stratégie n'ait jamais été prouvée dans la session : on ne reste PAS
 *     collé pour toujours — un NOUVEAU TOUR part du début du catalogue
 *     toutes les RENEGOTIATION_SILENT_MS (l'état GPU/navigateur a pu
 *     changer). Dès qu'une stratégie a été prouvée une fois dans la session,
 *     plus aucun tour périodique : un silence intégral signifie alors
 *     « personne dans le champ », et churner des Tasks serait du gaspillage.
 *
 *   WAITING_VALID_FRAME ──frame valide──▶ SEARCHING (stratégie de départ)
 *   SEARCHING ──5 landmarks consécutifs──▶ TRACKING PROUVÉ (tour ré-ancré)
 *   TRACKING ──perte──▶ SEARCHING, même stratégie (sortir du champ ≠ panne)
 *   SEARCHING (jamais prouvée) ──muet SWAP_MS + frames──▶ stratégie suivante
 *   SEARCHING (prouvée) ──muet SILENT_RECREATE_MS──▶ RECRÉER la même
 *                       ──encore muet une fenêtre──▶ stratégie suivante
 *   tout muet, rien prouvé ──cooldown──▶ NOUVEAU TOUR depuis le début.
 *
 * Les frames INVALIDES (noires, 0×0) n'avancent aucune horloge.
 */

import {
  advanceStrategy,
  allStrategiesTried,
  currentStrategy,
  NEGOTIATION_STABLE_FRAMES,
  restartRound,
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
  restartRound,
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

/**
 * 🔴 Ré-audit 2026-08-23 — catalogue entier muet et RIEN de prouvé dans la
 * session : cooldown avant de relancer un tour complet de négociation depuis
 * le début du catalogue. Assez long pour ne pas churner des Tasks (batterie),
 * assez court pour rattraper un état GPU/navigateur qui a changé.
 */
export const RENEGOTIATION_SILENT_MS = 30_000;

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
    plan.recoveryAttempts = 0; // épisode clos : la machine de reprise repart de zéro
    plan.stableFrames++;
    // 🔴 Ré-audit 2026-08-23 — la PREUVE est consécutive, et c'est ELLE qui
    // confère les égards : fenêtre prudente, ré-ancrage du tour, mémoire.
    // Une frame chanceuse (stableFrames < seuil) ne confère RIEN.
    if (plan.stableFrames >= NEGOTIATION_STABLE_FRAMES) {
      plan.strategyProven = true;
      plan.anyStrategyProven = true;
      plan.visitedStrategies = 1; // la stratégie PROUVÉE redevient l'ancre du tour
      if (!plan.stableNotified) {
        plan.stableNotified = true; // une seule notification : c'est elle qui mémorise
        return { advanceTo: null, reason: null, stableReached: true };
      }
    }
    return { advanceTo: null, reason: null };
  }

  plan.phase = 'searching';
  plan.silentValidFrames++;
  plan.silentSinceMs ??= obs.nowMs;
  plan.stableFrames = 0; // 🔴 consécutif : une frame sans visage casse la série

  // Une stratégie qui a PROUVÉ sa stabilité n'est pas soupçonnée à la
  // légère : la machine de REPRISE (A2) a ses fenêtres longues et prudentes.
  if (plan.strategyProven) return recoveryStep(plan, obs);
  if (allStrategiesTried(plan)) {
    // 🔴 Ré-audit 2026-08-23 — rien n'a JAMAIS été prouvé dans la session et
    // tout le catalogue est muet : après un cooldown, NOUVEAU TOUR depuis le
    // début (l'état GPU/navigateur a pu changer). Dès qu'une stratégie a été
    // prouvée une fois, plus de tour périodique : silence = champ vide.
    if (plan.anyStrategyProven) return { advanceTo: null, reason: null };
    const silentMs = obs.nowMs - (plan.silentSinceMs ?? obs.nowMs);
    if (silentMs < RENEGOTIATION_SILENT_MS || plan.silentValidFrames < SILENT_RECREATE_MIN_FRAMES) {
      return { advanceTo: null, reason: null };
    }
    restartRound(plan, 0);
    return {
      advanceTo: plan.strategyIndex,
      reason:
        `catalogue entier muet ${(silentMs / 1000).toFixed(0)} s sans stratégie jamais prouvée — ` +
        `nouveau tour de négociation depuis « ${currentStrategy(plan).label} »`,
    };
  }

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
 * ⭐ Ré-audit A2 — la machine de REPRISE d'une stratégie PROUVÉE (ré-audit
 * 2026-08-23 : la preuve — 5 frames consécutives — est requise ; une frame
 * chanceuse ne mérite pas ces égards).
 *
 * Un moteur peut mourir SANS lever : plus un landmark, plus une exception,
 * caméra vivante. La reprise est volontairement lente et en deux temps :
 * recréer LA MÊME stratégie, puis avancer si la recréation reste muette une
 * fenêtre complète. Le retour du visage remet `recoveryAttempts` à zéro
 * (planStep) : chaque épisode repaie la fenêtre prudente entière — pas de
 * ping-pong. Tout le catalogue visité : une seule recréation par épisode,
 * puis on cherche, honnêtement (la session a prouvé qu'elle SAIT suivre :
 * le silence intégral signifie « champ vide », pas « tout est mort »).
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
