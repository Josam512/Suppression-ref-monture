/**
 * tests/deadline.test.ts — le budget caméra est GLOBAL et réellement appliqué
 * (ré-audit A4) : chaque étape (`getUserMedia`, `play`, dimensions) court
 * contre la même échéance via `withDeadline`, et une résolution tardive est
 * remise à l'appelant pour NETTOYAGE (stream fantôme stoppé, point 66).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { withDeadline } from '../src/ui/deadline.js';

describe('withDeadline — chaque étape caméra contre la même échéance (A4)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('résolution avant l’échéance : la valeur passe telle quelle', async () => {
    await expect(withDeadline(Promise.resolve(42), performance.now() + 1000, 'boom')).resolves.toBe(42);
  });

  it('rejet avant l’échéance : l’erreur D’ORIGINE passe, pas celle du délai', async () => {
    await expect(
      withDeadline(Promise.reject(new Error('cause réelle')), performance.now() + 1000, 'boom'),
    ).rejects.toThrow('cause réelle');
  });

  it('jamais de réponse (getUserMedia pendu) : rejet à l’échéance, étape nommée', async () => {
    vi.useFakeTimers();
    const p = withDeadline(
      new Promise<never>(() => {}),
      performance.now() + 500,
      'getUserMedia sans réponse',
    );
    const guard = expect(p).rejects.toThrow(/getUserMedia/);
    await vi.advanceTimersByTimeAsync(600);
    await guard;
  });

  it('résolution TARDIVE : onLate reçoit la valeur pour le nettoyage, le rejet reste', async () => {
    vi.useFakeTimers();
    let resolveLate: ((v: string) => void) | null = null;
    const cleaned: string[] = [];
    const p = withDeadline(
      new Promise<string>((res) => {
        resolveLate = res;
      }),
      performance.now() + 500,
      'trop tard',
      (v) => cleaned.push(v),
    );
    const guard = expect(p).rejects.toThrow('trop tard');
    await vi.advanceTimersByTimeAsync(600);
    await guard;
    expect(resolveLate).not.toBeNull();
    resolveLate!('flux fantôme');
    await vi.advanceTimersByTimeAsync(1);
    expect(cleaned).toEqual(['flux fantôme']); // jamais de stream fantôme (point 66)
  });

  it('échéance déjà consommée par les étapes précédentes : rejet immédiat', async () => {
    vi.useFakeTimers();
    const p = withDeadline(new Promise<never>(() => {}), performance.now() - 1, 'budget épuisé');
    const guard = expect(p).rejects.toThrow('budget épuisé');
    await vi.advanceTimersByTimeAsync(1);
    await guard;
  });
});
