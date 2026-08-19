/**
 * ui/liveSteps.ts — les deux étapes qui vivent DANS la boucle de détection.
 *
 * La rotation de tête (§14.2) et le contre-contrôle iris (§14.1) se nourrissent
 * d'une image sur l'autre. Ils ne peuvent donc pas être des composants React :
 * ils sont appelés à chaque frame, depuis `TryOn.renderFrame`.
 *
 * Extrait de `TryOn.tsx` pour tenir la règle des 300 lignes (§3).
 *
 * ⚠️ Aucun des deux ne mesure : ils accumulent et délèguent à `core/`.
 */

import type { AutoStatus } from '../core/autoCalibration.js';
import { crossCheckWithIris } from '../core/crossCheck.js';
import { irisWidthPx, rollRadOf } from '../core/faceMetrics.js';
import type { NormalizedLandmark } from '../core/geom.js';
import type { Live } from './liveState.js';

/** Images d'iris moyennées avant de relire la carte. */
export const CROSSCHECK_FRAMES = 30;

/** Vues de carte à récolter avant de rafraîchir le compte à l'écran. */
export const SWEEP_REPORT_EVERY = 5;

/**
 * La séance filmée. Renvoie le compte rendu à publier, ou `null` si rien n'a
 * assez changé pour mériter un rendu React.
 *
 * 🔴 **Ne dit JAMAIS quand s'arrêter.** L'ancienne version rendait un booléen
 * `complete`, sur lequel `TryOn` déclenchait le calcul : la machine décidait que
 * la séance était finie, au milieu d'un mouvement du client. Le seul événement
 * qui termine la séance est désormais son bouton (arbitrage du 2026-08-18), et
 * ce qui sort d'ici est purement informatif.
 *
 * ⚠️ Un `setPhase` par image ferait rendre React soixante fois par seconde, au
 * moment précis où la détection a besoin du processeur. Le compte rendu est donc
 * publié par paliers — sur les degrés atteints, qui ne bougent que quand la tête
 * bouge, et toutes les `SWEEP_REPORT_EVERY` vues de carte.
 */
export function stepRotation(
  s: Live,
  lm: readonly NormalizedLandmark[],
  yawRad: number,
  w: number,
  h: number,
): { degrees: { left: number; right: number }; cardViews: number } | null {
  if (s.probe === null) return null;
  s.probe.offer(lm, yawRad, rollRadOf(lm, w, h), w, h);

  const cardViews = s.probe.quads().length;
  const reached = s.probe.progress.negative + s.probe.progress.positive;
  const moved = Math.abs(reached - s.lastProbeRatio) > 0.02;

  // ⚠️ Publier seulement sur CHANGEMENT (bug A1 de l'audit) : l'ancienne
  // condition laissait passer chaque frame dès que le compte stagnait sur un
  // multiple de SWEEP_REPORT_EVERY — 0 inclus, donc pendant toute séance où la
  // carte n'était pas trouvée, React re-rendait à la cadence vidéo.
  const countWorthReporting =
    cardViews !== s.lastReportedCardViews && cardViews % SWEEP_REPORT_EVERY === 0;
  if (!moved && !countWorthReporting) return null;

  s.lastProbeRatio = reached;
  s.lastReportedCardViews = cardViews;
  const p = s.probe.progress;
  const deg = (r: number): number => (r * 180) / Math.PI;
  return { degrees: { left: deg(p.negative), right: deg(p.positive) }, cardViews };
}

/**
 * ⭐ V2 sans carte — nourrit le moteur automatique et rend son état QUAND il a
 * changé, `null` sinon. Même discipline anti-A1 que `stepRotation` : la boucle
 * ne pousse jamais deux fois le même état vers React.
 *
 * `lm` vaut null quand la détection est perdue : le moteur doit le savoir,
 * c'est une des raisons qui expliquent pourquoi « ça ne finit pas ».
 */
export function stepAutoCalibration(
  s: Live,
  lm: readonly NormalizedLandmark[] | null,
  yawRad: number,
  w: number,
  h: number,
  nowMs: number,
): AutoStatus | null {
  if (s.auto === null) return null;
  const roll = lm === null ? 0 : rollRadOf(lm, w, h);
  s.auto.offer(lm, yawRad, roll, w, h, nowMs);

  const status = s.auto.status();
  const key = `${status.state}|${status.usableFrames}|${status.whyNotDone?.code ?? ''}`;
  if (key === s.lastAutoKey) return null;
  s.lastAutoKey = key;
  return status;
}

/**
 * L'iris relit la carte, une fois, en silence. Renvoie un avertissement à
 * afficher, ou `null`.
 *
 * 🔴 Il ne corrige rien et ne rejette rien (§14.1) : il signale un écart de plus
 * de 12 %, qui trahit un cadre mal posé. Le corriger reviendrait à mêler deux
 * étalons de précisions différentes.
 */
export function stepCrossCheck(
  s: Live,
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
): string | null {
  if (s.irisSamples === null || s.cal === null) return null;
  s.irisSamples.push(irisWidthPx(lm, w, h));
  if (s.irisSamples.length < CROSSCHECK_FRAMES) return null;

  const mean = s.irisSamples.reduce((a, b) => a + b, 0) / s.irisSamples.length;
  s.irisSamples = null;
  return crossCheckWithIris(s.cal, mean, lm, w, h);
}
