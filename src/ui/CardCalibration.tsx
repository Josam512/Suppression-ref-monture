/**
 * ui/CardCalibration.tsx — V1, calibration carte bancaire (CLAUDE.md §4, niveau 2).
 *
 * Deux secondes, une seule fois, puis la carte disparaît définitivement.
 */

import { useState } from 'react';
import type { Pt } from '../core/geom.js';
import {
  ISO_ID1_OBJECTS,
  estimateDistanceMm,
  parallaxRelErrorFromCard,
} from '../core/calibration.js';
import { TwoPointMeasure } from './TwoPointMeasure.js';
import { CARD_H_MM, CARD_W_MM, type CardQuad } from '../core/cardPose.js';

export interface CardCalibrationProps {
  frozen: HTMLCanvasElement;
  onValidate(cardWidthPx: number, quad: CardQuad): void;
  onCancel(): void;
}

export function CardCalibration(props: CardCalibrationProps): JSX.Element {
  const [widthPx, setWidthPx] = useState(0);
  const [edges, setEdges] = useState<{ a: Pt; b: Pt } | null>(null);

  /**
   * Le quadrilatère déduit des deux poignées, en supposant la ligne de guidage
   * à mi-hauteur de la carte et ses proportions ISO.
   *
   * ⚠️ Ce n'est qu'une GRAINE : `core/cardEdges.ts` l'accroche ensuite sur les
   * vrais bords, au dixième de pixel. Le client n'a donc pas à être précis — ce
   * qui est bien le seul niveau d'exigence acceptable pour un client à distance.
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

  const imageWidth = props.frozen.width;
  // ⭐ Plus de « trop près » : on CHIFFRE la marge au lieu de bloquer le client
  // (core/cardOptics.ts, parallaxRelErrorAt). Rien n'est refusé.
  const parallaxPct = widthPx > 0 ? 100 * parallaxRelErrorFromCard(widthPx, imageWidth) : null;
  const distanceCm = widthPx > 0 ? estimateDistanceMm(widthPx, imageWidth) / 10 : null;

  return (
    <section>
      <h2>Mesure avec une carte bancaire</h2>

      {/*
        ⚠️ Première consigne, avant toute autre. Un client qui garde ses lunettes
        casse la mesure de TROIS façons à la fois : ses branches passent
        exactement sur la ligne où l'on cherche le bord de sa tête, ses verres
        modifient de 10 % la taille apparente de son iris (§4, correctif S2), et
        l'essayage lui-même devient illisible avec une monture réelle sous la
        monture virtuelle. Le code sait détecter le premier cas et le refuse —
        mais il vaut mieux l'éviter que le rattraper.
      */}
      <p style={{ fontWeight: 700 }}>
        Retirez vos lunettes, si vous en portez.
        <span style={{ fontWeight: 400, opacity: 0.75 }}>
          {' '}
          Leurs branches passent à l’endroit exact où votre tête est mesurée : je mesurerais votre
          monture au lieu de votre visage.
        </span>
      </p>

      <p>
        Posez une carte bancaire <strong>à plat sur votre front</strong>, bord horizontal, et
        regardez droit devant vous. Amenez les deux poignées sur les bords de la carte.
      </p>

      <TwoPointMeasure
        frozen={props.frozen}
        onChange={setWidthPx}
        onEdges={(a, b) => setEdges({ a, b })}
        blocker={null}
      />

      <p>
        Vous pouvez utiliser {ISO_ID1_OBJECTS[0]}, {ISO_ID1_OBJECTS[1]}, {ISO_ID1_OBJECTS[2]} ou{' '}
        {ISO_ID1_OBJECTS[3]} : toutes font exactement le même format normalisé.{' '}
        <em>La carte Vitale est la plus sûre — elle ne porte aucun numéro de paiement.</em>
      </p>

      <p>
        Distance estimée : {distanceCm === null ? '—' : `${distanceCm.toFixed(0)} cm`}
        {parallaxPct !== null && (
          <>
            {' '}
            — à cette distance la carte, posée sur le front, est vue environ{' '}
            <strong>{parallaxPct.toFixed(0)} %</strong> plus grande que vos tempes. C'est corrigé,
            et l'étape de rotation qui suit le mesure au lieu de le supposer.
          </>
        )}
      </p>

      <button
        type="button"
        disabled={widthPx <= 0 || quad === null}
        onClick={() => quad !== null && props.onValidate(widthPx, quad)}
      >
        Valider — vous pourrez ranger votre carte
      </button>{' '}
      <button type="button" onClick={props.onCancel}>
        Annuler
      </button>
    </section>
  );
}
