/**
 * ui/RotationStep.tsx — la séance filmée, et son unique bouton d'arrêt.
 *
 * > « fais juste une vidéo où j'ai la main pour me montrer de face et de profil,
 * > et que JE décide moi quand la vidéo est finie »
 *
 * 🔴 **Rien ici ne s'arrête tout seul.** Ni délai, ni jauge qui se remplit et
 * déclenche, ni seuil de complétude. Le seul événement qui termine la séance est
 * le doigt du client. Les chiffres affichés disent ce qui a été récolté ; ils ne
 * commandent rien et ne barrent rien.
 *
 * ## ⚠️ Correction : la carte RESTE en main
 *
 * Cet écran affichait « Merci, vous pouvez ranger votre carte » — alors que le
 * relevé de la carte pendant la rotation est très exactement ce qui donne la
 * focale, donc la distance réelle. La consigne contredisait le code : le client
 * rangeait sa carte, le suivi ne trouvait plus rien, et la chaîne retombait en
 * silence sur la distance supposée. Sur le premier sujet réel, cet a priori
 * était faux de 46 % (78 cm supposés pour 42 mesurés). La carte se range à la
 * fin, pas avant.
 *
 * ## Ce que la rotation mesure, et qu'aucune constante ne peut remplacer
 *
 *   · l'ÉCART TEMPORAL : les pixels de la tête bougent quand elle tourne, ceux
 *     du mur derrière non ;
 *   · la PROFONDEUR carte ↔ tempes (correctif B4), qui reste entière — une carte
 *     tenue sous les yeux porte sur le nez, lequel ressort autant que le front ;
 *   · la FOCALE de l'objectif, par médiane sur toutes les vues de la carte.
 */

export interface RotationStepProps {
  /** Angle atteint de chaque côté, en degrés. Informatif. */
  degrees: { left: number; right: number };
  /** Nombre de vues de carte récoltées. Informatif. */
  cardViews: number;
  /** Le seul chemin de sortie — et c'est le client qui l'emprunte. */
  onFinish(): void;
}

export function RotationStep(props: RotationStepProps): JSX.Element {
  const { left, right } = props.degrees;

  return (
    <section>
      <h2>Filmez-vous : de face, puis de profil des deux côtés</h2>

      <p style={{ fontWeight: 700 }}>Gardez votre carte en main, bien visible.</p>

      <p>
        Tournez lentement la tête à gauche, puis à droite, et revenez de face. Une vingtaine de
        degrés de chaque côté suffisent. Prenez le temps que vous voulez — repassez plusieurs fois
        si ça vous chante, ça ne fait que rendre la mesure meilleure.
      </p>

      {/*
        ⚠️ Ces chiffres sont un COMPTE RENDU, pas une consigne. Ils ne disent
        jamais « pas encore » : le client n'a rien à atteindre. Les afficher sert
        seulement à ce qu'il voie que quelque chose se passe pendant qu'il bouge.
      */}
      <p aria-live="polite" style={{ opacity: 0.75 }}>
        récolté jusqu’ici : {left.toFixed(0)}° à gauche · {right.toFixed(0)}° à droite ·{' '}
        {props.cardViews} vue{props.cardViews > 1 ? 's' : ''} de votre carte
      </p>

      <button type="button" onClick={props.onFinish} style={{ fontWeight: 700 }}>
        J’ai fini — calculez
      </button>

      <p style={{ opacity: 0.6 }}>
        Vous pouvez appuyer quand vous voulez, même tout de suite. Moins vous aurez tourné la tête,
        plus la marge affichée sera large — c’est tout ce que ça change.
      </p>
    </section>
  );
}
