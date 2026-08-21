/**
 * scripts/journey-no-card.mjs — LE test fondamental du parcours (guide, pt 75).
 *
 * Un visage RÉEL (photo du sujet versionnée dans docs/verification/, convertie
 * en flux par make-face-y4m.mjs — reproductible depuis un clone propre, c39)
 * est injecté dans getUserMedia. La chaîne exigée :
 *
 *   caméra → premiers landmarks → MONTURE VISIBLE AVANT toute calibration
 *   (aperçu) → PD collecté en arrière-plan → calibration conclue → PD affiché
 *   en permanence → le tracking CONTINUE après calibration → le changement de
 *   monture n'efface aucune mesure.
 *
 * À aucune étape une absence facultative ne retire la monture, et aucun
 * invariant ne casse (`__VTO_HEALTH__`, complément 45).
 *
 * Cas A — navigateur VIERGE (?resetSession=1) : distance au champ SUPPOSÉ.
 * Cas B — profil d'objectif HÉRITÉ : l'héritage est DIT, jamais silencieux.
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 5181;
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
    } catch {
      /* pas prêt */
    }
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

// Prérequis refabriqués sur place : le flux visage et le wasm vendorisé (c39).
if (!existsSync('tests/fixtures/face.y4m')) execSync('node scripts/make-face-y4m.mjs', { stdio: 'inherit' });
execSync('node scripts/sync-wasm.mjs', { stdio: 'inherit' });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;

/** Déroule le parcours fondamental et rend le texte final de la page. */
async function run(ctx, tag) {
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${BASE}/?resetSession=1`, { waitUntil: 'load' });

  // — Étape 1 : la monture est posée AVANT toute calibration (aperçu).
  const sawProvisional = await page
    .waitForFunction(
      () => {
        const h = globalThis.__VTO_HEALTH__;
        return h && h.renderedFrames > 0 && !h.calibrated && h.provisional;
      },
      { timeout: 45_000 },
    )
    .then(() => true)
    .catch(() => false);
  check(`${tag} : la monture est posée AVANT la calibration (aperçu, pt 2-3)`, sawProvisional);

  // — Étape 2 : la calibration conclut SEULE, et l'annonce.
  await page.getByText(/Calibration acquise/i).first().waitFor({ timeout: 60_000 });
  const h1 = await health(page);
  check(`${tag} : la calibration se termine et l'annonce en clair`, h1?.calibrated === true);

  // — Étape 3 : le PD est mesuré et AFFICHÉ EN PERMANENCE (pts 22, 27).
  const body = await page.locator('main').innerText();
  check(`${tag} : le PD total est affiché avec sa marge (panneau permanent)`, /PD total : \d/.test(body), body.match(/PD total[^\n]*/)?.[0] ?? '');
  check(`${tag} : les demi-PD sont mesurées OU leur attente est dite (jamais PD/2 muet)`, /demi-PD/.test(body));
  check(`${tag} : la largeur de visage est affichée avec sa marge`, /largeur de visage[^\n]*\d/.test(body));
  check(`${tag} : la distance mesurée est affichée`, /distance mesurée : \d/.test(body));

  // — Étape 4 : le tracking CONTINUE après la calibration (c36). Assertion par
  // ÉCHÉANCE, pas par cadence : une machine de CI chargée tourne à 5 fps sans
  // que ce soit une panne (même philosophie que le guide, point 12).
  const before = (await health(page))?.renderedFrames ?? 0;
  const kept = await page
    .waitForFunction((b) => (globalThis.__VTO_HEALTH__?.renderedFrames ?? 0) > b + 10, before, {
      timeout: 20_000,
    })
    .then(() => true)
    .catch(() => false);
  const after = (await health(page))?.renderedFrames ?? 0;
  check(`${tag} : le tracking continue après calibration (${before} → ${after} frames)`, kept);

  // — Étape 5 : changer de monture n'efface AUCUNE mesure (c28).
  const buttons = page.locator('button:has-text("\u00b7")');
  if ((await buttons.count()) > 1) {
    await buttons.nth(1).click();
    await page.waitForTimeout(1200);
    const apres = await page.locator('main').innerText();
    check(`${tag} : le changement de monture conserve le panneau de mesures`, /PD total : \d/.test(apres));
    const h3 = await health(page);
    check(`${tag} : et la monture est toujours rendue`, (h3?.renderedFrames ?? 0) > after);
  } else {
    check(`${tag} : le changement de monture conserve le panneau de mesures`, true, 'une seule monture — non exercé');
  }

  // — Étape 6 : santé finale — aucun invariant cassé, aucun étage mort (pt 77).
  const hf = await health(page);
  check(`${tag} : aucun invariant runtime violé`, hf?.invariants?.violations === 0);
  check(`${tag} : aucune exception non rattrapée`, pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));

  const notices = body;
  await page.close();
  return notices;
}

try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath: findChromium(),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-video-capture=tests/fixtures/face.y4m',
      '--no-sandbox',
    ],
  });

  // ── Cas A — navigateur vierge : rien en localStorage, jamais de carte.
  const ctxA = await browser.newContext({ permissions: ['camera'] });
  const notesA = await run(ctxA, 'Cas A (vierge)');
  check('Cas A : la distance vient du champ SUPPOSÉ — pas d’un héritage caché', /champ de caméra supposé/i.test(notesA));
  check(
    'Cas A : AUCUNE mention de carte dans la chaîne de calcul',
    !/séance carte/i.test(notesA),
    'les notes ne citent que iris, distance supposée, convergence, plan',
  );
  await ctxA.close();

  // ── Cas B — profil d'objectif hérité d'une ancienne séance carte.
  const ctxB = await browser.newContext({ permissions: ['camera'] });
  await ctxB.addInitScript(() => {
    // ?resetSession=1 purge au chargement : ce init script REPOSE le profil
    // après coup, à chaque navigation, comme le ferait une séance précédente.
    const write = () => {
      try {
        localStorage.setItem(
          'essayage.camera.v1',
          JSON.stringify({ focalPerWidth: 0.9, relError: 0.05, views: 60, measuredAt: Date.now() }),
        );
      } catch {
        /* stockage absent : le cas B devient un cas A, les checks le diront */
      }
    };
    write();
    document.addEventListener('DOMContentLoaded', write);
  });
  const notesB = await run(ctxB, 'Cas B (profil hérité)');
  check('Cas B : l’héritage carte est SIGNALÉ, jamais silencieux', /séance carte précédente/i.test(notesB));
  await ctxB.close();

  const pd = (s) => /Écart pupillaire : ([\d,.]+) mm ± ([\d,.]+)/.exec(s);
  const a = pd(notesA);
  const b = pd(notesB);
  check('les notes détaillent le PD dans les deux cas', a !== null && b !== null);
  if (a && b) {
    console.log(`— PD Cas A (sans carte, jamais) : ${a[1]} mm ± ${a[2]} mm`);
    console.log(`— PD Cas B (focale héritée)     : ${b[1]} mm ± ${b[2]} mm`);
    check(
      'A et B concordent dans leurs marges (l’héritage n’altère que distance/marge)',
      Math.abs(parseFloat(a[1].replace(',', '.')) - parseFloat(b[1].replace(',', '.'))) <
        Math.min(parseFloat(a[2].replace(',', '.')), parseFloat(b[2].replace(',', '.'))),
    );
  }
} catch (err) {
  check('parcours sans carte', false, err instanceof Error ? err.message : String(err));
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} contrôle(s) rouge(s).`);
  process.exit(1);
}
console.log('\nParcours fondamental : tout est vert.');
