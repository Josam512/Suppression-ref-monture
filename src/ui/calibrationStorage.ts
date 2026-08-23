/**
 * ui/calibrationStorage.ts — la mesure du client survit à la fermeture d'onglet.
 *
 * Guide de fiabilisation (points 58, 60, compléments 43–44) :
 *
 *   - l'enveloppe stockée porte `AUTO_METROLOGY_VERSION`. Une calibration
 *     d'une AUTRE version n'est pas jetée en bloc : sa largeur de visage —
 *     qui ne pilote que l'échelle de rendu — est conservée si elle reste
 *     plausible, ses parties MÉTROLOGIQUES (PD, temporal, distance) sont
 *     invalidées et recollectées en arrière-plan (`startMissing`). Un
 *     algorithme neuf ne tourne plus jamais sur des chiffres d'un ancien ;
 *   - chaque champ est VALIDÉ à la relecture : un stockage corrompu rend les
 *     champs valides, jamais une exception ni une valeur par défaut ;
 *   - lecture ET écriture sont insubmersibles : un stockage plein ou interdit
 *     n'est pas une panne de session (point 60).
 */

import type { UserCalibration, CalSource } from '../core/calibration.js';
import { FACE_WIDTH_MAX_MM, FACE_WIDTH_MIN_MM } from '../core/calibration.js';
import { PD_MAX_MM, PD_MIN_MM } from '../core/autoCalibrate.js';
// prettier-ignore
import { AUTO_METROLOGY_VERSION, DISTANCE_ALGO_VERSION, FACE_SCALE_ALGO_VERSION, PD_ALGO_VERSION, TEMPORAL_ALGO_VERSION } from '../core/versions.js';
import { currentPersonId, PERSON_STORAGE_KEY } from './personSession.js';

const STORAGE_KEY = 'essayage.calibration.v1';

/**
 * ⭐ Ré-audit A17a — une métrique stockée sous la version V n'est relue que si
 * l'algorithme ACTUEL de cette métrique existait déjà en V (ALGO ≤ V) et que V
 * n'est pas du futur (V ≤ version courante). Chaque grandeur a SA version
 * (`core/versions.ts`) : corriger la largeur demain = bump de SA version, et
 * les largeurs anciennes tombent mécaniquement.
 */
export function metricCompatible(storedVersion: number, algoVersion: number): boolean {
  return storedVersion >= algoVersion && storedVersion <= AUTO_METROLOGY_VERSION;
}

const SOURCES: readonly CalSource[] = ['iris', 'card', 'worn-frame', 'auto'];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Valide champ par champ, migre ce qui est sûr, invalide SEULEMENT le reste
 * (complément 44). Rend `null` quand même la largeur — le socle du rendu —
 * n'est pas exploitable, quand l'enveloppe vient du FUTUR, ou quand elle
 * décrit une AUTRE personne (A17b).
 */
