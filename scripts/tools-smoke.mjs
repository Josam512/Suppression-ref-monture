import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 5192;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Vite non démarré');
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  await page.goto(`${BASE}/prep.html`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: "Préparation d'une monture" }).waitFor({ timeout: 10_000 });
  if ((await page.locator('input[type="file"]').count()) !== 1) {
    throw new Error('prep.html a servi une autre page / SPA fallback');
  }

  await page.goto(`${BASE}/calib.html`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: /Lot 8 — calibration de la correction de largeur/i }).waitFor({ timeout: 10_000 });
  if ((await page.locator('input[type="file"]').count()) !== 1) {
    throw new Error('calib.html a servi une autre page / SPA fallback');
  }

  console.log('✅ prep.html et calib.html chargent leurs vrais outils React');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
