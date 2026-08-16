/**
 * prep/fitCorrection.ts — ajuste la correction de largeur sur des mesures réelles.
 *
 * Ce module répond à une question qui n'était pas tranchable au moment du
 * contrat : **l'écart entre les repères 234/454 et la largeur réelle est-il un
 * décalage constant en millimètres, ou une proportion ?**
 *
 * Les deux premières mesures ne permettaient pas de choisir : +20,9 mm et
 * +14,3 mm en décalage, ×1,18 et ×1,12 en rapport, avec la même erreur
 * résiduelle. Plutôt que de trancher à l'intuition, on ajuste les DEUX modèles
 * et on laisse une validation croisée décider — c'est-à-dire qu'on mesure la
 * capacité de chacun à prédire un visage qu'il n'a PAS vu.
 *
 * ⚠️ Un modèle à un paramètre, pas un réseau. C'est délibéré : avec quelques
 * dizaines de mesures, tout ce qui a plus d'un paramètre libre apprendra le
 * bruit. Le jour où les mesures se comptent en centaines, le point d'entrée
 * pour un modèle plus riche est ici, et le protocole de validation aussi.
 */

import { median } from './stats.js';

/** Une mesure : ce que lisent les repères, et ce que vaut réellement le visage. */
export interface Measurement {
  /** Identifiant de la personne — sert à ne pas valider un visage contre lui-même. */
  sujet: string;
  /** Largeur lue sur les repères 234/454, en mm. */
  landmarkMm: number;
  /** Largeur réelle : au compas, ou celle d'une monture jugée bien ajustée. */
  reelleMm: number;
  /** D'où vient `reelleMm`. Traçabilité — n'entre dans aucun calcul. */
  origine: 'compas' | 'monture-jugee' | 'monture-portee';
}

export type Modele = 'decalage' | 'rapport';

export interface Ajustement {
  modele: Modele;
  /** Décalage en mm si `decalage`, facteur multiplicatif si `rapport`. */
  parametre: number;
  /** Erreur médiane en validation croisée, en mm. C'est elle qui compte. */
  erreurLoocvMm: number;
  n: number;
  sujets: number;
}

/** Sous ce nombre de mesures, aucun ajustement n'est publiable. */
export const MIN_MEASUREMENTS = 8;
/** Au-delà de cette erreur croisée, la constante ne vaut pas mieux que rien. */
export const MAX_LOOCV_ERROR_MM = 3;

function fitParam(rows: readonly Measurement[], modele: Modele): number {
  return modele === 'decalage'
    ? median(rows.map((r) => r.reelleMm - r.landmarkMm))
    : median(rows.map((r) => r.reelleMm / r.landmarkMm));
}

export function predict(landmarkMm: number, modele: Modele, parametre: number): number {
  return modele === 'decalage' ? landmarkMm + parametre : landmarkMm * parametre;
}

/**
 * Validation croisée **par sujet**, pas par mesure.
 *
 * ⚠️ Retirer une seule photo d'une personne alors que ses autres photos restent
 * dans l'ajustement ne mesure rien : le modèle a déjà vu ce visage. On retire
 * donc toutes les mesures d'un sujet à la fois. C'est la différence entre
 * « mon modèle sait interpoler » et « mon modèle marchera sur un inconnu » —
 * et seule la seconde question intéresse un client à distance.
 */
export function loocvErrorMm(rows: readonly Measurement[], modele: Modele): number {
  const sujets = [...new Set(rows.map((r) => r.sujet))];
  if (sujets.length < 2) return NaN;

  const erreurs: number[] = [];
  for (const sujet of sujets) {
    const entrainement = rows.filter((r) => r.sujet !== sujet);
    const test = rows.filter((r) => r.sujet === sujet);
    if (entrainement.length === 0) continue;
    const p = fitParam(entrainement, modele);
    for (const r of test) {
      erreurs.push(Math.abs(predict(r.landmarkMm, modele, p) - r.reelleMm));
    }
  }
  return median(erreurs);
}

/** Ajuste les deux modèles et retient celui qui prédit le mieux un visage inconnu. */
export function fitCorrection(rows: readonly Measurement[]): Ajustement | null {
  if (rows.length === 0) return null;

  const candidats: Ajustement[] = (['decalage', 'rapport'] as const).map((modele) => ({
    modele,
    parametre: fitParam(rows, modele),
    erreurLoocvMm: loocvErrorMm(rows, modele),
    n: rows.length,
    sujets: new Set(rows.map((r) => r.sujet)).size,
  }));

  const utilisables = candidats.filter((c) => Number.isFinite(c.erreurLoocvMm));
  if (utilisables.length === 0) return candidats[0] ?? null;
  return utilisables.reduce((a, b) => (b.erreurLoocvMm < a.erreurLoocvMm ? b : a));
}

/**
 * Un ajustement a-t-il le droit d'être figé dans `core/verdict.ts` ?
 *
 * Même discipline que le protocole du §5 : on refuse plutôt que de publier une
 * constante qui aurait l'air d'une mesure sans en être une.
 */
export function publiable(a: Ajustement | null): boolean {
  return (
    a !== null &&
    a.n >= MIN_MEASUREMENTS &&
    a.sujets >= 3 &&
    Number.isFinite(a.erreurLoocvMm) &&
    a.erreurLoocvMm <= MAX_LOOCV_ERROR_MM
  );
}

/** Les deux lignes à recopier dans `core/verdict.ts`, ou la raison du refus. */
export function rendu(a: Ajustement | null): string {
  if (a === null) return 'Aucune mesure : la correction reste à 0, la légende est décalée.';
  if (!publiable(a)) {
    return (
      `Non publiable — ${a.n} mesure(s) sur ${a.sujets} sujet(s), erreur croisée ` +
      `${a.erreurLoocvMm.toFixed(1)} mm. Il en faut ${MIN_MEASUREMENTS} sur 3 sujets, ` +
      `sous ${MAX_LOOCV_ERROR_MM} mm.`
    );
  }
  return a.modele === 'decalage'
    ? `export const FACE_WIDTH_CORRECTION_MM = ${a.parametre.toFixed(1)};\n` +
        `export const FACE_WIDTH_CORRECTION_RATIO = 1;`
    : `export const FACE_WIDTH_CORRECTION_MM = 0;\n` +
        `export const FACE_WIDTH_CORRECTION_RATIO = ${a.parametre.toFixed(4)};`;
}
