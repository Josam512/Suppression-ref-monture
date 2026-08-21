/**
 * ui/AutoCalibrationStep.tsx — la calibration automatique, vue par le client.
 */

import { MIN_AUTO_FRAMES, type AutoStatus } from '../core/autoCalibration.js';

export interface AutoCalibrationStepProps {
  status: AutoStatus;
  onRetry(): void;
  onUseCard(): void;
}

export function AutoCalibrationStep(props: AutoCalibrationStepProps): JSX.Element {
  const { status } = props;
  // Un statut synthétique d'erreur d'assemblage pouvait publier neededFrames=0.
  // HTML <progress max=0> n'est pas une barre de progression valide et certains
  // navigateurs la rendent comme terminée/indéterminée. L'IHM ne doit jamais
  // mentir sur l'avancement à cause d'un détail de statut.
  const progressMax = status.neededFrames > 0 ? status.neededFrames : MIN_AUTO_FRAMES;

  return (
    <section>
      <h2>Mesure automatique en cours — regardez simplement l’écran</h2>

      {status.attempts > 0 && (
        <p style={{ background: '#3a2a00', padding: '8px 10px', borderRadius: 6 }}>
          <strong>Ça prend plus longtemps que prévu</strong> (tentative {status.attempts + 1}).{' '}
          {status.lastAttemptFailure?.label ?? ''} La mesure continue — vous pouvez aussi{' '}
          <button type="button" onClick={props.onRetry}>repartir de zéro</button> ou{' '}
          <button type="button" onClick={props.onUseCard}>utiliser une carte</button>.
        </p>
      )}

      <p style={{ fontWeight: 700 }}>
        Retirez vos lunettes, si vous en portez.
        <span style={{ fontWeight: 400, opacity: 0.75 }}>
          {' '}Vos verres changent la taille apparente de vos yeux : la mesure serait faussée.
        </span>
      </p>

      <p>
        Restez face à la caméra quelques secondes, à une distance confortable. Rien à tenir, rien à
        viser : la mesure se prend toute seule et vous dira quand elle a terminé.
      </p>

      <p style={{ opacity: 0.75 }}>
        Facultatif : tournez d’abord brièvement la tête d’un côté puis de l’autre, avant de revenir
        de face — j’en profite pour mesurer la largeur de votre tête aux tempes. Sans cela, la
        mesure aboutit quand même, avec une marge un peu plus large.
      </p>

      <p aria-live="polite" style={{ opacity: 0.85 }}>
        {status.whyNotDone?.label ?? 'Mesure en cours…'}
      </p>
      <progress value={Math.min(status.usableFrames, progressMax)} max={progressMax} />

      <p style={{ opacity: 0.6 }}>
        <button type="button" onClick={props.onUseCard} style={{ fontWeight: 400 }}>
          Préférer la mesure avec une carte (mode diagnostic)
        </button>
      </p>
    </section>
  );
}
