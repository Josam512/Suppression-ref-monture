/**
 * ui/deadline.ts — course d'une promesse contre une ÉCHÉANCE absolue.
 *
 * Ré-audit A4 : `getUserMedia` et `video.play()` peuvent rester PENDUS
 * (périphérique tenu par une autre application, pilote gelé, WebView sans
 * permission). Le budget global de la chaîne caméra était calculé… puis
 * appliqué à la seule attente de dimensions : un budget jamais appliqué ne
 * protège rien. Chaque étape passe désormais ici, contre la MÊME échéance —
 * le budget est réellement GLOBAL.
 *
 * Une résolution TARDIVE n'est pas fuitée : `onLate` reçoit la valeur pour la
 * nettoyer (stopper les pistes d'un stream fantôme, fermer une ressource) —
 * guide, point 66.
 */

export function withDeadline<T>(
  promise: Promise<T>,
  deadlineMs: number,
  timeoutMessage: string,
  onLate: (value: T) => void = () => {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => {
        settled = true;
        reject(new Error(timeoutMessage));
      },
      Math.max(0, deadlineMs - performance.now()),
    );
    promise.then(
      (value) => {
        if (settled) {
          onLate(value); // tardif : à NETTOYER par l'appelant, jamais à fuir
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return; // l'échéance a déjà répondu ; le rejet tardif meurt ici
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
