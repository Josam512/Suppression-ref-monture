/**
 * ui/catalogue.ts — inventaire des montures préparées.
 *
 * ⚠️ « Catalogue » veut dire INVENTAIRE, pas sélection. Rien n'est trié, filtré,
 * classé ni recommandé (§0.0.1). Toute monture listée est essayable à tout
 * moment, y compris une manifestement trop grande : c'est précisément là qu'est
 * la valeur, puisque la personne le voit.
 *
 * Guide de fiabilisation (points 5 et 64), resserré par le ré-audit A13/A14 :
 *
 *   - le catalogue ENTIER ne bloque jamais la première monture : l'index est
 *     lu, le modèle par défaut (le premier) est chargé et PUBLIÉ aussitôt —
 *     🔴 AVANT ses coloris (A13) : un coloris à 15 s ne retarde plus la
 *     première frontale d'une seconde. Coloris et reste de l'inventaire
 *     arrivent en arrière-plan (`allSettled`, jamais un `Promise.all` fatal) ;
 *   - 🔴 A14 — chaque coloris passe `assertSameModel` À L'ATTACHE : un coloris
 *     rattaché au mauvais modèle est écarté et NOMMÉ dans `failures`, il
 *     n'attend pas le clic pour échouer (le garde au clic, lui, reste) ;
 *   - une fiche défectueuse est UNE monture invalide, pas une application
 *     invalide ; chaque fetch a un délai et une isolation.
 *
 * L'orchestration (`runCatalogue`) est PURE vis-à-vis du réseau (source
 * injectée) : le banc unitaire prouve « frontale publiée avant les coloris »
 * sans navigateur.
 */

import { useEffect, useState } from 'react';
import { assertSameModel, parseFrameSpec, type FrameSpec } from '../core/frameSpec.js';
import { assetUrl } from './assetUrl.js';

/** Un fichier d'inventaire ou une fiche qui ne répond pas dans ce délai a échoué. */
export const CATALOGUE_FETCH_TIMEOUT_MS = 15_000;

export interface CatalogueEntry {
  spec: FrameSpec;
  /** Coloris rattachés au même modèle (V2). Vide en V1, ou en cours d'attache. */
  colorways: FrameSpec[];
}

export type CatalogueState =
  | { status: 'loading' }
  | {
      status: 'ready';
      entries: CatalogueEntry[];
      /** Vrai tant que coloris ou reste de l'inventaire chargent en arrière-plan. */
      loadingRest: boolean;
      /** Fiches écartées, nommées — une par ligne, affichables telles quelles. */
      failures: string[];
    }
  | { status: 'error'; message: string };

interface IndexFile {
  frames: Array<{ slug: string; colorways?: string[] }>;
}

