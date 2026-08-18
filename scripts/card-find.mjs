/**
 * scripts/card-find.mjs — fait tourner `core/cardFinder.ts` sur une VRAIE
 * séquence, et rend les chiffres.
 *
 * ⚠️ Outil d'ATELIER (§0.0.2). C'est lui qui a produit les valeurs citées dans
 * l'en-tête de `core/cardFinder.ts`. Sans lui, elles seraient invérifiables.
 *
 *   node scripts/card-find.mjs <dossier-jpg>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error('Usage : node scripts/card-find.mjs <dossier>');
  process.exit(1);
}
const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();

function findChromium() {
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) {
    const c = `${root}/${d}/chrome-linux/chrome`;
    if (d.startsWith('chromium-') && existsSync(c)) return c;
  }
  return undefined;
}

const server = spawn('npx', ['vite', '--port', '5188', '--strictPort'], { stdio: 'ignore' });
const BASE = 'http://localhost:5188';
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    /* pas encore prêt */
  }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.error('  [page]', m.text()));
await page.goto(BASE, { waitUntil: 'load' });

await page.evaluate(async () => {
  const { FilesetResolver, FaceLandmarker } = await import(
    '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'
  );
  const fileset = await FilesetResolver.forVisionTasks('/wasm');
  window.__lm = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/face_landmarker.task' },
    runningMode: 'IMAGE',
    numFaces: 1,
  });
  window.__find = (await import('/src/core/cardFinder.ts')).findCard;
});

const ratios = [];
let seen = 0;
for (const f of files) {
  const b64 = readFileSync(join(dir, f)).toString('base64');
  const r = await page.evaluate(async (b) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const res = window.__lm.detect(c);
    if (!res.faceLandmarks.length) return null;
    const raw = ctx.getImageData(0, 0, c.width, c.height);
    const buf = { data: raw.data, width: raw.width, height: raw.height };
    const out = window.__find(buf, res.faceLandmarks[0], c.width, c.height);
    return out === null ? null : out.widthRatio;
  }, b64);
  seen++;
  if (r !== null) ratios.push(r);
}

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const m = med(ratios);
const mad = med(ratios.map((x) => Math.abs(x - m))) * 1.4826;
console.log(`carte trouvee : ${ratios.length}/${seen} images`);
console.log(`largeur/visage : mediane ${m.toFixed(4)}  ecart robuste ${(mad / m * 100).toFixed(1)} %`);
console.log(`  -> ecart-type de la MEDIANE : ${((mad / m / Math.sqrt(ratios.length)) * 100).toFixed(2)} %`);

await browser.close();
server.kill();
process.exit(0);
