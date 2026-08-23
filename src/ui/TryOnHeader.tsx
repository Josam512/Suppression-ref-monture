/**
 * ui/TryOnHeader.tsx — le bandeau de l'essayage : version, retour, note V2.
 * Extrait de `TryOn.tsx` pour tenir la règle des 300 lignes (§3). Affichage pur.
 */

import { OVERLAY_PADDING_MM } from '../render/composite.js';
import { APP_BUILD_TAG, GIT_SHA } from '../core/versions.js';
import type { Mode } from './TryOn.js';

/** Tampon de build (complément 43) + SHA — 🔴 ré-audit 2026-08-23 : le SHA au
 *  BANDEAU, pas seulement au HUD : une capture d'écran client dit LE commit. */
export const BUILD_TAG = `${APP_BUILD_TAG} · ${GIT_SHA}`;

export function TryOnHeader(props: { mode: Mode; onQuit(): void }): JSX.Element {
  return (
    <p>
      <button type="button" onClick={props.onQuit}>
        ↺ Recommencer
      </button>{' '}
      <strong>Essayage</strong>
      <span style={{ opacity: 0.55, fontSize: '.8em' }}> · {BUILD_TAG}</span>
      {props.mode === 'store' && (
        <span style={{ opacity: 0.75 }}>
          {' '}
          — sprite dilaté de {OVERLAY_PADDING_MM} mm pour couvrir la monture réelle portée
          dessous. La silhouette est épaissie ; la largeur mesurée, elle, reste exacte.
        </span>
      )}
    </p>
  );
}
