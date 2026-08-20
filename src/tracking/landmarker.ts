/**
 * tracking/landmarker.ts — init MediaPipe + boucle de détection (CLAUDE.md §1 bug #3).
 *
 * Modèle VENDORISÉ dans public/models/ : zéro CDN au runtime (§1 bug #4).
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Pt } from '../core/geom.js';
import { assetUrl, isInlined } from '../ui/assetUrl.js';

const MODEL_URL = assetUrl('models/face_landmarker.task');
const WASM_DIR = assetUrl('wasm');

/**
 * Contour de l'ovale facial (indices MediaPipe, dans l'ordre du tracé).
 * Sert à l'occlusion de la branche (§6).
 */
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148,
  176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
] as const;

/**
 * Le couple (chargeur, binaire) du runtime MediaPipe.
 *
 * Cas normal : `forVisionTasks` sonde le support SIMD du navigateur et choisit
 * lui-même entre les deux variantes. On lui laisse ce travail.
 *
 * Cas de la page autonome : il n'y a pas de serveur, donc pas de préfixe de
 * répertoire à concaténer — les deux fichiers sont portés par la page et
 * exposés en `blob:`. On construit alors le couple explicitement.
 *
 * ⚠️ Ce n'est pas un branchement sur un « mode » : c'est la présence, ou non,
 * d'un fichier embarqué. Le code ne sait pas pourquoi il est là.
 */
async function visionFileset(): Promise<{ wasmLoaderPath: string; wasmBinaryPath: string }> {
  const loader = 'wasm/vision_wasm_internal.js';
  const binary = 'wasm/vision_wasm_internal.wasm';
  if (isInlined(loader) && isInlined(binary)) {
    return { wasmLoaderPath: assetUrl(loader), wasmBinaryPath: assetUrl(binary) };
  }
  return FilesetResolver.forVisionTasks(WASM_DIR);
}

/**
 * Télécharge le modèle en signalant l'avancement RÉEL.
 *
 * Le bug #4 était un CDN sans barre de progression : impossible de distinguer
 * « ça charge » de « c'est mort ». Le modèle est vendorisé ET son chargement
 * est mesuré, pas simulé.
 */
async function fetchModel(onProgress: (ratio: number) => void): Promise<Uint8Array> {
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    throw new Error(
      `Modèle introuvable (${res.status}) à ${MODEL_URL}. ` +
        `Il doit être vendorisé dans public/models/ — aucun CDN au runtime (§1 bug #4).`,
    );
  }

  const total = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body?.getReader();
  if (reader === undefined) return new Uint8Array(await res.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) onProgress(received / total);
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  onProgress(1);
  return out;
}

export type Delegate = 'GPU' | 'CPU';

/**
 * 🔴 Constaté sur le téléphone du sujet réel (2026-08-20, navigateur intégré
 * Android) : le délégué GPU s'initialise sans erreur et ne détecte JAMAIS rien
 * — vidéo parfaite à l'écran, « détection perdue : 528 frames ». Aucune
 * exception, donc aucun des filets existants ne se déclenchait. Quand le GPU
 * n'a RIEN donné depuis le début pendant autant de frames, l'appelant doit
 * recréer le landmarker en CPU (XNNPACK) et continuer — jamais rester muet.
 */
export const GPU_SILENT_FALLBACK_LOST = 60; // ~2 s à 30 images/s

export async function createLandmarker(
  onProgress: (ratio: number) => void = () => {},
  delegate: Delegate = 'GPU',
): Promise<FaceLandmarker> {
  const [fileset, modelAssetBuffer] = await Promise.all([
    visionFileset(),
    fetchModel(onProgress),
  ]);

  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    // ⚠️ Activé UNIQUEMENT pour en extraire la ROTATION (§4).
    outputFacialTransformationMatrixes: true,
  });
}

/**
 * Yaw depuis la matrice de pose MediaPipe (colonne-major, 4×4).
 *
 * 🔴 SEULE lecture autorisée de cette matrice, et seulement sa partie rotation.
 * Sa TRANSLATION et son ÉCHELLE sont exprimées dans le repère du modèle
 * canonique : les utiliser reviendrait au « visage moyen habillé en
 * mathématiques » banni au §4. La rotation, elle, ne dépend pas de la taille
 * du visage — c'est pourquoi elle seule est admise.
 *
 * Un estimateur de yaw bricolé en 2D dépendrait du rapport profondeur du nez /
 * largeur du visage, c'est-à-dire d'une morphologie supposée : ce serait un
 * présupposé de taille déguisé, interdit au §0.0.3.
 */
