/**
 * ui/catalogue.ts — inventaire des montures préparées.
 *
 * ⚠️ « Catalogue » veut dire INVENTAIRE, pas sélection. Rien n'est trié, filtré,
 * classé ni recommandé (§0.0.1). Toute monture listée est essayable à tout
 * moment, y compris une manifestement trop grande : c'est précisément là qu'est
 * la valeur, puisque la personne le voit.
 */

import { useEffect, useState } from 'react';
import { parseFrameSpec, type FrameSpec } from '../core/frameSpec.js';
import { assetUrl } from './assetUrl.js';

export interface CatalogueEntry {
  spec: FrameSpec;
  /** Coloris rattachés au même modèle (V2). Vide en V1. */
  colorways: FrameSpec[];
}

export type CatalogueState =
  | { status: 'loading' }
  | { status: 'ready'; entries: CatalogueEntry[] }
  | { status: 'error'; message: string };

interface IndexFile {
  frames: Array<{ slug: string; colorways?: string[] }>;
}

async function loadSpec(slug: string): Promise<FrameSpec> {
  const res = await fetch(assetUrl(`frames/${slug}/spec.json`));
  if (!res.ok) throw new Error(`spec.json introuvable pour « ${slug} » (${res.status}).`);
  return parseFrameSpec(await res.json());
}

export function useCatalogue(): CatalogueState {
  const [state, setState] = useState<CatalogueState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(assetUrl('frames/index.json'));
        if (!res.ok) {
          throw new Error(
            `Aucun inventaire dans public/frames/index.json (${res.status}). ` +
              `Préparer au moins une monture avec l'outil de détourage (prep.html).`,
          );
        }
        const index = (await res.json()) as IndexFile;

        const entries = await Promise.all(
          index.frames.map(async (f) => ({
            spec: await loadSpec(f.slug),
            colorways: await Promise.all((f.colorways ?? []).map(loadSpec)),
          })),
        );

        if (!cancelled) setState({ status: 'ready', entries });
      } catch (err) {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
