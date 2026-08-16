/**
 * scripts/probe-photos.mjs — fait tourner MediaPipe sur des PHOTOS FIXES.
 *
 * Outil d'atelier, pas d'application (§0.0.2). Il sert au lot 8 : mesurer, sur
 * de vrais visages portant une monture de cotes connues, l'écart entre les
 * landmarks 234/454 et la réalité — c'est-à-dire calibrer
 * FACE_WIDTH_CORRECTION_MM au lieu de la deviner.
 *
 * Usage : node scripts/probe-photos.mjs <dossier-de-photos> [dossier-sortie]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { chromium } from 'playwright';

const SRC = process.argv[2];
const OUT = process.argv[3] ?? 'photo-probe';
const PORT = 5179;
const BASE = `http://localhost:${PORT}`;
const SERVED = 'public/_probe';

if (!SRC || !existsSync(SRC)) {
  console.error('Usage : node scripts/probe-photos.mjs <dossier-de-photos> [dossier-sortie]');
  process.exit(1);
}

function findChromium() {
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    const c = `${root}/${dir}/chrome-linux/chrome`;
    if (dir.startsWith('chromium-') && existsSync(c)) return c;
  }
  return undefined;
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Serveur injoignable sur ${BASE}`);
}

// Vite ne sert que la racine du projet : on y recopie les photos, le temps du run.
rmSync(SERVED, { recursive: true, force: true });
mkdirSync(SERVED, { recursive: true });
const photos = readdirSync(SRC).filter((f) => /\.(jpe?g|png)$/i.test(f));
photos.forEach((f, i) => cpSync(join(SRC, f), join(SERVED, `p${i}${extname(f)}`)));

mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;
const rows = [];

try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));

  await page.goto(`${BASE}/tests/landmark-probe.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'ready', {
    timeout: 60000,
  });

  for (let i = 0; i < photos.length; i++) {
    const url = `${BASE}/_probe/p${i}${extname(photos[i])}`;
    const r = await page.evaluate((u) => window.__probe(u), url);

    if (!r.found) {
      console.log(`—  ${photos[i]} : aucun visage détecté`);
      rows.push({ photo: photos[i], found: false });
      continue;
    }

    const name = basename(photos[i], extname(photos[i])).replace(/[^\w.-]+/g, '_');
    writeFileSync(join(OUT, `${name}.annot.jpg`), Buffer.from(r.annotated.split(',')[1], 'base64'));

    const { annotated: _drop, ...data } = r;
    rows.push({ photo: photos[i], ...data });

    console.log(
      `✓  ${photos[i]}\n` +
        `     image ${r.imageW}×${r.imageH}` +
        ` · visage 234↔454 : ${r.faceWidthPx.toFixed(1)} px` +
        ` · iris : ${r.irisWidthPx.toFixed(2)} px` +
        ` · yaw : ${r.yawDeg === null ? '—' : r.yawDeg.toFixed(1) + '°'}`,
    );
  }

  writeFileSync(join(OUT, 'mesures.json'), JSON.stringify(rows, null, 2));
  console.log(`\n${rows.filter((r) => r.found).length}/${photos.length} visages détectés → ${OUT}/`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  rmSync(SERVED, { recursive: true, force: true });
}
