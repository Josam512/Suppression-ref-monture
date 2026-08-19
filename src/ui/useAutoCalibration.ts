/**
 * ui/useAutoCalibration.ts — la calibration automatique, côté IHM.
 *
 * Extrait de `TryOn.tsx` pour tenir la règle des 300 lignes (§3), et parce que
 * c'est ici que vit la réponse au symptôme n°1 de l'audit : le moteur conclut,
 * la collecte S'ARRÊTE (`live.auto = null`), et le succès est ANNONCÉ en clair.
 * La caméra, elle, ne change pas d'état : l'essayage continue dessus.
 */

import { useCallback, type MutableRefObject, type RefObject } from 'react';

import { AutoCalibrationEngine } from '../core/autoCalibration.js';
import { calibrateAuto } from '../core/autoCalibrate.js';
import type { UserCalibration } from '../core/calibration.js';
import type { CameraProfile } from '../core/cameraProfile.js';
import type { NormalizedLandmark } from '../core/geom.js';
import type { Phase } from './CalibrationPanel.js';
import { stepAutoCalibration } from './liveSteps.js';
import type { Live } from './liveState.js';

export interface AutoCalibrationDeps {
  live: MutableRefObject<Live>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cameraProfile: MutableRefObject<CameraProfile | null>;
  onCalibrated(cal: UserCalibration, notes: string[]): void;
  setPhase(phase: Phase): void;
}

export interface AutoCalibration {
  /** (Re)lance la mesure : nouveau moteur, compteurs à zéro. */
  startAuto(): void;
  /**
   * À appeler à CHAQUE frame de la boucle (`lm` null si détection perdue).
   * Publie l'état quand il change, assemble et annonce quand le moteur conclut.
   */
  pump(lm: readonly NormalizedLandmark[] | null, yawRad: number, w: number, h: number): void;
}

export function useAutoCalibration(deps: AutoCalibrationDeps): AutoCalibration {
  const { live, canvasRef, cameraProfile, onCalibrated, setPhase } = deps;

  const startAuto = useCallback((): void => {
    live.current.probe = null;
    live.current.pendingCard = null;
    live.current.auto = new AutoCalibrationEngine();
    live.current.lastAutoKey = '';
    setPhase({ kind: 'mesure-auto', status: live.current.auto.status() });
  }, [live, setPhase]);

  /** Le moteur a conclu : on assemble UNE fois. Verrouillé par `auto = null`. */
  const finishAuto = useCallback((): void => {
    const m = live.current.auto?.measures() ?? null;
    live.current.auto = null;
    if (m === null) return;
    try {
      const out = calibrateAuto(m, canvasRef.current?.width ?? 1280, cameraProfile.current, Date.now());
      onCalibrated(out.cal, [
        `✅ Calibration acquise — c'est terminé (${m.usableFrames} images utiles). ` +
          `La collecte s'est arrêtée ; la caméra continue pour l'essayage.`,
        ...out.notes,
      ]);
    } catch (err) {
      // Grandeur hors plage anatomique : recommencer est la seule réparation.
      setPhase({ kind: 'mesure-auto', status: failedStatusOf(err) });
    }
  }, [live, canvasRef, cameraProfile, onCalibrated, setPhase]);

  const pump = useCallback(
    (lm: readonly NormalizedLandmark[] | null, yawRad: number, w: number, h: number): void => {
      const status = stepAutoCalibration(live.current, lm, yawRad, w, h, Date.now());
      if (status === null) return;
      if (status.state === 'calibrated') finishAuto();
      else setPhase({ kind: 'mesure-auto', status });
    },
    [live, finishAuto, setPhase],
  );

  return { startAuto, pump };
}

/** Un état d'échec affichable quand l'ASSEMBLAGE refuse (plage anatomique). */
function failedStatusOf(err: unknown): import('../core/autoCalibration.js').AutoStatus {
  return {
    state: 'failed',
    usableFrames: 0,
    neededFrames: 0,
    elapsedMs: 0,
    whyNotDone: {
      code: 'eyes-too-small',
      label: err instanceof Error ? err.message : String(err),
    },
    rejected: { 'no-face': 0, 'eyes-too-small': 0, 'turn-to-front': 0, 'straighten-head': 0 },
  };
}