export function yawFromMatrix(m: ArrayLike<number>): number {
  const r02 = m[8];
  const r22 = m[10];
  if (r02 === undefined || r22 === undefined) return 0;
  return Math.atan2(r02, r22);
}

export interface LoopHandlers {
  /** Appelé une fois par frame utile, avec les landmarks et le yaw mesuré. */
  onFrame(lm: ReadonlyArray<{ x: number; y: number; z?: number }>, yawRad: number): void;
  /** Appelé quand la détection échoue ou ne trouve aucun visage. */
  onLost(consecutiveFailures: number): void;
}

export interface LoopControl {
  stop(): void;
}

/**
 * ⭐ Correctif S5 — `@mediapipe/tasks-vision` n'expose pas `estimateFaces`.
 *
 * `detectForVideo(video, timestampMs)` est SYNCHRONE et lève si le timestamp
 * n'est pas strictement croissant, ce qui survient dès qu'une frame se répète
 * (webcam lente, onglet en arrière-plan). Un try/catch seul ne suffit pas : la
 * boucle passerait son temps à catcher et le compteur d'échecs saturerait sans
 * cause réelle — un compteur qui monte alors que rien ne va mal apprend à
 * ignorer l'alarme.
 */
export function startLoop(
  landmarker: FaceLandmarker,
  video: HTMLVideoElement,
  handlers: LoopHandlers,
): LoopControl {
  let running = true;
  let lastVideoTime = -1;
  let lastTimestampMs = -1;
  let consecutiveFailures = 0;

  // 🔴 Le détecteur ne lit JAMAIS l'élément <video> directement. Sur plusieurs
  // WebViews Android, la texture vidéo livrée au wasm est TOURNÉE de 90° (la
  // rotation du capteur n'est appliquée qu'à l'affichage) ou vide — l'écran
  // montre un visage droit, le détecteur reçoit un visage couché qu'il ne
  // trouve jamais, sans lever la moindre erreur. On recopie donc chaque frame
  // dans un canvas 2D : les pixels détectés sont EXACTEMENT ceux affichés.
  const feed = document.createElement('canvas');
  const feedCtx = feed.getContext('2d', { willReadFrequently: true });

  function loop(): void {
    if (!running) return;

    if (video.readyState < 2) {
      requestAnimationFrame(loop); // ✅ replanifie toujours
      return;
    }

    // ⭐ Garde S5 — frame répétée : on ne redétecte pas, et ce n'est PAS un échec.
    if (video.currentTime === lastVideoTime) {
      requestAnimationFrame(loop);
      return;
    }
    lastVideoTime = video.currentTime;

    // ⭐ Garde S5 — timestamp strictement croissant, exigé par tasks-vision.
    const ts = Math.max(performance.now(), lastTimestampMs + 1);
    lastTimestampMs = ts;

    try {
      let source: HTMLVideoElement | HTMLCanvasElement = video;
      if (feedCtx !== null) {
        if (feed.width !== video.videoWidth || feed.height !== video.videoHeight) {
          feed.width = video.videoWidth;
          feed.height = video.videoHeight;
        }
        feedCtx.drawImage(video, 0, 0);
        source = feed;
      }
      const res = landmarker.detectForVideo(source, ts);
      const lm = res.faceLandmarks[0];
      const mat = res.facialTransformationMatrixes[0];

      if (lm !== undefined && lm.length > 0) {
        consecutiveFailures = 0;
        handlers.onFrame(lm, mat !== undefined ? yawFromMatrix(mat.data) : 0);
      } else {
        consecutiveFailures++;
        handlers.onLost(consecutiveFailures);
      }
    } catch (err) {
      consecutiveFailures++;
      console.error('Detection error:', err); // ✅ visible, jamais avalé
      handlers.onLost(consecutiveFailures);
    }

    requestAnimationFrame(loop); // ✅ atteint dans tous les cas
  }

  requestAnimationFrame(loop);
  return {
    stop(): void {
      running = false;
    },
  };
}

/** Contour du visage en coordonnées écran, pour l'occlusion de la branche. */
export function faceOutlinePath(
  lm: ReadonlyArray<{ x: number; y: number }>,
  w: number,
  h: number,
): Path2D | null {
  const pts: Pt[] = [];
  for (const i of FACE_OVAL) {
    const l = lm[i];
    if (l === undefined) return null;
    pts.push({ x: l.x * w, y: l.y * h });
  }
  const path = new Path2D();
  const first = pts[0];
  if (first === undefined) return null;
  path.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p !== undefined) path.lineTo(p.x, p.y);
  }
  path.closePath();
  return path;
}
