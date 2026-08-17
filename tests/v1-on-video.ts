/**
 * tests/v1-on-video.ts — atelier : la chaîne V1 complète sur une VRAIE vidéo.
 *
 * ⚠️ Outil d'atelier (§0.0.2). Aucun chemin de `src/` ne l'importe.
 *
 * C'est le seul moyen de répondre à la question que ni les tests de synthèse ni
 * la tête projetée ne peuvent trancher : **sur un vrai visage, une vraie carte
 * et une vraie webcam, qu'est-ce que la chaîne rend réellement ?**
 *
 * Deux temps, volontairement séparés :
 *
 *  1. `surveyVideo` — relève ce que la vidéo contient : taux de détection,
 *     plage de yaw balayée, image la plus frontale. Sans cela on ne sait pas
 *     si un échec vient de la chaîne ou de la prise de vue.
 *  2. `runV1` — la calibration complète, une fois les deux bords de la carte
 *     pointés. Ces deux points sont exactement ce que le client fait en deux
 *     secondes dans l'application ; ici c'est l'humain qui les fournit.
 */

import { calibrateWithCardMeasured } from '../src/core/calibration.js';
import { rollRadOf } from '../src/core/faceMetrics.js';
import type { NormalizedLandmark } from '../src/core/geom.js';
import { type RotatedView } from '../src/core/parallax.js';
import { motionMask, type ImageBuffer } from '../src/core/silhouette.js';
import { refineQuad } from '../src/core/cardEdges.js';
import { cameraFromSweep, measureDistance, type SweepCamera } from '../src/core/cardSweep.js';
import type { CardQuad } from '../src/core/cardPose.js';
import { createLandmarker, yawFromMatrix } from '../src/tracking/landmarker.js';

const STEP_S = 1 / 15;

interface Frame {
  t: number;
  lm: readonly NormalizedLandmark[];
  yawRad: number;
  rollRad: number;
}

interface Loaded {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  frames: Frame[];
  w: number;
  h: number;
  durationS: number;
  stepped: number;
}

async function load(videoUrl: string): Promise<Loaded> {
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error(`Vidéo illisible : ${videoUrl}`));
  });
  video.pause();

  const w = video.videoWidth;
  const h = video.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  document.body.append(video, canvas);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('Contexte 2D indisponible.');

  const landmarker = await createLandmarker();
  const frames: Frame[] = [];
  const durationS = Number.isFinite(video.duration) ? video.duration : 0;
  let ts = 0;
  let stepped = 0;

  for (let t = 0; t < durationS; t += STEP_S) {
    video.currentTime = t;
    await new Promise<void>((r) => video.addEventListener('seeked', () => r(), { once: true }));
    stepped++;
    ts += 1000 * STEP_S;

    const res = landmarker.detectForVideo(video, ts);
    const lm = res.faceLandmarks[0];
    const mat = res.facialTransformationMatrixes[0];
    if (lm === undefined || lm.length === 0) continue;

    frames.push({
      t,
      lm,
      yawRad: mat !== undefined ? yawFromMatrix(mat.data) : 0,
      rollRad: rollRadOf(lm, w, h),
    });
  }

  return { video, canvas, ctx, frames, w, h, durationS, stepped };
}

/** Image de la vidéo à un instant donné, en dataURL. */
async function snapshot(l: Loaded, t: number): Promise<string> {
  l.video.currentTime = t;
  await new Promise<void>((r) => l.video.addEventListener('seeked', () => r(), { once: true }));
  l.ctx.setTransform(1, 0, 0, 1, 0, 0);
  l.ctx.drawImage(l.video, 0, 0, l.w, l.h);
  return l.canvas.toDataURL('image/png');
}

async function buffer(l: Loaded, t: number): Promise<ImageBuffer> {
  l.video.currentTime = t;
  await new Promise<void>((r) => l.video.addEventListener('seeked', () => r(), { once: true }));
  l.ctx.setTransform(1, 0, 0, 1, 0, 0);
  l.ctx.drawImage(l.video, 0, 0, l.w, l.h);
  return l.ctx.getImageData(0, 0, l.w, l.h);
}

export interface Survey {
  /** Meilleure image pour la silhouette : frontale ET avec du fond des deux côtés. */
  best: { t: number; yawDeg: number; marginLeftPx: number; marginRightPx: number } | null;
  /** Marges disponibles sur l'image la plus frontale. */
  frontalMargins: { left: number; right: number };
  w: number;
  h: number;
  durationS: number;
  stepped: number;
  detected: number;
  yawDegMin: number;
  yawDegMax: number;
  rollDegMedian: number;
  /** Instant le plus frontal, et sa vignette. */
  frontalT: number;
  frontalPng: string;
  /** Vignettes aux extrêmes de rotation, pour vérifier la consigne. */
  samples: Array<{ label: string; t: number; yawDeg: number; png: string }>;
}

