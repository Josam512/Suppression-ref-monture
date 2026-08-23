/**
 * tracking/taskWatchdog.ts — le WATCHDOG de création d'un backend de suivi.
 *
 * Extrait de `modelLifecycle.ts` (règle des 300 lignes, §3). Une création peut
 * réussir, rejeter… ou rester PENDUE — un `.catch()` ne couvre pas le
 * troisième cas. Et une résolution TARDIVE (après l'échéance) doit être
 * ÉLIMINÉE (`dispose`), jamais laissée fuir : ce serait une seconde Task
 * lourde vivante (point 6).
 */

import type { DetectionStrategy } from './strategyCatalog.js';
import type { FaceTracker } from './FaceTracker.js';

/** Création d'un backend : au-delà, il est réputé PENDU. */
export const MODEL_CREATE_TIMEOUT_MS = 15_000;

/** Fabrique un backend INITIALISÉ pour UNE stratégie. Injectable (bancs A1). */
export type TrackerFactory = (
  onProgress: (ratio: number) => void,
  strategy: DetectionStrategy,
) => Promise<FaceTracker>;

/** Course entre une création et son délai. Une résolution TARDIVE est éliminée. */
export function createWithWatchdog(
  factory: TrackerFactory,
  strategy: DetectionStrategy,
  onProgress: (r: number) => void,
): Promise<FaceTracker> {
  let settled = false;
  return new Promise<FaceTracker>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`création « ${strategy.label} » sans réponse après ${MODEL_CREATE_TIMEOUT_MS / 1000} s`));
    }, MODEL_CREATE_TIMEOUT_MS);
    factory(onProgress, strategy).then(
      (fresh) => {
        if (settled) {
          fresh.dispose(); // arrivée après le délai : ne pas laisser fuir une Task
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(fresh);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
