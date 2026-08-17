/**
 * core/depthFit.ts — MESURER la distance caméra, au lieu de la supposer.
 *
 * ## Ce que ce fichier corrige
 *
 * La correction de parallaxe B4 vaut `1 + Δz/D` : il lui faut la profondeur
 * front↔tempes ET la distance caméra. La profondeur était mesurée ; la distance
 * venait d'un champ de vision SUPPOSÉ (60°), et donc d'une hypothèse — dans une
 * chaîne dont tout le contrat dit qu'elle n'en tolère aucune. C'était de la
 * paresse : le client a une carte de dimensions normalisées sur le front, et il
 * tourne la tête. Tout est là pour mesurer la distance.
 *
 * ## Comment les deux se séparent
 *
 * Pour une vue de yaw θ, l'écart projeté front↔milieu-des-tempes vaut
 *
 *     g(θ) = −Δz·sin θ  −  (a²/D)·cos θ·sin θ
 *
 * Le premier terme est la profondeur cherchée. Le second est le décalage
 * perspectif du milieu de deux points projetés (cf. `parallax.ts`), et c'est LUI
 * qui porte la distance. Les deux dépendent de θ **différemment** — `sin θ`
 * contre `sin θ·cos θ` — donc une rotation balayée sur une plage d'angles
 * suffit à les séparer par moindres carrés. Deux vues au même angle ne le
 * peuvent pas ; c'est pourquoi on exige un ÉTALEMENT, pas seulement un nombre.
 *
 * 🔴 Toujours aucune 3D : deux scalaires extraits d'une régression linéaire à
 * deux inconnues. Aucun maillage, aucune pose 3D, aucune bibliothèque.
 */

import { CalibrationError } from './geom.js';
import { frontalOffsetMm, isUsableProbeView, type RotatedView } from './parallax.js';

/** En deçà, le système à deux inconnues n'a pas assez d'appuis. */
export const MIN_FIT_VIEWS = 4;

/**
 * Étalement minimal des |yaw| retenus, en radians.
 *
 * `sin θ` et `sin θ·cos θ` se confondent aux petits angles : sans écart franc
 * entre les vues, les deux inconnues sont indiscernables et la régression rend
 * n'importe quoi avec un air d'assurance.
 */
export const MIN_YAW_SPREAD_RAD = 0.12; // ~7°

/** Écart minimal de sin(yaw) entre deux vues pour que leur pente ait un sens. */
const MIN_SIN_GAP = 0.15;

/** Bornes de plausibilité de la distance mesurée. Détecteur de panne. */
export const DISTANCE_MIN_MM = 250;
export const DISTANCE_MAX_MM = 1500;

export const DEPTH_MIN_MM = 5;
export const DEPTH_MAX_MM = 60;

/**
 * 🔴 L'estimateur à DEUX paramètres a été SUPPRIMÉ, pas désactivé.
 *
 * Il ajustait `g(θ) = A·sinθ + B·sinθcosθ` pour tirer d'un coup la profondeur et
 * la distance. Sur la tête de synthèse il marchait ; sur la première vraie vidéo
 * il rendait 14,6 mm puis 43,8 mm pour la même personne, parce que les deux
 * régresseurs restent presque colinéaires sur la plage exploitable.
 *
 * Le garder « au cas où » aurait laissé dans le dépôt un estimateur dont on sait
 * qu'il ment avec assurance. La distance n'est plus ajustée du tout : elle est
 * fixée à la fenêtre de travail, où elle ne pèse que 3,4 % de la profondeur.
 */
export interface DepthAndDistance {
  /** Profondeur front ↔ plan des repères temporaux, en mm. Robuste. */
  depthMm: number;
  /** Incertitude relative sur cette profondeur, issue des résidus de la régression. */
  depthRelError: number;
  /**
   * Distance caméra ↔ plan des repères temporaux, en mm. MESURÉE — mais faible.
   *
   * ⚠️ Lire `distanceRelError` AVANT d'utiliser cette valeur. La distance est
   * portée par un effet perspectif du SECOND ordre, et le bruit des repères la
   * dégrade massivement : au banc, ±0,5 px de bruit sur les repères donnent
   * ±300 mm d'écart-type sur 700. Elle n'est jamais utilisée seule.
   */
  distanceMm: number;
  distanceRelError: number;
  /** Nombre de vues réellement utilisées. */
  views: number;
  /** Étalement des |yaw| retenus, en radians. Sert au diagnostic. */
  yawSpreadRad: number;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? NaN) : ((s[mid - 1] ?? NaN) + (s[mid] ?? NaN)) / 2;
}

