/**
 * scripts/recolor-video.mjs — recolorie une VRAIE video de magasin (V2, 2,5 D).
 *
 * Le client porte une monture reelle, filmee. On ne pose rien sur elle : on
 * remplace sa MATIERE par celle d'un autre coloris, en gardant la lumiere, les
 * reflets, la perspective, l'occlusion et le flou de bouge — tout ce qui coute
 * cher a simuler et qui est deja dans l'image.
 *
 * Outil d'atelier (§0.0.2). Il n'existe pas dans l'application.
 *
 * Usage :
 *   node scripts/recolor-video.mjs <video> <slug-porte> <slug-voulu> <faceWidthMm> [sortie]
 *
 * Exemple :
 *   node scripts/recolor-video.mjs client.mp4 p8-m252 ecaille-claire 136 recolor-out
 *
 * `faceWidthMm` est la sortie de la calibration V2 en magasin (deux clics de
 * l'opticien sur les bords de la monture portee). On la passe ici parce qu'un
 * outil d'atelier n'a pas d'opticien devant lui — jamais parce qu'on la suppose.
 */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium } from 'playwright';

const [video, wornSlug, targetSlug, faceWidthArg, outDir = 'recolor-out'] = process.argv.slice(2);

if (!video || !wornSlug || !targetSlug || !faceWidthArg) {
  console.error(
    'Usage : node scripts/recolor-video.mjs <video> <slug-porte> <slug-voulu> <faceWidthMm> [sortie]',
  );
  process.exit(1);
}
if (!existsSync(video)) {
  console.error(`Video introuvable : ${video}`);
  process.exit(1);
}

const faceWidthMm = Number(faceWidthArg);
if (!Number.isFinite(faceWidthMm) || faceWidthMm <= 0) {
  console.error(`faceWidthMm invalide : ${faceWidthArg}`);
  process.exit(1);
}

const PORT = 5181;
const BASE = `http://localhost:${PORT}`;
const SERVED = 'public/_video';

function findChromium() {
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    const candidate = `${root}/${dir}/chrome-linux/chrome`;
    if (dir.startsWith('chromium-') && existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      /* pas encore pret */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Serveur de dev injoignable sur ${BASE}`);
}

// La video est servie par vite : un <video src="file://..."> ne passerait pas
// le contexte securise, exactement comme le bug #5 du contrat.
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

  // Seules les exceptions non rattrapees comptent. La console recueille aussi
  // les 404 de favicon et les lignes d'information de TensorFlow Lite, que
  // Chromium classe en « error » : les compter ferait echouer un outil sain.
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${BASE}/tests/recolor-video.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__RECOLOR__ === 'function', { timeout: 20000 });

  console.log(`Traitement de ${basename(video)} — porte : ${wornSlug} → voulu : ${targetSlug}`);

  const result = await page.evaluate(
    (o) => window.__RECOLOR__(o),
    {
      videoUrl: `/_video/${basename(video)}`,
      wornSlug,
      targetSlug,
      faceWidthMm,
      maxFrames: 0,
    },
  );

  console.log(`  duree annoncee    : ${result.durationS} s`);
  console.log(`  arret par         : ${result.stoppedBy}`);
  console.log(`  images traitees   : ${result.frames}`);
  console.log(`  visage detecte    : ${result.detected}`);
  console.log(`  images recoloriees: ${result.recolored}`);
  if (result.lastReason) console.log(`  dernier refus     : ${result.lastReason}`);

  for (const [i, s] of result.samples.entries()) {
    for (const phase of ['before', 'after']) {
      const file = join(outDir, `${String(i).padStart(2, '0')}-${phase}.png`);
      writeFileSync(file, Buffer.from(s[phase].split(',')[1], 'base64'));
      console.log(`  ${file}`);
    }
  }

  if (errors.length > 0) {
    console.error(`\nErreurs page : ${errors.join(' | ')}`);
    process.exitCode = 1;
  }
  if (result.recolored === 0) {
    console.error(
      '\nAucune image recoloriee. Verifiez que le slug porte est bien le modele de la video, ' +
        'et que faceWidthMm vient de la calibration V2 et non d’une estimation.',
    );
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  rmSync(SERVED, { recursive: true, force: true });
}
