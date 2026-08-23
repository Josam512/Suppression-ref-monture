/**
 * diag/diagMain.ts — le DIAGNOSTIC d'appareil (refonte 2026-08-23).
 *
 * Exécute TOUT le catalogue de stratégies sur la caméra réelle, une à la
 * fois : création (watchdog), puis SONDE par inférences réelles sur les
 * frames, puis élimination. Verdict par stratégie : Init / Inférence /
 * Landmarks (478 validés) — et l'erreur INTÉGRALE quand ça casse.
 *
 * ⚠️ Outil d'appareil (§0.0.2) : jamais lié depuis le produit. Le produit
 * fait cette négociation automatiquement (modelLifecycle) et s'arrête à la
 * première stratégie stable ; cette page, elle, les essaie TOUTES — c'est un
 * instrument de mesure, pas l'essayage.
 */

import { MediaPipeTracker } from '../tracking/backends/MediaPipeTracker.js';
import { DETECTION_STRATEGIES } from '../tracking/strategyCatalog.js';
import { detectionInput, landmarksInvalidReason } from '../tracking/frameInput.js';
import { preloadLandmarkerAssets } from '../tracking/landmarker.js';
import type { FrameSnapshot } from '../tracking/frameFeed.js';

/** Fenêtre de sonde par stratégie : au-delà, on conclut sur ce qu'on a vu. */
const PROBE_WINDOW_MS = 6000;
/** Frames de landmarks VALIDÉS suffisantes pour conclure « OK » plus tôt. */
const PROBE_LANDMARK_TARGET = 10;
/** Création réputée PENDUE au-delà (même échéance que le produit). */
const INIT_TIMEOUT_MS = 15_000;

interface RowVerdict {
  init: 'OK' | 'KO' | 'PENDUE';
  inferenceOk: number;
  inferenceErrors: number;
  landmarks: number;
  firstError: string | null;
}

const rows = document.getElementById('rows') as HTMLTableSectionElement;
const verdictEl = document.getElementById('verdict') as HTMLDivElement;
const video = document.getElementById('cam') as HTMLVideoElement;

function cell(text: string, cls = ''): string {
  return `<td class="${cls}">${text}</td>`;
}

function renderRow(id: string, v: RowVerdict | null, note = ''): void {
  const tr = document.getElementById(`row-${id}`) ?? rows.insertRow();
  tr.id = `row-${id}`;
  if (v === null) {
    tr.innerHTML = cell(id) + cell(note, 'muted') + cell('…') + cell('…') + cell('');
    return;
  }
  const lmOk = v.landmarks >= PROBE_LANDMARK_TARGET;
  const infOk = v.inferenceOk > 0 && v.inferenceErrors === 0;
  tr.innerHTML =
    cell(id) +
    cell(v.init, v.init === 'OK' ? 'ok' : 'ko') +
    cell(v.init === 'OK' ? `${infOk ? 'OK' : 'KO'} (${v.inferenceOk} ✓ / ${v.inferenceErrors} ✗)` : '—', infOk ? 'ok' : v.init === 'OK' ? 'ko' : 'muted') +
    cell(v.init === 'OK' ? `${lmOk ? '478 ✓' : String(v.landmarks)}` : '—', lmOk ? 'ok' : 'muted') +
    `<td class="err">${v.firstError ?? ''}</td>`;
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

async function probeStrategy(strategy: (typeof DETECTION_STRATEGIES)[number]): Promise<RowVerdict> {
  const v: RowVerdict = { init: 'KO', inferenceOk: 0, inferenceErrors: 0, landmarks: 0, firstError: null };
  const tracker = new MediaPipeTracker(strategy);
  try {
    await Promise.race([
      tracker.init({}),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`création sans réponse après ${INIT_TIMEOUT_MS / 1000} s`)), INIT_TIMEOUT_MS)),
    ]);
    v.init = 'OK';
  } catch (err) {
    v.init = err instanceof Error && /sans réponse/.test(err.message) ? 'PENDUE' : 'KO';
    v.firstError = err instanceof Error ? err.message.slice(0, 600) : String(err).slice(0, 600);
    tracker.dispose();
    return v;
  }

  // Sonde : les frames RÉELLES, via le même routage d'entrée que le produit.
  const feed = document.createElement('canvas');
  const scratch = document.createElement('canvas');
  const g = feed.getContext('2d');
  let lastTs = -1;
  let lastVideoTime = -1;
  const deadline = performance.now() + PROBE_WINDOW_MS;
  while (performance.now() < deadline && v.landmarks < PROBE_LANDMARK_TARGET) {
    await nextFrame();
    if (video.videoWidth === 0 || video.currentTime === lastVideoTime) continue;
    lastVideoTime = video.currentTime;
    if (feed.width !== video.videoWidth) {
      feed.width = video.videoWidth;
      feed.height = video.videoHeight;
    }
    g?.drawImage(video, 0, 0);
    const snapshot: FrameSnapshot = {
      source: feed,
      w: feed.width,
      h: feed.height,
      videoTimeS: video.currentTime,
      validity: { valid: true, reason: null, meanLuma: 128, spreadLuma: 64 },
      method: 'raf',
    };
    const din = detectionInput(snapshot, video, strategy, scratch);
    const ts = Math.max(performance.now(), lastTs + 1);
    lastTs = ts;
    try {
      const res = tracker.detect(din.input, ts);
      v.inferenceOk++;
      if (res !== null && landmarksInvalidReason(res.landmarks, tracker.topology) === null) v.landmarks++;
    } catch (err) {
      v.inferenceErrors++;
      v.firstError ??= err instanceof Error ? err.message.slice(0, 600) : String(err).slice(0, 600);
      if (v.inferenceErrors >= 5) break; // le verdict est acquis, inutile d'insister
    }
  }
  tracker.dispose();
  return v;
}

async function main(): Promise<void> {
  preloadLandmarkerAssets();
  for (const s of DETECTION_STRATEGIES) renderRow(s.id, null, 'en attente');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  await video.play();
  while (video.videoWidth === 0) await nextFrame();

  const winners: string[] = [];
  for (const strategy of DETECTION_STRATEGIES) {
    verdictEl.textContent = `Essai : ${strategy.id}…`;
    renderRow(strategy.id, null, 'en cours…');
    const v = await probeStrategy(strategy); // séquentiel : UNE Task à la fois
    renderRow(strategy.id, v);
    if (v.init === 'OK' && v.inferenceErrors === 0 && v.landmarks >= PROBE_LANDMARK_TARGET) winners.push(strategy.id);
  }
  verdictEl.textContent =
    winners.length > 0
      ? `✅ Stratégies saines sur cet appareil : ${winners.join(', ')} — le produit choisira la première automatiquement.`
      : '❌ Aucune stratégie ne produit de landmarks ici. Envoyez une capture de ce tableau (les erreurs sont intégrales).';
  stream.getTracks().forEach((t) => t.stop());
}

main().catch((err) => {
  verdictEl.textContent = `❌ Diagnostic interrompu : ${err instanceof Error ? err.message : String(err)}`;
});