/**
 * ⭐ Profondeur front ↔ tempes, par MÉDIANE sur les vues. Un seul paramètre.
 *
 * ## Pourquoi ceci remplace la régression à deux inconnues
 *
 * Vouloir tirer la profondeur ET la distance des mêmes images était une erreur
 * de conception, et la première vraie vidéo l'a démontrée : `sin θ` et
 * `sin θ·cos θ` restent presque colinéaires sur toute la plage exploitable
 * (10–35°), si bien que le second paramètre absorbe le bruit et le rend au
 * premier. Résultat mesuré : 14,6 mm sur une image frontale, 43,8 mm sur une
 * autre, même vidéo, une seule vue d'écart.
 *
 * Or la distance n'a JAMAIS eu besoin d'être ajustée : elle n'intervient que
 * dans le petit terme perspectif du milieu, qui pèse ~20 % de la profondeur. Une
 * distance connue à ±17 % près — la fenêtre de travail imposée — n'y introduit
 * donc que 3,4 % d'erreur sur la profondeur. On la fixe, et il ne reste qu'une
 * inconnue.
 *
 * Chaque vue donne alors sa propre estimation, et on prend la **médiane** : une
 * image floue, un roll passager, une détection qui décroche ne déplacent plus
 * le résultat. Ce que la régression aux moindres carrés, elle, ne pardonnait pas.
 */
export function depthFromRotation(
  views: readonly RotatedView[],
  faceWidthMm: number,
  distanceMm: number,
): { depthMm: number; depthRelError: number; views: number } {
  const half = faceWidthMm / 2;
  const points: Array<{ s: number; g: number }> = [];

  for (const v of views) {
    if (!isUsableProbeView(v)) continue;
    const s = Math.sin(v.yawRad);

    // g(θ) = c − Δz·sinθ − (a² + Δz²)/D·cosθ·sinθ, Δz² négligeable devant a².
    // On retranche ici le terme perspectif, connu ; il ne reste que c et Δz.
    const midpointTerm = ((half * half) / distanceMm) * Math.cos(v.yawRad) * s;
    points.push({ s, g: frontalOffsetMm(v, faceWidthMm) + midpointTerm });
  }

  if (points.length < MIN_FIT_VIEWS) {
    throw new CalibrationError(
      `Seulement ${points.length} vue(s) exploitable(s) sur ${views.length}. ` +
        `Tournez la tête d'un côté puis de l'autre, sans la pencher.`,
    );
  }

  // 🔴 Il reste un DÉCALAGE CONSTANT, et il faut l'éliminer, pas le moyenner.
  //
  // Le repère de front n'est jamais exactement sur le plan sagittal : un visage
  // est asymétrique, et la tête n'est pas parfaitement centrée. Cela ajoute à
  // `g` une constante `c` que la relation devient `g = c − Δz·sinθ`. Diviser
  // chaque vue par `sinθ` transforme alors ce `c` en `c/sinθ`, qui explose aux
  // petits angles : sur la vraie vidéo, la profondeur sortait à 103 mm — trois
  // fois trop — et de façon parfaitement CONSTANTE d'une vue à l'autre, donc
  // avec l'air d'une bonne mesure.
  //
  // La pente élimine la constante. On la prend par Theil–Sen : la médiane des
  // pentes de toutes les paires de vues. C'est la mesure différentielle à deux
  // vues du §4, généralisée à toutes les paires, avec une médiane pour résister
  // aux images floues et aux décrochages de détection.
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      if (a === undefined || b === undefined) continue;
      const ds = a.s - b.s;
      if (Math.abs(ds) < MIN_SIN_GAP) continue;
      slopes.push((a.g - b.g) / ds);
    }
  }
  if (slopes.length < MIN_FIT_VIEWS) {
    throw new CalibrationError(
      `Les angles balayés sont trop semblables pour mesurer la profondeur. ` +
        `Tournez la tête franchement d'un côté, puis de l'autre.`,
    );
  }

  const slope = median(slopes);
  const depthMm = Math.abs(slope);

  // Dispersion robuste : l'écart absolu médian, mis à l'échelle d'un écart-type
  // gaussien. Insensible aux paires aberrantes, contrairement à l'écart-type —
  // et c'est justement d'elles qu'il s'agit de se protéger.
  const mad = median(slopes.map((x) => Math.abs(x - slope))) * 1.4826;
  const depthRelError = Math.min(
    1,
    mad / Math.sqrt(points.length) / Math.max(depthMm, 1e-6),
  );

  if (depthMm < DEPTH_MIN_MM || depthMm > DEPTH_MAX_MM) {
    throw new CalibrationError(
      `Profondeur mesurée : ${depthMm.toFixed(0)} mm, hors de tout plausible ` +
        `(${DEPTH_MIN_MM}–${DEPTH_MAX_MM} mm). La rotation n'a pas été exploitable.`,
    );
  }

  return { depthMm, depthRelError, views: points.length };
}

