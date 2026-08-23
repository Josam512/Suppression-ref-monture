/**
 * tests/lifecycle.test.ts — le cycle de vie de l'instance FaceLandmarker
 * (ré-audit A1/A3), sur le VRAI code de `modelLifecycle.ts` via sa fabrique
 * injectable :
 *
 *   - JAMAIS deux Tasks MediaPipe vivantes (`maxAlive === 1`), quel que soit
 *     le scénario : création, swap, échec de la cible, tempête, fatal ;
 *   - l'ordre du remplacement est fermer → créer → (échec) recréer l'ancienne
 *     → (échec) marche suivante de l'échelle ;
 *   - le watchdog ferme une résolution TARDIVE au lieu de la laisser fuir ;
 *   - `whenReady()` dit la vérité : `true` à la première instance vivante,
 *     `false` sur fatal ou démontage.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import {
  createModelHost,
  INFERENCE_ERROR_SWAP_AFTER,
  MODEL_CREATE_TIMEOUT_MS,
  NEGOTIATION_ERROR_NEXT_AFTER,
  STORM_RETRY_MS,
  type LandmarkerFactory,
} from '../src/tracking/modelLifecycle.js';
import { DETECTION_STRATEGIES, initialPlan } from '../src/tracking/detectionPlan.js';

/** Fabrique-espion : compte les Tasks vivantes et journalise chaque événement. */
function bench(): {
  factory: LandmarkerFactory;
  fails: Set<string>;
  log: string[];
  instance: (id: string) => FaceLandmarker;
  alive(): number;
  maxAlive(): number;
  created(): number;
} {
  let alive = 0;
  let maxAlive = 0;
  let created = 0;
  const fails = new Set<string>();
  const log: string[] = [];
  const instance = (id: string): FaceLandmarker => {
    created++;
    alive++;
    maxAlive = Math.max(maxAlive, alive);
    log.push(`création:${id}`);
    return {
      close(): void {
        alive--;
        log.push(`fermeture:${id}`);
      },
    } as unknown as FaceLandmarker;
  };
  const factory: LandmarkerFactory = async (_onProgress, strategy) => {
    await Promise.resolve(); // asynchrone, comme la vraie création
    if (fails.has(strategy.id)) {
      log.push(`échec:${strategy.id}`);
      throw new Error(`création ${strategy.id} refusée (banc)`);
    }
    return instance(strategy.id);
  };
  return {
    factory,
    fails,
    log,
    instance,
    alive: () => alive,
    maxAlive: () => maxAlive,
    created: () => created,
  };
}

const silent = { onProgress: () => {}, onWarning: () => {}, onError: () => {} };

