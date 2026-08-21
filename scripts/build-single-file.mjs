/**
 * scripts/build-single-file.mjs — l'application entière dans UN fichier HTML.
 *
 * Pourquoi : montrer l'essayage a quelqu'un qui n'installera rien. Pas de
 * serveur, pas de npm, pas de reglage : un fichier, un lien.
 *
 * ⚠️ Ce n'est PAS le build de production. Celui-la reste `npm run build`, qui
 * decoupe en morceaux et laisse un serveur livrer les 15 Mo de runtime. Ici on
 * paie ce prix d'un coup, dans la page.
 *
 * Ce qui est embarque, et sous quelle forme :
 *   · le chargeur et le binaire wasm de MediaPipe  — gzip, ~3,4 Mo
 *   · le modele face_landmarker.task               — gzip, ~3,3 Mo
 *   · les montures (PNG + spec.json)               — brut, les PNG ne gzippent pas
 *   · l'application elle-meme                      — un seul bundle IIFE
 *
 * Le navigateur les redeploie en `blob:` au chargement, et
 * `src/ui/assetUrl.ts` les retrouve la — c'est le seul point de contact entre
 * l'application servie et la page autonome.
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const OUT = process.argv[2] ?? 'essayage.html';

/** Un fichier embarque : son chemin relatif au site, son type MIME, sa compression. */
const ASSETS = [
  ['wasm/vision_wasm_internal.js', 'text/javascript', true],
  ['wasm/vision_wasm_internal.wasm', 'application/wasm', true],
  ['models/face_landmarker.task', 'application/octet-stream', true],
  ['frames/index.json', 'application/json', true],
];
// ⭐ Guide point 63 — les COLORWAYS embarquent aussi : dès que l'index en
// déclare, une page autonome sans eux rendrait « spec introuvable » et
// casserait le catalogue au premier coloris sélectionné.
const pushFrame = (slug) => {
  ASSETS.push([`frames/${slug}/spec.json`, 'application/json', true]);
  ASSETS.push([`frames/${slug}/front.png`, 'image/png', false]);
  ASSETS.push([`frames/${slug}/profile.png`, 'image/png', false]);
};
for (const frame of JSON.parse(readFileSync('public/frames/index.json', 'utf8')).frames) {
  pushFrame(frame.slug);
  for (const colorway of frame.colorways ?? []) pushFrame(colorway);
}

const payload = {};
let brut = 0;
for (const [path, mime, gz] of ASSETS) {
  const raw = readFileSync(`public/${path}`);
  brut += raw.length;
  const body = gz ? gzipSync(raw, { level: 9 }) : raw;
  payload[path] = { b: body.toString('base64'), m: mime, z: gz };
}

const app = readFileSync('dist-single/app.js', 'utf8');
const styles = readFileSync('index.html', 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];

const html = `<meta charset="utf-8" />
<title>Essayage virtuel</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<style>
${styles}
  .boot {
    position: fixed; inset: 0; display: grid; place-content: center; gap: 14px;
    padding: 32px; text-align: center; background: #111; color: #eee; z-index: 9;
  }
  .boot h1 { margin: 0; font-size: 1.35rem; font-weight: 600; text-wrap: balance; }
  .boot p { margin: 0; max-width: 32rem; color: #9a9aa1; line-height: 1.5; }
  .boot .bar { height: 3px; background: #2a2a2e; border-radius: 2px; overflow: hidden; }
  .boot .bar i { display: block; height: 100%; width: 0; background: #34c759; transition: width .2s; }
  .boot .ko { color: #ff6b6b; font-weight: 600; }
  .boot code { color: #c9c9d1; }
</style>

<div id="root"></div>

<div class="boot" id="boot">
  <h1>Essayage virtuel</h1>
  <p id="etat">Préparation…</p>
  <div class="bar"><i id="jauge"></i></div>
  <p style="font-size:.85rem">
    Tout est dans cette page : le suivi du visage, le modèle, les montures.
    Rien n’est envoyé nulle part — la vidéo ne quitte pas votre téléphone.
  </p>
</div>

<script>
(function () {
  var etat = document.getElementById('etat');
  var jauge = document.getElementById('jauge');
  var boot = document.getElementById('boot');

  function echec(quoi, detail) {
    etat.innerHTML = '<span class="ko">' + quoi + '</span><br><code>' + detail + '</code>';
    jauge.style.background = '#ff6b6b';
    jauge.style.width = '100%';
  }

  var P = PAYLOAD_PLACEHOLDER;

  function octets(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deplier(entry) {
    var bytes = octets(entry.b);
    if (entry.z) {
      var flux = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(flux).arrayBuffer());
    }
    return URL.createObjectURL(new Blob([bytes], { type: entry.m }));
  }

  (async function () {
    if (typeof DecompressionStream === 'undefined') {
      return echec('Navigateur trop ancien.', 'DecompressionStream absent — Chrome, Safari 16.4+ ou Firefox 113+.');
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return echec(
        'Pas d’accès caméra sur cette page.',
        "getUserMedia est indisponible : la page n'est pas en HTTPS, ou son cadre d'affichage n'autorise pas la caméra."
      );
    }

    var noms = Object.keys(P), carte = {}, fait = 0;
    try {
      for (var i = 0; i < noms.length; i++) {
        etat.textContent = 'Décompression ' + (fait + 1) + ' / ' + noms.length + '…';
        carte[noms[i]] = await deplier(P[noms[i]]);
        jauge.style.width = Math.round((++fait / noms.length) * 100) + '%';
      }
    } catch (e) {
      return echec('Décompression impossible.', String(e && e.message || e));
    }
    window.__INLINE_ASSETS__ = carte;

    etat.textContent = 'Démarrage…';
    window.addEventListener('error', function (e) {
      if (boot.isConnected) echec('L’application n’a pas démarré.', String(e.message || e));
    });

    try {
      APP_PLACEHOLDER
    } catch (e) {
      return echec('L’application n’a pas démarré.', String(e && e.message || e));
    }
    setTimeout(function () { boot.remove(); }, 400);
  })();
})();
</script>
`;

writeFileSync(
  OUT,
  html.replace('PAYLOAD_PLACEHOLDER', JSON.stringify(payload)).replace('APP_PLACEHOLDER', app),
);

const mo = (n) => (n / 1024 / 1024).toFixed(2) + ' Mo';
console.log('  fichiers embarques : ' + ASSETS.length + '  (' + mo(brut) + ' bruts)');
console.log('  application        : ' + mo(app.length));
console.log('  ' + OUT + ' : ' + mo(statSync(OUT).size));
