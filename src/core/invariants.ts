/**
 * core/invariants.ts — assertions de DÉVELOPPEMENT (complément 45).
 *
 * Un invariant cassé en dev doit hurler, jamais se taire ; en production il
 * ne doit ni hurler ni coûter. `devInvariant` lève hors production et compte
 * toujours — les bancs lisent le compteur pour l'assertion « aucun état
 * mort » (point 77).
 *
 * Exemples verrouillés par les appelants :
 *   - phase publiée `collecting` ⇒ un moteur existe ;
 *   - demi-PD présentes ⇒ `splitFrames ≥ MIN_SPLIT_FRAMES` ;
 *   - échelle de rendu finie et > 0 avant tout `drawImage`.
 */

let violations = 0;
let lastViolation: string | null = null;

/** Actif hors production (Vite : `import.meta.env.PROD`), et dans les tests. */
function shouldThrow(): boolean {
  try {
    return !(import.meta as { env?: { PROD?: boolean } }).env?.PROD;
  } catch {
    return true;
  }
}

export function devInvariant(condition: boolean, message: string): void {
  if (condition) return;
  violations++;
  lastViolation = message;
  console.error(`INVARIANT VIOLÉ — ${message}`);
  if (shouldThrow()) throw new Error(`Invariant violé : ${message}`);
}

/** Lu par les bancs et le HUD : combien d'invariants ont cassé, et lequel en dernier. */
export function invariantReport(): { violations: number; last: string | null } {
  return { violations, last: lastViolation };
}
