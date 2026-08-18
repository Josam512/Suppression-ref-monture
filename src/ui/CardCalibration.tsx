/**
 * ui/CardCalibration.tsx — V1, premier écran : « quand vous êtes prêt, appuyez ».
 *
 * ## Ce que ce composant ne fait plus, et pourquoi
 *
 * Il a porté deux parcours, tous deux abandonnés à l'usage :
 *
 *   1. **Deux poignées sur image figée, d'entrée de jeu.** Le seul geste long de
 *      la calibration, et il demandait au client d'être précis avant même de
 *      savoir de quoi il s'agissait.
 *   2. **Un cadre à remplir, en direct, avec verrouillage automatique.** Pire :
 *      le cadre était ancré sur le visage, donc il bougeait avec la tête. Le
 *      client courait après une cible mouvante, sans savoir ce qui manquait, et
 *      c'est la machine qui décidait quand c'était bon.
 *
 * 🔴 **Arbitrage humain du 2026-08-18 : c'est le client qui décide.** Il n'y a
 * plus rien à remplir, plus rien à viser, plus aucun verrouillage. Il place sa
 * carte comme il l'entend et appuie. Ce que la machine sait faire — accrocher un
 * bord au dixième de pixel — se fait ensuite, sur ses repères, sans lui demander
 * de la précision qu'il n'a pas à fournir.
 *
 * ⚠️ Ce composant ne mesure rien. Il affiche du texte et deux boutons.
 */

import { ISO_ID1_OBJECTS } from '../core/calibration.js';

export interface CardCalibrationProps {
  /** « Ma carte est en place » — fige l'image et passe au pointage. */
  onReady(): void;
  onCancel(): void;
}

export function CardCalibration(props: CardCalibrationProps): JSX.Element {
  return (
    <section>
      <h2>Prenez une carte, et dites-moi quand vous êtes prêt</h2>

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

      <ol>
        <li>
          Tenez la carte <strong>à plat contre votre visage, juste sous les yeux</strong>, bien
          visible en entier. Laissez vos yeux dégagés.
        </li>
        <li>
          Appuyez sur <strong>« Ma carte est en place »</strong>. J’arrête l’image et vous placez
          deux repères sur ses bords, tranquillement.
        </li>
        <li>
          Ensuite vous filmez : de face, puis de profil d’un côté et de l’autre.{' '}
          <strong>Vous gardez la carte en main</strong>, et vous arrêtez quand vous voulez.
        </li>
      </ol>

      {/*
        🔴 La carte se tient SOUS la ligne des yeux, jamais devant. Une carte qui
        masque les yeux ne fait pas perdre le visage à MediaPipe : le modèle rend
        quand même ses 478 points, en inventant ceux qu'il ne voit plus — et la
        largeur du visage, qui EST la mesure, serait lue sur ces points-là.
        (Ce placement n'annule PAS la parallaxe : le nez ressort autant que le
        front. C'est la rotation qui la mesure. Voir CARD_TO_TEMPLE_DEPTH_MM.)
      */}
      <p style={{ opacity: 0.75 }}>
        {ISO_ID1_OBJECTS[0]}, {ISO_ID1_OBJECTS[1]}, {ISO_ID1_OBJECTS[2]} ou {ISO_ID1_OBJECTS[3]} :
        toutes font exactement le même format normalisé.{' '}
        <em>La carte Vitale est la plus sûre — elle ne porte aucun numéro de paiement.</em>
      </p>

      <button type="button" onClick={props.onReady} style={{ fontWeight: 700 }}>
        Ma carte est en place
      </button>{' '}
      <button type="button" onClick={props.onCancel}>
        Annuler
      </button>
    </section>
  );
}
