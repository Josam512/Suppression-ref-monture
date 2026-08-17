/**
 * scripts/v1-on-video.mjs — fait tourner la chaine V1 sur une VRAIE video.
 *
 * Outil d'atelier (§0.0.2). Deux modes :
 *
 *   node scripts/v1-on-video.mjs <video> [sortie]
 *       releve ce que la video contient et exporte les vignettes.
 *
 *   node scripts/v1-on-video.mjs <video> [sortie] --card x1,y1,x2,y2 --t <secondes>
 *       calibration complete, une fois les deux bords de la carte pointes.
 */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const video = argv[0];
const outDir = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'v1-out';
const cardArg = argv.includes('--card') ? argv[argv.indexOf('--card') + 1] : null;
const tArg = argv.includes('--t') ? Number(argv[argv.indexOf('--t') + 1]) : 0;

if (!video || !existsSync(video)) {
  console.error('Usage : node scripts/v1-on-video.mjs <video> [sortie] [--card x1,y1,x2,y2 --t s]');
  process.exit(1);
}

const PORT = 5183;
const BASE = `http://localhost:${PORT}`;
const SERVED = 'public/_v1';

function findChromium() {
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) {
    const c = `${root}/${d}/chrome-linux/chrome`;
    if (d.startsWith('chromium-') && existsSync(c)) return c;
  }
  return undefined;
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(BASE)).ok) return; } catch { /* pas encore pret */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Serveur de dev injoignable sur ${BASE}`);
}

const png = (dataUrl, file) => writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

rmSync(SERVED, { recursive: true, force: true });
mkdirSync(SERVED, { recursive: true });
cpSync(video, join(SERVED, basename(video)));
mkdirSync(outDir, { recursive: true });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/tests/v1-on-video.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__SURVEY__ === 'function', { timeout: 20000 });

  const url = `/_v1/${basename(video)}`;

  if (cardArg === null) {
    const s = await page.evaluate((u) => window.__SURVEY__(u), url);
    console.log(`  dimensions        : ${s.w} x ${s.h}`);
    console.log(`  duree             : ${s.durationS.toFixed(2)} s`);
    console.log(`  images parcourues : ${s.stepped}`);
    console.log(`  visage detecte    : ${s.detected} (${((100*s.detected)/s.stepped).toFixed(0)} %)`);
    console.log(`  yaw balaye        : ${s.yawDegMin.toFixed(1)}° a ${s.yawDegMax.toFixed(1)}°`);
    console.log(`  roll median       : ${s.rollDegMedian.toFixed(1)}°`);
    console.log(`  image frontale    : t = ${s.frontalT.toFixed(2)} s`);
    console.log(`  marges au bord    : gauche ${s.frontalMargins.left.toFixed(0)} px, droite ${s.frontalMargins.right.toFixed(0)} px`);
    console.log(`  meilleure pour silhouette : ${s.best ? `t=${s.best.t.toFixed(2)} s yaw ${s.best.yawDeg.toFixed(1)}° marges ${s.best.marginLeftPx.toFixed(0)}/${s.best.marginRightPx.toFixed(0)} px` : 'aucune'}`);
    png(s.frontalPng, join(outDir, 'frontale.png'));
    console.log(`  ${join(outDir, 'frontale.png')}`);
    for (const v of s.samples) {
      const f = join(outDir, `${v.label}.png`);
      png(v.png, f);
      console.log(`  ${f}  (t=${v.t.toFixed(2)} s, yaw ${v.yawDeg.toFixed(1)}°)`);
    }
  } else {
    const [x1, y1, x2, y2] = cardArg.split(',').map(Number);
    const r = await page.evaluate(
      ({ u, c, t }) => window.__RUNV1__(u, c, t),
      { u: url, c: { x1, y1, x2, y2 }, t: tArg },
    );
    console.log(`  vues utilisees      : ${r.viewsUsed}`);
    console.log(`  profondeur mesuree  : ${r.depthMm === null ? '—' : r.depthMm.toFixed(1) + ' mm'}`);
    console.log(`  distance retenue    : ${(r.distanceMm / 10).toFixed(0)} cm`);
    console.log(`  facteur parallaxe   : ${r.parallaxFactor.toFixed(4)}  (${((r.parallaxFactor-1)*100).toFixed(1)} %)`);
    console.log(`  largeur reperes     : ${r.naiveFaceWidthMm.toFixed(1)} mm brute -> ${r.faceWidthMm.toFixed(1)} mm corrigee`);
    console.log(`  incertitude echelle : ${(r.relError * 100).toFixed(2)} %`);
    console.log(`  ECART TEMPORAL      : ${r.temporalWidthMm === null ? 'non mesure' : r.temporalWidthMm.toFixed(1) + ' mm'}`);
    if (r.temporalRelError !== null) console.log(`  son incertitude     : ${(r.temporalRelError*100).toFixed(2)} %  (± ${(r.temporalWidthMm*r.temporalRelError).toFixed(1)} mm)`);
    console.log('');
    for (const n of r.notes) console.log(`  · ${n}`);
  }

  if (errors.length > 0) { console.error(`\nErreurs page : ${errors.join(' | ')}`); process.exitCode = 1; }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  rmSync(SERVED, { recursive: true, force: true });
}
