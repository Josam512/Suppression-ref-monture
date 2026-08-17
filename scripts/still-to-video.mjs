/**
 * scripts/still-to-video.mjs — fabrique une courte video a partir d'une photo.
 *
 * Outil d'atelier (§0.0.2). Il sert a deux choses :
 *
 *  1. eprouver la chaine de recoloriage V2 de bout en bout sans attendre qu'une
 *     vraie video de magasin soit disponible ;
 *  2. permettre a l'opticien d'essayer un coloris a partir d'une simple PHOTO,
 *     quand filmer n'est pas commode.
 *
 * ⚠️ Ce n'est PAS un rendu de synthese : la photo reste la photo, on se contente
 * de l'encoder en video avec un tres leger mouvement, pour que la boucle de
 * detection ait des images distinctes a traiter (garde de monotonie S5, qui
 * ignore deliberement les frames identiques).
 *
 * Usage : node scripts/still-to-video.mjs <photo> <sortie.webm> [secondes]
 */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { chromium } from 'playwright';

const [photo, out = 'still.webm', secondsArg = '3'] = process.argv.slice(2);
if (!photo || !existsSync(photo)) {
  console.error('Usage : node scripts/still-to-video.mjs <photo> <sortie.webm> [secondes]');
  process.exit(1);
}
const seconds = Number(secondsArg);

const PORT = 5182;
const BASE = `http://localhost:${PORT}`;
const SERVED = 'public/_still';

function findChromium() {
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root)) {
    const c = `${root}/${dir}/chrome-linux/chrome`;
    if (dir.startsWith('chromium-') && existsSync(c)) return c;
  }
  return undefined;
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      /* pas encore pret */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Serveur de dev injoignable sur ${BASE}`);
}

rmSync(SERVED, { recursive: true, force: true });
mkdirSync(SERVED, { recursive: true });
cpSync(photo, join(SERVED, basename(photo)));

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;

try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: 'load' });

  const b64 = await page.evaluate(
    async ({ url, seconds }) => {
      const image = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image illisible'));
        el.src = url;
      });

      // 1280 de large au plus : au-dela, le decodage video coute plus cher que
      // la detection, sans rien apporter a la mesure.
      const scale = Math.min(1, 1280 / image.naturalWidth);
      const w = Math.round(image.naturalWidth * scale) & ~1;
      const h = Math.round(image.naturalHeight * scale) & ~1;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      // captureStream(0) + requestFrame : chaque image est produite a la
      // demande. Avec un taux automatique, le navigateur decide seul quand
      // echantillonner le canvas, et une page qu'il juge peu prioritaire n'y
      // produit qu'une poignee d'images — la video sortait a 2 frames.
      const stream = canvas.captureStream(0);
      const track = stream.getVideoTracks()[0];
      const chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const done = new Promise((resolve) => {
        rec.onstop = () => resolve();
      });
      rec.start();

      const total = Math.round(seconds * 30);
      for (let i = 0; i < total; i++) {
        // Un demi-pixel de derive : assez pour que deux images different,
        // trop peu pour deplacer quoi que ce soit de mesurable.
        const dx = Math.sin((i / total) * Math.PI * 2) * 0.5;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(image, dx, 0, w, h);
        track.requestFrame();
        // ⚠️ Cadencer a l'HORLOGE, pas au rythme d'affichage. Sur une page
        // hors ecran, `requestAnimationFrame` s'emballe : soixante images
        // etaient bien produites, mais horodatees sur 0,1 s — la video sortait
        // avec une duree de un dixieme de seconde.
        await new Promise((r) => setTimeout(r, 1000 / 30));
      }

      rec.stop();
      await done;

      const blob = new Blob(chunks, { type: 'video/webm' });
      const buffer = await blob.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    },
    { url: `/_still/${basename(photo)}`, seconds },
  );

  writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log(`${out} — ${(Buffer.from(b64, 'base64').length / 1024).toFixed(0)} Ko`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  rmSync(SERVED, { recursive: true, force: true });
}