/** Premier temps : que contient la vidéo ? */
export async function surveyVideo(videoUrl: string): Promise<Survey> {
  const l = await load(videoUrl);
  if (l.frames.length === 0) {
    throw new Error(`Aucun visage détecté sur ${l.stepped} images. Cadrage ou orientation ?`);
  }

  const yaws = l.frames.map((f) => (f.yawRad * 180) / Math.PI);
  const rolls = [...l.frames.map((f) => Math.abs((f.rollRad * 180) / Math.PI))].sort((a, b) => a - b);

  const frontal = l.frames.reduce((a, b) => (Math.abs(b.yawRad) < Math.abs(a.yawRad) ? b : a));
  const left = l.frames.reduce((a, b) => (b.yawRad < a.yawRad ? b : a));
  const right = l.frames.reduce((a, b) => (b.yawRad > a.yawRad ? b : a));

  const samples: Survey['samples'] = [];
  for (const [label, f] of [
    ['gauche', left],
    ['droite', right],
  ] as const) {
    samples.push({
      label,
      t: f.t,
      yawDeg: (f.yawRad * 180) / Math.PI,
      png: await snapshot(l, f.t),
    });
  }

  const marginsOf = (f: Frame): { left: number; right: number } => {
    const xs = [f.lm[234], f.lm[454]].map((p) => (p?.x ?? 0) * l.w);
    return { left: Math.min(...xs), right: l.w - Math.max(...xs) };
  };

  // Une image utilisable pour la silhouette doit être frontale ET laisser du
  // fond des deux côtés : le modèle de fond se prend au bord de l'image.
  const candidates = l.frames
    .filter((f) => Math.abs(f.yawRad) < 0.14)
    .map((f) => ({ f, m: marginsOf(f) }))
    .sort((a, b) => Math.min(b.m.left, b.m.right) - Math.min(a.m.left, a.m.right));
  const top = candidates[0];

  return {
    best:
      top === undefined
        ? null
        : {
            t: top.f.t,
            yawDeg: (top.f.yawRad * 180) / Math.PI,
            marginLeftPx: top.m.left,
            marginRightPx: top.m.right,
          },
    frontalMargins: marginsOf(frontal),
    w: l.w,
    h: l.h,
    durationS: l.durationS,
    stepped: l.stepped,
    detected: l.frames.length,
    yawDegMin: Math.min(...yaws),
    yawDegMax: Math.max(...yaws),
    rollDegMedian: rolls[Math.floor(rolls.length / 2)] ?? 0,
    frontalT: frontal.t,
    frontalPng: await snapshot(l, frontal.t),
    samples,
  };
}

/**
 * ⭐ AUDIT — le yaw de MediaPipe est-il À L'ÉCHELLE ?
 *
 * Toute la profondeur repose dessus au premier ordre : `Δz = Δu / sin θ`. Si
 * MediaPipe annonce 20° là où la tête en a tourné 30, la profondeur sort
 * gonflée d'un facteur 1,5 — et **de façon parfaitement stable d'une vue à
 * l'autre**, donc avec l'air d'une bonne mesure. C'est exactement le mode
 * d'échec que ce projet combat, et rien dans la chaîne ne l'attraperait.
 *
 * Le soupçon est chiffré : la mesure rend 35,6 mm entre les canthus externes et
 * le sellion, là où l'anatomie en donne 15 à 20.
 *
 * ## Comment on vérifie sans mire ni ground truth
 *
 * Un yaw est une rotation autour de la VERTICALE. Il raccourcit donc les
 * longueurs horizontales d'un facteur cos θ, et **ne touche à aucune longueur
 * verticale**. Le rapport
 *
 *     r(θ) = (écart horizontal des canthus externes) / (hauteur front ↔ menton)
 *
 * vaut donc `r0·cos θ`, et il est INSENSIBLE à la distance caméra puisque les
 * deux termes s'y échelonnent pareil. On en tire un yaw mesuré directement dans
 * les pixels, sans passer par la matrice — donc opposable à elle.
 *
 * ⚠️ Ce n'est PAS un estimateur de yaw pour l'application (§4 l'interdit : il
 * dépendrait d'une morphologie supposée, ici le rapport largeur/hauteur du
 * visage). C'est un CONTRÔLE : le rapport `r0` de la personne est pris sur ses
 * propres images frontales, donc aucune morphologie n'est supposée. Il vit dans
 * l'atelier et ne peut pas remonter dans `src/`.
 */
