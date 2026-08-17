/**
 * ui/CardManual.tsx — le filet : quand le cadre ne prend pas, on pointe à la main.
 *
 * ## Pourquoi ce fichier existe
 *
 * Le parcours nominal est le cadre à remplir (`ui/cardGuideStep.ts`) : rien à
 * cliquer, la mesure se prend seule. Mais il peut ne pas aboutir — carte sombre
 * sur peau sombre, contre-jour, webcam très floue, main qui masque un bord.
 *
 * 🔴 Sans issue, l'étape tourne alors **indéfiniment** et le seul bouton est
 * « Annuler », qui met le client dehors. C'est un cul-de-sac, et un cul-de-sac
 * est pire qu'une mesure moins bonne : il interdit l'essayage, ce que le §0.0.2
 * refuse explicitement. Ce composant est donc la porte de sortie, et elle est
 * toujours accessible — au bout de `GUIDE_STALL_MS`, ou immédiatement si le
 * client le demande.
 *
 * ⚠️ Ce n'est PAS un réglage d'échelle (§1 bug #1). Le client pointe les bords
 * d'un objet dont la cote est connue au centième de millimètre par la norme ISO ;
 * il ne choisit pas la taille de sa tête. Et `core/cardEdges.ts` reprend ensuite
 * ses deux points pour les accrocher au dixième de pixel : son geste est une
 * graine, pas une mesure.
 */

import { useState } from 'react';
import type { Pt } from '../core/geom.js';
import { ISO_ID1_OBJECTS } from '../core/calibration.js';
import { TwoPointMeasure } from './TwoPointMeasure.js';
import { CARD_H_MM, CARD_W_MM, type CardQuad } from '../core/cardPose.js';

export interface CardManualProps {
  frozen: HTMLCanvasElement;
  onValidate(cardWidthPx: number, quad: CardQuad): void;
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
      <h2>Pas de souci — placez les deux repères vous-même</h2>

      <p>
        Le cadre n’a pas réussi à accrocher votre carte. Amenez simplement les deux poignées sur
        ses bords gauche et droit : c’est aussi précis, ça prend cinq secondes de plus.
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
      >
        Valider — vous pourrez ranger votre carte
      </button>{' '}
      <button type="button" onClick={props.onRetry}>
        Réessayer avec le cadre
      </button>
    </section>
  );
}
