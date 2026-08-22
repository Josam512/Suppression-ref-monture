/**
 * tests/cataloguespec.test.ts — ré-audit A13/A14/A15 :
 *
 *   - A13 : la PREMIÈRE monture est publiée AVANT ses coloris — un coloris qui
 *     ne répond jamais ne retarde pas la frontale d'une seconde ;
 *   - A14 : chaque coloris passe `assertSameModel` à l'ATTACHE — un coloris du
 *     mauvais modèle est écarté et NOMMÉ, sans attendre le clic ;
 *   - A15 : le parseur de spec est complet (chaînes non vides, nombres finis,
 *     date lisible, angle plausible) et les ancres sont validées contre les
 *     dimensions RÉELLES de l'image au chargement du sprite.
 */

import { describe, expect, it } from 'vitest';

import { parseFrameSpec, type FrameSpec } from '../src/core/frameSpec.js';
import { frontAnchorsInImageError, profileAnchorsInImageError } from '../src/core/specAnchors.js';
import { runCatalogue, type CatalogueSource, type CatalogueState } from '../src/ui/catalogue.js';
import { specForTotalWidthMm } from './fixtures/builders.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('A15 — le parseur de spec ne laisse plus passer', () => {
  const base = (): Record<string, unknown> => ({ ...specForTotalWidthMm(132) }) as unknown as Record<string, unknown>;

  it('un spec complet passe', () => {
    expect(() => parseFrameSpec(base())).not.toThrow();
  });

  it('slug / front / profile vides ou absents → refusés, champ nommé', () => {
    for (const key of ['slug', 'front', 'profile']) {
      expect(() => parseFrameSpec({ ...base(), [key]: '' })).toThrow(new RegExp(key));
      const missing = base();
      delete missing[key];
      expect(() => parseFrameSpec(missing)).toThrow(new RegExp(key));
    }
  });

  it('un point NaN n’est pas une coordonnée (isPt exige des finis)', () => {
    expect(() => parseFrameSpec({ ...base(), bridgeCenter: { x: Number.NaN, y: 10 } })).toThrow(/bridgeCenter/);
    expect(() => parseFrameSpec({ ...base(), hingeProfile: { x: 5, y: Infinity } })).toThrow(/hingeProfile/);
  });

  it('bMm présent mais nul/négatif/NaN → refusé', () => {
    for (const bMm of [0, -3, Number.NaN]) {
      expect(() => parseFrameSpec({ ...base(), bMm })).toThrow(/bMm/);
    }
  });

  it('profileViewAngleDeg implausible → refusé ; ]0°, 90°] accepté', () => {
    for (const bad of [0, -10, 91, 200, Number.NaN]) {
      expect(() => parseFrameSpec({ ...base(), profileViewAngleDeg: bad })).toThrow(/profileViewAngleDeg/);
    }
    expect(() => parseFrameSpec({ ...base(), profileViewAngleDeg: 35 })).not.toThrow();
  });

  it('calibratedAt illisible → refusé (la traçabilité fait partie du contrat)', () => {
    expect(() => parseFrameSpec({ ...base(), calibratedAt: 'pas-une-date' })).toThrow(/calibratedAt/);
    expect(() => parseFrameSpec({ ...base(), calibratedAt: '2026-08-16' })).not.toThrow();
  });
});

describe('A15 — les ancres contre l’image RÉELLE (specAnchors)', () => {
  const spec = specForTotalWidthMm(132); // bbox : x=20, w=1584 → image ≥ 1604 px

  it('image assez grande : aucune erreur', () => {
    expect(frontAnchorsInImageError(spec, 1700, 600)).toBeNull();
    expect(profileAnchorsInImageError(spec, 400, 200)).toBeNull();
  });

  it('bbox qui déborde de l’image réelle → nommée (bbox périmée ou image remplacée)', () => {
    expect(frontAnchorsInImageError(spec, 1000, 600)).toMatch(/alphaBBox/);
  });

  it('ancre hors de l’image réelle → nommée', () => {
    const bad: FrameSpec = { ...spec, lensCenterR: { x: 5000, y: 286 } };
    expect(frontAnchorsInImageError(bad, 1700, 600)).toMatch(/lensCenterR/);
    const badHinge: FrameSpec = { ...spec, hingeProfile: { x: 96, y: 900 } };
    expect(profileAnchorsInImageError(badHinge, 400, 200)).toMatch(/hingeProfile/);
  });
});

