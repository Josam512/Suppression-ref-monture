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
import { guideQuad } from '../src/core/cardGuide.js';
import { checkCardInGuide, guideEdgeStep } from '../src/core/cardGuideLock.js';
import type { CardQuad } from '../src/core/cardPose.js';
import { faceWidthPx, rollRadOf } from '../src/core/faceMetrics.js';
import type { NormalizedLandmark, Pt } from '../src/core/geom.js';
import { luma, type ImageBuffer } from '../src/core/silhouette.js';
import { createLandmarker } from '../src/tracking/landmarker.js';

/**
 * Coins de la carte sur la PREMIÈRE image, pointés à la main sur une grille de
 * coordonnées. C'est le geste d'un opticien : deux clics, pas un algorithme.
 * Tout le reste de la séquence est ensuite accroché de proche en proche.
 */
const SEED_QUAD: CardQuad = [
  { x: 405, y: 537 },
  { x: 722, y: 563 },
  { x: 718, y: 700 },
  { x: 402, y: 707 },
];

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
  /**
   * Les QUATRE marches de la carte, bord par bord, dans l'ordre haut/droite/bas/gauche.
   *
   * 🔴 Indispensable ici : dans cette séquence la carte est calée contre les
   * cheveux, donc son bord HAUT est sombre sur sombre. Le minimum sur quatre
   * bords s'effondre alors pour une raison qui n'existe plus quand la carte est
   * portée à hauteur des yeux, peau tout autour. Sans ce détail, on figerait un
   * seuil sur le handicap d'un seul bord.
   */
  cardEdgeSteps: number[] | null;
  /** Le cadre proposé, en pixels — pour rejouer la scène hors ligne. */
  guideQuadPx: CardQuad;
  /** Le quadrilatère suivi, pour le tracé de contrôle. */
  cardQuad: CardQuad | null;
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

/**
 * Les quatre marches d'un quadrilatère, séparément.
 *
 * ⚠️ Reprend la géométrie de `guideEdgeStep` (même sonde à ±6 px, mêmes 23
 * échantillons) mais SANS le minimum final. C'est un instrument d'atelier : il
 * regarde ce que la fonction de production réduit à un seul nombre.
 */
function edgeStepsOf(buf: ImageBuffer, q: CardQuad): number[] {
  const PROBE_PX = 6; // identique à core/cardGuide.ts
  return [0, 1, 2, 3].map((e) => {
    const a = q[e] as Pt;
    const b = q[(e + 1) % 4] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) return 0;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    let sum = 0;
    for (let i = 1; i < 24; i++) {
      const t = i / 24;
      const cx = a.x + (b.x - a.x) * t;
      const cy = a.y + (b.y - a.y) * t;
      const inside = luma(buf, Math.round(cx - nx * PROBE_PX), Math.round(cy - ny * PROBE_PX));
      const outside = luma(buf, Math.round(cx + nx * PROBE_PX), Math.round(cy + ny * PROBE_PX));
      sum += Math.abs(outside - inside);
    }
    return sum / 23;
  });
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

export async function surveyGuide(manifestUrl: string, only?: number): Promise<GuideSurvey> {
  const { load, count: total, fps, canvas, ctx, w, h } = await open(manifestUrl);
  const count = only === undefined ? total : Math.min(total, only);
  const landmarker = await createLandmarker();

  const rows: GuideRow[] = [];
  const keep: { t: number; lm: readonly NormalizedLandmark[] }[] = [];
  let stepped = 0;
  let detected = 0;
  let ts = 0;
  let track: CardQuad | null = null;

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

    // ⭐ La carte est SUIVIE : chaque image repart du résultat de la précédente.
    // Aucune détection — le seul apport humain est le pointage de l'image 0.
    let card: CardQuad | null = null;
    let cardMeasured = 0;
    try {
      const r = refineQuadDetailed(buf, track ?? SEED_QUAD);
      if (r.measured >= 2) {
        card = r.quad;
        cardMeasured = r.measured;
        track = r.quad;
      }
    } catch {
      card = null; // suivi perdu : on repartira de la graine à l'image suivante.
      track = null;
    }

    rows.push({
      t,
      edgeStep,
      measured,
      worstOffsetPx: check.worstOffsetPx,
      fill: check.fill,
      ok: check.ok,
      foundWidthPx: card === null ? null : Math.hypot(card[1].x - card[0].x, card[1].y - card[0].y),
      foundEdgeStep: card === null ? null : guideEdgeStep(buf, card),
      foundMeasured: card === null ? null : cardMeasured,
      foundRollVsHeadDeg:
        card === null
          ? null
          : ((Math.atan2(card[1].y - card[0].y, card[1].x - card[0].x) - rollRadOf(lm, w, h)) * 180) / Math.PI,
      guideQuadPx: guide,
      cardEdgeSteps: card === null ? null : edgeStepsOf(buf, card),
      cardQuad: card,
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
      strokeQuad(ctx, guideQuad(entry.lm, w, h), '#ff2d55', 5); // le cadre proposé
      const row = rows.find((r) => r.t === p.t);
      if (row?.cardQuad != null) strokeQuad(ctx, row.cardQuad, '#34c759', 5); // la carte suivie
    }
    samples.push({ label: p.label, t: p.t, png: canvas.toDataURL('image/png') });
  }

  return { w, h, stepped, detected, rows, samples };
}

declare global {
  interface Window {
    __SURVEYGUIDE__?: (url: string, only?: number) => Promise<GuideSurvey>;
  }
}
window.__SURVEYGUIDE__ = surveyGuide;
