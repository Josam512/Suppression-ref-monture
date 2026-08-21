/**
 * core/cameraProfile.ts — la focale est une propriété de l'APPAREIL, pas de la photo.
 *
 * ## Le trou que ce fichier ferme
 *
 * Le balayage mesurait déjà la focale (`core/cardSweep.ts`), s'en servait une
 * fois pour convertir une distance… puis la jetait. À la calibration suivante,
 * ou si le client passait la rotation, la chaîne retombait sur le champ de
 * vision SUPPOSÉ de `core/cardOptics.ts` — celui qui, sur le premier sujet réel,
 * s'est révélé faux de 46 % (78 cm supposés pour 42 mesurés).
 *
 * Or une focale ne change pas entre deux séances : c'est l'objectif du client.
 * Mesurée une fois, elle vaut pour toutes les vues suivantes — et une vue
 * frontale unique, qui ne peut PAS porter la focale, redonne alors une distance
 * juste par simple division (`cardDistanceWithFocal`).
 *
 * ## Ce qui est stocké, et pourquoi sous cette forme
 *
 * 🔴 On ne stocke JAMAIS une focale en pixels. Elle dépend de la résolution de
 * capture, qui change d'une session à l'autre (webcam qui négocie 1280×720 puis
 * 640×480, téléphone qui bascule de caméra). On stocke le RAPPORT
 * `focale / largeur d'image`, qui est une propriété géométrique de l'objectif —
 * invariante par redimensionnement.
 */

import { CalibrationError } from './geom.js';
import { FOCAL_MAX_REL, FOCAL_MIN_REL } from './cardPose.js';

/**
 * ⭐ Identité de l'OBJECTIF qui a produit un profil (guide points 39–40,
 * compléments 23–24) : un profil de caméra arrière ne doit jamais contaminer
 * la caméra frontale, ni celui d'un autre appareil. Chaque champ est optionnel
 * — les navigateurs ne les donnent pas tous — et l'incompatibilité ne se
 * prononce que sur les champs CONNUS DES DEUX côtés.
 */
export interface CameraIdentity {
  deviceId?: string;
  facingMode?: string;
  /** largeur/hauteur de capture — un crop 4:3 → 16:9 change l'optique effective. */
  aspect?: number;
}

export interface CameraProfile extends CameraIdentity {
  /** Focale ÷ largeur d'image. Invariante par changement de résolution. */
  focalPerWidth: number;
  /** Incertitude relative, jamais sous le plancher systématique ci-dessous. */
  relError: number;
  /** Nombre de vues cumulées qui l'ont produite, toutes séances confondues. */
  views: number;
  measuredAt: number;
}

/** Tolérance de rapport d'image : au-delà, le cadrage n'est plus le même. */
export const ASPECT_TOLERANCE = 0.05;

/**
 * Deux identités sont-elles compatibles ? `true` quand rien ne les CONTREDIT :
 * un champ absent d'un côté ne condamne pas — refuser un profil parce qu'un
 * navigateur ne donne pas le deviceId pénaliserait tout le monde.
 */
export function identityCompatible(a: CameraIdentity, b: CameraIdentity): boolean {
  if (a.deviceId !== undefined && b.deviceId !== undefined && a.deviceId !== b.deviceId) return false;
  if (a.facingMode !== undefined && b.facingMode !== undefined && a.facingMode !== b.facingMode) return false;
  if (
    a.aspect !== undefined &&
    b.aspect !== undefined &&
    Math.abs(a.aspect / b.aspect - 1) > ASPECT_TOLERANCE
  ) {
    return false;
  }
  return true;
}

/**
 * Plancher d'incertitude sur la focale, non réductible par moyennage.
 *
 * ⚠️ Même discipline que `IRIS_REL_ERROR` (§4). Empiler des séances fait
 * baisser le BRUIT de pointage, pas les biais systématiques de la méthode :
 * distorsion de l'objectif, point principal supposé au centre de l'image,
 * pixels supposés carrés. Aucun de ces trois-là ne se moyenne. Annoncer mieux
 * que ce plancher serait annoncer une précision qu'on n'a pas vérifiée.
 */
export const FOCAL_SYSTEMATIC_FLOOR = 0.02;

/** Au-delà, le profil ne vaut pas mieux que l'a priori : on ne s'en sert pas. */
export const MAX_USABLE_FOCAL_REL_ERROR = 0.15;

/** Un profil trop vieux n'est pas invalide — mais l'appareil a pu changer. */
export const PROFILE_MAX_AGE_MS = 180 * 24 * 3600 * 1000; // ~6 mois

export interface SweepLike {
  focalPx: number;
  focalRelError: number;
  views: number;
}

