/**
 * ui/pdCarry.ts — la SURVIE du PD persistant (ré-audit A11, guide point 20).
 *
 * Scindé de `useAutoCalibration.ts` (règle des 300 lignes, §3). Deux aides
 * PURES, testées sans DOM :
 *
 *   - les capacités d'une calibration persistée sont SÉPARÉES : le total peut
 *     exister sans les demi-PD (séance interrompue avant la face stricte), et
 *     chaque manque relance SA collecte — pas « le PD » en bloc ;
 *   - un PD persistant n'est jamais jeté par une tentative qui n'a rien produit
 *     de mieux : quand le store n'a rien de frais, ses champs sont REPORTÉS
 *     dans la calibration suivante. C'est le point 20 (« une mesure validée
 *     n'est jamais supprimée par une autre ») étendu par-delà les
 *     rechargements. Une mesure fraîche, elle, remplace — c'est la nécessité.
 */

import type { UserCalibration } from '../core/calibration.js';
import type { PdAssembly } from '../core/pdAssembly.js';
import type { MetricSlot } from './measurementStore.js';

/** ⭐ A11 — ce que la calibration persistée SAIT déjà, capacité par capacité. */
export function missingPdCapacities(cal: UserCalibration): { hasPdTotal: boolean; hasHalfPd: boolean } {
  return {
    hasPdTotal: cal.pdMm !== undefined,
    hasHalfPd: cal.pdRightMm !== undefined && cal.pdLeftMm !== undefined,
  };
}

/** Ce que le panneau AFFICHE pour le PD — d'où que ça vienne, dit en clair. */
export interface PdDisplay {
  pdMm: number;
  uncertaintyMm: number;
  right: { mm: number; u: number } | null;
  left: { mm: number; u: number } | null;
  /** Images strictes quand la valeur vient du store ; null = séance mémorisée. */
  splitFrames: number | null;
  fromStore: boolean;
}

/**
 * ⭐ Ré-audit A12 — la valeur PD à AFFICHER : le store (plus frais) garde la
 * priorité, la calibration PERSISTÉE est le repli. Au rechargement d'une
 * séance, « PD total : 61,4 mm » s'affiche immédiatement — plus jamais « — »
 * avec une mesure mémorisée sous le tapis.
 */
export function pdDisplayOf(pd: MetricSlot<PdAssembly>, cal: UserCalibration | null): PdDisplay | null {
  if (pd.phase === 'ready' && pd.value !== null) {
    const v = pd.value;
    const halves = v.pdRightMm !== undefined && v.pdLeftMm !== undefined && v.pdHalfUncertaintyMm !== undefined;
    return {
      pdMm: v.pdMm,
      uncertaintyMm: v.pdMm * v.pdRelError,
      right: halves ? { mm: v.pdRightMm!, u: v.pdHalfUncertaintyMm!.right } : null,
      left: halves ? { mm: v.pdLeftMm!, u: v.pdHalfUncertaintyMm!.left } : null,
      splitFrames: v.splitFrames,
      fromStore: true,
    };
  }
  if (cal?.pdMm !== undefined) {
    const rel = cal.pdRelError ?? 0;
    const halves = cal.pdRightMm !== undefined && cal.pdLeftMm !== undefined;
    return {
      pdMm: cal.pdMm,
      uncertaintyMm: cal.pdMm * rel,
      right: halves ? { mm: cal.pdRightMm!, u: cal.pdHalfUncertaintyMm?.right ?? cal.pdRightMm! * rel } : null,
      left: halves ? { mm: cal.pdLeftMm!, u: cal.pdHalfUncertaintyMm?.left ?? cal.pdLeftMm! * rel } : null,
      splitFrames: null,
      fromStore: false,
    };
  }
  return null;
}

/** ⭐ A11 — les champs PD de la calibration PRÉCÉDENTE, reportés tels quels. */
export function carriedPdFields(prev: UserCalibration | null): Partial<UserCalibration> {
  if (prev?.pdMm === undefined) return {};
  return {
    pdMm: prev.pdMm,
    ...(prev.pdRelError !== undefined ? { pdRelError: prev.pdRelError } : {}),
    ...(prev.pdRightMm !== undefined && prev.pdLeftMm !== undefined
      ? { pdRightMm: prev.pdRightMm, pdLeftMm: prev.pdLeftMm }
      : {}),
    ...(prev.pdHalfUncertaintyMm !== undefined ? { pdHalfUncertaintyMm: prev.pdHalfUncertaintyMm } : {}),
  };
}
