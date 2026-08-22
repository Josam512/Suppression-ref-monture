/**
 * scripts/faults.mjs — la MATRICE DE PANNES (guide 74, 76–77, c42).
 *
 * La CI ne teste plus seulement le chemin heureux : chaque scénario INJECTE
 * une panne réelle (réseau, stockage, rendu, scheduler) et vérifie la règle
 * absolue — la session RÉCUPÈRE ou DIT précisément pourquoi, jamais morte en
 * silence. Les assertions lisent `__VTO_HEALTH__` (compteurs passifs) : une
 * panne de C ou D n'empêche jamais A ou B (ARCHITECTURE.md).
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 5188;
const BASE = `http://localhost:${PORT}`;

function findChromium() {
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    const c = `${root}/${dir}/chrome-linux/chrome`;
    if (dir.startsWith('chromium-') && existsSync(c)) return c;
  }
  return undefined;
}
async function waitForServer(t = 30000) {
  const d = Date.now() + t;
  while (Date.now() < d) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Serveur injoignable sur ${BASE}`);
}
const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
};
const health = (page) => page.evaluate(() => globalThis.__VTO_HEALTH__ ?? null);

/** Flux NOIR : le même en-tête y4m que make-face, plans Y=0 (frame invalide). */
function makeBlackY4m(path) {
  const W = 480, H = 640, frames = 4;
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420\n`);
  const plane = Buffer.alloc(W * H, 0);
  const chroma = Buffer.alloc((W * H) / 4, 128);
  const parts = [header];
  for (let i = 0; i < frames; i++) parts.push(Buffer.from('FRAME\n'), plane, chroma, chroma);
  writeFileSync(path, Buffer.concat(parts));
}

if (!existsSync('tests/fixtures/face.y4m')) execSync('node scripts/make-face-y4m.mjs', { stdio: 'inherit' });
execSync('node scripts/sync-wasm.mjs', { stdio: 'inherit' });
makeBlackY4m('tests/fixtures/black.y4m');

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });

const LAUNCH = (video) => ({
  executablePath: findChromium(),
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    ...(video ? [`--use-file-for-fake-video-capture=${video}`] : []),
    '--no-sandbox',
  ],
});

async function scenario(browser, name, { init, routes, run, url }) {
  const ctx = await browser.newContext({ permissions: ['camera'] });
  const pageErrors = [];
  try {
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    if (routes) await routes(page);
    await page.goto(url ?? `${BASE}/?resetSession=1`, { waitUntil: 'load' });
    await run(page, name, pageErrors);
  } catch (err) {
    check(`${name} : scénario exécuté`, false, err instanceof Error ? err.message.slice(0, 160) : String(err));
  } finally {
    await ctx.close();
  }
}

const CALIBRATED = (timeout = 60_000) => (page) =>
  page.waitForFunction(() => globalThis.__VTO_HEALTH__?.calibrated === true, { timeout }).then(() => true).catch(() => false);

let browser;
try {
  await waitForServer();

  // ───────────────────────── Visage réel ─────────────────────────
  browser = await chromium.launch(LAUNCH('tests/fixtures/face.y4m'));

  await scenario(browser, 'S1 localStorage KO', {
    init: () => {
      // c42/point 60 : tout accès au stockage LÈVE.
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('stockage interdit (test)');
        },
      });
    },
    run: async (page, name, pageErrors) => {
      check(`${name} : la calibration ABOUTIT sans stockage`, await CALIBRATED()(page));
      const h = await health(page);
      check(`${name} : la monture est rendue`, (h?.renderedFrames ?? 0) > 0);
      check(`${name} : aucune exception non rattrapée`, pageErrors.length === 0, pageErrors[0] ?? '');
    },
  });

  await scenario(browser, 'S2 sprite FRONT 404', {
    routes: (page) => page.route('**/frames/**/front.png', (r) => r.abort()),
    run: async (page, name) => {
      // Le rendu est privé de son image — la MÉTROLOGIE, jamais (points 26/72).
      check(`${name} : le PD se mesure quand même (métrologie ≠ rendu)`, await CALIBRATED()(page));
      const txt = await page.locator('body').innerText();
      check(`${name} : l'échec du sprite est DIT`, /introuvable|sans réponse/i.test(txt));
      const h = await health(page);
      check(`${name} : aucun invariant violé`, h?.invariants?.violations === 0);
    },
  });

  await scenario(browser, 'S3 sprite PROFIL 404', {
    routes: (page) => page.route('**/frames/**/profile.png', (r) => r.abort()),
    run: async (page, name) => {
      check(`${name} : calibration conclue`, await CALIBRATED()(page));
      const h = await health(page);
      check(`${name} : le FRONTAL est rendu sans le profil (point 4)`, (h?.renderedFrames ?? 0) > 0);
      const txt = await page.locator('body').innerText();
      check(`${name} : la face reste, l'absence de branches est dite`, /profil indisponible/i.test(txt));
    },
  });

  await scenario(browser, 'S4 spec.json corrompu (monture par défaut)', {
    routes: (page) =>
      page.route('**/frames/ecaille-claire/spec.json', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '{"slug":"ecaille-claire"}' }),
      ),
    run: async (page, name) => {
      check(`${name} : une fiche mauvaise ≠ application morte (point 5/55)`, await CALIBRATED()(page));
      const txt = await page.locator('body').innerText();
      check(`${name} : la fiche écartée est NOMMÉE`, /écartée/i.test(txt));
      const h = await health(page);
      check(`${name} : les autres montures se rendent`, (h?.renderedFrames ?? 0) > 0);
    },
  });

  await scenario(browser, 'S5 tempête d’exceptions de RENDU', {
    init: () => {
      // drawImage lève pendant 25 appels, à partir du 40e — puis guérit.
      const proto = CanvasRenderingContext2D.prototype;
      const original = proto.drawImage;
      let calls = 0;
      proto.drawImage = function (...args) {
        calls++;
        if (calls > 40 && calls <= 65) throw new Error('drawImage saboté (test)');
        return original.apply(this, args);
      };
    },
    run: async (page, name, pageErrors) => {
      check(`${name} : la calibration survit au sabotage du rendu`, await CALIBRATED()(page));
      const h1 = await health(page);
      await page.waitForTimeout(2500);
      const h2 = await health(page);
      check(
        `${name} : le rendu REPREND après la tempête (${h1?.renderedFrames} → ${h2?.renderedFrames})`,
        (h2?.renderedFrames ?? 0) > (h1?.renderedFrames ?? 0),
      );
      check(`${name} : le flux caméra n'est jamais mort (point 13)`, (h2?.cameraFrames ?? 0) > 60);
      check(`${name} : aucune exception non rattrapée`, pageErrors.length === 0, pageErrors[0] ?? '');
    },
  });

  await scenario(browser, 'S6 rVFC s’arrête de livrer', {
    init: () => {
      // Le navigateur livre 5 frames par rVFC puis se tait (point 14).
      const original = HTMLVideoElement.prototype.requestVideoFrameCallback;
      if (!original) return;
      let delivered = 0;
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (cb) {
        delivered++;
        if (delivered > 5) return 0; // plus jamais de callback
        return original.call(this, cb);
      };
    },
    run: async (page, name) => {
      check(`${name} : le watchdog bascule sur RAF et la session conclut`, await CALIBRATED()(page));
      const h = await health(page);
      check(`${name} : la bascule est comptée (stalls ≥ 1)`, (h?.feedStalls ?? 0) >= 1);
      check(`${name} : les frames continuent d'affluer`, (h?.cameraFrames ?? 0) > 30);
    },
  });

  await scenario(browser, 'S7 calibration d’une ANCIENNE version d’algorithme', {
    // ⚠️ PAS de ?resetSession ici : il purgerait la graine plantée (contexte
    // neuf = stockage vierge, la purge n'apporte rien et fausse le scénario).
    url: `${BASE}/`,
    init: () => {
      try {
        localStorage.setItem(
          'essayage.calibration.v1',
          JSON.stringify({
            v: 2, // version précédente : la métrologie doit être invalidée (58/c44)
            cal: { faceWidthMm: 140, source: 'auto', relError: 0.05, measuredAt: 1, pdMm: 63, pdRelError: 0.04 },
          }),
        );
      } catch {}
    },
    run: async (page, name) => {
      // La calibration vient du STOCKAGE migré : essayage immédiat, sans
      // repasser par « Calibration acquise » — c'est ça, la migration.
      const rendered = await page
        .waitForFunction(
          () => globalThis.__VTO_HEALTH__?.calibrated === true && (globalThis.__VTO_HEALTH__?.renderedFrames ?? 0) > 0,
          { timeout: 45_000 },
        )
        .then(() => true)
        .catch(() => false);
      check(`${name} : l'essayage démarre sur la largeur migrée`, rendered);
      // …et le PD, invalidé par le changement d'algorithme, se REMESURE en fond.
      const pdBack = await page
        .waitForFunction(() => globalThis.__VTO_HEALTH__?.pdReady === true, { timeout: 60_000 })
        .then(() => true)
        .catch(() => false);
      check(`${name} : le PD manquant est recollecté en arrière-plan (point 28)`, pdBack);
    },
  });

  await scenario(browser, 'S10 profil de focale d’un AUTRE appareil', {
    url: `${BASE}/`, // pas de resetSession : il purgerait la graine plantée
    init: () => {
      try {
        localStorage.setItem(
          'essayage.camera.v1',
          JSON.stringify({
            focalPerWidth: 0.9,
            relError: 0.05,
            views: 60,
            measuredAt: Date.now(),
            deviceId: 'appareil-fantome-du-passe',
            facingMode: 'environment', // caméra ARRIÈRE : incompatible (c23)
          }),
        );
      } catch {}
    },
    run: async (page, name) => {
      // L'avis d'éviction est affiché AU MOMENT de l'ouverture caméra, puis le
      // résumé de calibration prend l'écran (et redit la provenance) : on le
      // saisit dans sa fenêtre.
      const evicted = await page
        .waitForFunction(() => /autre caméra/i.test(document.body.innerText), { timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      check(`${name} : l'éviction du profil étranger est DITE (c23-c24)`, evicted);
      check(`${name} : la session conclut sans contamination`, await CALIBRATED()(page));
      // La distance repart du champ SUPPOSÉ — jamais de la focale étrangère.
      const txt = await page.locator('body').innerText();
      check(`${name} : la distance revient au champ supposé`, /champ de caméra supposé/i.test(txt));
    },
  });

  // ⭐ Ré-audit AN — S11 : getUserMedia ne répond JAMAIS. Le budget caméra est
  // GLOBAL (A4) : vrai échec nommé à l'échéance, jamais une attente infinie.
  await scenario(browser, 'S11 getUserMedia pendu', {
    init: () => {
      navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
    },
    run: async (page, name) => {
      const said = await page
        .waitForFunction(() => /getUserMedia|n’a pas répondu|n'a pas répondu/i.test(document.body.innerText), {
          timeout: 30_000,
        })
        .then(() => true)
        .catch(() => false);
      check(`${name} : l'échec est NOMMÉ à l'échéance (pas d'attente infinie)`, said);
      const retry = await page.getByRole('button', { name: /Réessayer/i }).count();
      check(`${name} : la sortie « Réessayer » est offerte (pas de cul-de-sac)`, retry >= 1);
    },
  });

  // AN — S12 : play() pendu — même budget, même échéance, étape nommée.
  await scenario(browser, 'S12 video.play() pendu', {
    init: () => {
      HTMLMediaElement.prototype.play = function play() {
        return new Promise(() => {});
      };
    },
    run: async (page, name) => {
      const said = await page
        .waitForFunction(() => /play|n’a pas répondu|n'a pas répondu/i.test(document.body.innerText), {
          timeout: 30_000,
        })
        .then(() => true)
        .catch(() => false);
      check(`${name} : l'échec est NOMMÉ à l'échéance`, said);
    },
  });

  // AN — S13 : création GPU forcée à l'ÉCHEC (WebGL absent). L'échelle prend
  // le relais (délégué CPU), la dégradation est DITE, une seule Task vit.
  await scenario(browser, 'S13 GPU indisponible (WebGL coupé)', {
    init: () => {
      const noGl = (original) =>
        function getContext(type, ...rest) {
          if (typeof type === 'string' && type.startsWith('webgl')) return null;
          return original.call(this, type, ...rest);
        };
      HTMLCanvasElement.prototype.getContext = noGl(HTMLCanvasElement.prototype.getContext);
      if (typeof OffscreenCanvas !== 'undefined') {
        OffscreenCanvas.prototype.getContext = noGl(OffscreenCanvas.prototype.getContext);
      }
    },
    run: async (page, name) => {
      check(`${name} : la session CONCLUT sur le délégué CPU (échelle vivante)`, await CALIBRATED(90_000)(page));
      const h = await health(page);
      check(`${name} : jamais plus d'une Task MediaPipe vivante`, (h?.aliveTasks ?? 99) <= 1, `alive=${h?.aliveTasks}`);
      check(`${name} : aucun invariant violé`, h?.invariants?.violations === 0);
    },
  });

  // AN/H — S14 : une réponse de sprite TARDIVE (modèle B lent) ne remplace
  // JAMAIS la monture re-sélectionnée (A). Garde specId, prouvée au banc.
  await scenario(browser, 'S14 sprite tardif d’une autre monture', {
    routes: (page) =>
      page.route('**/frames/**/front.png', async (route) => {
        // Seule la monture NON-défaut est ralentie de 8 s.
        if (!route.request().url().includes('ecaille-claire')) {
          await new Promise((r) => setTimeout(r, 8000));
        }
        await route.continue();
      }),
    run: async (page, name) => {
      check(`${name} : calibration conclue`, await CALIBRATED()(page));
      const buttons = page.locator('button:has-text("·")');
      if ((await buttons.count()) < 2) {
        check(`${name} : deux montures nécessaires`, false, 'catalogue trop petit');
        return;
      }
      const slugOf = async (i) => ((await buttons.nth(i).innerText()).split('·')[0] ?? '').trim();
      const slugA = await slugOf(0);
      await buttons.nth(1).click(); // B, dont le front mettra 8 s
      await page.waitForTimeout(300);
      await buttons.nth(0).click(); // retour immédiat sur A
      await page.waitForTimeout(2000);
      const during = await health(page);
      check(`${name} : A est rendue pendant que B traîne`, during?.frontSlug === slugA, `front=${during?.frontSlug}`);
      await page.waitForTimeout(8000); // la réponse TARDIVE de B arrive ici
      const after = await health(page);
      check(`${name} : la réponse tardive de B n'a PAS remplacé A`, after?.frontSlug === slugA, `front=${after?.frontSlug}`);
    },
  });

  // AN/A17b — S15 : la calibration du client A ne contamine JAMAIS le client B.
  await scenario(browser, 'S15 client A → client B', {
    url: `${BASE}/`, // pas de resetSession : il purgerait les graines
    init: () => {
      try {
        localStorage.setItem('essayage.person.v1', 'client-B');
        localStorage.setItem(
          'essayage.calibration.v1',
          JSON.stringify({
            v: 3, // version courante : seul le personId doit refuser
            personId: 'client-A',
            cal: { faceWidthMm: 145, source: 'auto', relError: 0.05, measuredAt: 1, pdMm: 62, pdRelError: 0.04 },
          }),
        );
      } catch {}
    },
    run: async (page, name) => {
      // Au boot, RIEN du client A : pas de calibration héritée.
      const freshStart = await page
        .waitForFunction(() => globalThis.__VTO_HEALTH__ !== undefined && globalThis.__VTO_HEALTH__.calibrated === false, {
          timeout: 20_000,
        })
        .then(() => true)
        .catch(() => false);
      check(`${name} : AUCUNE calibration du client A au démarrage`, freshStart);
      // …et le client B est MESURÉ, pas hérité : l'annonce de fin le prouve.
      await page.getByText(/Calibration acquise/i).first().waitFor({ timeout: 60_000 });
      check(`${name} : le client B est mesuré à neuf`, await CALIBRATED()(page));
    },
  });

  // AN/A17c — S16 : profil caméra d'une AUTRE version de schéma → refus propre.
  await scenario(browser, 'S16 profil caméra de version incompatible', {
    url: `${BASE}/`, // pas de resetSession : il purgerait la graine
    init: () => {
      try {
        localStorage.setItem(
          'essayage.camera.v1',
          JSON.stringify({ v: 1, profile: { focalPerWidth: 0.9, relError: 0.05, views: 60, measuredAt: 1 } }),
        );
      } catch {}
    },
    run: async (page, name) => {
      check(`${name} : la session conclut sans le profil illisible`, await CALIBRATED()(page));
      const txt = await page.locator('main').innerText();
      check(`${name} : la distance repart du champ SUPPOSÉ`, /champ de caméra supposé/i.test(txt));
      check(`${name} : aucune trace de la focale refusée`, !/séance carte précédente/i.test(txt));
    },
  });

  await browser.close();

  // ───────────────────────── Flux NOIR ─────────────────────────
  browser = await chromium.launch(LAUNCH('tests/fixtures/black.y4m'));
  await scenario(browser, 'S8 frames noires', {
    run: async (page, name, pageErrors) => {
      await page.waitForTimeout(9000);
      const h = await health(page);
      check(`${name} : l'entrée invalide est consommée sans mort (frames comptées)`, (h?.cameraFrames ?? 0) > 30);
      check(`${name} : aucun landmark n'est inventé sur du noir`, (h?.landmarkFrames ?? 0) === 0);
      const painted = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        if (!c) return false;
        return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v) => v !== 0);
      });
      check(`${name} : le chemin d'échec DESSINE (§1 bug #3)`, painted);
      check(`${name} : aucune exception non rattrapée`, pageErrors.length === 0, pageErrors[0] ?? '');
    },
  });
  await browser.close();

  // ───────────────────────── Mire (échelle de stratégies) ─────────────────────────
  browser = await chromium.launch(LAUNCH(null));
  {
    const ctx = await browser.newContext({ permissions: ['camera'] });
    const page = await ctx.newPage();
    const transitions = [];
    page.on('console', (m) => {
      if (/Détection —/.test(m.text())) transitions.push(m.text());
    });
    await page.goto(`${BASE}/?resetSession=1`, { waitUntil: 'load' });
    await page.waitForTimeout(14_000);
    check(
      'S9 : l’échelle de stratégies MONTE par élimination temporelle (pas de blocage GPU)',
      transitions.length >= 1,
      transitions[0]?.slice(0, 90) ?? 'aucune transition',
    );
    const h = await health(page);
    check('S9 : la session reste vivante en haut de l’échelle', (h?.cameraFrames ?? 0) > 40);
    await ctx.close();
  }
} catch (err) {
  check('matrice de pannes', false, err instanceof Error ? err.message : String(err));
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} contrôle(s) rouge(s).`);
  process.exit(1);
}
console.log('\nMatrice de pannes : tout est vert.');
