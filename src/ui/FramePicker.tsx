/**
 * ui/FramePicker.tsx — la liste des montures essayables.
 *
 * ⚠️ Aucun tri, aucun filtre, aucun classement, aucune recommandation (§0.0.1).
 * Une monture manifestement trop grande reste essayable : c'est précisément là
 * qu'est la valeur du produit — la personne le VOIT.
 */

import { assertSameModel, type FrameSpec } from '../core/frameSpec.js';

export interface FramePickerProps {
  /** Toutes les montures, coloris compris, dans l'ordre du catalogue. */
  frames: readonly FrameSpec[];
  /** Modèle de référence d'un coloris, pour le garde-fou §11.5. */
  referenceFor(slug: string): FrameSpec | undefined;
  selectedSlug: string | null;
  onSelect(slug: string): void;
  onError(message: string): void;
}

export function FramePicker(props: FramePickerProps): JSX.Element | null {
  if (props.frames.length === 0) return null;

  return (
    <section>
      <h2>Montures essayables</h2>
      <p style={{ opacity: 0.75 }}>
        Toutes les montures sont essayables, y compris celles qui ne sont manifestement pas à votre
        taille : c’est en la voyant que vous le constatez.
      </p>
      {props.frames.map((s) => (
        <button
          key={s.slug}
          type="button"
          onClick={() => {
            const ref = props.referenceFor(s.slug);
            try {
              // Garde-fou §11.5 : un coloris est le MÊME modèle.
              if (ref !== undefined) assertSameModel(ref, s);
              props.onSelect(s.slug);
            } catch (err) {
              props.onError(err instanceof Error ? err.message : String(err));
            }
          }}
          style={{ fontWeight: s.slug === props.selectedSlug ? 700 : 400, marginRight: 8 }}
        >
          {s.slug} · {s.totalWidthMm.toFixed(0)} mm
        </button>
      ))}
    </section>
  );
}