interface YawAudit {
  /** Médiane de (yaw mesuré dans les pixels) / (yaw MediaPipe). 1 = MediaPipe juste. */
  slope: number;
  /** Dispersion robuste de ce rapport. */
  spread: number;
  n: number;
  rows: string[];
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? NaN) : ((s[mid - 1] ?? NaN) + (s[mid] ?? NaN)) / 2;
}

/** Écart des canthus externes ÷ hauteur front↔menton, dé-rollé. Sans dimension. */
function shapeRatio(f: Frame, w: number, h: number): number {
  const at = (i: number): { x: number; y: number } => {
    const p = f.lm[i];
    return { x: (p?.x ?? 0) * w, y: (p?.y ?? 0) * h };
  };
  const c = Math.cos(f.rollRad);
  const s = Math.sin(f.rollRad);

  const eL = at(33);
  const eR = at(263);
  const horiz = Math.abs((eR.x - eL.x) * c + (eR.y - eL.y) * s);

  const top = at(10);
  const chin = at(152);
  const vert = Math.abs(-(chin.x - top.x) * s + (chin.y - top.y) * c);

  return vert > 0 ? horiz / vert : NaN;
}

/** En deçà, acos est trop plat : le bruit sur `r` explose en degrés. */
const AUDIT_MIN_YAW_RAD = 0.25; // ~14°

function auditYaw(frames: readonly Frame[], w: number, h: number): YawAudit {
  const pts = frames.map((f) => ({ yaw: Math.abs(f.yawRad), r: shapeRatio(f, w, h) }));

  const frontal = pts.filter((p) => p.yaw < 0.06 && Number.isFinite(p.r)).map((p) => p.r);
  const r0 = median(frontal.length >= 3 ? frontal : pts.map((p) => p.r).filter(Number.isFinite));

  const ratios: number[] = [];
  const rows: string[] = [];
  for (const p of pts) {
    if (!Number.isFinite(p.r) || p.yaw < AUDIT_MIN_YAW_RAD) continue;
    const cosMeasured = Math.min(1, Math.max(-1, p.r / r0));
    const yawMeasured = Math.acos(cosMeasured);
    ratios.push(yawMeasured / p.yaw);
    if (rows.length < 12) {
      rows.push(
        `MediaPipe ${((p.yaw * 180) / Math.PI).toFixed(1).padStart(5)}°  ` +
          `pixels ${((yawMeasured * 180) / Math.PI).toFixed(1).padStart(5)}°  ` +
          `rapport ${(yawMeasured / p.yaw).toFixed(2)}`,
      );
    }
  }

  const slope = median(ratios);
  return {
    slope,
    spread: median(ratios.map((x) => Math.abs(x - slope))) * 1.4826,
    n: ratios.length,
    rows,
  };
}

export interface V1Result {
  faceWidthMm: number;
  relError: number;
  temporalWidthMm: number | null;
  temporalRelError: number | null;
  depthMm: number | null;
  distanceMm: number;
  parallaxFactor: number;
  viewsUsed: number;
  notes: string[];
  naiveFaceWidthMm: number;
}

/**
 * Second temps : la calibration V1 complète.
 *
 * @param cardPx les deux bords de la carte sur l'image frontale, en pixels.
 *        Exactement les deux points que le client pose lui-même.
 */
