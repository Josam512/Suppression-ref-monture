/**
 * scripts/prepare-p58.mjs — atelier : fiche « p58 » depuis les photos produit
 * fournies par l'opticien (2026-08-31), déjà détourées CHEZ LUI mais arrivées
 * recompressées SANS canal alpha (damier incrusté dans les pixels).
 *
 * Ce script fait la préparation qu'un humain ferait dans l'outil de prep,
 * mais par MESURE sur les pixels — chaque grandeur est imprimée pour relecture.
 *
 *   1. Détourage DÉTERMINISTE du damier : un pixel « quasi-gris clair »
 *      (canaux serrés, luminance haute) appartient au damier. Par COMPOSANTES :
 *      celles qui touchent le bord = fond ; les grandes composantes intérieures
 *      = les verres (évidés — comme les fiches existantes) ; les petites
 *      restent opaques (reflets d'acétate). Les îlots opaques flottant DANS un
 *      verre (drapeaux/texte de l'étiquette) sont retirés.
 *   2. Échelle : la cote la plus fiable est le PONT — « 21 mm jusqu'à
 *      l'intérieur du drageoir » est EXACTEMENT l'écart minimal entre les deux
 *      trous, mesurable au pixel. A (48) et B (37) servent de contrôles : les
 *      trous leur sont inférieurs de l'enfoncement du drageoir (~1 mm par
 *      côté), l'écart mesuré est imprimé et doit rester plausible.
 *   3. totalWidthMm = bboxAlpha.w / échelle (proportionnalité demandée).
 *   4. Le sprite de PROFIL est la BRANCHE isolée de la photo trois-quarts :
 *      coupe à la jonction (le profil d'épaisseur des colonnes explose à la
 *      face), MIROIR horizontal pour la convention des fiches (charnière à
 *      gauche, branche vers +X), profilePxPerMm = longueur mesurée / 145 et
 *      profileReferenceLengthMm = 145 (la longueur peinte est la cote
 *      fabricant, complément 30). La pente de mise en page restante est
 *      annulée au chargement par l'app (ui/profileAxis.ts).
 *
 * Usage : node scripts/prepare-p58.mjs <face.webp> <trois-quarts.webp>
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FACE_SRC = process.argv[2];
const PROFILE_SRC = process.argv[3];
if (!FACE_SRC || !PROFILE_SRC) {
  console.error('usage : node scripts/prepare-p58.mjs <face> <trois-quarts>');
  process.exit(1);
}

const A_MM = 48;
const PONT_MM = 21;
const B_MM = 37;
const BRANCHE_MM = 145;
const SLUG = 'p58';

function findChromium() {
  const root = '/opt/pw-browsers';
  for (const dir of readdirSync(root)) {
    const candidate = resolve(root, dir, 'chrome-linux/chrome');
    if (dir.startsWith('chromium-') && existsSync(candidate)) return candidate;
  }
  throw new Error('Chromium introuvable sous /opt/pw-browsers');
}

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage();

/** Charge une image dans la page et rend { w, h } + la garde dans window.__img. */
async function load(b64) {
  return page.evaluate(async (data) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = 'data:image/webp;base64,' + data;
    });
    window.__img = img;
    return { w: img.naturalWidth, h: img.naturalHeight };
  }, b64);
}

/**
 * Détourage par composantes (tout en page, une passe) :
 * renvoie { png (dataURL), bbox, holes: [{bbox, area, cx, cy}...] } — holes
 * triés par surface décroissante = les composantes damier intérieures évidées.
 */
