/**
 * ui/personSession.ts — la notion de SESSION CLIENT (ré-audit A17b).
 *
 * Un poste partagé (magasin, ordinateur familial) sert PLUSIEURS personnes.
 * La calibration décrit une PERSONNE ; le profil d'objectif décrit le POSTE.
 * Sans cette distinction, le client B héritait silencieusement du PD et de la
 * largeur de visage du client A — le pire mode d'échec du projet : une mesure
 * fausse qui a l'air excellente.
 *
 * Le mécanisme est volontairement SIMPLE : un identifiant de personne persiste
 * avec la calibration ; `rotatePersonId()` ouvre la session du client suivant
 * — les calibrations du précédent portent un autre identifiant et ne seront
 * plus jamais relues. Le profil caméra, lui, n'est pas touché : la focale est
 * une propriété du poste. En mode magasin, l'IHM ne recharge de toute façon
 * JAMAIS une calibration au démarrage (TryOn) : nouveau client par défaut.
 */

export const PERSON_STORAGE_KEY = 'essayage.person.v1';

let memoryId: string | null = null;

function freshId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Contexte non sécurisé : un identifiant de session mémoire suffit.
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** L'identifiant de la personne COURANTE — créé et persisté au premier appel. */
export function currentPersonId(): string {
  if (memoryId !== null) return memoryId;
  try {
    const stored = localStorage.getItem(PERSON_STORAGE_KEY);
    if (stored !== null && stored !== '') {
      memoryId = stored;
      return stored;
    }
    memoryId = freshId();
    localStorage.setItem(PERSON_STORAGE_KEY, memoryId);
    return memoryId;
  } catch {
    // Stockage mort : identité de session mémoire — la calibration ne
    // persisterait de toute façon pas (point 60, rien ne bloque).
    memoryId = freshId();
    return memoryId;
  }
}

/** ⭐ « Nouveau client » : la session suivante ne relira RIEN du précédent. */
export function rotatePersonId(): string {
  memoryId = freshId();
  try {
    localStorage.setItem(PERSON_STORAGE_KEY, memoryId);
  } catch {
    // Même règle : l'absence de stockage n'est jamais une panne de session.
  }
  return memoryId;
}
