/**
 * gate-entry.tmp.ts — ESSAYAGE INSTRUMENTÉ (page d'atelier).
 *
 * Le banc `face-matrix` a exonéré la détection : 478 landmarks sur l'appareil
 * réel, en mode VIDEO, CPU comme GPU. Les deux symptômes restants — aucune
 * lunette posée, aucun PD — ont UNE cause commune, lue dans le code :
 * `paintScene` sort avant de dessiner tant que `cal === null`, et `cal` ne
 * naît que si la collecte automatique conclut.
 *
 * Cette page montre donc, en direct, CE QUI ARRIVE À CHAQUE FRAME dans la
 * collecte : combien sont retenues, et pour quel motif exact les autres sont
 * rejetées (les quatre compteurs du moteur, jamais affichés jusqu'ici).
 *
 * ⚠️ Elle ne corrige rien dans le produit. Une seule liberté d'instrument :
 * quand le moteur ABANDONNE (20 s, matière insuffisante), elle en relance un
 * — sinon les chiffres s'arrêteraient net et il n'y aurait plus rien à lire.
 */

import {
  AutoCalibrationEngine,
  IRIS_DISCREPANCY_MAX,
  MIN_AUTO_FRAMES,
  MAX_AUTO_YAW_RAD,
  MAX_AUTO_ROLL_RAD,
  MAX_SPLIT_YAW_RAD,
  MAX_SCALE_STANDARD_ERROR,
} from './src/core/autoCalibration';
import { IRIS_ABSOLUTE_FLOOR_PX, irisQualityOf } from './src/core/irisQuality';
import { calibrateAuto, type AutoTemporalScene } from './src/core/autoCalibrate';
import type { UserCalibration } from './src/core/calibration';
import { frameMetrics, rollRadOf } from './src/core/faceMetrics';
import { parseFrameSpec, type FrameSpec } from './src/core/frameSpec';
import { ocularPixelsOf } from './src/core/ocularScale';
import { motionMask, type ImageBuffer } from './src/core/silhouette';
import { verdict, legend } from './src/core/verdict';
import { provisionalScale } from './src/core/provisionalScale';
import { drawFrame } from './src/render/composite';
import { assetUrl } from './src/ui/assetUrl';
import { faceOutlinePath } from './src/tracking/landmarker';
import { startFaceLoop } from './src/tracking/faceLoop';

const BUILD = 'g3 · 2026-08-21 11:00';
type Lm = ReadonlyArray<{ x: number; y: number; z?: number }>;

document.body.innerHTML = `
  <main style="max-width:900px;margin:0 auto;font-family:system-ui;color:#eee;background:#111;padding:10px">
    <h3 style="margin:6px 0">ESSAYAGE INSTRUMENTÉ · ${BUILD}</h3>
    <div id="stage" style="position:relative;transform:scaleX(-1);max-width:min(100%,420px);margin:0 auto">
      <video autoplay playsinline muted style="width:100%;display:block"></video>
      <canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas>
    </div>
    <pre id="hud" style="font-size:12.5px;line-height:1.5;background:#1c1c22;padding:10px;border-radius:8px;white-space:pre-wrap">démarrage…</pre>
    <div id="frames"></div>
    <p id="status" style="opacity:.75;font-size:.9em"></p>
  </main>`;

const video = document.querySelector('video')!;
const canvas = document.querySelector('canvas')!;
const hud = document.getElementById('hud')!;
const statusEl = document.getElementById('status')!;
const framesEl = document.getElementById('frames')!;
const ctx = canvas.getContext('2d')!;

const deg = (r: number): string => `${((r * 180) / Math.PI).toFixed(1)}°`;

interface Loaded { spec: FrameSpec; front: HTMLImageElement; profile: HTMLImageElement }
let current: Loaded | null = null;

const load = (src: string): Promise<HTMLImageElement> =>
  new Promise((ok, ko) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => ko(new Error(src));
    i.src = src;
  });

