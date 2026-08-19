/**
 * scripts/journey-no-card.mjs — LA preuve du parcours sans carte, en navigateur.
 *
 * Un visage RÉEL (photo du sujet, convertie en flux par make-face-y4m.mjs) est
 * injecté dans getUserMedia. Deux scénarios :
 *
 *   Cas A — navigateur TOTALEMENT VIERGE (aucun localStorage) :
 *     caméra → calibration automatique → « Calibration acquise » → essayage.
 *     Aucune carte, aucune règle, aucune saisie ; la note de distance dit
 *     « champ de caméra supposé » et AUCUNE note ne mentionne la carte.
 *
 *   Cas B — profil d'objectif HÉRITÉ d'une ancienne séance carte :
 *     même parcours, et l'héritage est DIT en clair (« séance carte
 *     précédente ») — jamais une amélioration silencieuse (vérification 17).
 *
 * Usage : node scripts/journey-no-card.mjs   (npm run journey)
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

// Prérequis refabriqués sur place : le flux visage et le wasm vendorisé.
if (!existsSync('tests/fixtures/face.y4m')) execSync('node scripts/make-face-y4m.mjs', { stdio: 'inherit' });
execSync('node scripts/sync-wasm.mjs', { stdio: 'inherit' });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;

/** Déroule le parcours V1 et rend les notices + l'état final. */
async function run(ctx, tag) {
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: /Ouvrir V1/i }).click();

  await page.getByText(/Mesure automatique en cours/i).waitFor({ timeout: 30_000 });
  check(`${tag} : la mesure automatique démarre sans rien demander`, true);

  // Le moteur conclut SEUL : succès (« Calibration acquise ») ou échec nommé.
  const outcome = page
    .getByText(/Calibration acquise|n’a pas abouti|n'a pas abouti/i)
    .first();
  await outcome.waitFor({ timeout: 40_000 });

  const body = await page.locator('main').innerText();
  const acquired = /Calibration acquise/i.test(body);
  check(`${tag} : la calibration se TERMINE et l'annonce en clair`, acquired);

  const notices = acquired ? body.slice(body.indexOf('✅')) : body;
  check(
    `${tag} : l'essayage live est atteint (catalogue + refaire la calibration)`,
    acquired && /Refaire la calibration/i.test(body) && /Montures essayables/i.test(body),
  );
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
  check(
    'Cas A : la distance vient du champ SUPPOSÉ — pas d’un héritage caché',
    /champ de caméra supposé/i.test(notesA),
  );
  check(
    'Cas A : AUCUNE mention de carte dans la chaîne de calcul',
    !/carte/i.test(notesA),
    'les notes ne citent que iris, distance supposée, convergence, plan',
  );
  console.log('— Cas A, chaîne annoncée :\n' + notesA.trim().split('\n').slice(0, 6).join('\n'));
  await ctxA.close();

  // ── Cas B — profil d'objectif hérité d'une ancienne séance carte.
  const ctxB = await browser.newContext({ permissions: ['camera'] });
  await ctxB.addInitScript(() => {
    localStorage.setItem(
      'essayage.camera.v1',
      JSON.stringify({ focalPerWidth: 0.9, relError: 0.05, views: 60, measuredAt: Date.now() }),
    );
  });
  const notesB = await run(ctxB, 'Cas B (profil hérité)');
  check(
    'Cas B : l’héritage carte est SIGNALÉ, jamais silencieux',
    /séance carte précédente/i.test(notesB),
  );
  console.log('— Cas B, chaîne annoncée :\n' + notesB.trim().split('\n').slice(0, 6).join('\n'));
  await ctxB.close();

  const pd = (s) => /Écart pupillaire : ([\d,.]+) mm ± ([\d,.]+)/.exec(s);
  const a = pd(notesA);
  const b = pd(notesB);
  if (a && b) {
    console.log(`— PD Cas A (sans carte, jamais) : ${a[1]} mm ± ${a[2]} mm`);
    console.log(`— PD Cas B (focale héritée)     : ${b[1]} mm ± ${b[2]} mm`);
    // Le PD APPARENT est identique ; seul le terme de convergence dépend de la
    // distance estimée, donc de la focale. Le visage du y4m apparaît à ~22 cm —
    // bien plus près qu'un usage réel — et l'écart A/B reste sous 1 mm, dans
    // les marges des deux mesures. À ≥ 40 cm, il retombe sous 0,3 mm.
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
console.log('\nParcours sans carte : tout est vert.');
