/**
 * scripts/guide-on-video.mjs — le cadre a remplir, sur une VRAIE video.
 *
 * Outil d'atelier (§0.0.2).
 *
 *   node scripts/guide-on-video.mjs <dossier-images> [sortie]
 *
 * Sort le profil temporel brut (JSON + resume) et des vignettes annotees :
 * cadre propose en rouge, carte trouvee en vert.
 *
 * ⚠️ Il MESURE. Il ne regle aucun seuil. C'est l'humain qui lit le profil.
 */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const frames = argv[0];
const outDir = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'guide-out';

if (!frames || !existsSync(join(frames, 'manifest.json'))) {
  console.error('Usage : node scripts/guide-on-video.mjs <dossier-images> [sortie]');
  console.error('  Le dossier contient manifest.json et fNNNN.jpg (cf. docs/reprise-cadre.md).');
  process.exit(1);
}

const PORT = 5184;
const BASE = `http://localhost:${PORT}`;
const SERVED = 'public/_guide';

function findChromium() {
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const d of readdirSync(root)) {
    const c = `${root}/${d}/chrome-linux/chrome`;
    if (d.startsWith('chromium-') && existsSync(c)) return c;
  }
  return undefined;
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(BASE)).ok) return; } catch { /* pas encore pret */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Serveur de dev injoignable sur ${BASE}`);
}

const png = (dataUrl, file) => writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

/** Quantiles d'une serie — c'est ce qui separe un pic d'un fond, pas la moyenne. */
function quantiles(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return { min: q(0), p25: q(0.25), med: q(0.5), p75: q(0.75), p95: q(0.95), max: q(1) };
}

rmSync(SERVED, { recursive: true, force: true });
mkdirSync(SERVED, { recursive: true });
cpSync(frames, SERVED, { recursive: true });
mkdirSync(outDir, { recursive: true });

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/tests/guide-on-video.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__SURVEYGUIDE__ === 'function', { timeout: 20000 });

  const s = await page.evaluate((u) => window.__SURVEYGUIDE__(u), '/_guide/manifest.json');

  console.log(`  dimensions        : ${s.w} x ${s.h}`);
  console.log(`  images parcourues : ${s.stepped}`);
  console.log(`  visage detecte    : ${s.detected} (${((100 * s.detected) / s.stepped).toFixed(0)} %)`);
  console.log('');

  const step = quantiles(s.rows.map((r) => r.edgeStep));
  console.log('  — CADRE SUR LE FRONT : marche de luminance du bord le plus faible');
  console.log(`    min ${step.min.toFixed(1)}  p25 ${step.p25.toFixed(1)}  med ${step.med.toFixed(1)}  p75 ${step.p75.toFixed(1)}  p95 ${step.p95.toFixed(1)}  MAX ${step.max.toFixed(1)}`);
  console.log(`    images conformes  : ${s.rows.filter((r) => r.ok).length} / ${s.rows.length}`);
  console.log(`    bords mesures 4/4 : ${s.rows.filter((r) => r.measured === 4).length}`);

  const found = s.rows.filter((r) => r.foundEdgeStep !== null);
  console.log('');
  console.log('  — RECHERCHE LIBRE DANS LE FRONT (sans viser)');
  if (found.length === 0) {
    console.log('    aucune carte trouvee sur aucune image');
  } else {
    const fq = quantiles(found.map((r) => r.foundEdgeStep));
    const wq = quantiles(found.map((r) => r.foundWidthPx));
    console.log(`    images avec carte : ${found.length} / ${s.rows.length}`);
    console.log(`    marche            : med ${fq.med.toFixed(1)}  p95 ${fq.p95.toFixed(1)}  MAX ${fq.max.toFixed(1)}`);
    console.log(`    largeur trouvee   : min ${wq.min.toFixed(0)} med ${wq.med.toFixed(0)} max ${wq.max.toFixed(0)} px  (cadre : ${s.rows[0].guideWidthPx.toFixed(0)} px)`);
    console.log(`    bords sous-pixel  : ${found.filter((r) => r.foundMeasured === 4).length} images a 4/4, ${found.filter((r) => r.foundMeasured >= 2).length} a >=2/4`);

    const rv = quantiles(found.map((r) => Math.abs(r.foundRollVsHeadDeg)));
    console.log(`    inclinaison carte MOINS tete : med ${rv.med.toFixed(1)}°  p95 ${rv.p95.toFixed(1)}°  max ${rv.max.toFixed(1)}°`);

    // 🔴 LE controle d'exactitude : la personne bouge, donc les deux largeurs
    // varient — mais leur rapport, lui, ne doit pas. Une detection qui accroche
    // autre chose que la carte fait exploser cette dispersion.
    const ratios = found.map((r) => r.foundWidthPx / r.facePx);
    const rq = quantiles(ratios);
    const moy = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const sd = Math.sqrt(ratios.reduce((a, b) => a + (b - moy) ** 2, 0) / ratios.length);
    const faceq = quantiles(found.map((r) => r.facePx));
    console.log('');
    console.log('  — EXACTITUDE : rapport carte / visage, qui DOIT etre constant');
    console.log(`    visage balaye     : ${faceq.min.toFixed(0)} a ${faceq.max.toFixed(0)} px  (x${(faceq.max / faceq.min).toFixed(2)})`);
    console.log(`    rapport           : med ${rq.med.toFixed(4)}  min ${rq.min.toFixed(4)}  max ${rq.max.toFixed(4)}`);
    console.log(`    DISPERSION        : ${((100 * sd) / moy).toFixed(1)} %   <- si >5 %, la detection accroche autre chose`);
  }

  writeFileSync(join(outDir, 'rows.json'), JSON.stringify(s.rows));
  console.log('');
  console.log(`  ${join(outDir, 'rows.json')}`);
  for (const v of s.samples) {
    const f = join(outDir, `${v.label}.png`);
    png(v.png, f);
    console.log(`  ${f}  (t=${v.t.toFixed(2)} s)`);
  }

  if (errors.length > 0) { console.error(`\nErreurs page : ${errors.join(' | ')}`); process.exitCode = 1; }
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  rmSync(SERVED, { recursive: true, force: true });
}
