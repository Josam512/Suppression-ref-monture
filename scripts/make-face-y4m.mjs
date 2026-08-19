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

const SRC = resolve('docs/verification/essayage-severine.jpg');
const OUT = resolve('tests/fixtures/face.y4m');
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
  const rgba = await page.evaluate(
    async ({ w, h }) => {
      const img = document.querySelector('img');
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      return Array.from(ctx.getImageData(0, 0, w, h).data);
    },
    { w: W, h: H },
  );

  // RGB → YUV 4:2:0, coefficients BT.601 (le standard des fichiers Y4M).
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
  mkdirSync(resolve('tests/fixtures'), { recursive: true });
  writeFileSync(OUT, Buffer.concat([header, ...Array.from({ length: FRAMES }, () => frame)]));
  console.log(`✅ ${OUT} — ${W}×${H}, ${FRAMES} frames, visage réel du sujet.`);
} finally {
  await browser.close();
}
