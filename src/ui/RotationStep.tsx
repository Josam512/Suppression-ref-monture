/**
 * ui/RotationStep.tsx — « tournez lentement la tête à gauche, puis à droite ».
 *
 * Deux secondes de plus après la carte, et deux choses deviennent mesurables au
 * lieu d'être supposées :
 *
 *  · la PROFONDEUR entre la carte, posée sur le front, et vos tempes — sans
 *    quoi la carte est vue « trop grande » et le visage sort trop petit de 3 à
 *    7 % (correctif B4) ;
 *  · l'ÉCART TEMPORAL lui-même, parce que les pixels de votre tête bougent
 *    quand vous tournez, et pas ceux du mur derrière vous.
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
        Gardez la carte sur le front et les yeux vers l’écran. Une vingtaine de degrés de chaque
        côté suffisent — c’est ce qui permet de mesurer la largeur de votre tête aux tempes au lieu
        de l’estimer.
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
