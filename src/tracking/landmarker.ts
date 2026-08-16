import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';

/**
 * Initialisation MediaPipe FaceLandmarker — CLAUDE.md §1 bug #4, §3.
 *
 * Deux choses non négociables ici :
 *
 * 1. ZÉRO CDN. Le WASM et le modèle sont servis depuis notre propre origine.
 *    Un CDN, c'est 10–20 Mo sans barre de progression et une app bloquée sur
 *    « Chargement... » sans qu'on sache si ça charge ou si c'est mort.
 *
 * 2. Le modèle à 478 points est choisi POUR LES IRIS (indices 468–477), qui
 *    sont la référence de mesure du §4. Facemesh ne les donnait pas.
 */

/** Servis depuis notre origine. Voir scripts/vendor-mediapipe.mjs. */
export const WASM_DIR = '/mediapipe/wasm';
export const MODEL_URL = '/models/face_landmarker.task';

export interface LoadProgress {
  loadedBytes: number;
  /** 0 si le serveur n'annonce pas de Content-Length. */
  totalBytes: number;
  /** 0..1, ou null quand la taille totale est inconnue. */
  ratio: number | null;
}

/**
 * Télécharge le modèle en suivant l'avancement réel, octet par octet.
 *
 * C'est ce qui permet d'afficher un VRAI pourcentage (§1 bug #4) plutôt qu'un
 * spinner indistinguable d'un plantage. Extrait de `createFaceLandmarker` pour
 * être testable sans navigateur.
 */
export async function loadModelBuffer(
  url: string,
  onProgress?: (p: LoadProgress) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(
      `Modèle introuvable (${res.status}) à ${url}. ` +
        `Le fichier face_landmarker.task doit être vendorisé dans public/models/.`,
    );
  }

  const header = res.headers.get('content-length');
  const totalBytes = header === null ? 0 : Number.parseInt(header, 10);
  const reader = res.body?.getReader();

  // Pas de streaming disponible : on charge d'un bloc, sans progression.
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.({ loadedBytes: buf.byteLength, totalBytes: buf.byteLength, ratio: 1 });
    return buf;
  }

  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loadedBytes += value.byteLength;
      onProgress?.({
        loadedBytes,
        totalBytes,
        ratio: totalBytes > 0 ? Math.min(1, loadedBytes / totalBytes) : null,
      });
    }
  }

  const out = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function createFaceLandmarker(
  onProgress?: (p: LoadProgress) => void,
): Promise<FaceLandmarker> {
  const [fileset, modelAssetBuffer] = await Promise.all([
    FilesetResolver.forVisionTasks(WASM_DIR),
    loadModelBuffer(MODEL_URL, onProgress),
  ]);

  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,

    // ⛔ INTERDIT PAR LE §4 : la géométrie faciale métrique de MediaPipe ramène
    // tout visage aux dimensions du modèle canonique. L'échelle n'y est vraie
    // qu'« à une constante près » — c'est le visage moyen habillé en
    // mathématiques, donc plus trompeur qu'une constante écrite en clair.
    // Notre échelle vient de l'iris ou de la carte, de rien d'autre.
    outputFacialTransformationMatrixes: false,
    outputFaceBlendshapes: false,
  });
}

/** Ce dont le détecteur a besoin. Réduit à ça pour être stubbable en test. */
export interface VideoLandmarker {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult;
}

export interface VideoDetector {
  detect(video: HTMLVideoElement, nowMs: number): FaceLandmarkerResult | null;
}

/**
 * Enveloppe `detectForVideo` avec les deux gardes qui manquaient au §1 bug #3.
 *
 * Le correctif du contrat était écrit pour l'ancienne API tfjs (`estimateFaces`,
 * asynchrone). `@mediapipe/tasks-vision` est différent :
 *
 *   - `detectForVideo` est SYNCHRONE ;
 *   - il LÈVE UNE EXCEPTION si le timestamp n'est pas strictement croissant.
 *
 * Sans garde de monotonie, la boucle passe son temps à catcher dès qu'une frame
 * est répétée (webcam lente, onglet en arrière-plan) et le compteur d'échecs
 * sature sans cause réelle. Le try/catch seul ne suffit donc pas.
 *
 * Renvoyer `null` sur frame répétée n'est pas un échec : c'est « rien de neuf
 * à analyser », et l'appelant ne doit surtout pas le compter comme une perte.
 */
export function createVideoDetector(landmarker: VideoLandmarker): VideoDetector {
  let lastVideoTime = -1;
  let lastTimestampMs = -1;

  return {
    detect(video, nowMs) {
      if (video.currentTime === lastVideoTime) return null;
      lastVideoTime = video.currentTime;

      // Strictement croissant, même si l'horloge appelante stagne ou recule.
      const timestampMs = Math.max(nowMs, lastTimestampMs + 1);
      lastTimestampMs = timestampMs;

      return landmarker.detectForVideo(video, timestampMs);
    },
  };
}
