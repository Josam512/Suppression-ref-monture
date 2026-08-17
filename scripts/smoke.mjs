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

  // L'accueil propose les deux versions : il faut en ouvrir une pour arriver
  // sur le flux vidéo. On teste la V1, celle du client à distance.
  const v1 = page.getByRole('button', { name: /Ouvrir V1/ });
  const v2 = page.getByRole('button', { name: /Ouvrir V2/ });
  check('les deux versions sont proposées à l’accueil', (await v1.count()) === 1 && (await v2.count()) === 1);
  await v1.click();
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

  const texteV1 = await page.locator('body').innerText();
  check('V1 annonce clairement sa version', texteV1.includes('V1 — Vente en ligne'));

  // ⭐ Arbitrage humain 2026-08-17 : la carte est OBLIGATOIRE au démarrage.
  // L'ancienne question sur les lunettes ouvrait la voie iris ; elle n'existe plus.
  check(
    'V1 : la carte est demandée d’emblée, sans passer par l’iris',
    /carte bancaire/i.test(texteV1) && !/Portez-vous des lunettes/i.test(texteV1),
  );
  check(
    'V1 : la consigne « retirez vos lunettes » est donnée AVANT la mesure',
    /Retirez vos lunettes/i.test(texteV1),
  );

  // La V2 doit s'ouvrir aussi, et annoncer sa dilatation de sprite.
  const store = await ctx.newPage();
  const storeErrors = [];
  store.on('pageerror', (e) => storeErrors.push(e.message));
  await store.goto(BASE, { waitUntil: 'load' });
  await store.getByRole('button', { name: /Ouvrir V2/ }).click();
  await store.waitForTimeout(9000);
  const storeText = await store.locator('body').innerText();
  check('V2 s’ouvre et annonce son mode', storeText.includes('V2 — Mode magasin'), storeErrors.join(' | '));
  check('V2 annonce la dilatation du sprite (§11.6)', /dilaté de 1\.5 mm/.test(storeText));

  check('aucune exception non rattrapée', pageErrors.length === 0, pageErrors.join(' | '));

  // ── V1 : la carte se montre UNE fois, et n'est plus jamais redemandee.
  const revenant = await ctx.newPage();
  await revenant.goto(BASE, { waitUntil: 'load' });
  await revenant.evaluate(() =>
    localStorage.setItem(
      'essayage.calibration.v1',
      JSON.stringify({ faceWidthMm: 138, source: 'card', relError: 0.025, measuredAt: 1 }),
    ),
  );
  await revenant.goto(BASE, { waitUntil: 'load' });
  await revenant.getByRole('button', { name: /Ouvrir V1/ }).click();
  await revenant.waitForTimeout(9000);
  const texteRevenant = await revenant.locator('body').innerText();
  check(
    'client deja calibre : la carte n’est PAS redemandee',
    !/Portez-vous des lunettes/.test(texteRevenant) && !/carte bancaire/.test(texteRevenant),
  );

  // L'atelier de recoloriage V2 doit se charger : c'est lui qui traitera la
  // vraie vidéo de magasin. Un module cassé ne doit pas se découvrir ce jour-là.
  const atelier = await ctx.newPage();
  const atelierErrors = [];
  atelier.on('pageerror', (e) => atelierErrors.push(e.message));
  await atelier.goto(`${BASE}/tests/recolor-video.html`, { waitUntil: 'load' });
  await atelier.waitForTimeout(1500);
  check(
    'l’atelier de recoloriage V2 se charge',
    (await atelier.evaluate(() => typeof window.__RECOLOR__ === 'function')) &&
      atelierErrors.length === 0,
    atelierErrors.join(' | '),
  );

  const prep = await ctx.newPage();
  const prepErrors = [];
  prep.on('pageerror', (e) => prepErrors.push(e.message));
  await prep.goto(`${BASE}/prep.html`, { waitUntil: 'load' });
  await prep.waitForTimeout(1500);
  check('l’outil de préparation se charge', prepErrors.length === 0, prepErrors.join(' | '));

  // ── Preuve métrologique du rendu : les pixels peints, remesurés en mm.
  const proofPage = await ctx.newPage();
  await proofPage.goto(`${BASE}/tests/render-proof.html`, { waitUntil: 'load' });
  await proofPage.waitForFunction(() => window.__PROOF__ || window.__PROOF_ERROR__, {
    timeout: 20000,
  });
  const proofError = await proofPage.evaluate(() => window.__PROOF_ERROR__ ?? null);
  if (proofError) {
    check('banc de mesure du rendu', false, proofError);
  } else {
    const cases = await proofPage.evaluate(() => window.__PROOF__);
    console.log('\n── Rendu réellement peint, remesuré ──');
    for (const c of cases) {
      check(
        `  ${c.nom}`,
        c.ok,
        `attendu ${c.attendu.toFixed(2)} ${c.unite}, mesuré ${c.mesure.toFixed(2)} ${c.unite}`,
      );
    }
  }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}

if (failures.length > 0) {
  console.error(`\n${failures.length} contrôle(s) en échec : ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nBanc navigateur : tout est vert.');
