/**
 * tests/recolor-video.ts — atelier : recolorier une VRAIE vidéo de magasin.
 *
 * ⚠️ Outil d'atelier, pas d'application (§0.0.2). Aucun chemin de `src/` ne
 * l'importe, et il n'est jamais présenté à un client. Il sert à répondre, sur
 * une vidéo réelle, à la seule question que les tests de synthèse ne peuvent pas
 * trancher : **est-ce que ça a l'air vrai ?**
 *
 * Le principe est celui du §11 poussé à son terme. Le client porte une monture
 * réelle, filmée. On ne pose rien sur elle : on remplace sa matière par celle
 * d'un autre coloris, en gardant la lumière, les reflets, la perspective, le
 * flou de bougé et l'occlusion — tout ce qui coûte cher à simuler et qui est
 * déjà là, gratuitement, dans l'image.
 */

import { WORN_FRAME_REL_ERROR } from '../src/core/calibration.js';
import { frameMetrics } from '../src/core/faceMetrics.js';
import { parseFrameSpec, type FrameSpec } from '../src/core/frameSpec.js';
import { drawRecolored } from '../src/render/recolorLive.js';
import { createLandmarker, yawFromMatrix } from '../src/tracking/landmarker.js';

export interface RecolorVideoOptions {
  videoUrl: string;
  /** Slug du modèle physiquement porté dans la vidéo. */
  wornSlug: string;
  /** Slug du coloris voulu. Même modèle (garde-fou §11.5). */
  targetSlug: string;
  /**
   * Largeur du visage en mm, telle que la V2 l'a mesurée sur la monture portée.
   *
   * ⚠️ Pas une supposition : c'est la sortie de `calibrateWithWornFrame`, que
   * l'opticien obtient en deux clics. On la passe ici plutôt que de la
   * redemander, parce qu'un outil d'atelier n'a pas d'opticien devant lui.
   */
  faceWidthMm: number;
  /** Nombre d'images à traiter au plus. 0 = toute la vidéo. */
  maxFrames?: number;
}

export interface RecolorVideoResult {
  /** Durée annoncée par le conteneur, en secondes. NaN ou Infinity si absente. */
  durationS: number;
  /** Pourquoi la boucle s'est arrêtée. Diagnostic d'atelier. */
  stoppedBy: string;
  frames: number;
  detected: number;
  recolored: number;
  /** Dernière raison de refus rencontrée, s'il y en a eu. */
  lastReason: string | null;
  /** Images PNG en dataURL : avant / après, pour l'œil humain. */
  samples: Array<{ label: string; before: string; after: string }>;
}

async function loadSpec(slug: string): Promise<FrameSpec> {
  const res = await fetch(`/frames/${slug}/spec.json`);
  if (!res.ok) throw new Error(`spec.json introuvable pour « ${slug} » (${res.status})`);
  return parseFrameSpec(await res.json());
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Image introuvable : ${url}`));
    image.src = url;
  });
}

/** Traite la vidéo image par image et rend un compte-rendu chiffré. */
export async function recolorVideo(
  options: RecolorVideoOptions,
  onProgress: (done: number) => void = () => {},
): Promise<RecolorVideoResult> {
  const [wornSpec, targetSpec] = await Promise.all([
    loadSpec(options.wornSlug),
    loadSpec(options.targetSlug),
  ]);
  const [wornImg, targetImg] = await Promise.all([
    loadImage(`/frames/${wornSpec.slug}/${wornSpec.front}`),
    loadImage(`/frames/${targetSpec.slug}/${targetSpec.front}`),
  ]);

  const video = document.createElement('video');
  video.src = options.videoUrl;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error(`Vidéo illisible : ${options.videoUrl}`));
  });

  const w = video.videoWidth;
  const h = video.videoHeight;

  const stage = document.createElement('canvas');
  stage.width = w;
  stage.height = h;
  document.body.append(video, stage);
  const ctx = stage.getContext('2d');
  if (ctx === null) throw new Error('Contexte 2D indisponible.');

  const landmarker = await createLandmarker();

  const result: RecolorVideoResult = {
    durationS: video.duration,
    stoppedBy: 'jamais',
    frames: 0,
    detected: 0,
    recolored: 0,
    lastReason: null,
    samples: [],
  };

  const limit = options.maxFrames ?? 0;

  // ⚠️ On NE LIT PAS la vidéo, on la PARCOURT image par image.
  //
  // La boucle live du §1 bug #3 est bâtie pour un flux temps réel : elle saute
  // ce qu'elle n'a pas le temps de traiter, et c'est exactement ce qu'il faut
  // devant une webcam. Ici c'est l'inverse : la détection est plus lente que la
  // lecture, et laisser filer la vidéo ne traitait que deux images sur soixante.
  // Un outil d'atelier n'a aucune raison d'être temps réel — il a toutes les
  // raisons d'être exhaustif.
  video.pause();

  const step = 1 / 30;
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  let timestampMs = 0;

  for (let t = 0; t < duration && (limit === 0 || result.frames < limit); t += step) {
    video.currentTime = t;
    await new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
    });

    result.frames++;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(video, 0, 0, w, h);

    // Garde de monotonie S5 : `detectForVideo` lève si le timestamp recule.
    timestampMs += 1000 * step;
    const res = landmarker.detectForVideo(video, timestampMs);
    const lm = res.faceLandmarks[0];
    const mat = res.facialTransformationMatrixes[0];
    if (lm === undefined || lm.length === 0) continue;

    result.detected++;
    const yawRad = mat !== undefined ? yawFromMatrix(mat.data) : 0;

    // L'échelle vient de la calibration V2 déjà faite en magasin : on la
    // reçoit, on ne la réinvente pas ici.
    const m = frameMetrics(
      lm,
      w,
      h,
      {
        faceWidthMm: options.faceWidthMm,
        source: 'worn-frame',
        relError: WORN_FRAME_REL_ERROR,
        measuredAt: 0,
      },
      yawRad,
    );

    const before = result.samples.length < 3 ? stage.toDataURL('image/png') : null;
    const report = drawRecolored(
      ctx,
      video,
      { img: wornImg, spec: wornSpec },
      { img: targetImg, spec: targetSpec },
      m,
    );

    if (report.reason === null && report.painted > 0) result.recolored++;
    else result.lastReason = report.reason;

    if (before !== null && report.painted > 0) {
      result.samples.push({
        label: `image ${result.frames}`,
        before,
        after: stage.toDataURL('image/png'),
      });
    }
    onProgress(result.frames);
  }
  result.stoppedBy = limit > 0 && result.frames >= limit ? 'limite atteinte' : 'fin de vidéo';

  return result;
}

/** Exposé pour Playwright. */
declare global {
  interface Window {
    __RECOLOR__?: (o: RecolorVideoOptions) => Promise<RecolorVideoResult>;
  }
}
window.__RECOLOR__ = (o) => recolorVideo(o);
