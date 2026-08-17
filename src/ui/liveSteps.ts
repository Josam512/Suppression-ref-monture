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

import { crossCheckWithIris } from '../core/crossCheck.js';
import { irisWidthPx, rollRadOf } from '../core/faceMetrics.js';
import type { NormalizedLandmark } from '../core/geom.js';
import type { Live } from './liveState.js';

/** Images d'iris moyennées avant de relire la carte. */
export const CROSSCHECK_FRAMES = 30;

/**
 * Le balayage de rotation. Renvoie l'avancement à publier, ou `null` si rien
 * n'a assez changé pour mériter un rendu React.
 *
 * ⚠️ Un `setPhase` par image ferait rendre React soixante fois par seconde, au
 * moment précis où la détection a besoin du processeur.
 */
export function stepRotation(
  s: Live,
  lm: readonly NormalizedLandmark[],
  yawRad: number,
  w: number,
  h: number,
): { ratio: number; degrees: { left: number; right: number }; complete: boolean } | null {
  if (s.probe === null) return null;
  s.probe.offer(lm, yawRad, rollRadOf(lm, w, h), w, h);

  const ratio = s.probe.ratio();
  const complete = s.probe.complete;
  if (Math.abs(ratio - s.lastProbeRatio) <= 0.02 && !complete) return null;

  s.lastProbeRatio = ratio;
  const p = s.probe.progress;
  const deg = (r: number): number => (r * 180) / Math.PI;
  return { ratio, degrees: { left: deg(p.negative), right: deg(p.positive) }, complete };
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