export async function runV1(
  videoUrl: string,
  cardPx: { x1: number; y1: number; x2: number; y2: number },
  frontalT: number,
  /** Les quatre coins, si l'humain les a pointés. À défaut, déduits des deux bords. */
  corners?: CardQuad,
): Promise<V1Result> {
  const l = await load(videoUrl);
  const frontal = l.frames.reduce((a, b) => (Math.abs(b.t - frontalT) < Math.abs(a.t - frontalT) ? b : a));

  const cardWidthPx = Math.hypot(cardPx.x2 - cardPx.x1, cardPx.y2 - cardPx.y1);

  // À défaut de quatre coins pointés, on part du rectangle que les deux bords
  // impliquent, aux proportions ISO — et l'accrochage sur les bords fait le
  // reste. C'est exactement le « un doigt sur un coin » : le cadre de départ n'a
  // pas besoin d'être juste, il a besoin d'être proche.
  const cardQuad: CardQuad =
    corners ??
    (() => {
      const ux = (cardPx.x2 - cardPx.x1) / cardWidthPx;
      const uy = (cardPx.y2 - cardPx.y1) / cardWidthPx;
      const hh = (cardWidthPx * 53.98) / 85.6 / 2;
      const nx = -uy * hh;
      const ny = ux * hh;
      return [
        { x: cardPx.x1 - nx, y: cardPx.y1 - ny },
        { x: cardPx.x2 - nx, y: cardPx.y2 - ny },
        { x: cardPx.x2 + nx, y: cardPx.y2 + ny },
        { x: cardPx.x1 + nx, y: cardPx.y1 + ny },
      ] as CardQuad;
    })();

  // Le balayage : toutes les vues exploitables, dans l'ordre du temps.
  const views: RotatedView[] = l.frames.map((f) => ({
    lm: f.lm,
    yawRad: f.yawRad,
    rollRad: f.rollRad,
    w: l.w,
    h: l.h,
  }));

  // ⭐ La carte suivie pendant TOUT le balayage : un cadre pointé, les autres
  // accrochés sur les bords d'une image à la suivante (`core/cardEdges.ts`).
  let sweep: SweepCamera | null = null;
  let measured: { cardDistanceMm: number; relError: number } | null = null;
  try {
    const quads: CardQuad[] = [];
    let seed: CardQuad | null = refineQuad(await buffer(l, frontal.t), cardQuad);
    let frontalQuad: CardQuad = seed;

    for (const f of l.frames) {
      if (seed === null) break;
      try {
        const q = refineQuad(await buffer(l, f.t), seed, 25); // la tête bouge entre deux images
        quads.push(q);
        seed = q; // suivi : l'image précédente amorce la suivante
        if (Math.abs(f.t - frontal.t) < 1e-6) frontalQuad = q;
      } catch {
        // Carte perdue sur cette image : on garde la graine et on continue.
      }
    }

    sweep = cameraFromSweep(quads, l.w, l.h);
    const d = measureDistance(frontalQuad, sweep, l.w, l.h);
    measured = { cardDistanceMm: d.cardDistanceMm, relError: d.relError };
    console.log(
      `   CARTE — ${quads.length} cadres suivis sur ${l.frames.length} images, ` +
        `${sweep.views} exploitables → focale ${sweep.focalPx.toFixed(0)} px ` +
        `(${(sweep.focalPx / l.w).toFixed(2)} × la largeur d'image, ±${(sweep.focalRelError * 100).toFixed(1)} %) ` +
        `→ distance MESURÉE ${(d.cardDistanceMm / 10).toFixed(1)} cm`,
    );
  } catch (e) {
    console.log(`   CARTE — distance non mesurée : ${(e as Error).message}`);
  }

  const audit = auditYaw(l.frames, l.w, l.h);
  console.log(
    `   AUDIT YAW — rapport (yaw mesuré dans les pixels)/(yaw MediaPipe) : ` +
      `${audit.slope.toFixed(3)} ± ${audit.spread.toFixed(3)} sur ${audit.n} vues ` +
      `(1.000 = MediaPipe juste ; 1,5 = profondeurs gonflées de 50 %)`,
  );
  for (const row of audit.rows) console.log(`      ${row}`);

  const frontalBuf = await buffer(l, frontal.t);
  const left = l.frames.reduce((a, b) => (b.yawRad < a.yawRad ? b : a));
  const right = l.frames.reduce((a, b) => (b.yawRad > a.yawRad ? b : a));
  const motion = motionMask(frontalBuf, [await buffer(l, left.t), await buffer(l, right.t)]);

  const { cal, refinement } = calibrateWithCardMeasured(
    cardWidthPx,
    l.w,
    frontal.lm,
    l.w,
    l.h,
    views,
    { frontal: frontalBuf, motion, lm: frontal.lm, w: l.w, h: l.h },
    measured,
  );

  const naive = (cardWidthPx: number): number => cardWidthPx;
  void naive;

  return {
    faceWidthMm: cal.faceWidthMm,
    relError: cal.relError,
    temporalWidthMm: cal.temporalWidthMm ?? null,
    temporalRelError: cal.temporalRelError ?? null,
    depthMm: refinement.depthMm,
    distanceMm: refinement.distanceMm,
    parallaxFactor: refinement.parallaxFactor,
    viewsUsed: views.length,
    notes: refinement.notes,
    naiveFaceWidthMm: cal.faceWidthMm / refinement.parallaxFactor,
  };
}

declare global {
  interface Window {
    __SURVEY__?: (url: string) => Promise<Survey>;
    __RUNV1__?: (
      url: string,
      card: { x1: number; y1: number; x2: number; y2: number },
      frontalT: number,
      corners?: CardQuad,
    ) => Promise<V1Result>;
  }
}
window.__SURVEY__ = surveyVideo;
window.__RUNV1__ = runV1;
