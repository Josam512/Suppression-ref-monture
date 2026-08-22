/**
 * scripts/soak.mjs — le TEST D'ENDURANCE (ré-audit, section AO) : 5–10 minutes
 * de session continue, avec changements de monture répétés et sabotages
 * périodiques (tempêtes drawImage, stockage qui lève), sous surveillance :
 *
 *   - AUCUNE fuite de Task MediaPipe (`aliveTasks ≤ 1` à chaque échantillon) ;
 *   - AUCUN scheduler mort : caméra ET rendu avancent à chaque échantillon,
 *     heartbeat de rendu < 5 s ; cadence plausible (< 120 fps — une double
 *     boucle rVFC/RAF doublerait la cadence) ;
 *   - mémoire STABLE : le tas JS de fin < 2,5 × celui d'après l'échauffement ;
 *   - AUCUN invariant runtime violé, aucune exception non rattrapée ;
 *   - la calibration ne se MODIFIE PAS TOUTE SEULE : le PD affiché à
 *     l'acquisition est identique à la fin (le raffinement temporal ne touche
 *     que temporal*).
 *
 * Durée : SOAK_MS (défaut 6 min). Hors de `npm run ci` (durée) : `npm run
 * soak`, et un job dédié du workflow GitHub l'exécute en parallèle.
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 5189;
const BASE = `http://localhost:${PORT}`;
const SOAK_MS = Number(process.env.SOAK_MS ?? 360_000);
const SAMPLE_MS = 15_000;

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
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${BASE}/?resetSession=1&hud=1`, { waitUntil: 'load' });

  const snap = () =>
    page.evaluate(() => {
      const h = globalThis.__VTO_HEALTH__ ?? null;
      return h === null
        ? null
        : {
            cameraFrames: h.cameraFrames,
            renderedFrames: h.renderedFrames,
            aliveTasks: h.aliveTasks,
            violations: h.invariants?.violations ?? -1,
            calibrated: h.calibrated,
            renderAgeMs: performance.now() - h.lastRenderedAtMs,
          };
    });

  await page
    .waitForFunction(() => globalThis.__VTO_HEALTH__?.calibrated === true, { timeout: 90_000 })
    .catch(() => {});
  const pdOf = async () => ((await page.locator('main').innerText()).match(/PD total : ([\d,.]+)/) ?? [])[1] ?? null;
  const pdAtStart = await pdOf();
  check('calibration acquise au départ du soak', pdAtStart !== null, `PD=${pdAtStart}`);

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () =>
    (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;

  // Échauffement d'une minute avant la référence mémoire (caches, JIT, wasm).
  await page.waitForTimeout(Math.min(60_000, SOAK_MS / 4));
  const heapWarm = await heap();

  const deadline = Date.now() + SOAK_MS;
  let prev = await snap();
  let cycles = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(Math.min(SAMPLE_MS, Math.max(1000, deadline - Date.now())));
    cycles++;

    // — Vie réelle : changement de monture régulier, sabotages périodiques.
    const buttons = page.locator('button:has-text("·")');
    const n = await buttons.count();
    if (n > 1) await buttons.nth(cycles % n).click();
    if (cycles % 3 === 0) {
      await page.evaluate(() => {
        // Tempête courte : drawImage lève 12 fois, puis guérit (enveloppes §17).
        const proto = CanvasRenderingContext2D.prototype;
        const original = proto.drawImage;
        let sabotaged = 0;
        proto.drawImage = function (...args) {
          if (sabotaged++ < 12) throw new Error('drawImage saboté (soak)');
          proto.drawImage = original;
          return original.apply(this, args);
        };
      });
    }

    const cur = await snap();
    const tag = `t+${Math.round((SOAK_MS - (deadline - Date.now())) / 1000)}s`;
    if (cur === null || prev === null) {
      check(`${tag} : santé lisible`, false);
      break;
    }
    const camDelta = cur.cameraFrames - prev.cameraFrames;
    check(`${tag} : la caméra avance (${camDelta} frames)`, camDelta > 0);
    check(`${tag} : le rendu avance`, cur.renderedFrames > prev.renderedFrames);
    check(`${tag} : heartbeat de rendu < 5 s`, cur.renderAgeMs < 5000, `${Math.round(cur.renderAgeMs)} ms`);
    check(`${tag} : cadence plausible (pas de double boucle)`, camDelta / (SAMPLE_MS / 1000) < 120);
    check(`${tag} : une seule Task MediaPipe`, cur.aliveTasks <= 1, `alive=${cur.aliveTasks}`);
    check(`${tag} : aucun invariant violé`, cur.violations === 0, `violations=${cur.violations}`);
    prev = cur;
  }

  const heapEnd = await heap();
  const ratio = heapWarm > 0 ? heapEnd / heapWarm : 1;
  check(
    `mémoire stable sur ${Math.round(SOAK_MS / 60_000)} min`,
    ratio < 2.5 && heapEnd < 800e6,
    `${(heapWarm / 1e6).toFixed(0)} → ${(heapEnd / 1e6).toFixed(0)} Mo (×${ratio.toFixed(2)})`,
  );
  const pdAtEnd = await pdOf();
  check('la calibration ne s’est pas modifiée toute seule (PD identique)', pdAtEnd === pdAtStart, `${pdAtStart} → ${pdAtEnd}`);
  check('aucune exception non rattrapée', pageErrors.length === 0, pageErrors[0] ?? '');

  await ctx.close();
} catch (err) {
  check('soak', false, err instanceof Error ? err.message : String(err));
} finally {
  await browser?.close();
  server.kill();
}

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length} contrôle(s) rouge(s).`);
  process.exit(1);
}
console.log(`\nSoak ${Math.round(SOAK_MS / 60_000)} min : tout est vert.`);
