// Sonde d'audit : parcours V1 complet sur caméra factice (aucun visage).
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 5179;
const BASE = `http://localhost:${PORT}`;
function findChromium() {
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    const c = `${root}/${dir}/chrome-linux/chrome`;
    if (dir.startsWith('chromium-') && existsSync(c)) return c;
  }
  return '/opt/pw-browsers/chromium';
}
async function waitForServer(t = 30000) {
  const d = Date.now() + t;
  while (Date.now() < d) {
    try { if ((await fetch(BASE)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('serveur injoignable');
}
const dump = async (page, tag) => {
  const text = await page.locator('main').innerText();
  console.log(`--- ${tag} ---`);
  console.log(text.replace(/\n+/g, ' | ').slice(0, 600));
};
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: '/home/user/Suppression-ref-monture', stdio: 'ignore',
});
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ permissions: ['camera'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
  await page.goto(BASE);
  await page.getByRole('button', { name: /Ouvrir V1/i }).click();
  await page.waitForTimeout(9000);
  await dump(page, 'après init (9s)');
  const film = page.getByRole('button', { name: /Je filme/i });
  if (await film.count()) {
    await film.click();
    await page.waitForTimeout(8000);
    await dump(page, 'séance filmée (8s, aucun visage devant la caméra factice)');
    await page.getByRole('button', { name: /J.ai fini/i }).click();
    await page.waitForTimeout(2000);
    await dump(page, 'après « J’ai fini »');
  }
} finally {
  await browser?.close();
  server.kill();
}
