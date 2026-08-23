/**
 * tests/detectionmemory.test.ts — la stratégie négociée, mémorisée par
 * APPAREIL (arbitrage 2026-08-22).
 *
 * Enveloppe versionnée, id revalidé contre le catalogue, stockage mort toléré
 * — et la clé fait partie de la purge `?resetSession=1` (bancs déterministes).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DETECTION_MEMORY_VERSION,
  DETECTION_STORAGE_KEY,
  loadNegotiatedStrategy,
  saveNegotiatedStrategy,
} from '../src/ui/detectionMemory.js';
import { SESSION_STORAGE_KEYS } from '../src/ui/calibrationStorage.js';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe('detectionMemory — la stratégie prouvée, par appareil', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('aller-retour : la stratégie stable mémorisée est relue telle quelle', () => {
    expect(loadNegotiatedStrategy()).toBeNull(); // appareil jamais négocié
    saveNegotiatedStrategy('cpu');
    expect(loadNegotiatedStrategy()).toBe('cpu');
    saveNegotiatedStrategy('gpu-canvas'); // remplacée si une autre devient stable
    expect(loadNegotiatedStrategy()).toBe('gpu-canvas');
  });

  it('une VERSION d’enveloppe inconnue rend null : on renégocie, on ne devine pas', () => {
    localStorage.setItem(
      DETECTION_STORAGE_KEY,
      JSON.stringify({ v: DETECTION_MEMORY_VERSION + 1, strategyId: 'cpu' }),
    );
    expect(loadNegotiatedStrategy()).toBeNull();
  });

  it('un id ABSENT du catalogue (catalogue remanié) rend null', () => {
    localStorage.setItem(
      DETECTION_STORAGE_KEY,
      JSON.stringify({ v: DETECTION_MEMORY_VERSION, strategyId: 'strategie-disparue' }),
    );
    expect(loadNegotiatedStrategy()).toBeNull();
  });

  it('un JSON corrompu rend null, jamais une exception', () => {
    localStorage.setItem(DETECTION_STORAGE_KEY, '{brisé');
    expect(loadNegotiatedStrategy()).toBeNull();
  });

  it('stockage MORT : lecture null, écriture silencieuse — jamais une panne', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(loadNegotiatedStrategy()).toBeNull();
    expect(() => saveNegotiatedStrategy('cpu')).not.toThrow();
  });

  it('resetSession purge AUSSI cette mémoire : les bancs renégocient à vierge', () => {
    expect(SESSION_STORAGE_KEYS).toContain(DETECTION_STORAGE_KEY);
  });
});
