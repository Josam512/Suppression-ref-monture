/**
 * ui/useSprites.ts — chargement des images d'une monture déjà validée.
 *
 * Guide de fiabilisation (2026-08-21, points 4 et 64) : FRONT et PROFIL sont
 * INDÉPENDANTS. Une photo de profil cassée ou lente ne fait jamais disparaître
 * la face de la monture — elle prive seulement des branches, et c'est dit.
 * Chaque image a son délai ; un échec n'entraîne que sa propre ressource.
 *
 * Les deux emplacements portent l'identité du MÊME `spec` (complément 29) :
 * l'état est reconstruit atomiquement à chaque changement de monture, un front
 * du modèle B ne peut pas cohabiter avec un profil du modèle A — et le jeton
 * `cancelled` coupe les réponses tardives d'une sélection abandonnée
 * (complément 27 : A finit après B → A ne remplace jamais B).
 *
 * Le `spec.json` est passé par `parseFrameSpec` en amont (catalogue) : un champ
 * manquant lève une erreur qui le nomme, jamais une valeur par défaut (T4).
 */

import { useEffect, useState } from 'react';
import type { FrameSpec } from '../core/frameSpec.js';
import { frontAnchorsInImageError, profileAnchorsInImageError } from '../core/specAnchors.js';
import type { FrontSprite } from '../render/composite.js';
import { assetUrl } from './assetUrl.js';

/** Une image de monture qui ne répond pas dans ce délai est déclarée en échec. */
export const SPRITE_TIMEOUT_MS = 20_000;

export type SpriteSlot =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; sprite: FrontSprite }
  | { status: 'error'; message: string };

export interface SpritesState {
  /** Le spec dont les DEUX emplacements portent l'identité (complément 29). */
  spec: FrameSpec | null;
  front: SpriteSlot;
  profile: SpriteSlot;
}

function loadImage(url: string, timeoutMs: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = ''; // stoppe le téléchargement en cours
      reject(new Error(`Image sans réponse après ${timeoutMs / 1000} s : ${url}`));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Image introuvable : ${url}`));
    };
    img.src = url;
  });
}

const IDLE: SpritesState = { spec: null, front: { status: 'idle' }, profile: { status: 'idle' } };

export function useSprites(spec: FrameSpec | null): SpritesState {
  const [state, setState] = useState<SpritesState>(IDLE);

  useEffect(() => {
    if (spec === null) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    setState({ spec, front: { status: 'loading' }, profile: { status: 'loading' } });

    const slot = (key: 'front' | 'profile', next: SpriteSlot): void => {
      if (cancelled) return;
      setState((prev) => (prev.spec === spec ? { ...prev, [key]: next } : prev));
    };

    // ⚠️ `assetUrl` reçoit le chemin COMPLET du fichier, jamais un répertoire
    // auquel on concaténerait un nom : une page autonome sert ses fichiers en
    // `blob:`, et un `blob:…/front.png` ne mène nulle part.
    // ⭐ Point 4 — deux chargements INDÉPENDANTS, chacun son issue.
    // ⭐ A15 — l'image RÉELLE chargée, ses dimensions valident enfin les
    // ancres du spec (specAnchors) : hors image = fiche en erreur, nommée.
    void loadImage(assetUrl(`frames/${spec.slug}/${spec.front}`), SPRITE_TIMEOUT_MS).then(
      (img) => {
        const anchorErr = frontAnchorsInImageError(spec, img.naturalWidth, img.naturalHeight);
        if (anchorErr !== null) slot('front', { status: 'error', message: `« ${spec.slug} » : ${anchorErr}` });
        else slot('front', { status: 'ready', sprite: { img, spec } });
      },
      (err: unknown) =>
        slot('front', { status: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
    void loadImage(assetUrl(`frames/${spec.slug}/${spec.profile}`), SPRITE_TIMEOUT_MS).then(
      (img) => {
        const anchorErr = profileAnchorsInImageError(spec, img.naturalWidth, img.naturalHeight);
        if (anchorErr !== null) slot('profile', { status: 'error', message: `« ${spec.slug} » : ${anchorErr}` });
        else slot('profile', { status: 'ready', sprite: { img, spec } });
      },
      (err: unknown) =>
        slot('profile', { status: 'error', message: err instanceof Error ? err.message : String(err) }),
    );

    return () => {
      cancelled = true;
    };
  }, [spec]);

  return state;
}
