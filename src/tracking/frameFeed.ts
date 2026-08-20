/**
 * tracking/frameFeed.ts — Couches 1 et 2 : acquisition caméra + normalisation.
 *
 * Reprise de fond (mission détection 2026-08-20). Constats à l'origine :
 *   - « détection perdue : 528 frames » sur un visage plein cadre, sans que
 *     RIEN ne dise si les pixels analysés étaient noirs, couchés ou valides ;
 *   - une frame noire/vide devenait « 0 visage » au lieu de « ENTRÉE INVALIDE » ;
 *   - requestAnimationFrame était supposé coïncider avec une nouvelle frame
 *     caméra, ce qui est faux (écran 60/120 Hz, caméra 15–30 im/s).
 *
 * Ce module produit des SNAPSHOTS : la frame recopiée dans un canvas 2D — les
 * pixels réellement analysés, exactement ceux affichés (la rotation capteur des
 * WebViews Android n'est appliquée qu'à l'affichage : lire l'élément <video>
 * directement peut livrer une image couchée au wasm) — plus un verdict de
 * validité PRONONCÉ AVANT toute inférence. Cadence : requestVideoFrameCallback
 * quand il existe (une vraie frame caméra = un snapshot), sinon
 * requestAnimationFrame gardé par currentTime (S5 : une frame répétée n'est ni
 * redétectée ni comptée comme un échec).
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

export interface FrameFeedControl {
  stop(): void;
}

const SAMPLE_SIZE = 16; // réduction pour le test de validité

/**
 * Attache le flux : `onSnapshot` est appelé pour CHAQUE nouvelle frame caméra
 * (jamais pour une frame répétée), avec les pixels déjà recopiés et vérifiés.
 * Le canvas est réutilisé — ne pas le conserver au-delà du rappel.
 */
export function attachFrameFeed(
  video: HTMLVideoElement,
  onSnapshot: (s: FrameSnapshot) => void,
): FrameFeedControl {
  let running = true;
  const feed = document.createElement('canvas');
  const feedCtx = feed.getContext('2d', { willReadFrequently: true });
  const sampler = document.createElement('canvas');
  sampler.width = SAMPLE_SIZE;
  sampler.height = SAMPLE_SIZE;
  const samplerCtx = sampler.getContext('2d', { willReadFrequently: true });

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
    samplerCtx.drawImage(feed, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const validity = frameValidity(samplerCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
    onSnapshot({ source: feed, w: feed.width, h: feed.height, videoTimeS: video.currentTime, validity, method });
  };

  if (rvfc !== undefined) {
    const tick = (): void => {
      if (!running) return;
      emit('rvfc');
      rvfc(tick);
    };
    rvfc(tick);
  } else {
    const tick = (): void => {
      if (!running) return;
      // Garde S5 : une frame répétée n'est pas resoumise.
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        emit('raf');
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  return {
    stop(): void {
      running = false;
    },
  };
}
