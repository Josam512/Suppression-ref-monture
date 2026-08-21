/**
 * ui/calibrationStorage.ts — la mesure du client survit à la fermeture d'onglet.
 *
 * 🔴 C'est la contrepartie de tout ce que la séance filmée demande. Le client
 * tient sa carte, pointe deux repères et tourne la tête **une seule fois** ; à
 * partir de là son visage est connu en millimètres et devient sa propre règle
 * graduée (§4). Sans cette persistance, on lui redemanderait sa carte à chaque
 * monture, et la friction dépasserait de loin le bénéfice.
 *
 * ⚠️ Rien n'est vérifié ici au-delà de la forme : une calibration relue est
 * traitée comme n'importe quelle autre. C'est voulu — le contrôle de
 * plausibilité (§4, B5) a déjà eu lieu au moment de la mesure, et le refaire
 * ici sur des données qui l'ont passé n'ajouterait rien.
 */

import type { UserCalibration } from '../core/calibration.js';

const STORAGE_KEY = 'essayage.calibration.v1';

/** La calibration mémorisée, ou `null`. Un stockage illisible n'est pas une panne. */
export function loadCalibration(): UserCalibration | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : (JSON.parse(raw) as UserCalibration);
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cal));
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
