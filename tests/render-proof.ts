/**
 * tests/render-proof.ts — preuve MÉTROLOGIQUE du rendu, dans un vrai navigateur.
 *
 * Vitest teste la géométrie en calcul pur. Il ne peut pas répondre à la seule
 * question qui compte vraiment (§0, critère de succès) :
 *
 *   « les pixels réellement peints à l'écran mesurent-ils bien 132 mm ? »
 *
 * Ce banc compose le sprite avec le VRAI `drawFrame`, sur un VRAI canvas, puis
 * remesure la bounding box des pixels peints et la reconvertit en millimètres.
 * Il ferme la boucle : spec.json → affine → drawImage → pixels → millimètres.
 *
 * ⚠️ N'existe qu'en CI (§8.3). Aucun chemin de `src/` ne le charge, et il n'est
 * pas dans les entrées du build de production.
 *
 * ⚠️ Le sprite est un rectangle de synthèse aux cotes connues. Ce n'est PAS une
 * monture, et il ne prétend pas l'être : il sert d'étalon pour vérifier la
 * chaîne géométrique. La forme réelle vient toujours d'une photo (§1 bug #2).
 */

import { frameMetrics } from '../src/core/faceMetrics.js';
import { totalFrameWidthMm, type FrameSpec } from '../src/core/frameSpec.js';
import { spriteToScreen, VERTICAL_OFFSET_MM } from '../src/core/transform.js';
import { BRIDGE_AHEAD_MM, planeScale } from '../src/core/framePlane.js';
import type { UserCalibration } from '../src/core/calibration.js';
import { drawFrame, OVERLAY_PADDING_MM } from '../src/render/composite.js';
import { makeFace, makeFaceAtYaw, BASE_FACE_PX, W, H } from './fixtures/landmarks.js';

const SPRITE_PX_PER_MM = 12;
const PAD = 20; // marge transparente volontaire : c'est le piège B3
const CONTENT_W = 132 * SPRITE_PX_PER_MM; // 1584 px → 132,0 mm
const CONTENT_H = 512;

const SPEC: FrameSpec = {
  slug: 'banc-de-mesure',
  aMm: 44,
  bMm: 39,
  pontMm: 22,
  brancheMm: 145,
  totalWidthMm: CONTENT_W / SPRITE_PX_PER_MM,
  front: 'front.png',
  profile: 'profile.png',
  spritePxPerMm: SPRITE_PX_PER_MM,
  alphaBBox: { x: PAD, y: 18, w: CONTENT_W, h: CONTENT_H },
  bridgeCenter: { x: PAD + CONTENT_W / 2, y: 18 + CONTENT_H / 2 },
  lensCenterL: { x: PAD + CONTENT_W / 2 - 360, y: 286 },
  lensCenterR: { x: PAD + CONTENT_W / 2 + 360, y: 286 },
  hingeProfile: { x: 96, y: 130 },
  calibratedAt: '2026-08-16',
};

const CAL: UserCalibration = {
  faceWidthMm: 138,
  source: 'card',
  relError: 0.025,
  measuredAt: 0,
};

/** Sprite de synthèse : un bloc opaque entouré de marges TRANSPARENTES. */
function makeSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = CONTENT_W + 2 * PAD;
  c.height = CONTENT_H + 2 * 18;
  const ctx = c.getContext('2d');
  if (ctx === null) throw new Error('canvas 2D indisponible');
  ctx.fillStyle = '#101010';
  ctx.fillRect(PAD, 18, CONTENT_W, CONTENT_H);
  return c;
}

interface Painted {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box des pixels réellement peints. */
function paintedBBox(ctx: CanvasRenderingContext2D): Painted | null {
  const { width, height } = ctx.canvas;
  const d = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3]! > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export interface ProofCase {
  nom: string;
  attendu: number;
  mesure: number;
  ecart: number;
  ok: boolean;
  unite: string;
}

function compare(nom: string, attendu: number, mesure: number, tol: number, unite: string): ProofCase {
  const ecart = mesure - attendu;
  return { nom, attendu, mesure, ecart, ok: Math.abs(ecart) <= tol, unite };
}

export function runProof(): ProofCase[] {
  const sprite = makeSprite();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('canvas 2D indisponible');

  // ⚠️ Profil VIDE : ce banc mesure la FACE. Depuis que la branche est peinte
  // avant elle, un profil non vide entrerait dans la bounding box mesuree et
  // fausserait les controles de yaw — le banc l'a d'ailleurs signale.
  const emptyProfile = document.createElement('canvas');
  emptyProfile.width = 1;
  emptyProfile.height = 1;

  const sprites = {
    front: { img: sprite, spec: SPEC },
    profile: { img: emptyProfile, spec: SPEC },
  };

  const paint = (lm: ReturnType<typeof makeFace>, yaw: number, paddingMm = 0): Painted => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const m = frameMetrics(lm, W, H, CAL, yaw);
    drawFrame(ctx, sprites, m, null, { overlayPaddingMm: paddingMm });
    const box = paintedBBox(ctx);
    if (box === null) throw new Error('rien n’a été peint');
    return box;
  };

