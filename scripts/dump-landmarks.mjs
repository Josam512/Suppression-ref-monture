/**
 * scripts/dump-landmarks.mjs — relève les repères MediaPipe sur une séquence
 * d'images, et les écrit en JSON.
 *
 * ⚠️ Outil d'ATELIER (§0.0.2). Il ne sert qu'à travailler hors ligne sur des
 * images déjà prises ; aucun chemin de `src/` ne le connaît.
 *
 *   node scripts/dump-landmarks.mjs <dossier-jpg> <sortie.json>
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const dir = process.argv[2];
const out = process.argv[3] ?? 'landmarks.json';
if (!dir || !existsSync(dir)) {
  console.error('Usage : node scripts/dump-landmarks.mjs <dossier> <sortie.json>');
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
console.log(`${files.length} images`);

// Servi par vite : le modèle et le wasm sont déjà en place sous public/.
const { spawn } = await import('node:child_process');
const server = spawn('npx', ['vite', '--port', '5187', '--strictPort'], { stdio: 'ignore' });
const BASE = 'http://localhost:5187';
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(BASE);
    if (r.ok) break;
  } catch {
    /* pas encore prêt */
  }
  await new Promise((r) => setTimeout(r, 500));
}

// Les images vivent hors de public/ : on les sert en base64 via le contexte.
const { readFileSync } = await import('node:fs');

// ⚠️ Le chromium préinstallé, jamais un téléchargement : le proxy le bloque et
// `playwright install` échouerait sans dire pourquoi.
function findChromium() {
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) {
    const c = `${root}/${d}/chrome-linux/chrome`;
    if (d.startsWith('chromium-') && existsSync(c)) return c;
  }
  return undefined;
}

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.error('  [page]', m.text()));
await page.goto(BASE, { waitUntil: 'load' });

await page.evaluate(async () => {
  const { FilesetResolver, FaceLandmarker } = await import('/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks('/wasm');
  window.__lm = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/face_landmarker.task' },
    runningMode: 'IMAGE',
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
  });
});

const rows = [];
for (let i = 0; i < files.length; i++) {
  const b64 = readFileSync(join(dir, files[i])).toString('base64');
  const r = await page.evaluate(async (b) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const res = window.__lm.detect(c);
    if (!res.faceLandmarks.length) return null;
    const m = res.facialTransformationMatrixes?.[0]?.data ?? null;
    return {
      w: c.width,
      h: c.height,
      lm: res.faceLandmarks[0].map((p) => [Math.round(p.x * 1e5) / 1e5, Math.round(p.y * 1e5) / 1e5]),
      matrix: m ? Array.from(m) : null,
    };
  }, b64);
  rows.push(r === null ? null : { i, ...r });
  if (i % 20 === 0) console.log(`  ${i}/${files.length}`);
}

writeFileSync(out, JSON.stringify({ dir, files, rows }));
const found = rows.filter(Boolean).length;
console.log(`visage detecte sur ${found}/${files.length} images -> ${out}`);

await browser.close();
server.kill();
process.exit(0);
