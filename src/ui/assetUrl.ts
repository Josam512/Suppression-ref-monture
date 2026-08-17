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

/** Chemin RELATIF au site (sans `/` initial) → URL utilisable. */
export function assetUrl(relative: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base.endsWith('/') ? base : `${base}/`}${relative.replace(/^\//, '')}`;
}
