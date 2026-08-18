/**
 * ui/CardManual.tsx — le pointage des deux bords, sur image figée.
 *
 * ## Ce n'est plus un filet : c'est le parcours normal
 *
 * Ce composant était le repli du cadre à remplir. Le cadre a été supprimé
 * (arbitrage humain du 2026-08-18) : le pointage devient donc l'étape unique et
 * nominale, et son texte ne s'excuse plus de rien.
 *
 * 🔴 Ce qui rend ce geste acceptable pour une personne seule chez elle : il se
 * fait sur une image ARRÊTÉE, sans chronomètre, et il n'a pas besoin d'être
 * précis. `core/cardEdges.ts` reprend ensuite les deux repères et les accroche
 * sur les vrais bords au dixième de pixel. Le geste du client est une graine,
 * pas une mesure.
 *
 * ⚠️ Ce n'est PAS un réglage d'échelle (§1 bug #1). Le client pointe les bords
 * d'un objet dont la cote est connue au centième de millimètre par la norme ISO ;
 * il ne choisit pas la taille de sa tête, et rien à l'écran ne bouge quand il
 * déplace un repère — sinon la taille de la carte, qui n'est pas la sienne.
 */

import { useState } from 'react';
import type { Pt } from '../core/geom.js';
import { ISO_ID1_OBJECTS } from '../core/calibration.js';
import { TwoPointMeasure } from './TwoPointMeasure.js';
import { CARD_H_MM, CARD_W_MM, type CardQuad } from '../core/cardPose.js';

export interface CardManualProps {
  frozen: HTMLCanvasElement;
  onValidate(cardWidthPx: number, quad: CardQuad): void;
  /** Reprendre l'image : la carte était mal placée, ou le visage a bougé. */
  onRetry(): void;
}

export function CardManual(props: CardManualProps): JSX.Element {
  const [widthPx, setWidthPx] = useState(0);
  const [edges, setEdges] = useState<{ a: Pt; b: Pt } | null>(null);

  /**
   * Le quadrilatère déduit des deux poignées, en supposant la ligne de guidage à
   * mi-hauteur de la carte et ses proportions ISO.
   *
   * ⚠️ Une GRAINE, rien de plus : `core/cardEdges.ts` l'accroche ensuite sur les
   * vrais bords. Le client n'a donc pas à être précis — seul niveau d'exigence
   * acceptable pour une personne seule chez elle.
   */
  const quad: CardQuad | null =
    edges === null
      ? null
      : (() => {
          const half = (Math.abs(edges.b.x - edges.a.x) * CARD_H_MM) / CARD_W_MM / 2;
          return [
            { x: edges.a.x, y: edges.a.y - half },
            { x: edges.b.x, y: edges.b.y - half },
            { x: edges.b.x, y: edges.b.y + half },
            { x: edges.a.x, y: edges.a.y + half },
          ] as CardQuad;
        })();

  return (
    <section>
      <h2>Placez les deux repères sur les bords de votre carte</h2>

      <p>
        L’image est arrêtée : prenez votre temps. Amenez les deux poignées sur le{' '}
        <strong>bord gauche</strong> et le <strong>bord droit</strong> de la carte.{' '}
        <span style={{ opacity: 0.75 }}>
          À quelques pixels près, c’est suffisant — je recale ensuite sur les bords réels.
        </span>
      </p>

      <TwoPointMeasure
        frozen={props.frozen}
        onChange={setWidthPx}
        onEdges={(a, b) => setEdges({ a, b })}
        blocker={null}
      />

      <p style={{ opacity: 0.75 }}>
        {ISO_ID1_OBJECTS[0]}, {ISO_ID1_OBJECTS[1]}, {ISO_ID1_OBJECTS[2]} ou {ISO_ID1_OBJECTS[3]} :
        toutes font exactement le même format normalisé.
      </p>

      <button
        type="button"
        disabled={widthPx <= 0 || quad === null}
        onClick={() => quad !== null && props.onValidate(widthPx, quad)}
        style={{ fontWeight: 700 }}
      >
        C’est bon — on filme
      </button>{' '}
      <button type="button" onClick={props.onRetry}>
        Reprendre l’image
      </button>
    </section>
  );
}
