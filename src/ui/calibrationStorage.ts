/**
 * ui/calibrationStorage.ts — persistance de la calibration client.
 *
 * Audit 2026-08-21 : une calibration automatique dépend de l'algorithme qui
 * l'a produite. La relire aveuglément après une refonte de l'échelle peut faire
 * croire qu'un nouveau build ne change rien alors que l'application réutilise
 * simplement une ancienne largeur de visage. Les calibrations auto portent
 * donc désormais une version d'algorithme.
 */

import type { UserCalibration } from '../core/calibration.js';

const STORAGE_KEY = 'essayage.calibration.v1';
const AUTO_ALGO_VERSION = 2;
const VERSION_FIELD = '__autoAlgoVersion';

type StoredCalibration = UserCalibration & { __autoAlgoVersion?: number };

function structurallyValid(x: unknown): x is StoredCalibration {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o['faceWidthMm'] === 'number' && Number.isFinite(o['faceWidthMm']) &&
    typeof o['relError'] === 'number' && Number.isFinite(o['relError']) &&
    typeof o['measuredAt'] === 'number' && Number.isFinite(o['measuredAt']) &&
    (o['source'] === 'iris' || o['source'] === 'card' || o['source'] === 'worn-frame' || o['source'] === 'auto')
  );
}

export function loadCalibration(): UserCalibration | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!structurallyValid(parsed)) return null;

    // Les anciennes calibrations AUTO sont volontairement invalidées : elles
    // peuvent venir d'un algorithme de plan/iris que l'audit vient de changer.
    // Les calibrations carte / monture portée restent utilisables : leur
    // vérité terrain externe ne dépend pas du nouvel estimateur auto.
    if (parsed.source === 'auto' && parsed.__autoAlgoVersion !== AUTO_ALGO_VERSION) return null;

    const { __autoAlgoVersion: _ignored, ...cal } = parsed;
    return cal;
  } catch {
    return null;
  }
}

export function saveCalibration(cal: UserCalibration): void {
  const stored: StoredCalibration =
    cal.source === 'auto'
      ? { ...cal, [VERSION_FIELD]: AUTO_ALGO_VERSION }
      : { ...cal };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function clearCalibration(): void {
  localStorage.removeItem(STORAGE_KEY);
}