async function loadFrames(): Promise<void> {
  const idx = (await (await fetch(assetUrl('frames/index.json'))).json()) as { frames: { slug: string }[] };
  for (const { slug } of idx.frames) {
    const spec = parseFrameSpec(await (await fetch(assetUrl(`frames/${slug}/spec.json`))).json());
    const [front, profile] = await Promise.all([
      load(assetUrl(`frames/${slug}/${spec.front}`)),
      load(assetUrl(`frames/${slug}/${spec.profile}`)),
    ]);
    const b = document.createElement('button');
    b.textContent = `${slug} · ${spec.totalWidthMm.toFixed(0)} mm`;
    b.style.cssText = 'margin:4px;padding:8px 12px';
    b.onclick = () => {
      current = { spec, front, profile };
    };
    framesEl.appendChild(b);
    current ??= { spec, front, profile };
  }
}

// — Capture pour l'écart temporal : mêmes fenêtres que la production.
const off = document.createElement('canvas');
let frontal: { buf: ImageBuffer; lm: Lm; w: number; h: number } | null = null;
const sides: { neg: ImageBuffer | null; pos: ImageBuffer | null } = { neg: null, pos: null };
function grab(): ImageBuffer | null {
  if (video.videoWidth === 0) return null;
  off.width = video.videoWidth;
  off.height = video.videoHeight;
  const c = off.getContext('2d', { willReadFrequently: true });
  if (c === null) return null;
  c.drawImage(video, 0, 0);
  return c.getImageData(0, 0, off.width, off.height);
}

let engine: AutoCalibrationEngine | null = new AutoCalibrationEngine();
let cal: UserCalibration | null = null;
let degraded: boolean | null = null;
let notes: string[] = [];
let camLine = '';
let planLine = '—';
let lostLine = '';
let liveIrisL = 0;
let liveIrisR = 0;
let lmCount = 0;
let lastHud = 0;
/** Le saut d'echelle apercu -> calibre, MESURE sur l'appareil (audit point 2). */
let pxPerMmPreview: number | null = null;
let pxPerMmCalibrated: number | null = null;

function finish(): void {
  const meas = engine?.measures() ?? null;
  engine = null;
  if (meas === null) return;
  degraded = meas.degraded;
  const buffers = [sides.neg, sides.pos].filter((b): b is ImageBuffer => b !== null);
  const scene: AutoTemporalScene | null =
    frontal !== null && buffers.length > 0
      ? { frontal: frontal.buf, motion: motionMask(frontal.buf, buffers), lm: frontal.lm, w: frontal.w, h: frontal.h }
      : null;
  try {
    const out = calibrateAuto(meas, video.videoWidth, null, Date.now(), scene);
    cal = out.cal;
    notes = out.notes;
  } catch (err) {
    statusEl.textContent = `Échec d'assemblage : ${err instanceof Error ? err.message : String(err)}`;
  }
}

