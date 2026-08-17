/**
 * tests/guide-on-video.ts — atelier : le cadre à remplir, sur une VRAIE vidéo.
 *
 * ⚠️ Outil d'atelier (§0.0.2). Aucun chemin de `src/` ne l'importe.
 *
 * Il répond à la seule question que la simulation ne peut pas trancher :
 * **quand la carte remplit vraiment le cadre, le signal de bord décolle-t-il ?**
 *
 * Le défaut d'origine — cadre centré dans l'image, donc sur les yeux — a été
 * trouvé ici et nulle part ailleurs : sur 179 images, la marche de luminance
 * plafonnait à 1,4 alors qu'elle vaut 34,6 quand la carte est réellement dans
 * le cadre. Aucune relecture de code n'aurait pu l'attraper.
 *
 * 🔴 Ce fichier MESURE, il ne règle rien. Il sort un profil temporel brut ;
 * c'est l'humain qui lit le profil et fige le seuil. Ajuster un seuil jusqu'à
 * ce qu'une courbe fasse joli est très exactement ce que le dépôt combat.
 */

import { refineQuadDetailed } from '../src/core/cardEdges.js';
import { checkCardInGuide, guideEdgeStep, guideQuad } from '../src/core/cardGuide.js';
import type { CardQuad } from '../src/core/cardPose.js';
import { findCardOnForehead } from './cardFind.atelier.js';
import { faceWidthPx, rollRadOf } from '../src/core/faceMetrics.js';
import type { NormalizedLandmark } from '../src/core/geom.js';
import type { ImageBuffer } from '../src/core/silhouette.js';
import { createLandmarker } from '../src/tracking/landmarker.js';

/** Pas d'échantillonnage : toutes les images utiles, sans exiger le temps réel. */
const STEP_S = 1 / 30;

export interface GuideRow {
  t: number;
  /** Marche de luminance du bord le plus faible du cadre. */
  edgeStep: number;
  /** Bords réellement accrochés sur les pixels, sur 4. */
  measured: number;
  /** Écart du pire coin accroché au cadre, en px. */
  worstOffsetPx: number;
  fill: number;
  ok: boolean;
  /** Largeur de la carte TROUVÉE par recherche libre sur le front, en px. */
  foundWidthPx: number | null;
  /** Marche de luminance sur le contour de la carte trouvée. */
  foundEdgeStep: number | null;
  /** Bords sous-pixel accrochés sur la carte trouvée, sur 4. */
  foundMeasured: number | null;
  /**
   * Inclinaison de la carte MOINS celle de la tête, en degrés.
   *
   * ⚠️ C'est ce que le contrat supposait nul (« posée à plat sur le front »).
   * S'il ne l'est pas, verrouiller la recherche sur le roll du visage est faux.
   */
  foundRollVsHeadDeg: number | null;
  /**
   * Largeur du VISAGE en pixels sur cette image.
   *
   * 🔴 C'est le contrôle d'exactitude non circulaire : la personne avance et
   * recule, donc `foundWidthPx` doit varier — mais leur RAPPORT, lui, ne doit
   * pas bouger, la carte et le visage grossissant ensemble. Une détection qui
   * accroche autre chose fait exploser la dispersion de ce rapport.
   */
  facePx: number;
  /** Largeur du cadre à cette image, en px — pour rapporter la précédente. */
  guideWidthPx: number;
}

export interface GuideSurvey {
  w: number;
  h: number;
  stepped: number;
  detected: number;
  rows: GuideRow[];
  /** Vignettes annotées aux instants les plus parlants. */
  samples: { label: string; t: number; png: string }[];
}

/**
 * ⚠️ Séquence d'IMAGES, pas un `<video>`.
 *
 * Le Chromium open-source du poste de dev ne décode pas le H.264 : un `<video>`
 * sur le fichier du téléphone lève « Vidéo illisible » sans plus d'explication.
 * On alimente donc la chaîne image par image, ce qui a un second mérite — chaque
 * image est relue à l'identique d'une exécution à l'autre, alors qu'un `seek`
 * vidéo ne retombe pas toujours sur la même frame.
 */
interface Ready {
  load: (i: number) => Promise<HTMLImageElement>;
  count: number;
  fps: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

async function open(manifestUrl: string): Promise<Ready> {
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/'));
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`Manifeste illisible : ${manifestUrl}`);
  const { n, fps } = (await res.json()) as { n: number; fps: number };

