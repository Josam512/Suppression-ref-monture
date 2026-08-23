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
import type { FaceTracker } from '../src/tracking/FaceTracker.js';
import {
  createModelHost,
  INFERENCE_ERROR_SWAP_AFTER,
  MODEL_CREATE_TIMEOUT_MS,
  NEGOTIATION_ERROR_NEXT_AFTER,
  STORM_RENEGOTIATE_MS,
  STORM_RETRY_MS,
  type TrackerFactory,
} from '../src/tracking/modelLifecycle.js';
import { DETECTION_STRATEGIES, initialPlan, type DetectionStrategy } from '../src/tracking/detectionPlan.js';

// Le catalogue est ORDONNÉ (minimal d'abord, refonte 2026-08-23) : ces tests
// parlent de POSITIONS (première marche, suivante…), pas d'identités — les ids
// sont donc lus sur le catalogue pour survivre à tout réordonnancement.
const ID0 = DETECTION_STRATEGIES[0]!.id;
const ID1 = DETECTION_STRATEGIES[1]!.id;
const ID2 = DETECTION_STRATEGIES[2]!.id;
const LAST = DETECTION_STRATEGIES[DETECTION_STRATEGIES.length - 1]!.id;

/** Fabrique-espion : compte les backends vivants et journalise chaque événement. */
function bench(): {
  factory: TrackerFactory;
  fails: Set<string>;
  log: string[];
  instance: (id: string) => FaceTracker;
  alive(): number;
  maxAlive(): number;
  created(): number;
} {
  let alive = 0;
  let maxAlive = 0;
  let created = 0;
  const fails = new Set<string>();
  const log: string[] = [];
  const instance = (id: string): FaceTracker => {
    created++;
    alive++;
    maxAlive = Math.max(maxAlive, alive);
    log.push(`création:${id}`);
    return {
      id,
      strategy: DETECTION_STRATEGIES.find((st) => st.id === id) ?? (DETECTION_STRATEGIES[0] as DetectionStrategy),
      init: async () => {},
      detect: () => null,
      dispose(): void {
        alive--;
        log.push(`fermeture:${id}`);
      },
    };
  };
  const factory: TrackerFactory = async (_onProgress, strategy) => {
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
    expect(host.runningStrategy()?.id).toBe(ID0);
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
    expect(host.runningStrategy()?.id).toBe(ID1);
    expect(b.log).toEqual([`création:${ID0}`, `fermeture:${ID0}`, `création:${ID1}`]);
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
    b.fails.add(ID1);
    plan.strategyIndex = 1;
    host.ensure();
    await flush();
    expect(host.runningStrategy()?.id).toBe(ID0);
    expect(plan.strategyIndex).toBe(0); // le plan est réconcilié sur la stratégie vivante
    expect(host.state()).toBe('ready');
    expect(warnings.some((w) => /je recrée/.test(w))).toBe(true);
    expect(b.log).toEqual([`création:${ID0}`, `fermeture:${ID0}`, `échec:${ID1}`, `création:${ID0}`]);
    expect(b.maxAlive()).toBe(1);
    host.dispose();
  });

  it('cible KO + recréation KO → la marche suivante prend le relais', async () => {
    const b = bench();
    const plan = initialPlan();
    const host = createModelHost(plan, silent, b.factory);
    host.ensure();
    await flush();
    b.fails.add(ID1); // la cible échouera…
    b.fails.add(ID0); // …et l'ancienne ne peut plus être recréée
    plan.strategyIndex = 1;
    host.ensure();
    await flush();
    expect(host.runningStrategy()?.id).toBe(ID2);
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
    plan.strategyProven = true; // elle a PROUVÉ sa stabilité : règle prudente
    for (let i = 0; i < INFERENCE_ERROR_SWAP_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.runningStrategy()?.id).toBe(ID0); // recréée, pas remplacée
    expect(b.log).toEqual([`création:${ID0}`, `fermeture:${ID0}`, `création:${ID0}`]);
    for (let i = 0; i < INFERENCE_ERROR_SWAP_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.runningStrategy()?.id).toBe(ID1); // la tempête persiste → suivante
    expect(plan.strategyProven).toBe(false);
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
    expect(host.runningStrategy()?.id).toBe(ID0); // 2 erreurs : rien encore
    host.noteInferenceError(); // la 3e élimine
    await flush();
    expect(host.runningStrategy()?.id).toBe(ID1);
    expect(b.log).toEqual([`création:${ID0}`, `fermeture:${ID0}`, `création:${ID1}`]); // fermer AVANT créer
    expect(advances).toEqual([`${ID0}:erreurs`]);
    // Un succès sur la nouvelle marche remet les compteurs : 2 erreurs isolées n'éliminent plus.
    host.noteInferenceCompleted();
    for (let i = 0; i < NEGOTIATION_ERROR_NEXT_AFTER - 1; i++) host.noteInferenceError();
    await flush();
    expect(host.runningStrategy()?.id).toBe(ID1);
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
    expect(host.runningStrategy()?.id).toBe(LAST); // dernière marche du tour, VIVANTE
    // Tout visité : la règle prudente reprend — recréation, puis épuisement.
    for (let i = 0; i < INFERENCE_ERROR_SWAP_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.retryDelayMs()).toBe(0); // la recréation du dernier recours a eu sa chance
    for (let i = 0; i < INFERENCE_ERROR_SWAP_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.state()).toBe('ready');
    expect(host.retryDelayMs()).toBe(STORM_RETRY_MS); // plus rien à essayer → espacement
    expect(b.maxAlive()).toBe(1);
    host.noteInferenceCompleted(); // le pilote revient : plein régime immédiat
    expect(host.retryDelayMs()).toBe(0);
    host.dispose();
  });

  it('🔴 RÉ-AUDIT : catalogue épuisé DEPUIS le cooldown → NOUVEAU TOUR (jamais collé sur la dernière)', async () => {
    const b = bench();
    const plan = initialPlan();
    const host = createModelHost(plan, silent, b.factory);
    host.ensure();
    await flush();
    // Épuiser le catalogue entier (négociation 3 erreurs, puis prudence, puis tempête).
    for (let rung = 1; rung < DETECTION_STRATEGIES.length; rung++) {
      for (let i = 0; i < NEGOTIATION_ERROR_NEXT_AFTER; i++) host.noteInferenceError();
      await flush();
    }
    for (let i = 0; i < 2 * INFERENCE_ERROR_SWAP_AFTER; i++) host.noteInferenceError();
    await flush();
    expect(host.retryDelayMs()).toBe(STORM_RETRY_MS); // épuisé, espacé
    expect(host.runningStrategy()?.id).toBe(LAST); // collé sur la dernière… pour l'instant
    // Le cooldown passe : la PROCHAINE erreur déclenche un tour complet neuf.
    const origNow = performance.now.bind(performance);
    try {
      const jump = origNow() + STORM_RENEGOTIATE_MS + 1_000;
      performance.now = () => jump;
      host.noteInferenceError();
      await flush();
      expect(host.runningStrategy()?.id).toBe(ID0); // reparti du début (rien de prouvé)
      expect(plan.visitedStrategies).toBe(1); // compteur de tour VIERGE
      expect(host.retryDelayMs()).toBe(STORM_RETRY_MS); // le tour neuf reste ESPACÉ
      expect(b.maxAlive()).toBe(1);
    } finally {
      performance.now = origNow;
    }
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
    expect(host.runningStrategy()?.id).toBe(ID0); // le tour continue au début
    expect(host.retryDelayMs()).toBe(0); // 3 visitées sur 10 : rien d'épuisé
    expect(b.maxAlive()).toBe(1);
    host.dispose();
  });

  it('🔴 SONDE : init réussi n’est PAS sain — healthy exige 3 visages VALIDÉS réels', async () => {
    const b = bench();
    const plan = initialPlan();
    const host = createModelHost(plan, silent, b.factory);
    expect(host.health().state).toBe('initializing');
    host.ensure();
    await flush();
    // Créé et adopté, mais JAMAIS sondé : probing, pas healthy.
    expect(host.health()).toMatchObject({ state: 'probing', successes: 0 });
    host.noteValidFace();
    host.noteValidFace();
    expect(host.health()).toMatchObject({ state: 'probing', successes: 2 });
    host.noteValidFace(); // le 3e VISAGE validé prouve la santé
    expect(host.health().state).toBe('healthy');
    // Une RECRÉATION doit re-prouver : la santé ne survit pas à l'instance.
    plan.strategyIndex = 1;
    host.ensure();
    await flush();
    expect(host.health()).toMatchObject({ state: 'probing', successes: 0 });
    host.dispose();
  });

  it('🔴 RÉ-AUDIT : des inférences PROPRES sans visage ne prouvent RIEN — jamais healthy sur du vide', async () => {
    const b = bench();
    const plan = initialPlan();
    const host = createModelHost(plan, silent, b.factory);
    host.ensure();
    await flush();
    // 50 detect() propres qui ne voient PERSONNE : la sonde ne bouge pas.
    for (let i = 0; i < 50; i++) host.noteInferenceCompleted();
    expect(host.health()).toMatchObject({ state: 'probing', successes: 0 });
    host.dispose();
  });

  it('🔴 RÉ-AUDIT : whenProven ne se règle qu’au premier VISAGE — false si démontage sans visage', async () => {
    const b = bench();
    const plan = initialPlan();
    const host = createModelHost(plan, silent, b.factory);
    host.ensure();
    await flush();
    const proven = host.whenProven();
    host.noteInferenceCompleted(); // propre mais vide : ne règle rien
    host.noteValidFace(); // le premier visage validé règle la promesse
    expect(await proven).toBe(true);
    host.dispose();

    const b2 = bench();
    const host2 = createModelHost(initialPlan(), silent, b2.factory);
    host2.ensure();
    await flush();
    const neverProven = host2.whenProven();
    host2.dispose(); // aucun visage jamais vu
    expect(await neverProven).toBe(false);
  });

  it('création PENDUE : le watchdog descend l’échelle, la résolution tardive est FERMÉE', async () => {
    vi.useFakeTimers();
    const b = bench();
    let resolveGpu: ((l: FaceTracker) => void) | null = null;
    const factory: TrackerFactory = (_p, strategy) =>
      strategy.id === DETECTION_STRATEGIES[0]!.id
        ? new Promise<FaceTracker>((res) => {
            resolveGpu = res;
          })
        : Promise.resolve(b.instance(strategy.id));
    const plan = initialPlan();
    const host = createModelHost(plan, silent, factory);
    host.ensure();
    await vi.advanceTimersByTimeAsync(MODEL_CREATE_TIMEOUT_MS + 10);
    expect(host.runningStrategy()?.id).toBe(ID1);
    expect(host.state()).toBe('ready');
    // La création pendue résout APRÈS coup : l'instance est fermée, jamais adoptée.
    expect(resolveGpu).not.toBeNull();
    resolveGpu!(b.instance(ID0));
    await vi.advanceTimersByTimeAsync(1);
    expect(b.log).toContain(`fermeture:${ID0}`);
    expect(b.alive()).toBe(1); // seule la marche suivante vit
    expect(host.runningStrategy()?.id).toBe(ID1);
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
    let resolveGpu: ((l: FaceTracker) => void) | null = null;
    const b = bench();
    const factory: TrackerFactory = () =>
      new Promise<FaceTracker>((res) => {
        resolveGpu = res;
      });
    const plan = initialPlan();
    const host = createModelHost(plan, silent, factory);
    const ready = host.whenReady();
    host.ensure();
    host.dispose();
    expect(resolveGpu).not.toBeNull();
    resolveGpu!(b.instance(ID0));
    await flush();
    expect(b.alive()).toBe(0); // fermée à l'arrivée : rien ne fuit après démontage
    expect(await ready).toBe(false);
  });
});
