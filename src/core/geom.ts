/**
 * core/geom.ts — utilitaires partagés, écrits UNE fois (CLAUDE.md §7).
 *
 * Ne jamais réimplémenter localement l'une de ces fonctions : deux définitions
 * de la même géométrie finissent toujours par diverger.
 *
 * ZONE CRITIQUE : aucune dépendance UI, aucune dépendance MediaPipe.
 */

export interface Pt {
  x: number;
  y: number;
}

/**
 * Landmark normalisé (0..1) tel que renvoyé par MediaPipe FaceLandmarker.
 * Redéfini ici plutôt qu'importé : `core/` doit rester testable sans le
 * moindre paquet externe.
 */
export interface NormalizedLandmark {
  x: number;
  y: number;
  z?: number;
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

export const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Landmark MediaPipe normalisé (0..1) → pixels image. */
export const px = (l: NormalizedLandmark, w: number, h: number): Pt => ({ x: l.x * w, y: l.y * h });

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Accès indexé sûr à un tableau de landmarks.
 *
 * `noUncheckedIndexedAccess` est activé volontairement : un index MediaPipe
 * absent doit lever une erreur nommée, jamais produire un `undefined` qui se
 * propage en `NaN` jusqu'à l'écran. Un NaN silencieux dans la chaîne de mesure
 * est exactement le mode d'échec que ce projet combat (§0).
 */
export function at(lm: readonly NormalizedLandmark[], index: number): NormalizedLandmark {
  const l = lm[index];
  if (l === undefined) {
    throw new CalibrationError(
      `Landmark ${index} absent : le modèle a renvoyé ${lm.length} points au lieu de 478. ` +
        `Modèle mal chargé, ou visage non détecté sur cette frame.`,
    );
  }
  return l;
}

/**
 * Codes TYPÉS des refus de mesure (complément 3).
 *
 * `failedStatusOf` rabattait toutes les erreurs d'assemblage sur
 * « eyes-too-small » : l'utilisateur était envoyé se rapprocher de la caméra
 * alors que le vrai problème était un PD aberrant ou une distance invalide.
 * Chaque refus porte désormais son code ; l'UI mappe le code sur la consigne.
 */
export type MetricFailureCode =
  | 'pd-out-of-range'
  | 'face-width-out-of-range'
  | 'invalid-distance'
  | 'insufficient-half-pd'
  | 'metric-assembly-error'
  | 'internal-error';

export class CalibrationError extends Error {
  /** Nommé quand le refus est un échec d'assemblage métrique ; sinon absent. */
  readonly code: MetricFailureCode | null;

  constructor(message: string, code: MetricFailureCode | null = null) {
    super(message);
    this.name = 'CalibrationError';
    this.code = code;
  }
}

/** Le code d'un refus, quel que soit ce qui a été levé (complément 3). */
export function failureCodeOf(err: unknown): MetricFailureCode {
  if (err instanceof CalibrationError && err.code !== null) return err.code;
  if (err instanceof CalibrationError) return 'metric-assembly-error';
  return 'internal-error';
}
