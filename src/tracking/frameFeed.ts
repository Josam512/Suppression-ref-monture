/**
 * tracking/frameFeed.ts — Couches 1 et 2 : acquisition caméra + normalisation.
 *
 * Reprise de fond (mission détection 2026-08-20), durcie par le guide de
 * fiabilisation (2026-08-21, points 13–15) :
 *
 *   - le PROCHAIN tick est TOUJOURS programmé, même si le traitement d'une
 *     frame lève : `try { emit } finally { schedule }`. Avant cette reprise,
 *     une exception dans `onSnapshot` (rendu, métrologie…) tuait la boucle
 *     rVFC définitivement — vidéo vivante, application morte, rien à l'écran
 *     pour le dire ;
 *   - un WATCHDOG surveille le flux : caméra vivante + vidéo prête mais aucune
 *     frame traitée depuis STALL_MS → diagnostic `rvfc-stalled` et bascule sur
 *     le repli requestAnimationFrame. Ne jamais supposer qu'une API mobile
 *     continuera éternellement parce qu'elle a fonctionné au début ;
 *   - le GRAND canvas (entrée MediaPipe) n'est PLUS forcé en chemin CPU : le
 *     contrôle de luminosité lit la vidéo dans son propre canvas 16×16, seul à
 *     porter `willReadFrequently`.
 *
 * Ce module produit des SNAPSHOTS : la frame recopiée dans un canvas 2D — les
 * pixels réellement analysés — plus un verdict de validité prononcé AVANT
 * toute inférence. Une frame répétée n'est ni redétectée ni comptée en échec.
 */

/** Verdict de validité d'une frame, AVANT inférence. */
export interface FrameValidity {
  valid: boolean;
  /** Cause nommée quand invalide — jamais « 0 visage » pour une entrée cassée. */
  reason: string | null;
  meanLuma: number;
  spreadLuma: number;
}

/** Sous ces bornes, l'image est noire ou uniforme : rien à détecter dedans. */
export const MIN_MEAN_LUMA = 4;
export const MIN_LUMA_SPREAD = 6;

/** Flux muet toléré avant le diagnostic `rvfc-stalled` (durée, pas frames). */
export const FEED_STALL_MS = 1000;
/** Cadence de la sentinelle du flux. */
export const FEED_WATCHDOG_INTERVAL_MS = 500;

/**
 * Validité depuis un échantillon RGBA (calcul pur, testé sans navigateur).
 * L'échantillon vient d'une réduction ~16×16 de la frame : assez pour dire
 * « noire/uniforme », assez peu pour coûter ~0 ms.
 */
export function frameValidity(rgba: Uint8ClampedArray): FrameValidity {
  if (rgba.length < 4) {
    return { valid: false, reason: 'échantillon vide (canvas non rempli)', meanLuma: 0, spreadLuma: 0 };
  }
  let sum = 0;
  let min = 255;
  let max = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) {
    const l = 0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0);
    sum += l;
    if (l < min) min = l;
    if (l > max) max = l;
  }
  const meanLuma = sum / n;
  const spreadLuma = max - min;
  if (meanLuma < MIN_MEAN_LUMA) {
    return { valid: false, reason: `frame noire (luma moyen ${meanLuma.toFixed(1)})`, meanLuma, spreadLuma };
  }
  if (spreadLuma < MIN_LUMA_SPREAD) {
    return { valid: false, reason: `frame uniforme (étendue ${spreadLuma.toFixed(1)})`, meanLuma, spreadLuma };
  }
  return { valid: true, reason: null, meanLuma, spreadLuma };
}

/** Une frame prête pour l'inférence : SES pixels, SA validité, SON horodatage. */
export interface FrameSnapshot {
  /** Le canvas réellement analysé — affichable tel quel en vue debug. */
  source: HTMLCanvasElement;
  w: number;
  h: number;
  videoTimeS: number;
  validity: FrameValidity;
  /** Cadence effectivement utilisée. */
  method: 'rvfc' | 'raf';
}

/** Compteurs du flux — le HUD lit ici « où la chaîne s'est arrêtée ». */
export interface FrameFeedStats {
  /** Frames caméra livrées à `onSnapshot` (tentées, erreurs comprises). */
  cameraFrames: number;
  /** Exceptions levées PAR le traitement d'une frame — comptées, jamais fatales. */
  snapshotErrors: number;
  lastSnapshotError: string | null;
  /** Bascules rVFC → RAF décidées par le watchdog. */
  stalls: number;
  method: 'rvfc' | 'raf';
  /** Horodatage `performance.now()` du dernier tick — le heartbeat du flux. */
  lastFrameAt: number;
}

export interface FrameFeedControl {
  stop(): void;
  stats(): Readonly<FrameFeedStats>;
}

const SAMPLE_SIZE = 16; // réduction pour le test de validité

/**
 * Attache le flux : `onSnapshot` est appelé pour CHAQUE nouvelle frame caméra
 * (jamais pour une frame répétée), avec les pixels déjà recopiés et vérifiés.
 * Le canvas est réutilisé — ne pas le conserver au-delà du rappel.
 *
 * @param onDiagnostic événements du flux lui-même (`rvfc-stalled`,
 *        `snapshot-error`) — informatif, jamais dans le chemin de décision.
 */
