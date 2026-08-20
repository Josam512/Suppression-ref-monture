/**
 * ui/AutoCalibrationStep.tsx — la calibration automatique, vue par le client.
 *
 * ## Le contrat d'affichage qui répond à l'audit (§2, cause A)
 *
 * La machine sait ce qui lui manque : elle le DIT, en une ligne, tout le temps
 * (`WHY_NOT_DONE`). Et quand elle a terminé, elle le dit aussi — c'est le
 * composant parent qui affiche alors « Calibration acquise ». Il n'est plus
 * possible que la caméra tourne sans qu'on sache pourquoi ni jusqu'à quand.
 *
 * ⚠️ Ce composant ne mesure rien : il affiche l'état du moteur, deux boutons de
 * secours, et c'est tout.
 */

import type { AutoStatus } from '../core/autoCalibration.js';

export interface AutoCalibrationStepProps {
  status: AutoStatus;
  /** Réessayer après un échec : nouveau moteur, compteurs à zéro. */
  onRetry(): void;
  /** Mode diagnostic : la carte ISO reste disponible comme vérité terrain. */
  onUseCard(): void;
}

export function AutoCalibrationStep(props: AutoCalibrationStepProps): JSX.Element {
  const { status } = props;

  return (
    <section>
      <h2>Mesure automatique en cours — regardez simplement l’écran</h2>

      {/* ⭐ Audit 2026-08-21 : un délai dépassé n'est plus un cul-de-sac. Le
          moteur DIT ce qui lui manque, compte la tentative, et CONTINUE de
          mesurer — l'écran ne se substitue plus à la mesure en cours. */}
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
          {' '}
          Vos verres changent la taille apparente de vos yeux : la mesure serait faussée.
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

      {/* ⭐ WHY_NOT_DONE (mission §9) : la raison courante, toujours visible. */}
      <p aria-live="polite" style={{ opacity: 0.85 }}>
        {status.whyNotDone?.label ?? 'Mesure en cours…'}
      </p>
      <progress value={Math.min(status.usableFrames, status.neededFrames)} max={status.neededFrames} />

      <p style={{ opacity: 0.6 }}>
        <button type="button" onClick={props.onUseCard} style={{ fontWeight: 400 }}>
          Préférer la mesure avec une carte (mode diagnostic)
        </button>
      </p>
    </section>
  );
}