/** Laisse la chaîne création → repli → échelle se dérouler (macrotâches). */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('modelLifecycle — une seule Task, fermer avant créer (A1)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('création initiale : une Task, ready dit vrai', async () => {
    const b = bench();
    const plan = initialPlan();
    const host = createModelHost(plan, silent, b.factory);
    const ready = host.whenReady();
    host.ensure();
    await flush();
    expect(host.state()).toBe('ready');
    expect(host.runningStrategy()?.id).toBe('gpu');
    expect(await ready).toBe(true);
    expect(b.maxAlive()).toBe(1);
    host.dispose();
    expect(b.alive()).toBe(0);
  });

  it('remplacement : l’ancienne est FERMÉE avant la création de la cible', async () => {
    const b = bench();
    const plan = initialPlan();
    const host = createModelHost(plan, silent, b.factory);
    host.ensure();
    await flush();
    plan.strategyIndex = 1;
    host.ensure();
    await flush();
    expect(host.runningStrategy()?.id).toBe('cpu');
    expect(b.log).toEqual(['création:gpu', 'fermeture:gpu', 'création:cpu']);
    expect(b.maxAlive()).toBe(1); // le cœur du ré-audit A1
    host.dispose();
  });

  it('cible KO → la stratégie qui MARCHAIT est recréée, échelle intacte', async () => {
    const b = bench();
    const warnings: string[] = [];
    const plan = initialPlan();
    const host = createModelHost(plan, { ...silent, onWarning: (m) => warnings.push(m) }, b.factory);
    host.ensure();
    await flush();
    b.fails.add('cpu');
    plan.strategyIndex = 1;
    host.ensure();
    await flush();
    expect(host.runningStrategy()?.id).toBe('gpu');
    expect(plan.strategyIndex).toBe(0); // le plan est réconcilié sur la stratégie vivante
    expect(host.state()).toBe('ready');
    expect(warnings.some((w) => /je recrée/.test(w))).toBe(true);
    expect(b.log).toEqual(['création:gpu', 'fermeture:gpu', 'échec:cpu', 'création:gpu']);
    expect(b.maxAlive()).toBe(1);
    host.dispose();
  });

  it('cible KO + recréation KO → la marche suivante prend le relais', async () => {
    const b = bench();
    const plan = initialPlan();
    const host = createModelHost(plan, silent, b.factory);
    host.ensure();
    await flush();
    b.fails.add('cpu'); // la cible échouera…
    b.fails.add('gpu'); // …et l'ancienne ne peut plus être recréée (GPU mort)
    plan.strategyIndex = 1;
    host.ensure();
    await flush();
    expect(host.runningStrategy()?.id).toBe('cpu-marge');
    expect(host.state()).toBe('ready');
    expect(b.maxAlive()).toBe(1);
    host.dispose();
  });

  it('tempête d’inférence sur stratégie ÉPROUVÉE : recréer LA MÊME, puis avancer', async () => {
    const b = bench();
    const plan = initialPlan();
    const host = createModelHost(plan, silent, b.factory);
    host.ensure();
    await flush();
    plan.strategyEverTracked = true; // elle a SUIVI un visage : règle prudente
    for (let i = 0; i < INFERENCE_ERROR_SWAP_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.runningStrategy()?.id).toBe('gpu'); // recréée, pas remplacée
    expect(b.log).toEqual(['création:gpu', 'fermeture:gpu', 'création:gpu']);
    for (let i = 0; i < INFERENCE_ERROR_SWAP_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.runningStrategy()?.id).toBe('cpu'); // la tempête persiste → suivante
    expect(plan.strategyEverTracked).toBe(false);
    expect(b.maxAlive()).toBe(1);
    host.dispose();
  });

  it('🔴 NÉGOCIATION : stratégie JAMAIS éprouvée qui lève → fermée après 3 erreurs, suivante essayée', async () => {
    const b = bench();
    const advances: string[] = [];
    const plan = initialPlan();
    const host = createModelHost(plan, { ...silent, onAdvance: (id, outcome) => advances.push(`${id}:${outcome}`) }, b.factory);
    host.ensure();
    await flush();
    for (let i = 0; i < NEGOTIATION_ERROR_NEXT_AFTER - 1; i++) host.noteInferenceError();
    await flush();
    expect(host.runningStrategy()?.id).toBe('gpu'); // 2 erreurs : rien encore
    host.noteInferenceError(); // la 3e élimine
    await flush();
    expect(host.runningStrategy()?.id).toBe('cpu');
    expect(b.log).toEqual(['création:gpu', 'fermeture:gpu', 'création:cpu']); // fermer AVANT créer
    expect(advances).toEqual(['gpu:erreurs']);
    // Un succès sur la nouvelle marche remet les compteurs : 2 erreurs isolées n'éliminent plus.
    host.noteInferenceSuccess();
    for (let i = 0; i < NEGOTIATION_ERROR_NEXT_AFTER - 1; i++) host.noteInferenceError();
    await flush();
    expect(host.runningStrategy()?.id).toBe('cpu');
    expect(b.maxAlive()).toBe(1);
    host.dispose();
  });

  it('tempête INDÉPASSABLE : TOUT le catalogue épuisé → tentatives ESPACÉES, un succès → plein régime', async () => {
    const b = bench();
    const plan = initialPlan();
    const host = createModelHost(plan, silent, b.factory);
    host.ensure();
    await flush();
    // La négociation traverse le catalogue : 3 erreurs par stratégie jamais éprouvée.
    for (let rung = 1; rung < DETECTION_STRATEGIES.length; rung++) {
      expect(host.retryDelayMs()).toBe(0); // AUCUN espacement tant qu'il reste une marche
      for (let i = 0; i < NEGOTIATION_ERROR_NEXT_AFTER; i++) host.noteInferenceError();
      await flush();
    }
    expect(host.runningStrategy()?.id).toBe('cpu-canvas-sans-matrice'); // dernier recours, VIVANT
    // Tout visité : la règle prudente reprend — recréation, puis épuisement.
    for (let i = 0; i < INFERENCE_ERROR_SWAP_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.retryDelayMs()).toBe(0); // la recréation du dernier recours a eu sa chance
    for (let i = 0; i < INFERENCE_ERROR_SWAP_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.state()).toBe('ready');
    expect(host.retryDelayMs()).toBe(STORM_RETRY_MS); // plus rien à essayer → espacement
    expect(b.maxAlive()).toBe(1);
    host.noteInferenceSuccess(); // le pilote revient : plein régime immédiat
    expect(host.retryDelayMs()).toBe(0);
    host.dispose();
  });

  it('🔴 NÉGOCIATION : partie d’une stratégie MÉMORISÉE, l’élimination BOUCLE sur tout le catalogue', async () => {
    const b = bench();
    const startIndex = DETECTION_STRATEGIES.length - 2; // avant-dernière mémorisée
    const plan = initialPlan(startIndex);
    const host = createModelHost(plan, silent, b.factory);
    host.ensure();
    await flush();
    expect(host.runningStrategy()?.id).toBe(DETECTION_STRATEGIES[startIndex]!.id);
    // Elle lève : la suivante, PUIS retour au début du catalogue (wrap), sans épuisement prématuré.
    for (let i = 0; i < NEGOTIATION_ERROR_NEXT_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.runningStrategy()?.id).toBe(DETECTION_STRATEGIES[DETECTION_STRATEGIES.length - 1]!.id);
    for (let i = 0; i < NEGOTIATION_ERROR_NEXT_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.runningStrategy()?.id).toBe('gpu'); // le tour continue au début
    expect(host.retryDelayMs()).toBe(0); // 3 visitées sur 10 : rien d'épuisé
    expect(b.maxAlive()).toBe(1);
    host.dispose();
  });

  it('création PENDUE : le watchdog descend l’échelle, la résolution tardive est FERMÉE', async () => {
    vi.useFakeTimers();
    const b = bench();
    let resolveGpu: ((l: FaceLandmarker) => void) | null = null;
    const factory: LandmarkerFactory = (_p, strategy) =>
      strategy.id === 'gpu'
        ? new Promise<FaceLandmarker>((res) => {
            resolveGpu = res;
          })
        : Promise.resolve(b.instance(strategy.id));
    const plan = initialPlan();
    const host = createModelHost(plan, silent, factory);
    host.ensure();
    await vi.advanceTimersByTimeAsync(MODEL_CREATE_TIMEOUT_MS + 10);
    expect(host.runningStrategy()?.id).toBe('cpu');
    expect(host.state()).toBe('ready');
    // La création pendue résout APRÈS coup : l'instance est fermée, jamais adoptée.
    expect(resolveGpu).not.toBeNull();
    resolveGpu!(b.instance('gpu'));
    await vi.advanceTimersByTimeAsync(1);
    expect(b.log).toContain('fermeture:gpu');
    expect(b.alive()).toBe(1); // seule la CPU vit
    expect(host.runningStrategy()?.id).toBe('cpu');
    host.dispose();
  });

  it('AUCUNE stratégie ne se crée → fatal une fois, whenReady = false', async () => {
    const b = bench();
    for (const s of DETECTION_STRATEGIES) b.fails.add(s.id);
    const errors: string[] = [];
    const plan = initialPlan();
    const host = createModelHost(plan, { ...silent, onError: (m) => errors.push(m) }, b.factory);
    const ready = host.whenReady();
    host.ensure();
    await flush();
    expect(host.state()).toBe('failed');
    expect(errors).toHaveLength(1);
    expect(await ready).toBe(false);
    expect(b.created()).toBe(0);
    // Un ensure() de routine (frame model-pending) ne relance PAS le fatal en boucle.
    host.ensure();
    await flush();
    expect(errors).toHaveLength(1);
    host.dispose();
  });

  it('démontage PENDANT la création : l’instance fraîche est fermée, ready = false', async () => {
    let resolveGpu: ((l: FaceLandmarker) => void) | null = null;
    const b = bench();
    const factory: LandmarkerFactory = () =>
      new Promise<FaceLandmarker>((res) => {
        resolveGpu = res;
      });
    const plan = initialPlan();
    const host = createModelHost(plan, silent, factory);
    const ready = host.whenReady();
    host.ensure();
    host.dispose();
    expect(resolveGpu).not.toBeNull();
    resolveGpu!(b.instance('gpu'));
    await flush();
    expect(b.alive()).toBe(0); // fermée à l'arrivée : rien ne fuit après démontage
    expect(await ready).toBe(false);
  });
});
