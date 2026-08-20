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

  // ⚖️ Arbitrage 2026-08-20 : plus d'écran de choix — l'essayage démarre
  // directement, la V2 magasin ne se présente plus.
  check(
    "l'essayage démarre directement (plus d'écran V1/V2)",
    (await page.getByRole('button', { name: /Ouvrir V/ }).count()) === 0,
  );
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

  const texteAuto = await page.locator('body').innerText();
  check("l'en-tête porte le tampon de build (cache CDN traçable)", /b\d+ · 20\d\d-/.test(texteAuto));

  // ⭐ MISSION 2026-08-19 : le parcours normal est la mesure AUTOMATIQUE, sans
  // carte. Le client regarde l'écran, la machine dit ce qui lui manque
  // (WHY_NOT_DONE) et annonce elle-même sa fin.
  check(
    'V2 : la mesure automatique est le parcours d’entrée — aucune carte exigée',
    /Mesure automatique en cours/i.test(texteAuto),
  );
  check(
    'V2 : WHY_NOT_DONE est affiché — on sait toujours pourquoi ça tourne',
    /images utiles|je ne vous ai pas vu|face à la caméra/i.test(texteAuto),
  );
  check(
    'V2 : la consigne « retirez vos lunettes » est donnée AVANT la mesure',
    /Retirez vos lunettes/i.test(texteAuto),
  );

  // 🔴 RÈGLE CHANGÉE PAR ARBITRAGE HUMAIN (audit du 2026-08-21, point 1).
  // Ces deux contrôles exigeaient que la collecte se TERMINE en échec après le
  // délai. Cette règle est abrogée : « un timeout ne doit PLUS rendre
  // l'essayage définitivement mort ». Ils vérifient donc la règle qui la
  // remplace — la cause est dite, ET la caméra comme la collecte continuent.
  await page.waitForTimeout(21_000);
  const texteEchec = await page.locator('body').innerText();
  check(
    'V2 : sans visage, la cause est DITE et la mesure continue (jamais de cul-de-sac)',
    /face à la caméra/i.test(texteEchec) && /Mesure automatique en cours/i.test(texteEchec),
  );
  // ⚠️ Ce que ce banc NE peut pas montrer : la bannière « ça prend plus
  // longtemps que prévu » n'apparaît qu'une fois au moins une frame RETENUE,
  // et le flux injecté est une mire sans visage — il n'y en aura jamais. Ce
  // cas est couvert en calcul pur (tests/autogates.test.ts, audit 2). Ici on
  // vérifie ce qui est vérifiable : la sortie de secours reste offerte, et
  // aucun libellé de cul-de-sac n'apparaît.
  check(
    'V2 : la sortie carte reste offerte, et AUCUN cul-de-sac n’est affiché',
    (await page.getByRole('button', { name: /carte/i }).count()) >= 1 &&
      !/n’a pas abouti|n'a pas abouti/i.test(texteEchec),
  );

  // — Le mode diagnostic CARTE reste le parcours de vérité terrain (inchangé).
  await page.getByRole('button', { name: /carte/i }).first().click();
  await page.waitForTimeout(300);
  const texteV1 = await page.locator('body').innerText();
  check(
    'V1 : la carte reste disponible en mode diagnostic',
    /carte/i.test(texteV1) && !/Portez-vous des lunettes/i.test(texteV1),
  );

  // ⭐ La carte peut etre tenue ou le client veut — le detecteur cherche du
  // front aux joues. La SEULE contrainte qui subsiste : ne pas masquer les
  // yeux, sinon MediaPipe invente les reperes sur lesquels la mesure est prise.
  check(
    'V1 : le placement est libre, sauf devant les yeux',
    /sans cacher vos yeux/i.test(texteV1) && /comme vous voulez/i.test(texteV1),
  );

  // 🔴 ARBITRAGE DU 2026-08-18 : c'est le CLIENT qui declenche, et lui seul.
  // Le cadre a remplir et son verrouillage automatique ont ete supprimes — la
  // machine ne decide plus ni quand la mesure est prise, ni quand elle est
  // finie. Ces trois controles verrouillent ce renversement.
  const pret = page.getByRole('button', { name: /Je filme/i });
  check('V1 : c’est le client qui declenche la seance', (await pret.count()) === 1);
  check(
    'V1 : aucune jauge de cadrage ne court derriere lui',
    !/Cadrage\s*:/i.test(texteV1) && !/dans le cadre/i.test(texteV1),
  );

  // 🔴 AUCUN POINTAGE. Le client a tranche : « je te fous une photo de moi et
  // c'est a moi de te dire ou est la carte ? ». La carte est desormais trouvee
  // par core/cardFinder.ts. Ce controle interdit que l'ecran de pointage
  // revienne par une porte derobee.
  const boutons = await page.locator('button').allInnerTexts();
  check(
    'V1 : aucun pointage demande au client',
    !boutons.some((b) => /rep[eè]re|pointer|placer/i.test(b)) && !/deux rep/i.test(texteV1),
  );

  await pret.click();
  await page.waitForTimeout(2500);
  const seance = await page.locator('body').innerText();
  check(
    'V1 : « Je filme » ouvre la seance, carte gardee en main',
    /de profil/i.test(seance) && /Gardez votre carte en main/i.test(seance),
  );
  check(
    'V1 : le SEUL moyen de terminer est son bouton — aucune jauge ne declenche',
    (await page.getByRole('button', { name: /J’ai fini|J'ai fini/ }).count()) === 1 &&
      !/%/.test(seance),
  );

  // Le flux injecte par Chromium est une mire, pas un visage : la carte ne peut
  // donc pas etre vue. Ce que le banc verifie ici, c'est que l'echec est DIT.
  await page.getByRole('button', { name: /J’ai fini|J'ai fini/ }).click();
  await page.waitForTimeout(3000);
  const apres = await page.locator('body').innerText();
  check(
    'V1 : carte jamais vue → l’echec est dit en clair, pas avale (§1 bug #3)',
    /pas r[eé]ussi [aà] voir votre carte/i.test(apres),
  );

  /*
   * ⚠️ LIMITE ASSUMEE DU BANC, a ne pas laisser croire couverte.
   *
   * Le detecteur ne peut pas etre exerce ici : `--use-fake-device` ne fournit
   * pas de visage, donc pas de carte non plus. Il est mesure separement, sur la
   * VRAIE sequence du sujet, par `node scripts/card-find.mjs` — 179 images sur
   * 179, 0,35 % d'ecart-type sur la mediane — et en calcul pur par
   * `tests/cardfinder.test.ts`, qui verifie qu'une lisiere plus contrastee que
   * la carte ne detourne pas la mesure.
   */

  // ⚖️ Arbitrage 2026-08-20 : la V2 magasin ne se présente plus à l'écran.
  // Son code reste dans le dépôt (couvert par les tests unitaires), mais
  // aucune page ne l'affiche : rien à vérifier ici.

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
  await revenant.waitForTimeout(9000);
  const texteRevenant = await revenant.locator('body').innerText();
  check(
    'client deja calibre : la carte n’est PAS redemandee',
    !/Portez-vous des lunettes/.test(texteRevenant) &&
      !/Ma carte est en place/.test(texteRevenant),
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