function paintHud(m: { livePxPerMm: number; yawRad: number } | null, rollRad: number | null, extra: string): void {
  const now = performance.now();
  if (now - lastHud < 200) return;
  lastHud = now;

  const st = engine?.status() ?? null;
  const r = st?.rejected ?? null;
  const spec = current?.spec ?? null;
  const half = (v: number | undefined, u: number | undefined): string =>
    v === undefined || Number.isNaN(v) ? 'non publiée (pas assez d’images de face STRICTE)' : `${v.toFixed(1)} mm ± ${(u ?? 0).toFixed(1)}`;
  const dist = notes.map((n) => /(\d+) cm/.exec(n)?.[0]).find((v) => v !== undefined) ?? '—';

  const iq = liveIrisL > 0 ? irisQualityOf(liveIrisL, liveIrisR, IRIS_DISCREPANCY_MAX) : null;
  const gate = (bad: boolean): string => (bad ? '❌' : '✅');
  const yawBad = m !== null && Math.abs(m.yawRad) > MAX_AUTO_YAW_RAD;
  const rollBad = rollRad !== null && Math.abs(rollRad) > MAX_AUTO_ROLL_RAD;

  hud.textContent = [
    `⚠️ page d'ATELIER. Écart avec la production : elle affiche ces compteurs,`,
    `   le produit ne les montre pas. Le moteur, lui, est le MÊME (il se`,
    `   ré-arme tout seul depuis le 2026-08-21 : plus rien à relancer ici).`,
    ``,
    `── DÉTECTION ────────────────────────────`,
    `stratégie   ${planLine}`,
    `landmarks   ${lmCount}${lostLine === '' ? '' : `   ${lostLine}`}`,
    `pose        yaw ${m === null ? '—' : deg(m.yawRad)}  ·  roll ${rollRad === null ? '—' : deg(rollRad)}`,
    `iris        OD ${liveIrisR.toFixed(1)} px  ·  OG ${liveIrisL.toFixed(1)} px  ·  écart ${iq === null ? '—' : (iq.discrepancy * 100).toFixed(1) + ' %'}`,
    ``,
    `── LES GATES, UN PAR UN (indépendants) ──`,
    `${gate(lmCount === 0)} visage détecté`,
    `${gate(iq !== null && !iq.ok)} iris exploitables  (plancher ${IRIS_ABSOLUTE_FLOOR_PX} px · aberration ${(IRIS_DISCREPANCY_MAX * 100).toFixed(1)} %)${iq?.reason === undefined || iq?.reason === null ? '' : ' → ' + iq.reason}`,
    `${gate(yawBad)} tête de face      (≤ ${deg(MAX_AUTO_YAW_RAD)})`,
    `${gate(rollBad)} tête droite       (≤ ${deg(MAX_AUTO_ROLL_RAD)})`,
    `raison n°1  ${st?.primaryRejectReason ?? '(aucune : frame retenue)'}`,
    ``,
    `── COLLECTE ─────────────────────────────`,
    `état        ${cal !== null ? '✅ CALIBRÉ' : (st?.state ?? '—')}   tentatives ${st?.attempts ?? 0}`,
    `utiles      ${st?.usableFrames ?? '—'} / ${MIN_AUTO_FRAMES}`,
    `depuis      1er visage ${st === null ? '—' : (st.acquisitionMs / 1000).toFixed(1) + ' s'}  ·  1re frame utile ${st === null ? '—' : (st.elapsedMs / 1000).toFixed(1) + ' s'}`,
    `variance    erreur-type d'échelle ${st === null ? '—' : (st.scaleStandardError * 100).toFixed(3) + ' %'} (converge sous ${(MAX_SCALE_STANDARD_ERROR * 100).toFixed(1)} %)`,
    `pourquoi    ${cal !== null ? '(terminé)' : (st?.whyNotDone?.label ?? '—')}`,
    st?.lastAttemptFailure == null ? '' : `dernier délai  ${st.lastAttemptFailure.label}`,
    ``,
    `── MESURE ───────────────────────────────`,
    `qualité     ${cal === null ? '⏳ APERÇU — taille pas encore mesurée' : degraded ? '⚠️ dégradée (conclue au délai, marge élargie)' : 'nominale'}`,
    `méthode     ${cal === null ? 'échelle d’UNE frame (aperçu, aucun mm affirmé)' : cal.source}`,
    `livePxPerMm ${m === null ? '—' : m.livePxPerMm.toFixed(3)}`,
    `saut        ${
      pxPerMmPreview === null || pxPerMmCalibrated === null
        ? 'aperçu → calibré : pas encore franchi'
        : `aperçu ${pxPerMmPreview.toFixed(3)} → calibré ${pxPerMmCalibrated.toFixed(3)} = ${((pxPerMmCalibrated / pxPerMmPreview - 1) * 100).toFixed(1)} % (doit être ≈ 0)`
    }`,
    `visage      ${cal === null ? '—' : `${cal.faceWidthMm.toFixed(1)} mm ± ${(cal.faceWidthMm * cal.relError).toFixed(1)}`}`,
    `temporal    ${cal?.temporalWidthMm !== undefined ? `${cal.temporalWidthMm.toFixed(1)} mm ± ${(cal.temporalWidthMm * (cal.temporalRelError ?? 0)).toFixed(1)}` : 'non mesuré'}`,
    `distance    ${dist} (estimée)`,
    `PD total    ${cal?.pdMm === undefined ? '—' : `${cal.pdMm.toFixed(1)} mm ± ${(cal.pdMm * (cal.pdRelError ?? 0)).toFixed(1)}`}`,
    `demi-PD OD  ${cal === null ? '—' : half(cal.pdRightMm, cal.pdHalfUncertaintyMm?.right)}`,
    `demi-PD OG  ${cal === null ? '—' : half(cal.pdLeftMm, cal.pdHalfUncertaintyMm?.left)}`,
    `  (demi-PD : face STRICTE, |yaw| ≤ ${deg(MAX_SPLIT_YAW_RAD)})`,
    `monture     ${spec === null ? '—' : `${spec.slug} · ${spec.totalWidthMm.toFixed(1)} mm`}`,
    extra === '' ? '' : `légende     ${extra}`,
    camLine,
  ].join('\n');
}

