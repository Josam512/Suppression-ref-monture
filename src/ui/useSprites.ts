/**
 * ui/useSprites.ts — chargement des images d'une monture déjà validée.
 *
 * Le `spec.json` est passé par `parseFrameSpec` en amont (catalogue) : un champ
 * manquant lève une erreur qui le nomme, jamais une valeur par défaut (T4).
 */

import { useEffect, useState } from 'react';
import type { FrameSpec } from '../core/frameSpec.js';
import type { Sprites } from '../render/composite.js';
import { assetUrl } from './assetUrl.js';

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

export function useSprites(spec: FrameSpec | null): SpritesState {
  const [state, setState] = useState<SpritesState>({ status: 'idle' });

  useEffect(() => {
    if (spec === null) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });

    void (async () => {
      try {
        // ⚠️ `assetUrl` reçoit le chemin COMPLET du fichier, jamais un
        // répertoire auquel on concaténerait un nom : une page autonome sert
        // ses fichiers en `blob:`, et un `blob:…/front.png` ne mène nulle part.
        const [front, profile] = await Promise.all([
          loadImage(assetUrl(`frames/${spec.slug}/${spec.front}`)),
          loadImage(assetUrl(`frames/${spec.slug}/${spec.profile}`)),
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
  }, [spec]);

  return state;
}