  const out: ProofCase[] = [];

  // ── 1. La question du projet : les pixels peints font-ils 132 mm ?
  const lm = makeFace({ faceWidthPx: BASE_FACE_PX });
  const m0 = frameMetrics(lm, W, H, CAL, 0);
  const box0 = paint(lm, 0);
  out.push(
    compare(
      'largeur peinte reconvertie en mm',
      totalFrameWidthMm(SPEC),
      box0.w / m0.livePxPerMm,
      0.25,
      'mm',
    ),
  );

  // ── 2. B3 : les marges transparentes ne doivent RIEN ajouter.
  // Le fichier fait 1624 px de large pour 1584 px de monture. Si la chaîne
  // retombait sur les dimensions du fichier, on lirait 135,3 mm au lieu de 132.
  out.push(
    compare(
      'le padding alpha n’élargit pas la monture',
      132,
      box0.w / m0.livePxPerMm,
      0.25,
      'mm',
    ),
  );

  // ── 3. B3, second volet : un sprite padé doit être POSÉ au bon endroit.
  const centre = { x: box0.x + box0.w / 2, y: box0.y + box0.h / 2 };
  const ancre = spriteToScreen(SPEC.bridgeCenter, SPEC, m0);
  out.push(compare('centre peint ↔ centre du pont projeté (x)', ancre.x, centre.x, 1.5, 'px'));
  out.push(compare('centre peint ↔ centre du pont projeté (y)', ancre.y, centre.y, 1.5, 'px'));

  // ── 4. L'ancrage vertical vaut bien VERTICAL_OFFSET_MM sous le sellion.
  //
  // ⚠️ Reconverti à l'échelle du PLAN DU PONT, pas à celle des tempes : ces
  // 3 mm se mesurent sur l'arête du nez, ~48 mm devant les repères 234/454.
  // Diviser par `livePxPerMm` ferait sortir 3,2 mm et l'écart passerait pour
  // une erreur de pose alors qu'il est de la perspective (`core/framePlane.ts`).
  const sellionY = (lm[168]?.y ?? 0) * H;
  out.push(
    compare(
      'décalage vertical sous le sellion',
      VERTICAL_OFFSET_MM,
      (centre.y - sellionY) / planeScale(m0.livePxPerMm, BRIDGE_AHEAD_MM),
      0.3,
      'mm',
    ),
  );

  // ── 5. S1 : un yaw ne change pas la HAUTEUR peinte…
  const yaw = Math.PI / 9; // 20°
  const boxYaw = paint(makeFaceAtYaw(yaw), yaw);
  out.push(compare('hauteur peinte à 20° vs 0°', box0.h, boxYaw.h, 1.5, 'px'));

  // ── 6. …et rétrécit la largeur d'exactement cos(yaw), UNE fois (pas cos²).
  out.push(
    compare('largeur peinte à 20° / largeur à 0°', Math.cos(yaw), boxYaw.w / box0.w, 0.01, '×'),
  );

  // ── 7. V2 : la dilatation épaissit de OVERLAY_PADDING_MM de chaque côté.
  const boxPad = paint(lm, 0, OVERLAY_PADDING_MM);
  out.push(
    compare(
      'dilatation V2 de chaque côté',
      OVERLAY_PADDING_MM,
      (boxPad.w - box0.w) / 2 / m0.livePxPerMm,
      0.3,
      'mm',
    ),
  );

  // ── 8. V2 : la dilatation ne DÉPLACE pas la monture.
  out.push(
    compare(
      'la dilatation reste centrée',
      centre.x,
      boxPad.x + boxPad.w / 2,
      1.5,
      'px',
    ),
  );

  return out;
}
