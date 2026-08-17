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
        Tenez la carte <strong>à plat contre votre visage, juste sous les yeux</strong>, et
        amenez-la dans le cadre. Laissez vos yeux dégagés. Ça se prend tout seul, en une seconde —
        vous n’avez rien à valider.
      </p>

      {/*
        🔴 La carte se tient SOUS la ligne des yeux, jamais devant. Une carte qui
        masque les yeux ne fait pas perdre le visage à MediaPipe : le modèle rend
        quand même ses 478 points, en inventant ceux qu'il ne voit plus — et la
        largeur du visage, qui EST la mesure, serait lue sur ces points-là.
        (Ce placement n'annule PAS la parallaxe : le nez ressort autant que le
        front. C'est la rotation qui la mesure. Voir CARD_TO_TEMPLE_DEPTH_MM.)
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
