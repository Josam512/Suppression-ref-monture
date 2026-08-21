/**
 * core/cameraProfile.ts — profil de focale d'un objectif/caméra.
 */

import { CalibrationError } from './geom.js';
import { FOCAL_MAX_REL, FOCAL_MIN_REL } from './cardPose.js';

export interface CameraProfile {
  focalPerWidth: number;
  relError: number;
  views: number;
  measuredAt: number;
  deviceId?: string;
}

export const FOCAL_SYSTEMATIC_FLOOR = 0.02;
export const MAX_USABLE_FOCAL_REL_ERROR = 0.15;
export const PROFILE_MAX_AGE_MS = 180 * 24 * 3600 * 1000;

export interface SweepLike {
  focalPx: number;
  focalRelError: number;
  views: number;
}

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

export function mergeProfile(stored: CameraProfile | null, fresh: CameraProfile): CameraProfile {
  if (
    stored !== null &&
    stored.deviceId !== undefined &&
    fresh.deviceId !== undefined &&
    stored.deviceId !== fresh.deviceId
  ) {
    return fresh;
  }
  if (stored === null) return fresh;

  const wa = 1 / stored.relError ** 2;
  const wb = 1 / fresh.relError ** 2;
  const focalPerWidth = (stored.focalPerWidth * wa + fresh.focalPerWidth * wb) / (wa + wb);
  const combined = 1 / Math.sqrt(wa + wb);
  const deviceId = fresh.deviceId ?? stored.deviceId;

  return {
    focalPerWidth,
    relError: Math.max(combined, FOCAL_SYSTEMATIC_FLOOR),
    views: stored.views + fresh.views,
    measuredAt: fresh.measuredAt,
    ...(deviceId !== undefined ? { deviceId } : {}),
  };
}

export function isProfileUsable(profile: CameraProfile | null, now: number): boolean {
  if (profile === null) return false;
  if (!Number.isFinite(profile.focalPerWidth) || !Number.isFinite(profile.relError)) return false;
  if (profile.focalPerWidth < FOCAL_MIN_REL || profile.focalPerWidth > FOCAL_MAX_REL) return false;
  if (profile.relError > MAX_USABLE_FOCAL_REL_ERROR) return false;
  return now - profile.measuredAt <= PROFILE_MAX_AGE_MS;
}

export function isProfileForDevice(profile: CameraProfile | null, deviceId: string | undefined): boolean {
  if (profile === null) return false;
  if (deviceId === undefined || deviceId.length === 0) return profile.deviceId === undefined;
  return profile.deviceId === deviceId;
}

export function focalPxFor(profile: CameraProfile, imageWidthPx: number): number {
  return profile.focalPerWidth * imageWidthPx;
}

export function parseCameraProfile(raw: unknown): CameraProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const nums = ['focalPerWidth', 'relError', 'views', 'measuredAt'] as const;
  for (const k of nums) {
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k] as number)) return null;
  }
  if (o['deviceId'] !== undefined && typeof o['deviceId'] !== 'string') return null;
  return {
    focalPerWidth: o['focalPerWidth'] as number,
    relError: o['relError'] as number,
    views: o['views'] as number,
    measuredAt: o['measuredAt'] as number,
    ...(typeof o['deviceId'] === 'string' ? { deviceId: o['deviceId'] } : {}),
  };
}
