/**
 * ui/useSprites.ts — chargement d'une monture préparée.
 *
 * `spec.json` passe par `parseFrameSpec` : un champ manquant lève une erreur
 * qui le nomme, jamais une valeur par défaut silencieuse (T4).
 */

import { useEffect, useState } from 'react';
import { parseFrameSpec, type FrameSpec } from '../core/frameSpec.js';
import type { Sprites } from '../render/composite.js';

export type SpritesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; sprites: Sprites; spec: FrameSpec }
  | { status: 'error'; message: string };

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image introuvable : ${url}`));
    img.src = url;
  });
}

export function useSprites(slug: string | null): SpritesState {
  const [state, setState] = useState<SpritesState>({ status: 'idle' });

  useEffect(() => {
    if (slug === null) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });

    void (async () => {
      try {
        const base = `/frames/${slug}`;
        const res = await fetch(`${base}/spec.json`);
        if (!res.ok) throw new Error(`spec.json introuvable pour « ${slug} » (${res.status}).`);

        const spec = parseFrameSpec(await res.json());
        const [front, profile] = await Promise.all([
          loadImage(`${base}/${spec.front}`),
          loadImage(`${base}/${spec.profile}`),
        ]);

        if (cancelled) return;
        setState({
          status: 'ready',
          spec,
          sprites: { front: { img: front, spec }, profile: { img: profile, spec } },
        });
      } catch (err) {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return state;
}