export function parseStoredCalibration(raw: unknown, expectedPersonId: string | null = null): UserCalibration | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const envelope = raw as { v?: unknown; cal?: unknown; personId?: unknown };
  // Enveloppe versionnée, ou forme HISTORIQUE (la calibration nue, sans `v`).
  const version = typeof envelope.v === 'number' ? envelope.v : 1;
  // Une enveloppe du FUTUR (version > courante) : schéma inconnu, rien n'est relu.
  if (version > AUTO_METROLOGY_VERSION) return null;
  // ⭐ A17b — la calibration décrit une PERSONNE : celle d'un AUTRE client
  // n'est jamais relue. `personId` absent = donnée d'avant la notion,
  // acceptée une fois (migration) ; la prochaine écriture l'estampille.
  const personId = typeof envelope.personId === 'string' ? envelope.personId : null;
  if (expectedPersonId !== null && personId !== null && personId !== expectedPersonId) return null;
  const o = (typeof envelope.cal === 'object' && envelope.cal !== null ? envelope.cal : raw) as Record<
    string,
    unknown
  >;

  const faceWidthMm = num(o['faceWidthMm']);
  const relError = num(o['relError']);
  const measuredAt = num(o['measuredAt']);
  const source = SOURCES.includes(o['source'] as CalSource) ? (o['source'] as CalSource) : null;
  if (
    faceWidthMm === null ||
    faceWidthMm < FACE_WIDTH_MIN_MM ||
    faceWidthMm > FACE_WIDTH_MAX_MM ||
    relError === null ||
    relError <= 0 ||
    relError >= 1 ||
    measuredAt === null ||
    source === null
  ) {
    return null;
  }

  // ⭐ A17a — le SOCLE (largeur) a sa propre version d'algorithme : si elle
  // change un jour, les largeurs anciennes tombent ici, mécaniquement.
  if (!metricCompatible(version, FACE_SCALE_ALGO_VERSION)) return null;
  const cal: UserCalibration = { faceWidthMm, source, relError, measuredAt };

  // ⭐ Points 58/A17a — chaque métrique traverse selon SA version d'algo :
  // incompatible → à remesurer (recollecte d'arrière-plan, startMissing).
  if (metricCompatible(version, PD_ALGO_VERSION)) {
    const pdMm = num(o['pdMm']);
    const pdRelError = num(o['pdRelError']);
    if (pdMm !== null && pdMm >= PD_MIN_MM && pdMm <= PD_MAX_MM && pdRelError !== null && pdRelError > 0) {
      cal.pdMm = pdMm;
      cal.pdRelError = pdRelError;
      const pdLeftMm = num(o['pdLeftMm']);
      const pdRightMm = num(o['pdRightMm']);
      const unc = o['pdHalfUncertaintyMm'] as { left?: unknown; right?: unknown } | undefined;
      const uL = num(unc?.left);
      const uR = num(unc?.right);
      if (pdLeftMm !== null && pdRightMm !== null && uL !== null && uR !== null) {
        cal.pdLeftMm = pdLeftMm;
        cal.pdRightMm = pdRightMm;
        cal.pdHalfUncertaintyMm = { left: uL, right: uR };
      }
    }
  }

  if (metricCompatible(version, TEMPORAL_ALGO_VERSION)) {
    const temporalWidthMm = num(o['temporalWidthMm']);
    const temporalRelError = num(o['temporalRelError']);
    if (
      temporalWidthMm !== null &&
      temporalWidthMm >= FACE_WIDTH_MIN_MM &&
      temporalWidthMm <= FACE_WIDTH_MAX_MM &&
      temporalRelError !== null &&
      temporalRelError > 0
    ) {
      cal.temporalWidthMm = temporalWidthMm;
      cal.temporalRelError = temporalRelError;
    }
  }

  if (metricCompatible(version, DISTANCE_ALGO_VERSION)) {
    const distanceMm = num(o['distanceMm']);
    if (distanceMm !== null && distanceMm > 0) cal.distanceMm = distanceMm;
  }

  return cal;
}

/** La calibration mémorisée DE LA PERSONNE COURANTE, ou `null` (A17b). */
export function loadCalibration(): UserCalibration | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : parseStoredCalibration(JSON.parse(raw) as unknown, currentPersonId());
  } catch {
    return null;
  }
}

export function saveCalibration(cal: UserCalibration): void {
  // 🔴 Guide point 60 — cette écriture est appelée depuis la boucle de rendu
  // (la calibration conclut PENDANT une frame) : un stockage plein ou interdit
  // (navigation privée, quota) levait DANS la boucle et tuait la séance. La
  // session mémoire continue ; seule la persistance est perdue.
  try {
    // ⭐ A17b — estampillée avec la PERSONNE : un autre client ne la relira pas.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: AUTO_METROLOGY_VERSION, personId: currentPersonId(), cal }),
    );
  } catch {
    // Stockage indisponible : la prochaine session remesurera. Rien ne bloque.
  }
}

/** « Refaire la calibration » : on jette, et la séance recommence à zéro. */
export function clearCalibration(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Même règle : l'absence de stockage n'est jamais une panne de session.
  }
}

/** Les clés que `?resetSession=1` purge (outil de banc, point 59). La mémoire
 *  de stratégie négociée en fait partie : les bancs renégocient à vierge. */
export const SESSION_STORAGE_KEYS = [STORAGE_KEY, 'essayage.camera.v1', PERSON_STORAGE_KEY, 'essayage.detection.v1'] as const;
