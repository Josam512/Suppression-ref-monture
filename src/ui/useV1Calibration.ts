/**
 * ui/useV1Calibration.ts — la calibration de la vente en ligne, de bout en bout.
 *
 * ## Le déroulé, décidé par le CLIENT (arbitrages des 2026-08-18)
 *
 * > « fais juste une vidéo où j'ai la main pour me montrer de face et de profil,
 * > et que JE décide moi quand la vidéo est finie »
 * > « je te fous une photo de moi et c'est à moi à te dire où est la carte ? »
 *
 *   1. Il tient sa carte contre son visage et appuie sur « Je filme ».
 *   2. Il se montre de face, puis de profil des deux côtés, aussi longtemps
 *      qu'il veut. **Il ne montre rien, ne clique rien, ne vise rien.**
 *   3. Il appuie sur « J'ai fini ». Le calcul se fait alors, une fois.
 *
 * 🔴 **La carte est trouvée par la machine** (`core/cardFinder.ts`), sur chaque
 * image du film, et c'est la MÉDIANE des vues qui porte la mesure. Demander au
 * client de pointer les bords revenait à lui faire faire le travail — et sur une
 * image figée, en plus, alors qu'il avait demandé une vidéo.
 *
 * 🔴 **Rien d'automatique ne décide à sa place** — ni verrouillage, ni délai, ni
 * seuil de complétude. Le seul événement qui termine la séance est son doigt.
 *
 * ⚠️ Aucun raffinement n'est obligatoire. Chaque échec élargit la marge annoncée
 * et laisse une note ; **aucun ne renvoie le client à la case départ** — c'est
 * `core/cardAssembly.ts` qui en porte la garantie, et elle est testée.
 */

import { useCallback, useRef, type MutableRefObject, type RefObject } from 'react';

import { assembleCardCalibration } from '../core/cardAssembly.js';
import type { UserCalibration } from '../core/calibration.js';
import { refineQuad } from '../core/cardEdges.js';
import { consensusWidthRatio, findCard } from '../core/cardFinder.js';
import type { CardQuad } from '../core/cardPose.js';
import type { CameraProfile } from '../core/cameraProfile.js';
import { at, CalibrationError, dist, px, type NormalizedLandmark } from '../core/geom.js';
import { FACE_L, FACE_R } from '../core/faceMetrics.js';
import { motionMask, type ImageBuffer } from '../core/silhouette.js';
import type { Live } from './liveState.js';
import { RotationProbe } from './rotationProbe.js';

export interface V1CalibrationDeps {
  live: MutableRefObject<Live>;
  videoRef: RefObject<HTMLVideoElement | null>;
  onCalibrated(cal: UserCalibration, notes: string[]): void;
  /** La carte n'a jamais été vue, ou la mesure est aberrante. */
  onFailed(message: string): void;
  cameraProfile: CameraProfile | null;
  onCameraProfile(profile: CameraProfile): void;
}

/** Tolérance d'accrochage : la graine vient du détecteur, pas d'une main. */
const REFINE_TOLERANCE_PX = 25;

export interface V1Calibration {
  /** « Je filme » : la séance commence, compteurs à zéro. */
  start(): void;
  /** « J'ai fini » : on assemble. Appelée UNIQUEMENT par le client. */
  finish(): void;
}