async function keyOut() {
  return page.evaluate(() => {
    const img = window.__img;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const im = ctx.getImageData(0, 0, w, h);
    const d = im.data;
    const n = w * h;

    // 1. masque « quasi-gris clair » (damier, compression comprise).
    const grey = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const r = d[i * 4];
      const g = d[i * 4 + 1];
      const b = d[i * 4 + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx - mn <= 22 && mn >= 200) grey[i] = 1;
    }

    // 2. composantes connexes du masque gris (BFS 4-connexité).
    const label = new Int32Array(n).fill(-1);
    const comps = []; // {id, area, touchesEdge, minX, minY, maxX, maxY}
    const queue = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (grey[s] === 0 || label[s] !== -1) continue;
      const id = comps.length;
      const comp = { id, area: 0, touchesEdge: false, minX: w, minY: h, maxX: -1, maxY: -1 };
      let head = 0;
      let tail = 0;
      queue[tail++] = s;
      label[s] = id;
      while (head < tail) {
        const p = queue[head++];
        const x = p % w;
        const y = (p / w) | 0;
        comp.area++;
        if (x < comp.minX) comp.minX = x;
        if (x > comp.maxX) comp.maxX = x;
        if (y < comp.minY) comp.minY = y;
        if (y > comp.maxY) comp.maxY = y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) comp.touchesEdge = true;
        if (x > 0 && grey[p - 1] && label[p - 1] === -1) { label[p - 1] = id; queue[tail++] = p - 1; }
        if (x < w - 1 && grey[p + 1] && label[p + 1] === -1) { label[p + 1] = id; queue[tail++] = p + 1; }
        if (y > 0 && grey[p - w] && label[p - w] === -1) { label[p - w] = id; queue[tail++] = p - w; }
        if (y < h - 1 && grey[p + w] && label[p + w] === -1) { label[p + w] = id; queue[tail++] = p + w; }
      }
      comps.push(comp);
    }

    // 3. transparent : fond (touche le bord) + composantes intérieures
    //    NOTABLES (> 0,3 % de l'image = les verres). Les petites restent
    //    opaques : ce sont des reflets DANS l'acétate.
    const clear = new Uint8Array(comps.length);
    const holes = [];
    for (const comp of comps) {
      if (comp.touchesEdge) clear[comp.id] = 1;
      else if (comp.area > 0.003 * n) {
        clear[comp.id] = 1;
        holes.push({
          area: comp.area,
          bbox: { x: comp.minX, y: comp.minY, w: comp.maxX - comp.minX + 1, h: comp.maxY - comp.minY + 1 },
          cx: (comp.minX + comp.maxX) / 2,
          cy: (comp.minY + comp.maxY) / 2,
        });
      }
    }
    for (let i = 0; i < n; i++) if (label[i] !== -1 && clear[label[i]]) d[i * 4 + 3] = 0;

    // 4. îlots OPAQUES flottant dans un verre (étiquette) → retirés.
    holes.sort((a, b) => b.area - a.area);
    const opaque = (i) => d[i * 4 + 3] > 0;
    const olabel = new Int32Array(n).fill(-1);
    for (let s = 0; s < n; s++) {
      if (!opaque(s) || olabel[s] !== -1) continue;
      const id = 1;
      let head = 0;
      let tail = 0;
      const members = [];
      queue[tail++] = s;
      olabel[s] = id;
      let minX = w, minY = h, maxX = -1, maxY = -1;
      while (head < tail) {
        const p = queue[head++];
        members.push(p);
        const x = p % w;
        const y = (p / w) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x > 0 && opaque(p - 1) && olabel[p - 1] === -1) { olabel[p - 1] = id; queue[tail++] = p - 1; }
        if (x < w - 1 && opaque(p + 1) && olabel[p + 1] === -1) { olabel[p + 1] = id; queue[tail++] = p + 1; }
        if (y > 0 && opaque(p - w) && olabel[p - w] === -1) { olabel[p - w] = id; queue[tail++] = p - w; }
        if (y < h - 1 && opaque(p + w) && olabel[p + w] === -1) { olabel[p + w] = id; queue[tail++] = p + w; }
      }
      const inHole = holes.find(
        (hh) => minX >= hh.bbox.x && maxX <= hh.bbox.x + hh.bbox.w && minY >= hh.bbox.y && maxY <= hh.bbox.y + hh.bbox.h,
      );
      if (inHole && members.length < 0.2 * inHole.area) {
        for (const p of members) d[p * 4 + 3] = 0;
      }
    }

    ctx.putImageData(im, 0, 0);

    // 5. bbox alpha finale.
    let bMinX = w, bMinY = h, bMaxX = -1, bMaxY = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < bMinX) bMinX = x;
          if (x > bMaxX) bMaxX = x;
          if (y < bMinY) bMinY = y;
          if (y > bMaxY) bMaxY = y;
        }

    window.__keyed = { canvas: c, w, h };
    return {
      bbox: { x: bMinX, y: bMinY, w: bMaxX - bMinX + 1, h: bMaxY - bMinY + 1 },
      holes: holes.slice(0, 6),
    };
  });
}

// ─── FACE ───────────────────────────────────────────────────────────────────
const faceDims = await load(readFileSync(FACE_SRC).toString('base64'));
const face = await keyOut();
const lenses = face.holes.slice(0, 2).sort((a, b) => a.cx - b.cx);
if (lenses.length < 2) {
  console.error('❌ verres introuvables — composantes :', JSON.stringify(face.holes));
  process.exit(1);
}
const [lensL, lensR] = lenses;

