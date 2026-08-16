/**
 * scripts/smoke.mjs — banc de test navigateur SANS caméra (CLAUDE.md §8.3).
 *
 * Chromium accepte `--use-fake-device-for-media-stream`, ce qui rend testables
 * en intégration continue les trois choses que Vitest ne voit pas :
 *   1. la webcam s'ouvre et le canvas est dimensionné ;
 *   2. le modèle vendorisé se charge réellement (aucun CDN) ;
 *   3. la boucle DESSINE quelque chose même quand aucun visage n'est détecté.
 *
 * Le point 3 est celui qui compte. C'est lui qui a rattrapé la régression la
 * plus insidieuse de ce projet : `onLost` incrémentait un compteur sans jamais
 * l'afficher, donc une détection perdue était strictement indiscernable d'un
 * fonctionnement normal — le mode d'échec exact du §1 bug #3.
 *
 * ⚠️ Ce banc n'existe qu'en CI. Il ne fait pas partie de l'application et n'est
 * jamais montré à un client (§0.0.2).
 *
 * Un vrai fichier .y4m contenant un visage permettrait d'aller plus loin
 * (rendu du sprite, occlusion de la branche). Il reste à fournir par l'humain.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 5178;
const BASE = `http://localhost:${PORT}`;

/** Le conteneur fournit Chromium ; on ne retélécharge jamais de navigateur. */
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
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Serveur de dev injoignable sur ${BASE}`);
}

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: false,
});

let browser;
try {
  await waitForServer();

  browser = await chromium.launch({
    executablePath: findChromium(),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--no-sandbox',
    ],
  });

  const ctx = await browser.newContext({ permissions: ['camera'] });
  const page = await ctx.newPage();

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(12000);

  const video = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { w: v.videoWidth, h: v.videoHeight, playing: !v.paused } : null;
  });
  check('la webcam s’ouvre et joue', video?.playing === true, `${video?.w}×${video?.h}`);

  const canvas = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? { w: c.width, h: c.height } : null;
  });
  check(
    'le canvas est dimensionné sur la vidéo',
    canvas?.w === video?.w && canvas?.h === video?.h,
    `${canvas?.w}×${canvas?.h}`,
  );

  const modelOk = await page.evaluate(async () => {
    const res = await fetch('/models/face_landmarker.task');
    return res.ok && Number(res.headers.get('content-length')) > 1_000_000;
  });
  check('le modèle est vendorisé et servi localement (§1 bug #4)', modelOk);

  // 🔴 LE test : aucun visage sur la mire de synthèse, donc détection perdue.
  // La boucle DOIT quand même peindre le compteur d'échecs.
  const painted = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return d.some((v) => v !== 0);
  });
  check('détection perdue → la boucle affiche quand même l’échec (§1 bug #3)', painted);

  check('aucune exception non rattrapée', pageErrors.length === 0, pageErrors.join(' | '));

  const prep = await ctx.newPage();
  const prepErrors = [];
  prep.on('pageerror', (e) => prepErrors.push(e.message));
  await prep.goto(`${BASE}/prep.html`, { waitUntil: 'load' });
  await prep.waitForTimeout(1500);
  check('l’outil de préparation se charge', prepErrors.length === 0, prepErrors.join(' | '));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}

if (failures.length > 0) {
  console.error(`\n${failures.length} contrôle(s) en échec : ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nBanc navigateur : tout est vert.');
