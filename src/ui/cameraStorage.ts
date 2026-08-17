/**
 * ui/cameraStorage.ts — persistance du profil d'objectif.
 *
 * ⚠️ Clé SÉPARÉE de celle de la calibration, et c'est délibéré : la calibration
 * décrit un VISAGE, le profil décrit un OBJECTIF. « Refaire la calibration » ne
 * doit pas jeter une focale déjà mesurée — elle reste vraie pour le même
 * appareil, et c'est justement ce qui évite de retomber sur le champ de vision
 * supposé (`core/cardOptics.ts`), faux de 46 % sur le premier sujet réel.
 */

import { parseCameraProfile, type CameraProfile } from '../core/cameraProfile.js';

const CAMERA_KEY = 'essayage.camera.v1';

export function loadCameraProfile(): CameraProfile | null {
  try {
    const raw = localStorage.getItem(CAMERA_KEY);
    return raw === null ? null : parseCameraProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveCameraProfile(profile: CameraProfile): void {
  try {
    localStorage.setItem(CAMERA_KEY, JSON.stringify(profile));
  } catch {
    // Stockage indisponible (navigation privée, quota) : ce n'est pas une
    // panne. La séance en cours garde son profil en mémoire ; la suivante
    // remesurera. Rien ne doit bloquer l'essayage (§0.0.2).
  }
}
