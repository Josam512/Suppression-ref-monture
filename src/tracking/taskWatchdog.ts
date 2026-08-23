/**
 * tracking/taskWatchdog.ts — le WATCHDOG de création d'une Task MediaPipe.
 *
 * Extrait de `modelLifecycle.ts` (règle des 300 lignes, §3). `createFromOptions`
 * peut réussir, rejeter… ou rester PENDU — un `.catch()` ne couvre pas le
 * troisième cas. Et une résolution TARDIVE (après l'échéance) doit être FERMÉE,
 * jamais laissée fuir : ce serait une seconde Task vivante (point 6).
 */

import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import type { DetectionStrategy } from './strategyCatalog.js';

/** Création d'une instance MediaPipe : au-delà, elle est réputée PENDUE. */
export const MODEL_CREATE_TIMEOUT_MS = 15_000;

/** Fabrique une instance pour UNE stratégie. Injectable (banc du ré-audit A1). */
export type LandmarkerFactory = (
  onProgress: (ratio: number) => void,
  strategy: DetectionStrategy,
) => Promise<FaceLandmarker>;

/** Course entre une création et son délai. Une résolution TARDIVE est fermée. */
export function createWithWatchdog(
  factory: LandmarkerFactory,
  strategy: DetectionStrategy,
  onProgress: (r: number) => void,
): Promise<FaceLandmarker> {
  let settled = false;
  return new Promise<FaceLandmarker>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`création « ${strategy.label} » sans réponse après ${MODEL_CREATE_TIMEOUT_MS / 1000} s`));
    }, MODEL_CREATE_TIMEOUT_MS);
    factory(onProgress, strategy).then(
      (fresh) => {
        if (settled) {
          fresh.close(); // arrivée après le délai : ne pas laisser fuir une Task
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
