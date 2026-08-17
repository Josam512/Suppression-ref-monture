/**
 * ui/RotationStep.tsx — « tournez lentement la tête à gauche, puis à droite ».
 *
 * Deux secondes de plus après la carte, pour mesurer l'ÉCART TEMPORAL au lieu de
 * le supposer : les pixels de la tête bougent quand elle tourne, ceux du mur
 * derrière non.
 *
 * Elle mesure AUSSI la profondeur carte ↔ tempes (correctif B4), qui reste
 * entière : la carte, désormais tenue sous les yeux, porte sur le nez, lequel
 * ressort autant que le front. Rien n'a été gagné de ce côté-là.
 *
 * ⭐ En revanche la carte est déjà rangée à ce stade — cette étape ne demande
 * plus aucun accessoire.
 *
 * ⚠️ On peut passer outre. La mesure reste alors celle de la carte seule, avec
 * sa marge annoncée pour ce qu'elle est. On n'a jamais le droit de bloquer un
 * essayage : la personne doit pouvoir voir l'image (§0.0.2).
 */

export interface RotationStepProps {
  /** 0..1, l'avancement des deux côtés confondus. */
  ratio: number;
  /** Angle atteint de chaque côté, en degrés. */
  degrees: { left: number; right: number };
  onSkip(): void;
}

export function RotationStep(props: RotationStepProps): JSX.Element {
  const pct = Math.round(props.ratio * 100);

  return (
    <section>
      <h2>Tournez lentement la tête à gauche, puis à droite</h2>
      <p>
        <strong>Merci, vous pouvez ranger votre carte.</strong> Gardez simplement les yeux vers
        l’écran. Une vingtaine de degrés de chaque côté suffisent — c’est ce qui permet de mesurer
        la largeur de votre tête aux tempes au lieu de l’estimer.
      </p>

      <p>
        <progress value={pct} max={100} /> {pct} %
        <br />
        <span style={{ opacity: 0.75 }}>
          à gauche : {props.degrees.left.toFixed(0)}° · à droite : {props.degrees.right.toFixed(0)}°
        </span>
      </p>

      <button type="button" onClick={props.onSkip}>
        Passer cette étape — ma marge de mesure sera plus large
      </button>
    </section>
  );
}