const faceGeom = await page.evaluate(
  ({ lensL, lensR }) => {
    const { canvas: c, w, h } = window.__keyed;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, w, h).data;
    const alpha = (x, y) => d[(y * w + x) * 4 + 3];

    // Pont : écart minimal entre les deux trous, ligne par ligne.
    const y0 = Math.max(lensL.bbox.y, lensR.bbox.y);
    const y1 = Math.min(lensL.bbox.y + lensL.bbox.h, lensR.bbox.y + lensR.bbox.h);
    let pontPx = Infinity;
    let pontY = -1;
    for (let y = y0; y < y1; y++) {
      let leftEdge = -1;
      for (let x = lensL.bbox.x + lensL.bbox.w; x >= lensL.bbox.x; x--)
        if (alpha(x, y) < 8) { leftEdge = x; break; }
      let rightEdge = -1;
      for (let x = lensR.bbox.x; x < lensR.bbox.x + lensR.bbox.w; x++)
        if (alpha(x, y) < 8) { rightEdge = x; break; }
      if (leftEdge < 0 || rightEdge < 0) continue;
      const gap = rightEdge - leftEdge - 1;
      if (gap > 0 && gap < pontPx) { pontPx = gap; pontY = y; }
    }

    // Tenons : extrêmes opaques sur la bande de hauteur des verres.
    const cy = Math.round((lensL.cy + lensR.cy) / 2);
    const band = Math.round((lensL.bbox.h + lensR.bbox.h) / 4);
    let rootLx = w, rootRx = -1;
    for (let y = cy - band; y <= cy + band; y++) {
      for (let x = 0; x < w; x++) if (alpha(x, y) > 8) { if (x < rootLx) rootLx = x; break; }
      for (let x = w - 1; x >= 0; x--) if (alpha(x, y) > 8) { if (x > rootRx) rootRx = x; break; }
    }
    return { pontPx, pontY, cy, rootLx, rootRx, png: c.toDataURL('image/png') };
  },
  { lensL, lensR },
);

const scale = faceGeom.pontPx / PONT_MM; // px sprite par mm
const measured = {
  face: faceDims,
  bbox: face.bbox,
  pontPx: faceGeom.pontPx,
  scale: +scale.toFixed(4),
  lensL_wMm: +(lensL.bbox.w / scale).toFixed(1),
  lensL_hMm: +(lensL.bbox.h / scale).toFixed(1),
  lensR_wMm: +(lensR.bbox.w / scale).toFixed(1),
  lensR_hMm: +(lensR.bbox.h / scale).toFixed(1),
  totalWidthMm: +(face.bbox.w / scale).toFixed(1),
  totalHeightMm: +(face.bbox.h / scale).toFixed(1),
  rootL: { x: faceGeom.rootLx, y: faceGeom.cy },
  rootR: { x: faceGeom.rootRx, y: faceGeom.cy },
  lateralOverhangMm: +(((faceGeom.rootLx - face.bbox.x) + (face.bbox.x + face.bbox.w - 1 - faceGeom.rootRx)) / scale).toFixed(2),
};
console.log('FACE :', JSON.stringify(measured, null, 1));

