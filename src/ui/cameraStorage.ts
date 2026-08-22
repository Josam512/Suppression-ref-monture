/**
 * ui/cameraStorage.ts — persistance du profil d'objectif.
 *
 * ⚠️ Clé SÉPARÉE de celle de la calibration, et c'est délibéré : la calibration
 * décrit un VISAGE, le profil décrit un OBJECTIF. « Refaire la calibration » ne
 * doit pas jeter une focale déjà mesurée — elle reste vraie pour le même
 * appareil, et c'est justement ce qui évite de retomber sur le champ de vision
 * supposé (`core/cardOptics.ts`), faux de 46 % sur le premier sujet réel.
 *
 * 🔴 Ré-audit A17c — l'enveloppe est VERSIONNÉE (`CAMERA_PROFILE_VERSION`) :
 * un profil écrit sous un AUTRE schéma est refusé proprement (la séance
 * remesure) au lieu d'alimenter l'optique avec une forme inconnue. La forme
 * HISTORIQUE (profil nu, d'avant l'enveloppe — même schéma que l'actuel) est
 * acceptée une fois, validée champ par champ ; la prochaine écriture
 * l'enveloppe.
 */

import { parseCameraProfile, type CameraProfile } from '../core/cameraProfile.js';
import { CAMERA_PROFILE_VERSION } from '../core/versions.js';

const CAMERA_KEY = 'essayage.camera.v1';

/** Relit l'enveloppe versionnée — exportée pour le banc (A17c). */
export function parseStoredCameraProfile(raw: unknown): CameraProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const envelope = raw as { v?: unknown; profile?: unknown };
  if (envelope.v !== undefined || envelope.profile !== undefined) {
    // Autre version de schéma (passée OU future) : refus PROPRE — la séance
    // repart sur le champ supposé et remesurera, rien ne casse.
    if (envelope.v !== CAMERA_PROFILE_VERSION) return null;
    return parseCameraProfile(envelope.profile);
  }
  return parseCameraProfile(raw); // forme historique nue, validée champ par champ
}

export function loadCameraProfile(): CameraProfile | null {
  try {
    const raw = localStorage.getItem(CAMERA_KEY);
    return raw === null ? null : parseStoredCameraProfile(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveCameraProfile(profile: CameraProfile): void {
  try {
    localStorage.setItem(CAMERA_KEY, JSON.stringify({ v: CAMERA_PROFILE_VERSION, profile }));
  } catch {
    // Stockage indisponible (navigation privée, quota) : ce n'est pas une
    // panne. La séance en cours garde son profil en mémoire ; la suivante
    // remesurera. Rien ne doit bloquer l'essayage (§0.0.2).
  }
}