export function useV1Calibration(deps: V1CalibrationDeps): V1Calibration {
  const { live, videoRef } = deps;

  /**
   * Canvas de lecture, réutilisé d'une image à l'autre.
   *
   * ⚠️ En créer un par image laisse au ramasse-miettes un canvas de 1280×720 à
   * chaque frame, pendant que la détection tourne. Invisible sur un portable de
   * développement, sensible sur un téléphone.
   */
  const off = useRef<HTMLCanvasElement | null>(null);

  const grab = useCallback((): ImageBuffer | null => {
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0) return null;

    off.current ??= document.createElement('canvas');
    const canvas = off.current;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return null;
    ctx.drawImage(video, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, [videoRef]);

  /**
   * Chercher la carte, puis accrocher ses bords.
   *
   * ⚠️ Les deux étapes sont nécessaires et différentes. `findCard` dit OÙ elle
   * est, en s'appuyant sur la géométrie du visage. `refineQuad` place ses quatre
   * coins sur les vrais pixels — et c'est de CES coins que sort la focale
   * (§14.5). Sans lui, le bord haut serait déduit de la norme ISO, donc le
   * quadrilatère serait un rectangle parfait, et le calcul de focale
   * dégénérerait : on lirait la perspective qu'on vient d'inventer.
   */
  const findAndRefine = useCallback(
    (buf: ImageBuffer, lm: readonly NormalizedLandmark[], w: number, h: number) => {
      const seen = findCard(buf, lm, w, h);
      if (seen === null) return null;

      let quad: CardQuad = seen.quad;
      try {
        quad = refineQuad(buf, seen.quad, REFINE_TOLERANCE_PX);
      } catch {
        // Bords introuvables sur cette image : on garde la graine du détecteur.
        // Elle vaut pour la largeur ; elle ne portera simplement pas la focale.
      }

      const faceWidthPx = dist(px(at(lm, FACE_L), w, h), px(at(lm, FACE_R), w, h));
      const widthPx = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
      if (!(faceWidthPx > 1) || !(widthPx > 1)) return null;
      return { quad, widthRatio: widthPx / faceWidthPx };
    },
    [],
  );

  const start = useCallback((): void => {
    live.current.probe = new RotationProbe(grab, findAndRefine);
    live.current.lastProbeRatio = -1;
  }, [live, grab, findAndRefine]);

  const finish = useCallback((): void => {
    const probe = live.current.probe;
    const frontal = probe?.frontal() ?? null;
    const ratio = probe === null ? null : consensusWidthRatio(probe.widthRatios());

    live.current.probe = null;

    if (probe === null || frontal === null || ratio === null) {
      deps.onFailed(
        new CalibrationError(
          `Je n’ai pas réussi à voir votre carte. Tenez-la bien à plat contre votre visage, ` +
            `entièrement visible, et refilmez-vous.`,
        ).message,
      );
      return;
    }

    // ⭐ LA mesure : la largeur médiane, ramenée en pixels sur la vue frontale.
    // La médiane vient de tout le film ; la vue frontale ne fournit que
    // l'échelle en pixels de CETTE image, où le visage se lit sans raccourci.
    const faceWidthPx = dist(
      px(at(frontal.lm, FACE_L), frontal.w, frontal.h),
      px(at(frontal.lm, FACE_R), frontal.w, frontal.h),
    );
    const cardWidthPx = ratio * faceWidthPx;

    // ⚠️ Sans rotation, PAS de mesure de silhouette. Le masque de mouvement est
    // la seule chose qui distingue un bord de tête d'un montant de porte.
    const buffers = probe.buffers();
    const scene =
      buffers.length > 0
        ? { frontal: frontal.buf, motion: motionMask(frontal.buf, buffers), lm: frontal.lm, w: frontal.w, h: frontal.h }
        : null;

    try {
      const out = assembleCardCalibration(
        { cardWidthPx, quad: frontal.quad, lm: frontal.lm, w: frontal.w, h: frontal.h },
        { quads: probe.quads(), views: probe.views(), scene },
        deps.cameraProfile,
        Date.now(),
      );
      if (out.profile !== null) deps.onCameraProfile(out.profile);
      deps.onCalibrated(out.cal, [
        `Merci, vous pouvez ranger votre carte.`,
        `Carte reconnue sur ${probe.widthRatios().length} images de votre film.`,
        ...out.notes,
      ]);
    } catch (err) {
      deps.onFailed(err instanceof Error ? err.message : String(err));
    }
  }, [live, deps]);

  return { start, finish };
}
