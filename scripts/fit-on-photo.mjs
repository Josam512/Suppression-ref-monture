/**
 * scripts/fit-on-photo.mjs — compose des montures preparees sur une photo fixe.
 *
 * Outil d'atelier. Il ferme le dernier trou de verification du projet : jusqu'ici
 * la geometrie etait prouvee au pixel pres sur un rectangle de synthese, mais le
 * sprite n'avait JAMAIS ete composite sur de vrais landmarks d'un vrai visage.
 *
 * Le controle decisif est l'auto-superposition : on repose sur la photo la
 * monture que la personne porte REELLEMENT. Le sprite doit alors se confondre
 * avec elle. Si les deux ne coincident pas, c'est la chaine d'echelle qui est
 * fausse — et cela se voit immediatement, sans instrument.
 *
 * Usage :
 *   node scripts/fit-on-photo.mjs <photo> <faceWidthMm> <slug[,slug...]> [sortie]
 */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { chromium } from 'playwright';

const [photo, faceWidthMmArg, slugsArg, outDir = 'photo-fit'] = process.argv.slice(2);
if (!photo || !faceWidthMmArg || !slugsArg) {
  console.error('Usage : node scripts/fit-on-photo.mjs <photo> <faceWidthMm> <slug[,slug]> [sortie]');
  process.exit(1);
}

const faceWidthMm = Number(faceWidthMmArg);
const slugs = slugsArg.split(',');
const PORT = 5180;
const BASE = `http://localhost:${PORT}`;
const SERVED = 'public/_fit';

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
      /* pas encore pret */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Serveur injoignable sur ${BASE}`);
}

rmSync(SERVED, { recursive: true, force: true });
mkdirSync(SERVED, { recursive: true });
const servedName = `photo${extname(photo)}`;
cpSync(photo, join(SERVED, servedName));
mkdirSync(outDir, { recursive: true });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;

try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));

  await page.goto(`${BASE}/tests/photo-fit.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'ready', {
    timeout: 60000,
  });

  const stem = basename(photo, extname(photo));
  for (const slug of slugs) {
    const r = await page.evaluate(
      (a) => window.__fit(a),
      { photo: `${BASE}/_fit/${servedName}`, slug, faceWidthMm },
    );
    if (!r.ok) {
      console.log(`—  ${slug} : ${r.why}`);
      continue;
    }
    const file = join(outDir, `${stem}--${slug}.jpg`);
    writeFileSync(file, Buffer.from(r.image.split(',')[1], 'base64'));
    console.log(
      `✓  ${slug} : monture ${r.frameWidthMm.toFixed(1)} mm · ` +
        `${r.livePxPerMm.toFixed(3)} px/mm · yaw ${r.yawDeg.toFixed(1)}° · ` +
        `${r.status ?? 'legende gelee (pose hors tolerance)'}\n` +
        `     ${r.legende ?? ''}\n     → ${file}`,
    );
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  rmSync(SERVED, { recursive: true, force: true });
}
