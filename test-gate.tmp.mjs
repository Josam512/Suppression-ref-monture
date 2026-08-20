import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const PORT = 5204, BASE = `http://localhost:${PORT}`;
const SP = '/tmp/claude-0/-home-user/5cceaacd-ae84-5f30-bc31-50c3a94428b4/scratchpad';
mkdirSync(`${SP}/preview-g1`, { recursive: true });
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
function findChromium() { for (const d of readdirSync('/opt/pw-browsers')) { const c = `/opt/pw-browsers/${d}/chrome-linux/chrome`; if (d.startsWith('chromium-') && existsSync(c)) return c; } }
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise(r => setTimeout(r, 400)); }
try {
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${SP}/portrait-test.y4m`,'--no-sandbox'] });
  const ctx = await browser.newContext({ permissions: ['camera'], viewport: { width: 520, height: 1200 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.error('  pageerror:', e.message));
  await p.goto(`${BASE}/essayage-instrumente.html`);
  await p.waitForFunction(() => /utiles/.test(document.getElementById('hud')?.textContent ?? ''), { timeout: 120000 });
  await p.waitForTimeout(9000);
  console.log((await p.locator('#hud').innerText()).split('\n').map(l => '  ' + l).join('\n'));
  console.log('  STATUS: ' + (await p.locator('#status').innerText()).slice(0, 160));
  await p.screenshot({ path: `${SP}/preview-g1/gate.png`, fullPage: true });
  await browser.close();
} catch (e) { console.error('❌', e.message); process.exitCode = 1; }
finally { server.kill('SIGTERM'); }