// ─── PROFIL (branche isolée du trois-quarts) ───────────────────────────────
await load(readFileSync(PROFILE_SRC).toString('base64'));
await keyOut();
const temple = await page.evaluate((BRANCHE_MM) => {
  const { canvas: c, w, h } = window.__keyed;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(0, 0, w, h).data;
  const alpha = (x, y) => d[(y * w + x) * 4 + 3];

  // Épaisseur opaque par colonne : fine sur la branche, énorme sur la face.
  const thick = new Array(w).fill(0);
  for (let x = 0; x < w; x++) {
    let t = 0;
    for (let y = 0; y < h; y++) if (alpha(x, y) > 8) t++;
    thick[x] = t;
  }
  let first = 0;
  while (first < w && thick[first] === 0) first++;
  const sample = thick.slice(first, first + Math.round(w * 0.3)).filter((t) => t > 0).sort((a, b) => a - b);
  const medThick = sample[Math.floor(sample.length / 2)] ?? 0;
  // Jonction : première colonne (depuis la gauche) durablement > 4× l'épaisseur
  // de branche — on ne garde ensuite que 15 px de face : juste la continuité du
  // tenon. Une marge plus large embarquait un arc de cerclage de ~80 mm réels
  // qui aurait dépassé de la face frontale au rendu (contrôle visuel du
  // 2026-08-31).
  let xJoin = w - 1;
  for (let x = first; x < w; x++) {
    if (thick[x] > Math.max(4 * medThick, 40)) {
      let sustained = true;
      for (let k = 1; k <= 12; k++) if (thick[Math.min(x + k, w - 1)] <= Math.max(4 * medThick, 40)) sustained = false;
      if (sustained) { xJoin = x; break; }
    }
  }
  const cropW = Math.min(w, xJoin + 15);

  // Miroir horizontal (convention des fiches : charnière à GAUCHE, branche +X).
  const out = document.createElement('canvas');
  out.width = cropW;
  out.height = h;
  const octx = out.getContext('2d', { willReadFrequently: true });
  octx.translate(cropW, 0);
  octx.scale(-1, 1);
  octx.drawImage(c, 0, 0, cropW, h, 0, 0, cropW, h);

  // Charnière : après miroir, la jonction est à x = cropW − xJoin ; son y est
  // le centre de masse opaque de cette colonne. Longueur : le pixel opaque le
  // plus ÉLOIGNÉ de la charnière (le bout du manchon).
  const od = octx.getImageData(0, 0, cropW, h).data;
  const oAlpha = (x, y) => od[(y * cropW + x) * 4 + 3];
  const hx = cropW - xJoin;
  let sy = 0;
  let ny = 0;
  for (let y = 0; y < h; y++) if (oAlpha(Math.min(hx + 2, cropW - 1), y) > 8) { sy += y; ny++; }
  const hy = ny > 0 ? sy / ny : h / 2;
  let far = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < cropW; x++)
      if (oAlpha(x, y) > 8) {
        const dd = Math.hypot(x - hx, y - hy);
        if (dd > far) far = dd;
      }
  let bMinX = cropW, bMinY = h, bMaxX = -1, bMaxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < cropW; x++)
      if (oAlpha(x, y) > 8) {
        if (x < bMinX) bMinX = x;
        if (x > bMaxX) bMaxX = x;
        if (y < bMinY) bMinY = y;
        if (y > bMaxY) bMaxY = y;
      }
  return {
    cropW,
    xJoin,
    medThick,
    hinge: { x: hx, y: +hy.toFixed(1) },
    lengthPx: +far.toFixed(1),
    pxPerMm: +(far / BRANCHE_MM).toFixed(4),
    bbox: { x: bMinX, y: bMinY, w: bMaxX - bMinX + 1, h: bMaxY - bMinY + 1 },
    png: out.toDataURL('image/png'),
  };
}, BRANCHE_MM);
console.log('PROFIL :', JSON.stringify({ ...temple, png: `(${temple.png.length} car.)` }, null, 1));

// ─── Fiche ──────────────────────────────────────────────────────────────────
const dir = resolve('public/frames', SLUG);
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'front.png'), Buffer.from(faceGeom.png.split(',')[1], 'base64'));
writeFileSync(resolve(dir, 'profile.png'), Buffer.from(temple.png.split(',')[1], 'base64'));

const spec = {
  slug: SLUG,
  aMm: A_MM,
  pontMm: PONT_MM,
  bMm: B_MM,
  brancheMm: BRANCHE_MM,
  totalWidthMm: +(face.bbox.w / scale).toFixed(1),
  front: 'front.png',
  profile: 'profile.png',
  spritePxPerMm: +scale.toFixed(4),
  alphaBBox: face.bbox,
  bridgeCenter: { x: +((lensL.cx + lensR.cx) / 2).toFixed(1), y: faceGeom.pontY },
  lensCenterL: { x: +lensL.cx.toFixed(1), y: +lensL.cy.toFixed(1) },
  lensCenterR: { x: +lensR.cx.toFixed(1), y: +lensR.cy.toFixed(1) },
  templeRootL: measured.rootL,
  templeRootR: measured.rootR,
  hingeProfile: { x: temple.hinge.x, y: +temple.hinge.y },
  profilePxPerMm: temple.pxPerMm,
  profileReferenceLengthMm: BRANCHE_MM,
  calibratedAt: '2026-08-31',
};
writeFileSync(resolve(dir, 'spec.json'), JSON.stringify(spec, null, 2) + '\n');
console.log('SPEC :', JSON.stringify(spec));
console.log(`✅ fiche écrite dans public/frames/${SLUG}/`);
await browser.close();
