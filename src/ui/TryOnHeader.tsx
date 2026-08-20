/**
 * ui/TryOnHeader.tsx — le bandeau de l'essayage : version, retour, note V2.
 * Extrait de `TryOn.tsx` pour tenir la règle des 300 lignes (§3). Affichage pur.
 */

import { OVERLAY_PADDING_MM } from '../render/composite.js';
import type { Mode } from './TryOn.js';

/**
 * Tampon de build, AFFICHÉ à l'écran. Raison d'être : les pages autonomes sont
 * servies par des CDN qui cachent — sans tampon visible, impossible de savoir
 * depuis une capture d'écran si le client teste la version corrigée ou une
 * vieille copie. Trois allers-retours ont été perdus exactement là-dessus.
 */
export const BUILD_TAG = 'b7 · 2026-08-20 18:10';

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
