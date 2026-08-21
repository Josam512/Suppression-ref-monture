/**
 * ui/calibrationStorage.ts — persistance de la calibration client.
 *
 * Une calibration automatique dépend de l'algorithme qui l'a produite. Les
 * anciennes calibrations AUTO sont donc invalidées après une refonte du calcul,
 * tandis que les vérités terrain externes (carte / monture portée) restent
 * réutilisables.
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

  // Audit prédictif : localStorage peut lever (navigation privée, politique
  // d'entreprise, quota, WebView). L'ancienne version laissait l'exception
  // remonter jusque dans `finishAuto()`, qui la prenait alors pour un ÉCHEC DE
  // MÉTROLOGIE, recréait le moteur et recommençait la calibration. Une panne de
  // stockage pouvait donc provoquer une boucle de mesures parfaitement valides.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // La séance en mémoire reste valide. La prochaine session recalibrera.
  }
}

export function clearCalibration(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Idem : l'absence de stockage persistant ne doit jamais bloquer le live.
  }
}
