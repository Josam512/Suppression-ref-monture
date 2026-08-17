/**
 * core/framePlane.ts — DANS QUEL PLAN chaque grandeur rendue vit-elle.
 *
 * ## Le piège que ce fichier existe pour barrer
 *
 * « Des lunettes sont posées sur le nez, pas sur les yeux » : c'est vrai, et
 * c'est un fait d'anatomie. La conclusion qu'on en tire spontanément — donc il
 * faut dessiner le sprite à l'échelle du plan du nez — est **fausse**, et elle
 * coûterait 6 % sur la seule grandeur que ce projet promet au millimètre.
 *
 * Une monture n'est pas plate. Son plan avant — pont, faces des verres — est
 * mesuré à ~48 mm devant les repères temporaux sur le sujet réel. Mais sa
 * LARGEUR, les 132 mm affichés, ne se réalise pas là : elle se réalise aux
 * **extrémités**, les tenons, qui sont plaqués sur les côtés de la tête, à
 * quelques millimètres devant le contour du visage. C'est bien là qu'un
 * opticien pose son réglet, et c'est là que la caméra voit les deux bords.
 *
 * Redimensionner tout le sprite au plan du pont dessinerait donc une monture
 * **6 % plus large qu'elle n'est** — soit 8 mm sur 132 — tout en ayant l'air
 * plus juste, puisque la partie centrale du sprite, elle, tomberait mieux. Un
 * opticien regardant l'écran verrait 140 mm sur un visage de 152, là où la
 * réalité donne 132. C'est très exactement le critère de succès du §0 qui
 * tombe, et rien à l'écran ne le signalerait.
 *
 * ## Ce que le plan du nez gouverne réellement
 *
 * Les deux grandeurs qui vivent, elles, au plan du pont :
 *
 *   - `VERTICAL_OFFSET_MM` (§6.3) — de combien le pont se pose SOUS le sellion.
 *     C'est un écart en millimètres réels, mesuré sur le nez.
 *   - le décentrement (§5) — l'écart entre le centre de l'œil et le centre
 *     optique du verre, qui est sur la face avant de la monture.
 *
 * Les deux sont petits (0,2 mm de correction), mais ils sont gratuits et justes.
 *
 * ## Ce qu'on ne corrige PAS, et pourquoi
 *
 * Les tenons ne sont pas exactement dans le plan des repères 234/454 : ils sont
 * ~8 mm devant, ce qui vaut 1 % d'échelle. On ne le corrige pas, parce qu'on ne
 * sait pas cette valeur à mieux que ±6 mm, soit 75 % d'incertitude relative sur
 * une correction de 1 %. Le projet a déjà tranché ce genre de cas
 * (`MAX_DEPTH_REL_ERROR`, §cardRefinement) : au-delà de 50 % d'incertitude sur
 * une correction, corriger déplace l'erreur au lieu de la retirer. Ce 1 % est
 * donc laissé en biais **déclaré** plutôt qu'en correction hasardeuse.
 *
 * 🔴 Aucune 3D ici : trois profondeurs scalaires et une division. Le rendu reste
 * du sprite 2D (§0).
 */

/**
 * Distance de travail nominale caméra ↔ plan des repères temporaux.
 *
 * ⚠️ Ce n'est PAS une distance devinée depuis un champ de vision supposé —
 * cette voie-là a été retirée du projet. C'est la fenêtre que l'application
 * fait respecter : elle refuse en deçà de 60 cm (parade B4 n°1) et au-delà
 * d'environ 1 m la carte devient trop petite pour être pointée. La distance
 * réelle vit dans cette fourchette parce qu'on l'y contraint.
 *
 * Elle vit ici, et non dans `cardRefinement.ts`, pour être importable par
 * `faceMetrics`/`transform` sans créer de cycle d'imports.
 */
export const NOMINAL_DISTANCE_MM = 780;
export const NOMINAL_DISTANCE_REL_ERROR = 0.17; // couvre ~600–1000 mm

/**
 * Profondeur du plan du PONT devant les repères temporaux 234/454, en mm.
 *
 * Mesurée sur la vidéo du sujet réel, pas supposée : la rotation de tête donne
 * 35,6 mm ±1 % entre les coins externes des yeux et le sellion (repère 168),
 * auxquels s'ajoutent les 12 mm déclarés entre les coins externes et les tempes
 * (`CANTHI_TO_TEMPLE_DEPTH_MM`). Les plans plus bas de l'arête montent
 * régulièrement — 40,6 mm au repère 6, 45,9 au 197, 50,8 au 195 — ce qui est
 * cohérent avec l'anatomie et constitue en soi une preuve que la sonde mesure
 * bien quelque chose.
 *
 * ⚠️ Un seul sujet. L'incertitude déclarée le dit.
 */
export const BRIDGE_AHEAD_MM = 48;
export const BRIDGE_AHEAD_SD_MM = 10;

/**
 * Profondeur du plan des TENONS — là où la largeur totale se réalise — devant
 * les mêmes repères. Petite : les tenons doivent dégager la tête pour laisser
 * les branches filer vers les oreilles, mais à peine.
 *
 * ⚠️ Déclarée, non mesurée : aucune image ne la donne sans monture réellement
 * portée. Elle n'est utilisée par AUCUN calcul — voir l'en-tête : à ±6 mm sur
 * 8, la corriger reviendrait à la deviner. Elle est ici pour que le 1 % de biais
 * résiduel sur la largeur rendue soit écrit quelque part plutôt que tu.
 */
export const ENDPIECE_AHEAD_MM = 8;
export const ENDPIECE_AHEAD_SD_MM = 6;

/** Au-delà, la géométrie n'est plus celle d'un visage : on ne corrige rien. */
export const MAX_PLANE_DELTA = 0.15;

/**
 * Échelle (px par mm) dans un plan situé `aheadMm` DEVANT le plan des tempes.
 *
 * En projection perspective l'échelle varie en 1/z : un plan plus proche de la
 * caméra est vu plus grand. `k(Δ) = k_tempes / (1 − Δ/D)`.
 *
 * @param templePxPerMm échelle au plan des repères 234/454 (`livePxPerMm`).
 * @param aheadMm profondeur du plan voulu devant celui des tempes.
 */
export function planeScale(templePxPerMm: number, aheadMm: number): number {
  const delta = aheadMm / NOMINAL_DISTANCE_MM;
  if (!Number.isFinite(delta) || Math.abs(delta) > MAX_PLANE_DELTA) return templePxPerMm;
  return templePxPerMm / (1 - delta);
}

/**
 * Ce qu'il reste d'incertitude sur une longueur convertie dans un autre plan.
 *
 * `d(facteur)/facteur ≈ (Δ/D) × incertitude relative sur (Δ/D)`.
 */
export function planeScaleRelError(aheadMm: number, sdMm: number): number {
  if (aheadMm === 0) return 0;
  const delta = aheadMm / NOMINAL_DISTANCE_MM;
  return Math.abs(delta) * Math.hypot(sdMm / aheadMm, NOMINAL_DISTANCE_REL_ERROR);
}
