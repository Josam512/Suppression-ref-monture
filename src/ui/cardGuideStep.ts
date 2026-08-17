/**
 * ui/cardGuideStep.ts — l'étape « posez votre carte », en direct.
 *
 * Elle remplace le parcours à deux poignées sur une image figée. Le client ne
 * clique rien, ne règle rien, ne valide rien : il pose sa carte là où seront ses
 * lunettes, et la mesure se prend d'elle-même en une fraction de seconde.
 *
 * ⚠️ Ce fichier ne mesure rien lui-même — toute la métrologie est dans
 * `core/cardGuide.ts` et `core/cardEdges.ts`. Il lit des pixels, dessine, et
 * relaie le verrouillage.
 *
 * 🔴 Les pixels sont pris sur la VIDÉO, jamais sur le canvas d'affichage : ce
 * dernier est transparent au-dessus du `<video>` et ne contient pas l'image.
 * Le journal du projet retient déjà deux pannes de cette famille — `onLost` qui
 * ne dessinait pas, `putImageData` qui remplaçait au lieu de composer.
 */

import {
  GuideLock,
  checkCardInGuide,
  guideEdgeStep,
  guideQuad,
  type GuideCheck,
} from '../core/cardGuide.js';
import { refineQuadDetailed } from '../core/cardEdges.js';
import type { CardQuad } from '../core/cardPose.js';
import type { NormalizedLandmark } from '../core/geom.js';
import type { ImageBuffer } from '../core/silhouette.js';

export interface GuideStepFrame {
  /** 0 → 1, la jauge affichée. */
  fill: number;
  /** Non nul À L'IMAGE EXACTE du verrouillage, une seule fois. */
  locked: { widthPx: number; quad: CardQuad } | null;
}

/** Épaisseur du tracé du cadre, en pixels. */
const STROKE_PX = 4;

export class CardGuideStep {
  private readonly lock = new GuideLock();
  private readonly off = document.createElement('canvas');

  reset(): void {
    this.lock.reset();
  }

  /**
   * Une image : lit la vidéo, teste la carte dans le cadre, dessine, et dit si
   * c'est verrouillé.
   *
   * @param ctx canvas d'affichage, superposé à la vidéo.
   * @param video source des pixels — la seule qui contienne l'image.
   */
  run(
    ctx: CanvasRenderingContext2D,
    lm: readonly NormalizedLandmark[],
    video: HTMLVideoElement | null,
  ): GuideStepFrame {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const guide = guideQuad(lm, w, h);

    let check: GuideCheck = { worstOffsetPx: Infinity, fill: 0, ok: false };
    let snapped: CardQuad = guide;

    const buf = this.readVideo(video, w, h);
    if (buf !== null) {
      const edgeStep = guideEdgeStep(buf, guide);
      let measured = 0;
      try {
        const refined = refineQuadDetailed(buf, guide);
        snapped = refined.quad;
        measured = refined.measured;
      } catch {
        measured = 0; // bord introuvable : ce n'est pas une erreur, c'est « pas encore ».
      }
      check = checkCardInGuide(snapped, guide, measured, edgeStep);
    }

    this.draw(ctx, guide, check);

    const fired = this.lock.push(check.ok);
    return {
      fill: check.fill,
      locked: fired
        ? {
            widthPx: Math.hypot(snapped[1].x - snapped[0].x, snapped[1].y - snapped[0].y),
            quad: snapped,
          }
        : null,
    };
  }

  private readVideo(video: HTMLVideoElement | null, w: number, h: number): ImageBuffer | null {
    if (video === null || video.readyState < 2) return null;
    if (this.off.width !== w || this.off.height !== h) {
      this.off.width = w;
      this.off.height = h;
    }
    const octx = this.off.getContext('2d', { willReadFrequently: true });
    if (octx === null) return null;
    octx.drawImage(video, 0, 0, w, h);
    const raw = octx.getImageData(0, 0, w, h);
    return { data: raw.data, width: raw.width, height: raw.height };
  }

  /** Le cadre, et une jauge qui dit ce qui manque encore. */
  private draw(ctx: CanvasRenderingContext2D, guide: CardQuad, check: GuideCheck): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.save();

    ctx.lineWidth = STROKE_PX;
    // Du blanc translucide vers le vert franc : le client voit qu'il approche
    // sans avoir à lire un chiffre.
    ctx.strokeStyle = check.ok ? '#34c759' : `rgba(255,255,255,${0.45 + 0.5 * check.fill})`;
    ctx.beginPath();
    ctx.moveTo(guide[0].x, guide[0].y);
    for (const p of [guide[1], guide[2], guide[3]]) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.stroke();

    // La jauge, sous le cadre, alignée sur sa largeur.
    const x0 = Math.min(...guide.map((p) => p.x));
    const x1 = Math.max(...guide.map((p) => p.x));
    const y = Math.max(...guide.map((p) => p.y)) + 3 * STROKE_PX;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x0, y, x1 - x0, STROKE_PX);
    ctx.fillStyle = check.ok ? '#34c759' : '#ffffff';
    ctx.fillRect(x0, y, (x1 - x0) * check.fill, STROKE_PX);

    ctx.restore();
  }
}

/**
 * L'étape carte pour UNE image : dessine, et relaie le verrouillage.
 *
 * Extrait de `TryOn.tsx` pour tenir la règle des 300 lignes (§3) — et parce que
 * le gel de l'image au verrouillage est un point délicat qui mérite d'être lu
 * d'un seul tenant, à côté de ce qu'il gèle.
 */
export function runCardStep(
  step: CardGuideStep,
  ctx: CanvasRenderingContext2D,
  lm: readonly NormalizedLandmark[],
  video: HTMLVideoElement | null,
  on: {
    /** Reçoit l'image EXACTE du verrouillage, figée. */
    locked(widthPx: number, quad: CardQuad, frozen: HTMLCanvasElement): void;
    fill(ratio: number): void;
  },
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const out = step.run(ctx, lm, video);

  if (out.locked === null) {
    on.fill(out.fill);
    return;
  }

  // 🔴 Seule exception au « live et jamais différé » (§0.0.2), et elle est
  // nécessaire : la chaîne aval mesure le VISAGE sur les mêmes pixels que la
  // carte. Sur deux images différentes, la personne aurait bougé entre les deux
  // et le rapport carte/visage — qui EST la mesure — serait faux.
  const frozen = document.createElement('canvas');
  frozen.width = w;
  frozen.height = h;
  const fctx = frozen.getContext('2d');
  if (fctx === null || video === null) return;
  fctx.drawImage(video, 0, 0, w, h);
  on.locked(out.locked.widthPx, out.locked.quad, frozen);
}