async function main(): Promise<void> {
  statusEl.textContent = 'chargement des montures et du modèle…';
  await loadFrames();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  const s0 = stream.getVideoTracks()[0]?.getSettings() as Record<string, unknown> | undefined;
  camLine = s0 === undefined ? '' : `\ncaméra      ${String(s0['width'])}×${String(s0['height'])} @ ${String(s0['frameRate'])}`;
  video.srcObject = stream;
  await video.play();
  await new Promise<void>((ok) => {
    if (video.readyState >= 2) ok();
    else video.onloadedmetadata = () => ok();
  });
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const loop = await startFaceLoop(video, {
    onProgress: (r) => {
      statusEl.textContent = `modèle : ${Math.round(r * 100)} %`;
    },
    onTransition: (reason) => {
      statusEl.textContent = `détection — ${reason}`;
    },
    onError: (message) => {
      statusEl.textContent = `Erreur détection : ${message}`;
    },
    onLandmarks(lm, yawRad) {
      const w = canvas.width;
      const h = canvas.height;
      lmCount = lm.length;
      lostLine = '';
      const roll = rollRadOf(lm as never, w, h);
      const eyes = ocularPixelsOf(lm as never, w, h);
      liveIrisL = eyes.hvidLeftPx;
      liveIrisR = eyes.hvidRightPx;

      if (engine !== null) {
        const ay = Math.abs(yawRad);
        if (ay <= 0.06 && frontal === null) {
          const buf = grab();
          if (buf !== null) frontal = { buf, lm: lm.map((p) => ({ x: p.x, y: p.y })), w, h };
        } else if (ay >= 0.17 && ay <= 0.61) {
          const key = yawRad < 0 ? 'neg' : 'pos';
          if (sides[key] === null) sides[key] = grab();
        }
        engine.offer(lm as never, yawRad, roll, w, h, Date.now());
        if (engine.state === 'calibrated') finish();
      }

      // ⭐ Point 4 — l'essayage démarre dès le SUIVI, sans attendre les mm.
      const shown = cal ?? provisionalScale(lm as never, w, h, IRIS_DISCREPANCY_MAX, Date.now())?.cal ?? null;
      if (shown !== null && current !== null) {
        const m = frameMetrics(lm as never, w, h, shown, yawRad);
        if (cal === null) pxPerMmPreview = m.livePxPerMm;
        else pxPerMmCalibrated ??= m.livePxPerMm;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        drawFrame(
          ctx,
          { front: { img: current.front, spec: current.spec }, profile: { img: current.profile, spec: current.spec } },
          m,
          faceOutlinePath(lm, w, h),
        );
        const v = cal === null ? null : verdict(lm as never, cal, current.spec, w, h, yawRad);
        paintHud(m, roll, v === null ? (cal === null ? 'gelée — aperçu, aucun mm affirmé' : 'gelée (pose hors tolérance — règle 3)') : legend(v));
        return;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      paintHud(null, roll, '');
    },
    onLost(n, cause, reason) {
      lmCount = 0;
      lostLine = cause === 'invalid-input' ? `❌ entrée : ${reason ?? '?'} (${n})` : `visage non trouvé (${n})`;
      // La perte est une frame comme une autre pour le moteur : elle compte
      // dans « visage absent », sinon ce compteur resterait à zéro à tort.
      if (engine !== null) engine.offer(null, 0, 0, canvas.width, canvas.height, Date.now());
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      paintHud(null, null, '');
    },
  });

  statusEl.textContent = 'Regardez l’écran quelques secondes, puis tournez lentement la tête.';
  setInterval(() => {
    planLine = `${loop.plan().phase} · ${loop.plan().strategyIndex}`;
    if (notes.length > 0) statusEl.textContent = notes.join(' — ');
  }, 500);
}

main().catch((err) => {
  hud.textContent = `Erreur : ${err instanceof Error ? err.message : String(err)}`;
});

export {};