describe('A13/A14 — le catalogue publie la première fiche AVANT ses coloris', () => {
  const REF = specForTotalWidthMm(132, { slug: 'modele' });
  const COLORWAY_OK = { ...specForTotalWidthMm(132, { slug: 'modele-bleu' }) };
  const WRONG_MODEL = { ...specForTotalWidthMm(132, { slug: 'intrus' }), aMm: 60 }; // ≠ modèle

  function sourceOf(specs: Record<string, FrameSpec | (() => Promise<FrameSpec>)>, frames: unknown): CatalogueSource {
    return {
      index: () => Promise.resolve(frames),
      spec: (slug) => {
        const v = specs[slug];
        if (v === undefined) return Promise.reject(new Error(`« ${slug} » introuvable (banc).`));
        return typeof v === 'function' ? v() : Promise.resolve(v);
      },
    };
  }

  it('🔴 A13 — un coloris qui ne répond JAMAIS ne retarde pas la première monture', async () => {
    const states: CatalogueState[] = [];
    const never = (): Promise<FrameSpec> => new Promise<FrameSpec>(() => {});
    const run = runCatalogue(
      sourceOf({ modele: REF, 'modele-bleu': never }, { frames: [{ slug: 'modele', colorways: ['modele-bleu'] }] }),
      (s) => states.push(s),
      () => false,
    );
    await tick(); // le coloris, lui, ne résoudra jamais
    const ready = states.find((s) => s.status === 'ready');
    expect(ready).toBeDefined(); // la frontale est PUBLIÉE…
    if (ready?.status === 'ready') {
      expect(ready.entries[0]?.spec.slug).toBe('modele');
      expect(ready.entries[0]?.colorways).toEqual([]); // …sans attendre le coloris
      expect(ready.loadingRest).toBe(true); // et le travail restant est DIT
    }
    void run; // le run reste pendu sur le coloris : c'est le scénario
  });

  it('coloris conforme attaché ensuite ; loadingRest retombe', async () => {
    const states: CatalogueState[] = [];
    await runCatalogue(
      sourceOf(
        { modele: REF, 'modele-bleu': COLORWAY_OK },
        { frames: [{ slug: 'modele', colorways: ['modele-bleu'] }] },
      ),
      (s) => states.push(s),
      () => false,
    );
    const final = states[states.length - 1];
    expect(final?.status).toBe('ready');
    if (final?.status === 'ready') {
      expect(final.entries[0]?.colorways.map((c) => c.slug)).toEqual(['modele-bleu']);
      expect(final.loadingRest).toBe(false);
    }
    // Et la première publication n'avait PAS les coloris (A13).
    const firstReady = states.find((s) => s.status === 'ready');
    if (firstReady?.status === 'ready') expect(firstReady.entries[0]?.colorways).toEqual([]);
  });

  it('🔴 A14 — un coloris du MAUVAIS modèle est écarté à l’attache, et nommé', async () => {
    const states: CatalogueState[] = [];
    await runCatalogue(
      sourceOf({ modele: REF, intrus: WRONG_MODEL }, { frames: [{ slug: 'modele', colorways: ['intrus'] }] }),
      (s) => states.push(s),
      () => false,
    );
    const final = states[states.length - 1];
    if (final?.status === 'ready') {
      expect(final.entries[0]?.colorways).toEqual([]); // jamais listé
      expect(final.failures.join(' ')).toMatch(/intrus/);
      expect(final.failures.join(' ')).toMatch(/mauvais modèle/i);
    } else {
      throw new Error('état final inattendu');
    }
  });

  it('le reste de l’inventaire arrive en arrière-plan, les fiches mortes isolées', async () => {
    const states: CatalogueState[] = [];
    await runCatalogue(
      sourceOf(
        { modele: REF, autre: specForTotalWidthMm(140, { slug: 'autre' }) },
        { frames: [{ slug: 'modele' }, { slug: 'autre' }, { slug: 'fantome' }] },
      ),
      (s) => states.push(s),
      () => false,
    );
    const final = states[states.length - 1];
    if (final?.status === 'ready') {
      expect(final.entries.map((e) => e.spec.slug)).toEqual(['modele', 'autre']);
      expect(final.failures.join(' ')).toMatch(/fantome/);
      expect(final.loadingRest).toBe(false);
    } else {
      throw new Error('état final inattendu');
    }
  });

  it('inventaire mort → état d’erreur qui dit quoi faire', async () => {
    const states: CatalogueState[] = [];
    await runCatalogue(
      { index: () => Promise.reject(new Error('réseau coupé')), spec: () => Promise.reject(new Error('n/a')) },
      (s) => states.push(s),
      () => false,
    );
    expect(states[states.length - 1]?.status).toBe('error');
  });
});