export function attachFrameFeed(
  video: HTMLVideoElement,
  onSnapshot: (s: FrameSnapshot) => void,
  onDiagnostic?: (code: 'rvfc-stalled' | 'snapshot-error', detail: string) => void,
): FrameFeedControl {
  let running = true;
  const feed = document.createElement('canvas');
  // ⚠️ PAS de `willReadFrequently` ici : ce canvas est l'ENTRÉE de MediaPipe,
  // le forcer en chemin CPU pour un échantillon 16×16 coûtait des copies
  // GPU→CPU à chaque frame (guide, point 15).
  const feedCtx = feed.getContext('2d');
  const sampler = document.createElement('canvas');
  sampler.width = SAMPLE_SIZE;
  sampler.height = SAMPLE_SIZE;
  const samplerCtx = sampler.getContext('2d', { willReadFrequently: true });

  const stats: FrameFeedStats = {
    cameraFrames: 0,
    snapshotErrors: 0,
    lastSnapshotError: null,
    stalls: 0,
    method: 'rvfc',
    lastFrameAt: 0,
  };

  // Lié explicitement (pas de narrowing `in` : lib.dom déclare déjà l'API,
  // ce qui rendrait la branche de repli « impossible » pour TypeScript alors
  // qu'elle est bien réelle sur les navigateurs qui ne l'implémentent pas).
  const rvfc = (
    video as { requestVideoFrameCallback?: (cb: () => void) => number }
  ).requestVideoFrameCallback?.bind(video);
  let lastVideoTime = -1;

  const emit = (method: 'rvfc' | 'raf'): void => {
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      onSnapshot({
        source: feed,
        w: 0,
        h: 0,
        videoTimeS: video.currentTime,
        validity: { valid: false, reason: 'vidéo 0×0 (pas de frame décodée)', meanLuma: 0, spreadLuma: 0 },
        method,
      });
      return;
    }
    if (feed.width !== video.videoWidth || feed.height !== video.videoHeight) {
      feed.width = video.videoWidth;
      feed.height = video.videoHeight;
    }
    if (feedCtx === null || samplerCtx === null) {
      onSnapshot({
        source: feed,
        w: feed.width,
        h: feed.height,
        videoTimeS: video.currentTime,
        validity: { valid: false, reason: 'contexte 2D indisponible', meanLuma: 0, spreadLuma: 0 },
        method,
      });
      return;
    }
    feedCtx.drawImage(video, 0, 0);
    // Le contrôle lit la VIDÉO, pas le grand canvas : c'est lui qui porte le
    // chemin CPU, et lui seul.
    samplerCtx.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const validity = frameValidity(samplerCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
    onSnapshot({ source: feed, w: feed.width, h: feed.height, videoTimeS: video.currentTime, validity, method });
  };

  /**
   * ⭐ Guide point 13 — le tick ne meurt JAMAIS : l'exception est comptée et
   * signalée, la programmation de la frame suivante est dans le `finally` de
   * l'appelant. Une frame ratée est une frame ratée, pas une séance morte.
   */
  const safeEmit = (method: 'rvfc' | 'raf'): void => {
    stats.cameraFrames++;
    stats.lastFrameAt = performance.now();
    try {
      emit(method);
    } catch (err) {
      stats.snapshotErrors++;
      stats.lastSnapshotError = err instanceof Error ? err.message : String(err);
      onDiagnostic?.('snapshot-error', stats.lastSnapshotError);
    }
  };

  const rafTick = (): void => {
    if (!running) return;
    try {
      // Garde S5 : une frame répétée n'est pas resoumise.
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        safeEmit('raf');
      }
    } finally {
      requestAnimationFrame(rafTick);
    }
  };

  let rvfcAlive = rvfc !== undefined;
  if (rvfc !== undefined) {
    const tick = (): void => {
      if (!running || !rvfcAlive) return;
      try {
        safeEmit('rvfc');
      } finally {
        rvfc(tick);
      }
    };
    rvfc(tick);
  } else {
    stats.method = 'raf';
    requestAnimationFrame(rafTick);
  }

  // ⭐ Guide point 14 — la sentinelle du flux. Onglet caché exclu : rVFC et RAF
  // y sont légitimement suspendus, ce n'est pas une panne. DEUX constats
  // consécutifs sont exigés : une compilation WASM qui bloque le thread
  // suspend AUSSI la sentinelle, et un seul constat au réveil accusait un flux
  // parfaitement vivant (faux positif mesuré au banc, 2026-08-21).
  stats.lastFrameAt = performance.now();
  let framesAtSuspicion = -1;
  const watchdog = setInterval(() => {
    if (!running || !rvfcAlive) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      stats.lastFrameAt = performance.now(); // ne pas accuser un onglet en veille
      framesAtSuspicion = -1;
      return;
    }
    if (video.readyState < 2) return;
    if (performance.now() - stats.lastFrameAt <= FEED_STALL_MS) {
      framesAtSuspicion = -1;
      return;
    }
    if (framesAtSuspicion === -1 || stats.cameraFrames !== framesAtSuspicion) {
      framesAtSuspicion = stats.cameraFrames; // premier constat : on note, on attend
      return;
    }

    stats.stalls++;
    stats.method = 'raf';
    rvfcAlive = false; // l'ancien enchaînement rVFC s'éteint de lui-même
    onDiagnostic?.(
      'rvfc-stalled',
      `aucune frame depuis ${Math.round(performance.now() - stats.lastFrameAt)} ms — repli requestAnimationFrame`,
    );
    requestAnimationFrame(rafTick);
  }, FEED_WATCHDOG_INTERVAL_MS);

  return {
    stop(): void {
      running = false;
      clearInterval(watchdog);
    },
    stats(): Readonly<FrameFeedStats> {
      return stats;
    },
  };
}
