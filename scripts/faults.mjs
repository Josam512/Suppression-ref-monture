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
import { MOVING_AMPL_PX, movingCenterX } from './movingLaw.mjs';

/** Filtre de développement : FAULTS_ONLY=S20 n'exécute que les scénarios dont
 *  le nom contient la sous-chaîne. La CI ne le pose JAMAIS (matrice entière). */
const ONLY = process.env.FAULTS_ONLY ?? null;

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

if (
  !existsSync('tests/fixtures/face.y4m') ||
  !existsSync('tests/fixtures/face-shades.y4m') ||
  !existsSync('tests/fixtures/face-moving.y4m')
) {
  execSync('node scripts/make-face-y4m.mjs', { stdio: 'inherit' });
}
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
  if (ONLY !== null && !name.includes(ONLY)) return; // filtre de dev, jamais en CI
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
      // p58 est la monture par défaut du catalogue depuis le 2026-08-31.
      page.route('**/frames/p58/spec.json', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: '{"slug":"p58"}' }),
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

  // AN — S13 : WebGL TOTALEMENT absent (pilote cassé, navigateur exotique).
  // Constat mesuré (sonde 2026-08-22) : MediaPipe ne lève PAS à la création —
  // l'instance se crée puis `detectForVideo` lève à CHAQUE frame, sur les
  // DEUX délégués (le CPU utilise aussi WebGL pour l'entrée image). Le
  // repli « création GPU KO → CPU prend le relais », lui, est prouvé par
  // lifecycle.test.ts (fabrique injectable). Ce scénario prouve donc LE
  // contrat de survie sous TEMPÊTE d'erreurs d'inférence : session vivante,
  // une seule Task malgré les recréations, tempête DITE, sorties offertes.
  await scenario(browser, 'S13 WebGL absent (tempête d’erreurs d’inférence)', {
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
    run: async (page, name, pageErrors) => {
      // La tempête doit avoir traversé la recréation ET l'échelle sans tuer la
      // session : on laisse le temps aux swaps (10 erreurs → recréer → 10 →
      // marche suivante), puis on lit l'état.
      await page.waitForTimeout(25_000);
      const h1 = await health(page);
      await page.waitForTimeout(3_000);
      const h2 = await health(page);
      check(`${name} : la caméra reste VIVANTE sous la tempête`, (h2?.cameraFrames ?? 0) > (h1?.cameraFrames ?? 0));
      check(`${name} : les erreurs d'inférence sont COMPTÉES, jamais fatales`, (h2?.inferenceErrors ?? 0) > 50);
      check(`${name} : jamais plus d'une Task malgré les recréations`, (h2?.aliveTasks ?? 99) <= 1, `alive=${h2?.aliveTasks}`);
      check(`${name} : aucun invariant violé`, h2?.invariants?.violations === 0);
      const txt = await page.locator('main').innerText();
      check(`${name} : l'impasse est DITE et une sortie est offerte (carte)`, /carte/i.test(txt));
      check(`${name} : aucune exception non rattrapée`, pageErrors.length === 0, pageErrors[0] ?? '');
    },
  });

  // AN/H — S14 : une réponse de sprite TARDIVE (modèle B lent) ne remplace
  // JAMAIS la monture re-sélectionnée (A). Garde specId, prouvée au banc.
  await scenario(browser, 'S14 sprite tardif d’une autre monture', {
    routes: (page) =>
      page.route('**/frames/**/front.png', async (route) => {
        // Seule la monture NON-défaut est ralentie de 8 s (défaut : p58).
        if (!route.request().url().includes('p58')) {
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

  // 🔴 Négociation (2026-08-22) — S17 : une stratégie MÉMORISÉE pour l'appareil
  // est essayée EN PREMIER, prouvée à nouveau (≥ 478 landmarks), et conservée.
  await scenario(browser, 'S17 stratégie négociée mémorisée', {
    url: `${BASE}/`, // pas de resetSession : il purgerait la graine
    init: () => {
      try {
        localStorage.setItem('essayage.detection.v1', JSON.stringify({ v: 1, strategyId: 'cpu' }));
      } catch {}
    },
    run: async (page, name) => {
      check(`${name} : la session conclut sur la stratégie mémorisée`, await CALIBRATED()(page));
      const h = await health(page);
      check(`${name} : la stratégie vivante EST celle mémorisée`, h?.runningStrategy === 'cpu', `vivante=${h?.runningStrategy}`);
      check(
        `${name} : re-prouvée STABLE par des landmarks réels (jamais par createFromOptions)`,
        (h?.negotiation ?? []).some((e) => e.id === 'cpu' && e.outcome === 'stable'),
      );
      const kept = await page.evaluate(() => localStorage.getItem('essayage.detection.v1'));
      check(`${name} : la mémoire d'appareil est conservée`, /"strategyId":"cpu"/.test(kept ?? ''));
    },
  });

  // S18 : un id mémorisé INCONNU (catalogue remanié) est ignoré — négociation
  // vierge depuis le nominal, et la stratégie re-prouvée ÉCRASE la mémoire.
  await scenario(browser, 'S18 mémoire de stratégie inconnue', {
    url: `${BASE}/`,
    init: () => {
      try {
        localStorage.setItem('essayage.detection.v1', JSON.stringify({ v: 1, strategyId: 'strategie-fantome' }));
      } catch {}
    },
    run: async (page, name) => {
      check(`${name} : la session conclut malgré la mémoire illisible`, await CALIBRATED()(page));
      const h = await health(page);
      check(`${name} : repartie du NOMINAL (graph minimal), pas d'une devinette`, h?.runningStrategy === 'gpu-sans-matrice', `vivante=${h?.runningStrategy}`);
      const rewritten = await page.evaluate(() => localStorage.getItem('essayage.detection.v1'));
      check(`${name} : la stratégie re-prouvée a remplacé l'id fantôme`, /"strategyId":"gpu-sans-matrice"/.test(rewritten ?? ''));
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

  // ───────────────── Yeux OCCLUS (refonte « VTO autonome ») ─────────────────
  // S19 — l'essayage visuel n'attend PAS la métrologie : la monture est posée
  // et suivie dès les landmarks (échelle provisoire), la PD se mesure en
  // parallèle. Le flux porte un bandeau sombre sur la zone oculaire.
  browser = await chromium.launch(LAUNCH('tests/fixtures/face-shades.y4m'));
  await scenario(browser, 'S19 lunettes AVANT la métrologie (yeux occlus)', {
    run: async (page, name, pageErrors) => {
      let renderedWhileUncalibrated = 0;
      let sawUncalibrated = false;
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const h = await health(page);
        if (h && h.calibrated === false) {
          sawUncalibrated = true;
          renderedWhileUncalibrated = Math.max(renderedWhileUncalibrated, h.renderedFrames ?? 0);
        }
        if (h && h.calibrated === true && renderedWhileUncalibrated > 3) break;
        await page.waitForTimeout(400);
      }
      check(`${name} : une fenêtre SANS calibration a été observée`, sawUncalibrated);
      check(
        `${name} : la monture est POSÉE avant toute métrologie (frames rendues sans calibration)`,
        renderedWhileUncalibrated > 3,
        `rendues=${renderedWhileUncalibrated}`,
      );
      const h = await health(page);
      check(`${name} : le suivi tient yeux occlus (landmarks réels)`, (h?.landmarkFrames ?? 0) > 30);
      check(`${name} : aucun invariant violé`, h?.invariants?.violations === 0);
      check(`${name} : aucune exception non rattrapée`, pageErrors.length === 0, pageErrors[0] ?? '');
      // Constat documentaire (pas une assertion) : que conclut la métrologie
      // sur des yeux occlus ? À confronter au vrai visage — cf. PROGRESS.
      const pd = (await page.locator('body').innerText()).match(/PD[^\n]{0,40}/)?.[0] ?? 'PD non affiché';
      console.log(`   ↳ constat yeux occlus : calibrated=${h?.calibrated} · ${pd.replace(/\s+/g, ' ')}`);
    },
  });
  await browser.close();

  // S20 — 🔴 terrain 2026-08-26 (capture réelle Windows/Chrome) : la monture
  // décrochait dès que le visage BOUGEAIT ou s'écartait du centre — et toutes
  // les fixtures historiques étaient statiques et centrées. Ici le visage
  // suit une loi sinusoïdale CONNUE (movingLaw.mjs) : on oppose, frame par
  // frame, l'ancre réellement PEINTE à la position vraie du visage.
  browser = await chromium.launch(LAUNCH('tests/fixtures/face-moving.y4m'));
  await scenario(browser, 'S20 la monture SUIT un visage MOBILE', {
    run: async (page, name, pageErrors) => {
      await page
        .waitForFunction(() => (globalThis.__VTO_HEALTH__?.renderedFrames ?? 0) > 5, { timeout: 60_000 })
        .catch(() => {});
      const samples = [];
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        // Un SEUL evaluate : la pose peinte (santé) et la position VRAIE lue
        // dans les PIXELS de la vidéo (repère fiduciaire au sommet du cadre) —
        // même tâche JS, donc pas de biais d'échantillonnage entre les deux.
        const s = await page.evaluate(() => {
          const h = globalThis.__VTO_HEALTH__ ?? null;
          const v = document.querySelector('video');
          let markerX = null;
          let vt = null;
          if (v !== null && v.videoWidth > 0) {
            vt = v.currentTime;
            const g = (globalThis.__S20C ??= (() => {
              const c = document.createElement('canvas');
              return c.getContext('2d', { willReadFrequently: true });
            })());
            g.canvas.width = v.videoWidth;
            g.canvas.height = 16;
            g.drawImage(v, 0, 0, v.videoWidth, 16, 0, 0, v.videoWidth, 16);
            const row = g.getImageData(0, 7, v.videoWidth, 1).data;
            const dark = [];
            for (let i = 0; i < v.videoWidth; i++) {
              const l = 0.299 * row[i * 4] + 0.587 * row[i * 4 + 1] + 0.114 * row[i * 4 + 2];
              if (l < 70) dark.push(i);
            }
            if (dark.length >= 3) markerX = dark.reduce((a, b) => a + b, 0) / dark.length;
          }
          return {
            x: h?.anchorFilteredPx?.x ?? null,
            raw: h?.anchorRawPx?.x ?? null,
            t: h?.lastVideoTimeS ?? null,
            rf: h?.renderedFrames ?? 0,
            markerX,
            vt,
          };
        });
        if (s.x !== null && s.markerX !== null) samples.push(s);
        await page.waitForTimeout(120);
      }
      const uniq = samples.filter((s, i) => i === 0 || s.rf !== samples[i - 1].rf);
      check(`${name} : échantillons de pose collectés`, uniq.length >= 40, `n=${uniq.length}`);
      if (uniq.length >= 40) {
        // 1) Le sprite SE DÉPLACE avec l'amplitude du mouvement (±120 px).
        const xs = uniq.map((s) => s.x);
        const spread = Math.max(...xs) - Math.min(...xs);
        check(`${name} : le sprite se DÉPLACE (amplitude réelle)`, spread > 1.2 * MOVING_AMPL_PX, `étendue=${spread.toFixed(0)} px`);
        // 2) Le TAMPON du faux périphérique d'abord : le repère fiduciaire
        // (pixels) daté par currentTime mesure le retard contenu ↔ horloge —
        // propriété du BANC (Chromium), jamais de l'application. On l'estime
        // puis on l'ôte de la vérité terrain.
        const medOf = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
        let capTau = 0;
        let capBest = Number.POSITIVE_INFINITY;
        for (let tau = 0; tau <= 0.5; tau += 0.02) {
          const m = medOf(uniq.map((s) => Math.abs(s.markerX - movingCenterX(s.vt - tau))));
          if (m < capBest) {
            capBest = m;
            capTau = tau;
          }
        }
        // 3) Vérité terrain à l'INSTANT DE LA FRAME PEINTE : loi(t_peint − τ).
        // Un décalage CONSTANT (sellion ↔ centre photo) est toléré et estimé ;
        // les RÉSIDUS, eux, doivent être petits — un pipeline en miroir, un
        // espace de coordonnées faux ou un retard perceptible explosent ici.
        const truth = (s) => movingCenterX(s.t - capTau);
        const offset = medOf(uniq.map((s) => s.x - truth(s)));
        const resid = uniq.map((s) => Math.abs(s.x - truth(s) - offset)).sort((a, b) => a - b);
        const med = resid[Math.floor(resid.length / 2)];
        const p90 = resid[Math.floor(resid.length * 0.9)];
        check(`${name} : l'ancre peinte est SUR le visage (décalage constant borné)`, Math.abs(offset) < 60, `δ=${offset.toFixed(0)} px`);
        check(`${name} : elle SUIT le mouvement (résidu médian)`, med < 30, `méd=${med.toFixed(0)} px`);
        check(`${name} : y compris aux vitesses de pointe (p90)`, p90 < 60, `p90=${p90.toFixed(0)} px`);
        const rawOffset = medOf(uniq.map((s) => s.raw - truth(s)));
        const rawMed = medOf(uniq.map((s) => Math.abs(s.raw - truth(s) - rawOffset)));
        console.log(
          `   ↳ diagnostic : tampon de capture τ≈${(capTau * 1000).toFixed(0)} ms (résidu ${capBest.toFixed(0)} px) · ` +
            `brut méd=${rawMed.toFixed(0)} px · filtré méd=${med.toFixed(0)} px`,
        );
      }
      const h2 = await health(page);
      check(`${name} : aucun invariant violé`, h2?.invariants?.violations === 0);
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