  const load = async (i: number): Promise<HTMLImageElement> => {
    const el = new Image();
    el.src = `${base}/f${String(i).padStart(4, '0')}.jpg`;
    await el.decode();
    return el;
  };

  const first = await load(0);
  const w = first.naturalWidth;
  const h = first.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('Contexte 2D indisponible.');
  return { load, count: n, fps, canvas, ctx, w, h };
}

function strokeQuad(ctx: CanvasRenderingContext2D, q: CardQuad, color: string, width: number): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(q[0].x, q[0].y);
  for (const p of [q[1], q[2], q[3]]) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export async function surveyGuide(manifestUrl: string): Promise<GuideSurvey> {
  const { load, count, fps, canvas, ctx, w, h } = await open(manifestUrl);
  const landmarker = await createLandmarker();

  const rows: GuideRow[] = [];
  const keep: { t: number; lm: readonly NormalizedLandmark[] }[] = [];
  let stepped = 0;
  let detected = 0;
  let ts = 0;

  for (let i = 0; i < count; i++) {
    const t = i / fps;
    const frame = await load(i);
    stepped++;
    ts += 1000 * STEP_S;

    const res = landmarker.detectForVideo(frame, ts);
    const lm = res.faceLandmarks[0];
    if (lm === undefined) continue;
    detected++;

    ctx.drawImage(frame, 0, 0, w, h);
    const raw = ctx.getImageData(0, 0, w, h);
    const buf: ImageBuffer = { data: raw.data, width: raw.width, height: raw.height };

    const guide = guideQuad(lm, w, h);
    const edgeStep = guideEdgeStep(buf, guide);

    let measured = 0;
    let snapped: CardQuad = guide;
    try {
      const refined = refineQuadDetailed(buf, guide);
      snapped = refined.quad;
      measured = refined.measured;
    } catch {
      measured = 0;
    }
    const check = checkCardInGuide(snapped, guide, measured, edgeStep);

    const found = findCardOnForehead(buf, lm, w, h);

    rows.push({
      t,
      edgeStep,
      measured,
      worstOffsetPx: check.worstOffsetPx,
      fill: check.fill,
      ok: check.ok,
      foundWidthPx: found === null ? null : found.widthPx,
      foundEdgeStep: found === null ? null : found.edgeStep,
      foundMeasured: found === null ? null : found.measured,
      foundRollVsHeadDeg: found === null ? null : ((found.rollRad - rollRadOf(lm, w, h)) * 180) / Math.PI,
      facePx: faceWidthPx(lm, w, h),
      guideWidthPx: Math.hypot(guide[1].x - guide[0].x, guide[1].y - guide[0].y),
    });
    keep.push({ t, lm });
  }

  // — Vignettes : le meilleur signal de cadre, la meilleure carte trouvée, et deux témoins.
  const byStep = [...rows].sort((a, b) => b.edgeStep - a.edgeStep);
  const byFound = [...rows].filter((r) => r.foundEdgeStep !== null).sort((a, b) => (b.foundEdgeStep ?? 0) - (a.foundEdgeStep ?? 0));
  const picks: { label: string; t: number }[] = [];
  if (byStep[0] !== undefined) picks.push({ label: 'cadre-max', t: byStep[0].t });
  if (byFound[0] !== undefined) picks.push({ label: 'trouvee-max', t: byFound[0].t });
  // Une planche large : toutes les images où quelque chose a été trouvé.
  for (const r of byFound) picks.push({ label: `f-${r.t.toFixed(2)}`, t: r.t });

  const samples: { label: string; t: number; png: string }[] = [];
  for (const p of picks) {
    ctx.drawImage(await load(Math.round(p.t * fps)), 0, 0, w, h);
    const entry = keep.find((k) => k.t === p.t);
    if (entry !== undefined) {
      const raw = ctx.getImageData(0, 0, w, h);
      const buf: ImageBuffer = { data: raw.data, width: raw.width, height: raw.height };
      strokeQuad(ctx, guideQuad(entry.lm, w, h), '#ff2d55', 5); // le cadre proposé
      const found = findCardOnForehead(buf, entry.lm, w, h);
      if (found !== null) strokeQuad(ctx, found.quad, '#34c759', 5); // la carte trouvée
    }
    samples.push({ label: p.label, t: p.t, png: canvas.toDataURL('image/png') });
  }

  return { w, h, stepped, detected, rows, samples };
}

declare global {
  interface Window {
    __SURVEYGUIDE__?: (url: string) => Promise<GuideSurvey>;
  }
}
window.__SURVEYGUIDE__ = surveyGuide;
