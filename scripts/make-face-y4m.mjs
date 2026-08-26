/**
 * scripts/make-face-y4m.mjs — fabrique `tests/fixtures/face.y4m` depuis la
 * photo réelle du sujet (docs/verification/essayage-severine.jpg).
 *
 * C'est le fichier que le §8.3 du contrat attendait (« un vrai .y4m contenant
 * un visage permettrait d'aller plus loin ») : injecté par Chromium dans
 * getUserMedia, il rend le parcours ENTIER testable en CI — détection,
 * calibration automatique sans carte, essayage.
 *
 * ⚠️ Outil de banc uniquement (§0.0.2). Le fichier généré n'est pas commité :
 * il se refabrique ici, depuis la photo versionnée, à la demande.
 *
 * Zéro dépendance nouvelle : Chromium (déjà là pour le banc) rastérise la
 * photo ; la conversion RGB → YUV 4:2:0 (BT.601) est écrite en clair.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  MOVING_AMPL_PX,
  MOVING_CX_PX,
  MOVING_FACE_H_PX,
  MOVING_FPS,
  MOVING_H,
  MOVING_PERIOD_S,
  MOVING_W,
} from './movingLaw.mjs';

const SRC = resolve('docs/verification/essayage-severine.jpg');
const OUT = resolve('tests/fixtures/face.y4m');
// Variante S19 : les YEUX sont masqués (bandeau sombre, ~lunettes de soleil).
// Le maillage tient, les iris deviennent inexploitables → refus d'échelle de
// pose persistant : c'est le cas que l'échelle VISUELLE de secours couvre.
const OUT_SHADES = resolve('tests/fixtures/face-shades.y4m');
// 🔴 Variante S20 (terrain 2026-08-26) : le visage SE DÉPLACE. Toutes les
// fixtures étaient statiques et centrées — or sur machine réelle la monture
// décrochait précisément quand le visage bougeait ou s'écartait du centre.
// Ici : cadre PAYSAGE (webcam réelle), visage réduit, position horizontale
// sinusoïdale de trajectoire CONNUE (le banc la reconstruit depuis
// video.currentTime et compare au sprite réellement peint).
const OUT_MOVING = resolve('tests/fixtures/face-moving.y4m');
// 2544×3392 est exactement du 3:4 → 480×640 sans recadrage ni déformation.
const W = 480;
const H = 640;
const FRAMES = 4; // Chromium boucle le fichier ; 4 frames suffisent (~1,8 Mo).

function findChromium() {
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    const c = `${root}/${dir}/chrome-linux/chrome`;
    if (dir.startsWith('chromium-') && existsSync(c)) return c;
  }
  return undefined;
}

const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(`file://${SRC}`);
  const grab = (shadeBand) =>
    page.evaluate(
      async ({ w, h, band }) => {
        const img = document.querySelector('img');
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        if (band) {
          ctx.fillStyle = '#1c1c1c';
          ctx.fillRect(0, Math.round(band.top * h), w, Math.round(band.height * h));
        }
        return Array.from(ctx.getImageData(0, 0, w, h).data);
      },
      { w: W, h: H, band: shadeBand },
    );

  // RGB → YUV 4:2:0, coefficients BT.601 (le standard des fichiers Y4M).
  const toY4m = (rgba) => {
    const y = new Uint8Array(W * H);
    const u = new Uint8Array((W / 2) * (H / 2));
    const v = new Uint8Array((W / 2) * (H / 2));
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const o = (j * W + i) * 4;
        const [r, g, b] = [rgba[o], rgba[o + 1], rgba[o + 2]];
        y[j * W + i] = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
        if (i % 2 === 0 && j % 2 === 0) {
          // Sous-échantillonnage 2×2 : moyenne du bloc pour U et V.
          let sr = 0;
          let sg = 0;
          let sb = 0;
          for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const p = ((j + dj) * W + (i + di)) * 4;
            sr += rgba[p];
            sg += rgba[p + 1];
            sb += rgba[p + 2];
          }
          const [mr, mg, mb] = [sr / 4, sg / 4, sb / 4];
          const k = (j / 2) * (W / 2) + i / 2;
          u[k] = Math.max(0, Math.min(255, Math.round(-0.169 * mr - 0.331 * mg + 0.5 * mb + 128)));
          v[k] = Math.max(0, Math.min(255, Math.round(0.5 * mr - 0.419 * mg - 0.081 * mb + 128)));
        }
      }
    }
    const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`);
    const frame = Buffer.concat([Buffer.from('FRAME\n'), Buffer.from(y), Buffer.from(u), Buffer.from(v)]);
    return Buffer.concat([header, ...Array.from({ length: FRAMES }, () => frame)]);
  };

  mkdirSync(resolve('tests/fixtures'), { recursive: true });
  writeFileSync(OUT, toY4m(await grab(null)));
  console.log(`✅ ${OUT} — ${W}×${H}, ${FRAMES} frames, visage réel du sujet.`);
  // Le bandeau couvre la zone oculaire de CETTE photo (0,40 H → 0,50 H).
  writeFileSync(OUT_SHADES, toY4m(await grab({ top: 0.4, height: 0.1 })));
  console.log(`✅ ${OUT_SHADES} — yeux masqués (refus d'iris persistant, S19).`);

  // ── Variante MOBILE (S20) : toutes les frames sont composées et converties
  // EN PAGE (un seul aller-retour), le mouvement suit movingLaw.mjs à la frame
  // près — le banc pourra opposer le sprite peint à la position VRAIE.
  const movingB64 = await page.evaluate(
    async ({ w, h, fps, periodS, ampl, cx, faceH }) => {
      const img = document.querySelector('img');
      await img.decode();
      const frames = fps * periodS;
      const faceW = Math.round((faceH * 3) / 4); // la photo est du 3:4
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const half = (w / 2) * (h / 2);
      const out = new Uint8Array(frames * (6 + w * h + 2 * half)); // 'FRAME\n' + Y + U + V
      let o = 0;
      for (let f = 0; f < frames; f++) {
        // Fond NON uniforme (dégradé doux) : frameValidity refuse l'uniforme.
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#cfd4da');
        g.addColorStop(1, '#8f979f');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        const t = f / fps;
        const centerX = cx + ampl * Math.sin((2 * Math.PI * (t % periodS)) / periodS);
        ctx.drawImage(img, Math.round(centerX - faceW / 2), Math.round((h - faceH) / 2), faceW, faceH);
        // Repère FIDUCIAIRE : barre noire au sommet, à l'abscisse vraie du
        // centre du visage — le banc lit la vérité terrain dans les PIXELS
        // (immunisé contre tout tampon du faux périphérique de capture).
        ctx.fillStyle = '#000';
        ctx.fillRect(Math.round(centerX) - 4, 0, 8, 14);
        const rgba = ctx.getImageData(0, 0, w, h).data;
        for (const ch of [70, 82, 65, 77, 69, 10]) out[o++] = ch; // 'FRAME\n'
        const uOff = o + w * h;
        const vOff = uOff + half;
        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) {
            const p = (j * w + i) * 4;
            const [r, gg, b] = [rgba[p], rgba[p + 1], rgba[p + 2]];
            out[o + j * w + i] = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * gg + 0.114 * b)));
            if (i % 2 === 0 && j % 2 === 0) {
              let sr = 0;
              let sg = 0;
              let sb = 0;
              for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                const q = ((j + dj) * w + (i + di)) * 4;
                sr += rgba[q];
                sg += rgba[q + 1];
                sb += rgba[q + 2];
              }
              const [mr, mg, mb] = [sr / 4, sg / 4, sb / 4];
              const k = (j / 2) * (w / 2) + i / 2;
              out[uOff + k] = Math.max(0, Math.min(255, Math.round(-0.169 * mr - 0.331 * mg + 0.5 * mb + 128)));
              out[vOff + k] = Math.max(0, Math.min(255, Math.round(0.5 * mr - 0.419 * mg - 0.081 * mb + 128)));
            }
          }
        }
        o = vOff + half;
      }
      let s = '';
      const CHUNK = 32768;
      for (let i = 0; i < out.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, out.subarray(i, Math.min(i + CHUNK, out.length)));
      }
      return btoa(s);
    },
    {
      w: MOVING_W,
      h: MOVING_H,
      fps: MOVING_FPS,
      periodS: MOVING_PERIOD_S,
      ampl: MOVING_AMPL_PX,
      cx: MOVING_CX_PX,
      faceH: MOVING_FACE_H_PX,
    },
  );
  const movingHeader = Buffer.from(`YUV4MPEG2 W${MOVING_W} H${MOVING_H} F${MOVING_FPS}:1 Ip A1:1 C420jpeg\n`);
  writeFileSync(OUT_MOVING, Buffer.concat([movingHeader, Buffer.from(movingB64, 'base64')]));
  console.log(
    `✅ ${OUT_MOVING} — ${MOVING_W}×${MOVING_H} paysage, ${MOVING_FPS * MOVING_PERIOD_S} frames, ` +
      `visage MOBILE (±${MOVING_AMPL_PX} px, période ${MOVING_PERIOD_S} s).`,
  );
} finally {
  await browser.close();
}
