/**
 * scripts/smoke-single.mjs — le banc de la PAGE AUTONOME (guide 62, c40).
 *
 * « Si le Samsung ouvre essayage.html, la CI doit générer et ouvrir CE même
 * artefact. » Le build Vite et l'HTML autonome sont deux artefacts différents ;
 * les deux doivent être verts. Ce banc sert l'artefact EXACT produit par
 * `npm run single` et vérifie qu'il démarre, ouvre la caméra, peint, et porte
 * son identité de build (c38).
 */

import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 5186;
const BASE = `http://localhost:${PORT}`;
const ARTIFACT = 'essayage.html';

function findChromium() {
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    const c = `${root}/${dir}/chrome-linux/chrome`;
    if (dir.startsWith('chromium-') && existsSync(c)) return c;
  }
  return undefined;
}

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// 1. Construire l'artefact EXACT (vite single + empaquetage), s'il manque.
if (!existsSync(ARTIFACT) || process.argv.includes('--rebuild')) {
  execSync('npm run single', { stdio: 'inherit' });
}
const html = readFileSync(ARTIFACT);
check(`l'artefact ${ARTIFACT} existe (${(html.length / 1024 / 1024).toFixed(1)} Mo)`, html.length > 1_000_000);

// 2. Le servir TEL QUEL — un fichier, un lien, comme sur le téléphone.
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise((r) => server.listen(PORT, r));

let browser;
try {
  browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ permissions: ['camera'] });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(BASE, { waitUntil: 'load' });

  // Le boot (décompression des assets embarqués) doit se terminer.
  const booted = await page
    .waitForFunction(() => document.getElementById('boot') === null, { timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  check('le boot autonome se termine (décompression + démarrage)', booted);

  await page.waitForTimeout(9000);
  const video = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { w: v.videoWidth, playing: !v.paused } : null;
  });
  check('la caméra s’ouvre dans l’artefact autonome', video?.playing === true, `${video?.w}px`);

  const painted = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return d.some((v) => v !== 0);
  });
  check('la boucle peint (même sans visage : l’alarme, §1 bug #3)', painted);

  const texte = await page.locator('body').innerText();
  check('l’identité de build est affichée (c38)', /b\d+ · 20\d\d-/.test(texte));
  check('la mesure automatique démarre dans l’artefact', /Mesure automatique en cours/i.test(texte));
  check(
    'la santé est observable (compteurs pour les bancs)',
    await page.evaluate(() => typeof globalThis.__VTO_HEALTH__ === 'object'),
  );
  check('aucune exception non rattrapée', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));
} finally {
  await browser?.close();
  server.close();
}

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} contrôle(s) rouge(s) sur l'artefact autonome.`);
  process.exit(1);
}
console.log('\nArtefact autonome : tout est vert.');
