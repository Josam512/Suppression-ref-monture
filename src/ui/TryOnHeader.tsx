/**
 * ui/TryOnHeader.tsx — le bandeau de l'essayage : version, retour, note V2.
 * Extrait de `TryOn.tsx` pour tenir la règle des 300 lignes (§3). Affichage pur.
 */

import { OVERLAY_PADDING_MM } from '../render/composite.js';
import type { Mode } from './TryOn.js';

export function TryOnHeader(props: { mode: Mode; onQuit(): void }): JSX.Element {
  return (
    <p>
      <button type="button" onClick={props.onQuit}>
        ← Changer de version
      </button>{' '}
      <strong>{props.mode === 'store' ? 'V2 — Mode magasin' : 'V1 — Vente en ligne'}</strong>
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