/** L'accès aux fichiers, injectable — le banc simule lenteurs et pannes. */
export interface CatalogueSource {
  index(): Promise<unknown>;
  spec(slug: string): Promise<FrameSpec>;
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function fetchJsonWithTimeout(url: string, what: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CATALOGUE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${what} introuvable (${res.status}).`);
    return (await res.json()) as unknown;
  } catch (err) {
    if (ctrl.signal.aborted) {
      throw new Error(`${what} sans réponse après ${CATALOGUE_FETCH_TIMEOUT_MS / 1000} s.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const networkSource: CatalogueSource = {
  index: () => fetchJsonWithTimeout(assetUrl('frames/index.json'), 'inventaire frames/index.json'),
  spec: async (slug) =>
    parseFrameSpec(await fetchJsonWithTimeout(assetUrl(`frames/${slug}/spec.json`), `spec.json de « ${slug} »`)),
};

/** ⭐ A14 — attache les coloris d'un modèle : chargés, VÉRIFIÉS, ou nommés. */
async function loadColorways(
  source: CatalogueSource,
  ref: FrameSpec,
  slugs: readonly string[],
  failures: string[],
): Promise<FrameSpec[]> {
  const out: FrameSpec[] = [];
  const settled = await Promise.allSettled(slugs.map((s) => source.spec(s)));
  settled.forEach((r, i) => {
    const slug = slugs[i] ?? '?';
    if (r.status === 'rejected') {
      failures.push(`coloris « ${slug} » écarté : ${errText(r.reason)}`);
      return;
    }
    try {
      assertSameModel(ref, r.value); // un coloris est le MÊME modèle (§11.5)
      out.push(r.value);
    } catch (err) {
      failures.push(`coloris « ${slug} » écarté : ${errText(err)}`);
    }
  });
  return out;
}

/** Charge une entrée COMPLÈTE (fiche + coloris vérifiés) — pour l'arrière-plan. */
async function loadEntry(
  source: CatalogueSource,
  f: { slug: string; colorways?: string[] },
  failures: string[],
): Promise<CatalogueEntry | null> {
  let spec: FrameSpec;
  try {
    spec = await source.spec(f.slug);
  } catch (err) {
    failures.push(`« ${f.slug} » écartée : ${errText(err)}`);
    return null;
  }
  return { spec, colorways: await loadColorways(source, spec, f.colorways ?? [], failures) };
}

/**
 * L'orchestration du catalogue, source injectée. Publie : la PREMIÈRE fiche
 * dès qu'elle est prête (A13), puis ses coloris, puis le reste — chaque étape
 * par un nouvel état, `loadingRest` disant s'il reste du travail.
 */
export async function runCatalogue(
  source: CatalogueSource,
  publish: (state: CatalogueState) => void,
  isCancelled: () => boolean,
): Promise<void> {
  let index: IndexFile;
  try {
    index = (await source.index()) as IndexFile;
    if (!Array.isArray(index.frames)) throw new Error('inventaire malformé (champ « frames » absent).');
  } catch (err) {
    if (!isCancelled()) {
      publish({
        status: 'error',
        message: `${errText(err)} Préparer au moins une monture avec l'outil de détourage (prep.html).`,
      });
    }
    return;
  }

  const failures: string[] = [];
  const [first, ...rest] = index.frames;
  if (first === undefined) {
    if (!isCancelled()) publish({ status: 'ready', entries: [], loadingRest: false, failures });
    return;
  }

  const entries: CatalogueEntry[] = [];
  let firstEntry: CatalogueEntry | null = null;
  try {
    firstEntry = { spec: await source.spec(first.slug), colorways: [] };
    entries.push(firstEntry);
  } catch (err) {
    failures.push(`« ${first.slug} » écartée : ${errText(err)}`);
  }
  if (isCancelled()) return;

  const firstColorways = firstEntry !== null ? (first.colorways ?? []) : [];
  let colorwaysDone = firstColorways.length === 0;
  let restDone = rest.length === 0;
  const publishNow = (): void => {
    if (isCancelled()) return;
    publish({
      status: 'ready',
      entries: entries.map((e) => ({ ...e })),
      loadingRest: !(colorwaysDone && restDone),
      failures: [...failures],
    });
  };
  // ⭐ A13 — LA publication qui compte : la première monture, SANS ses coloris.
  publishNow();

  const jobs: Array<Promise<void>> = [];
  if (!colorwaysDone) {
    jobs.push(
      loadColorways(source, firstEntry!.spec, firstColorways, failures).then((cw) => {
        firstEntry!.colorways = cw;
        colorwaysDone = true;
        publishNow();
      }),
    );
  }
  if (!restDone) {
    jobs.push(
      Promise.allSettled(rest.map((f) => loadEntry(source, f, failures))).then((settled) => {
        for (const r of settled) {
          if (r.status === 'fulfilled' && r.value !== null) entries.push(r.value);
          else if (r.status === 'rejected') failures.push(errText(r.reason));
        }
        restDone = true;
        publishNow();
      }),
    );
  }
  await Promise.all(jobs);
}

export function useCatalogue(): CatalogueState {
  const [state, setState] = useState<CatalogueState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void runCatalogue(networkSource, setState, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
