/**
 * ui/WornFrameCalibration.tsx — V2 mode magasin, lot V2-3 (CLAUDE.md §11.7).
 *
 * Le client porte PHYSIQUEMENT une monture du magasin, dont les cotes sont
 * connues. Elle sert d'étalon vivant dans le flux vidéo, à la place de la carte
 * bancaire de la V1. L'opticien pointe ses deux bords externes.
 *
 * C'est la source la plus précise des trois — 2 % (T8), contre 2,5 % pour la
 * carte et 4,3 % pour l'iris.
 */

import { useState } from 'react';
import type { FrameSpec } from '../core/frameSpec.js';
import { TwoPointMeasure } from './TwoPointMeasure.js';

export interface WornFrameCalibrationProps {
  frozen: HTMLCanvasElement;
  /** Montures du magasin dont les cotes réelles sont connues. */
  catalogue: readonly FrameSpec[];
  onValidate(wornFrameWidthPx: number, wornFrameSpec: FrameSpec): void;
  onCancel(): void;
}

export function WornFrameCalibration(props: WornFrameCalibrationProps): JSX.Element {
  const [widthPx, setWidthPx] = useState(0);
  const [slug, setSlug] = useState<string>(props.catalogue[0]?.slug ?? '');

  const worn = props.catalogue.find((s) => s.slug === slug) ?? null;

  return (
    <section>
      <h2>Étalonnage sur la monture portée</h2>
      <p>
        Le client porte une monture du magasin. Sélectionnez le modèle, puis pointez ses{' '}
        <strong>deux bords externes</strong>.
      </p>

      <label>
        Monture réellement portée{' '}
        <select value={slug} onChange={(e) => setSlug(e.target.value)}>
          {props.catalogue.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.slug} — {s.totalWidthMm.toFixed(1)} mm
            </option>
          ))}
        </select>
      </label>

      <TwoPointMeasure frozen={props.frozen} guideY={0.45} onChange={setWidthPx} />

      {worn !== null && widthPx > 0 && (
        <p>
          {widthPx.toFixed(0)} px pour {worn.totalWidthMm.toFixed(1)} mm réels →{' '}
          {(widthPx / worn.totalWidthMm).toFixed(2)} px/mm
        </p>
      )}

      <button
        type="button"
        disabled={worn === null || widthPx <= 0}
        onClick={() => {
          if (worn !== null) props.onValidate(widthPx, worn);
        }}
      >
        Étalonner
      </button>{' '}
      <button type="button" onClick={props.onCancel}>
        Annuler
      </button>
    </section>
  );
}
