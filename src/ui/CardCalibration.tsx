/**
 * ui/CardCalibration.tsx — V1, l'étape carte : la consigne, et rien d'autre.
 *
 * ## Ce que ce composant NE fait plus
 *
 * Il affichait une image figée, deux poignées à traîner sur les bords de la
 * carte, et un bouton « Valider ». C'était le seul geste long de la calibration,
 * et il demandait au client d'être précis — ce qui est exactement ce qu'on ne
 * peut pas exiger d'une personne seule chez elle.
 *
 * Le cadre affiché en direct sur la vidéo l'a remplacé (`ui/cardGuideStep.ts`) :
 * le client pose sa carte là où seront ses lunettes, et la mesure se prend
 * d'elle-même. **Aucun bouton, aucune validation, aucun réglage.** La jauge dit
 * seulement où il en est.
 *
 * ⚠️ Ce composant ne mesure rien. Il affiche du texte et un pourcentage.
 */

import { ISO_ID1_OBJECTS } from '../core/calibration.js';

export interface CardCalibrationProps {
  /** Avancement du verrouillage, 0 → 1. Vient de `core/cardGuide.ts`. */
  fill: number;
  onCancel(): void;
}

export function CardCalibration(props: CardCalibrationProps): JSX.Element {
  return (
    <section>
      <h2>Posez votre carte là où seront vos lunettes</h2>

      {/*
        ⚠️ Première consigne, avant toute autre. Un client qui garde ses lunettes
        casse la mesure de TROIS façons à la fois : ses branches passent
        exactement sur la ligne où l'on cherche le bord de sa tête, ses verres
        modifient de 10 % la taille apparente de son iris (§4, correctif S2), et
        l'essayage lui-même devient illisible avec une monture réelle sous la
        monture virtuelle.
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
        Tenez la carte <strong>à hauteur des yeux</strong>, contre votre visage, et amenez-la dans
        le cadre. Ça se prend tout seul, en une seconde — vous n’avez rien à valider.
      </p>

      {/*
        🔴 La carte se porte dans le PLAN DU VISAGE, et pas sur le front. Ce n'est
        pas un détail de confort : sur le front elle est ~54 mm devant les repères
        qui mesurent le visage, ce qui introduit 13 % de biais systématique à
        40 cm (correctif B4). Là où iront les lunettes, il n'y a plus d'écart de
        profondeur — donc plus rien à corriger, et plus rien à supposer.
      */}
      <p style={{ opacity: 0.75 }}>
        Vous pouvez utiliser {ISO_ID1_OBJECTS[0]}, {ISO_ID1_OBJECTS[1]}, {ISO_ID1_OBJECTS[2]} ou{' '}
        {ISO_ID1_OBJECTS[3]} : toutes font exactement le même format normalisé.{' '}
        <em>La carte Vitale est la plus sûre — elle ne porte aucun numéro de paiement.</em>
      </p>

      <p aria-live="polite">
        {props.fill >= 1
          ? 'C’est bon, ne bougez plus…'
          : `Cadrage : ${Math.round(100 * props.fill)} %`}
      </p>

      <button type="button" onClick={props.onCancel}>
        Annuler
      </button>
    </section>
  );
}
