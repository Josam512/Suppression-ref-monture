/**
 * scripts/chaos.mjs — le CHAOS TEST de la machine entière (guide c46, c37, 77).
 *
 * Une session LONGUE (~100 s) sous sabotage aléatoire — exceptions de rendu,
 * stockage capricieux, changements de monture à la volée — avec l'assertion
 * PERMANENTE du point 77, vérifiée toutes les 5 s :
 *
 *   - la caméra vivante PRODUIT des frames (le scheduler ne meurt jamais) ;
 *   - le rendu avance dès qu'une calibration existe ;
 *   - aucun invariant runtime ne casse ;
 *   - jamais silencieusement vivante en apparence mais morte en interne.
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 5189;
const BASE = `http://localhost:${PORT}`;
const DURATION_MS = 100_000;
const CHECK_EVERY_MS = 5_000;

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

if (!existsSync('tests/fixtures/face.y4m')) execSync('node scripts/make-face-y4m.mjs', { stdio: 'inherit' });
execSync('node scripts/sync-wasm.mjs', { stdio: 'inherit' });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;
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
  const ctx = await browser.newContext({ permissions: ['camera'] });
  await ctx.addInitScript(() => {
    // — Sabotage 1 : ~2 % des drawImage lèvent, par rafales imprévisibles.
    const proto = CanvasRenderingContext2D.prototype;
    const original = proto.drawImage;
    proto.drawImage = function (...args) {
      if (Math.random() < 0.02) throw new Error('chaos : drawImage saboté');
      return original.apply(this, args);
    };
    // — Sabotage 2 : le stockage échoue une fois sur trois.
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...args) {
      if (Math.random() < 0.33) throw new Error('chaos : stockage saboté');
      return set.apply(this, args);
    };
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${BASE}/?resetSession=1`, { waitUntil: 'load' });

  const started = Date.now();
  let last = { cameraFrames: -1, renderedFrames: -1 };
  let ticks = 0;
  let deadTicks = 0;

  while (Date.now() - started < DURATION_MS) {
    await page.waitForTimeout(CHECK_EVERY_MS);
    ticks++;
    const h = await page.evaluate(() => globalThis.__VTO_HEALTH__ ?? null);
    if (h === null) {
      deadTicks++;
      console.log(`  t+${Math.round((Date.now() - started) / 1000)}s : santé indisponible`);
      continue;
    }
    const cameraAlive = h.cameraFrames > last.cameraFrames;
    const renderAlive = !h.calibrated || h.renderedFrames > last.renderedFrames;
    if (!cameraAlive || !renderAlive) deadTicks++;
    console.log(
      `  t+${Math.round((Date.now() - started) / 1000)}s : cam ${h.cameraFrames} · rendu ${h.renderedFrames} · ` +
        `errRendu ${h.renderErrors} · errMétro ${h.metrologyErrors} · cal ${h.calibrated} · pd ${h.pdReady} · ` +
        `invariants ${h.invariants?.violations ?? '?'}${cameraAlive && renderAlive ? '' : '   ⚠️ étage muet'}`,
    );
    last = { cameraFrames: h.cameraFrames, renderedFrames: h.renderedFrames };

    // — Sabotage 3 : changement de monture à la volée, une fois sur deux.
    if (ticks % 2 === 0) {
      const buttons = page.locator('button:has-text("\u00b7")');
      const n = await buttons.count();
      if (n > 0) await buttons.nth(ticks % n).click().catch(() => {});
    }
  }

  const h = await page.evaluate(() => globalThis.__VTO_HEALTH__ ?? null);
  check('point 77 : AUCUN passage mort (caméra et rendu ont produit à chaque contrôle)', deadTicks === 0, `${deadTicks}/${ticks} contrôles muets`);
  check('la calibration a abouti malgré le chaos', h?.calibrated === true);
  check('le PD a abouti malgré le chaos', h?.pdReady === true);
  check('des sabotages ont réellement eu lieu (le chaos a mordu)', (h?.renderErrors ?? 0) > 0, `${h?.renderErrors} erreurs de rendu encaissées`);
  check('aucun invariant runtime violé (c45)', h?.invariants?.violations === 0);
  check('aucune exception non rattrapée', pageErrors.length === 0, pageErrors[0]?.slice(0, 160) ?? '');
} catch (err) {
  check('chaos', false, err instanceof Error ? err.message : String(err));
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} contrôle(s) rouge(s).`);
  process.exit(1);
}
console.log('\nChaos : la session récupère ou dit pourquoi — tout est vert.');
