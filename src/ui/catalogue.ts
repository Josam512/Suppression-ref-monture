/**
 * ui/catalogue.ts — inventaire des montures préparées.
 *
 * ⚠️ « Catalogue » veut dire INVENTAIRE, pas sélection. Rien n'est trié, filtré,
 * classé ni recommandé (§0.0.1). Toute monture listée est essayable à tout
 * moment, y compris une manifestement trop grande : c'est précisément là qu'est
 * la valeur, puisque la personne le voit.
 *
 * Guide de fiabilisation (2026-08-21, points 5 et 64) :
 *
 *   - le catalogue ENTIER ne bloque jamais la première monture : l'index est
 *     lu, le modèle par défaut (le premier) est chargé et PUBLIÉ aussitôt, le
 *     reste arrive en arrière-plan (`allSettled`, jamais un `Promise.all`
 *     fatal) ;
 *   - une fiche défectueuse est UNE monture invalide, pas une application
 *     invalide : elle est écartée et nommée dans `failures` ;
 *   - chaque fetch a un délai et une isolation : rien ne reste « loading »
 *     pour l'éternité.
 */

import { useEffect, useState } from 'react';
import { parseFrameSpec, type FrameSpec } from '../core/frameSpec.js';
import { assetUrl } from './assetUrl.js';

/** Un fichier d'inventaire ou une fiche qui ne répond pas dans ce délai a échoué. */
export const CATALOGUE_FETCH_TIMEOUT_MS = 15_000;

export interface CatalogueEntry {
  spec: FrameSpec;
  /** Coloris rattachés au même modèle (V2). Vide en V1. */
  colorways: FrameSpec[];
}

export type CatalogueState =
  | { status: 'loading' }
  | {
      status: 'ready';
      entries: CatalogueEntry[];
      /** Vrai tant que le reste de l'inventaire charge en arrière-plan. */
      loadingRest: boolean;
      /** Fiches écartées, nommées — une par ligne, affichables telles quelles. */
      failures: string[];
    }
  | { status: 'error'; message: string };

interface IndexFile {
  frames: Array<{ slug: string; colorways?: string[] }>;
}

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

async function loadSpec(slug: string): Promise<FrameSpec> {
  return parseFrameSpec(await fetchJsonWithTimeout(assetUrl(`frames/${slug}/spec.json`), `spec.json de « ${slug} »`));
}

/** Charge une entrée : la fiche principale, puis ses coloris — chacun isolé. */
async function loadEntry(
  f: { slug: string; colorways?: string[] },
  failures: string[],
): Promise<CatalogueEntry | null> {
  let spec: FrameSpec;
  try {
    spec = await loadSpec(f.slug);
  } catch (err) {
    failures.push(`« ${f.slug} » écartée : ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const colorways: FrameSpec[] = [];
  const settled = await Promise.allSettled((f.colorways ?? []).map(loadSpec));
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') colorways.push(r.value);
    else {
      const slug = f.colorways?.[i] ?? '?';
      failures.push(`coloris « ${slug} » écarté : ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    }
  });
  return { spec, colorways };
}

export function useCatalogue(): CatalogueState {
  const [state, setState] = useState<CatalogueState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let index: IndexFile;
      try {
        index = (await fetchJsonWithTimeout(assetUrl('frames/index.json'), 'inventaire frames/index.json')) as IndexFile;
        if (!Array.isArray(index.frames)) throw new Error('inventaire malformé (champ « frames » absent).');
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            message:
              (err instanceof Error ? err.message : String(err)) +
              ` Préparer au moins une monture avec l'outil de détourage (prep.html).`,
          });
        }
        return;
      }

      const failures: string[] = [];
      const [first, ...rest] = index.frames;
      if (first === undefined) {
        if (!cancelled) setState({ status: 'ready', entries: [], loadingRest: false, failures });
        return;
      }

      // ⭐ Point 5 — le modèle PAR DÉFAUT d'abord, publié dès qu'il est prêt.
      const firstEntry = await loadEntry(first, failures);
      if (cancelled) return;
      const entries = firstEntry !== null ? [firstEntry] : [];
      setState({ status: 'ready', entries: [...entries], loadingRest: rest.length > 0, failures: [...failures] });

      if (rest.length === 0) return;
      const settled = await Promise.allSettled(rest.map((f) => loadEntry(f, failures)));
      if (cancelled) return;
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value !== null) entries.push(r.value);
        else if (r.status === 'rejected') {
          failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        }
      }
      setState({ status: 'ready', entries: [...entries], loadingRest: false, failures: [...failures] });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