/**
 * Profil issu d'un balayage, normalisé par la largeur d'image.
 *
 * @throws si la focale mesurée sort des bornes de plausibilité : un profil
 *         absurde persisté contaminerait toutes les séances suivantes, ce qui
 *         est bien pire qu'une séance ratée.
 */
export function profileFromSweep(
  sweep: SweepLike,
  imageWidthPx: number,
  now: number,
): CameraProfile {
  if (imageWidthPx <= 0) throw new CalibrationError('Largeur d’image nulle : profil impossible.');
  const focalPerWidth = sweep.focalPx / imageWidthPx;

  if (focalPerWidth < FOCAL_MIN_REL || focalPerWidth > FOCAL_MAX_REL) {
    throw new CalibrationError(
      `Objectif mesuré à ${focalPerWidth.toFixed(2)} × la largeur d'image, hors de tout ` +
        `plausible. Profil non enregistré.`,
    );
  }
  return {
    focalPerWidth,
    relError: Math.max(sweep.focalRelError, FOCAL_SYSTEMATIC_FLOOR),
    views: sweep.views,
    measuredAt: now,
  };
}

/**
 * Combine un profil déjà connu avec une nouvelle mesure.
 *
 * Pondération par l'inverse de la variance : la mesure la plus sûre pèse le
 * plus. C'est le seul estimateur qui ne privilégie ni le passé ni le présent.
 *
 * ⚠️ Le résultat ne descend jamais sous `FOCAL_SYSTEMATIC_FLOOR`, quel que soit
 * le nombre de séances accumulées.
 */
export function mergeProfile(stored: CameraProfile | null, fresh: CameraProfile): CameraProfile {
  if (stored === null) return fresh;
  // 🔴 Complément 24 — JAMAIS fusionner deux appareils : identités
  // incompatibles → la mesure fraîche remplace, elle ne se mélange pas.
  if (!identityCompatible(stored, fresh)) return fresh;

  const wa = 1 / stored.relError ** 2;
  const wb = 1 / fresh.relError ** 2;
  const focalPerWidth = (stored.focalPerWidth * wa + fresh.focalPerWidth * wb) / (wa + wb);
  const combined = 1 / Math.sqrt(wa + wb);

  return {
    focalPerWidth,
    relError: Math.max(combined, FOCAL_SYSTEMATIC_FLOOR),
    views: stored.views + fresh.views,
    measuredAt: fresh.measuredAt,
    // L'identité s'enrichit : ce que la fraîche connaît prime, le reste survit.
    ...(stored.deviceId !== undefined || fresh.deviceId !== undefined
      ? { deviceId: fresh.deviceId ?? stored.deviceId }
      : {}),
    ...(stored.facingMode !== undefined || fresh.facingMode !== undefined
      ? { facingMode: fresh.facingMode ?? stored.facingMode }
      : {}),
    ...(stored.aspect !== undefined || fresh.aspect !== undefined
      ? { aspect: fresh.aspect ?? stored.aspect }
      : {}),
  };
}

/** Vrai si ce profil peut remplacer l'a priori de champ de vision. */
export function isProfileUsable(profile: CameraProfile | null, now: number): boolean {
  if (profile === null) return false;
  if (!Number.isFinite(profile.focalPerWidth) || !Number.isFinite(profile.relError)) return false;
  if (profile.focalPerWidth < FOCAL_MIN_REL || profile.focalPerWidth > FOCAL_MAX_REL) return false;
  if (profile.relError > MAX_USABLE_FOCAL_REL_ERROR) return false;
  return now - profile.measuredAt <= PROFILE_MAX_AGE_MS;
}

/** Focale en pixels pour CETTE résolution. C'est ici que la normalisation se défait. */
export function focalPxFor(profile: CameraProfile, imageWidthPx: number): number {
  return profile.focalPerWidth * imageWidthPx;
}

/** Relit un profil venant du stockage, sans jamais faire confiance à sa forme. */
export function parseCameraProfile(raw: unknown): CameraProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const nums = ['focalPerWidth', 'relError', 'views', 'measuredAt'] as const;
  for (const k of nums) {
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k] as number)) return null;
  }
  return {
    focalPerWidth: o['focalPerWidth'] as number,
    relError: o['relError'] as number,
    views: o['views'] as number,
    measuredAt: o['measuredAt'] as number,
    ...(typeof o['deviceId'] === 'string' ? { deviceId: o['deviceId'] } : {}),
    ...(typeof o['facingMode'] === 'string' ? { facingMode: o['facingMode'] } : {}),
    ...(typeof o['aspect'] === 'number' && Number.isFinite(o['aspect']) ? { aspect: o['aspect'] as number } : {}),
  };
}
