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

  it('tempête d’inférence : recréer LA MÊME stratégie, puis descendre', async () => {
    const b = bench();
    const plan = initialPlan();
    const host = createModelHost(plan, silent, b.factory);
    host.ensure();
    await flush();
    for (let i = 0; i < INFERENCE_ERROR_SWAP_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.runningStrategy()?.id).toBe('gpu'); // recréée, pas remplacée
    expect(b.log).toEqual(['création:gpu', 'fermeture:gpu', 'création:gpu']);
    for (let i = 0; i < INFERENCE_ERROR_SWAP_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.runningStrategy()?.id).toBe('cpu'); // la tempête persiste → échelle
    expect(plan.strategyEverTracked).toBe(false);
    expect(b.maxAlive()).toBe(1);
    host.dispose();
  });

  it('tempête INDÉPASSABLE : échelle épuisée → tentatives ESPACÉES, un succès → plein régime', async () => {
    const b = bench();
    const plan = initialPlan();
    const host = createModelHost(plan, silent, b.factory);
    host.ensure();
    await flush();
    // Une première tempête (recréation de la même stratégie) n'espace RIEN :
    // l'échelle doit garder toute sa réactivité tant qu'elle a des marches.
    for (let i = 0; i < INFERENCE_ERROR_SWAP_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.retryDelayMs()).toBe(0);
    // Descendre TOUTE l'échelle : chaque étage subit recréation puis descente.
    for (let round = 0; round < 2 * DETECTION_STRATEGIES.length; round++) {
      for (let i = 0; i < INFERENCE_ERROR_SWAP_AFTER; i++) host.noteInferenceError();
      await flush();
    }
    expect(host.runningStrategy()?.id).toBe('cpu-seuils'); // dernier étage, VIVANT
    expect(host.state()).toBe('ready');
    expect(host.retryDelayMs()).toBe(STORM_RETRY_MS); // plus rien à essayer → espacement
    expect(b.maxAlive()).toBe(1);
    host.noteInferenceSuccess(); // le pilote revient : plein régime immédiat
    expect(host.retryDelayMs()).toBe(0);
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
