/**
 * ui/assetUrl.ts — l'unique façon de désigner un fichier servi par le site.
 *
 * ## Pourquoi ce fichier existe
 *
 * Les chemins étaient écrits en absolu, avec une barre initiale, vers les
 * dossiers du modèle, du wasm et des montures. (Ils ne sont pas cités ici tels
 * quels : le barrage du hook cherche cette forme, et il a raison de ne pas
 * faire d'exception pour un commentaire — c'est au commentaire de s'adapter.)
 * Ça marche tant que l'application est servie à la RACINE d'un domaine, et ça
 * casse silencieusement dès qu'elle vit dans un sous-répertoire : le modèle
 * MediaPipe rend un 404, la boucle ne démarre jamais, et l'écran reste sur
 * « Chargement… » sans la moindre erreur rouge. C'est très exactement le mode
 * d'échec du §1 bug #4, sous une autre forme.
 *
 * `import.meta.env.BASE_URL` vaut `/` en développement et le sous-chemin réel en
 * production. Un seul point de passage, donc un seul endroit à relire.
 *
 * ⚠️ Aucun chemin de fichier servi ne doit plus commencer par `/` ailleurs dans
 * `src/`. Un barrage du hook le vérifie.
 */

/**
 * Fichiers EMBARQUÉS dans la page, quand il n'y a pas de serveur du tout.
 *
 * Le déploiement normal sert des fichiers ; une page autonome, elle, les porte
 * en elle et les expose en `blob:`. Ce registre est le seul point où les deux
 * mondes se rejoignent — sans lui, il faudrait détourner `fetch` et le
 * chargement des images, c'est-à-dire réécrire à côté ce que ce fichier fait
 * déjà pour tout le monde.
 *
 * ⚠️ Il est vide dans l'application servie. Rien ne le remplit à part le script
 * d'empaquetage `scripts/build-single-file.mjs`.
 */
declare global {
  interface Window {
    __INLINE_ASSETS__?: Readonly<Record<string, string>>;
  }
}

/** Ce chemin est-il porté par la page elle-même plutôt que par un serveur ? */
export function isInlined(relative: string): boolean {
  return typeof window !== 'undefined' && window.__INLINE_ASSETS__?.[key(relative)] !== undefined;
}

const key = (relative: string): string => relative.replace(/^\//, '');

/** Chemin RELATIF au site (sans `/` initial) → URL utilisable. */
export function assetUrl(relative: string): string {
  const inline = typeof window !== 'undefined' ? window.__INLINE_ASSETS__?.[key(relative)] : undefined;
  if (inline !== undefined) return inline;

  const base = import.meta.env.BASE_URL;
  return `${base.endsWith('/') ? base : `${base}/`}${key(relative)}`;
}
