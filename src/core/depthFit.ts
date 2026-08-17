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

/** Bornes de plausibilité de la distance mesurée. Détecteur de panne. */
export const DISTANCE_MIN_MM = 250;
export const DISTANCE_MAX_MM = 1500;

export const DEPTH_MIN_MM = 5;
export const DEPTH_MAX_MM = 60;

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

/** Résout le système 2×2 des moindres carrés. `null` si mal conditionné. */
function solve2x2(
  suu: number,
  suv: number,
  svv: number,
  sug: number,
  svg: number,
): { a: number; b: number } | null {
  const det = suu * svv - suv * suv;
  // Le déterminant normalisé mesure la colinéarité des deux régresseurs.
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12 * Math.abs(suu * svv)) return null;
  return {
    a: (sug * svv - svg * suv) / det,
    b: (svg * suu - sug * suv) / det,
  };
}

interface Row {
  u: number;
  w: number;
  g: number;
}

/**
 * Dispersion des deux coefficients quand on retire une vue à la fois.
 *
 * Le jackknife ne suppose rien sur la loi des erreurs — il mesure la sensibilité
 * réelle de l'ajustement à ses propres données. C'est ce qu'il fallait : sur la
 * première vraie vidéo, une seule vue de différence faisait tripler la
 * profondeur, et aucune formule de résidus ne le voyait venir.
 */
function jackknife(rows: readonly Row[], halfWidthMm: number): { depthSd: number; leverSd: number } {
  const depths: number[] = [];
  const levers: number[] = [];

  for (let skip = 0; skip < rows.length; skip++) {
    let suu = 0;
    let suv = 0;
    let svv = 0;
    let sug = 0;
    let svg = 0;
    for (let i = 0; i < rows.length; i++) {
      if (i === skip) continue;
      const r = rows[i];
      if (r === undefined) continue;
      suu += r.u * r.u;
      suv += r.u * r.w;
      svv += r.w * r.w;
      sug += r.u * r.g;
      svg += r.w * r.g;
    }
    const s = solve2x2(suu, suv, svv, sug, svg);
    if (s === null) continue;
    depths.push(Math.abs(s.a));
    levers.push(Math.abs(s.b));
  }

  const sd = (xs: readonly number[]): number => {
    if (xs.length < 2) return Infinity;
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
    // Facteur du jackknife : la dispersion des « leave-one-out » sous-estime
    // celle de l'estimateur d'un facteur √(n−1).
    return Math.sqrt(v * (xs.length - 1));
  };

  void halfWidthMm;
  return { depthSd: sd(depths), leverSd: sd(levers) };
}

/**
 * Ajuste `g(θ) = A·sinθ + B·sinθ·cosθ` sur toutes les vues, puis en tire
 * la profondeur et la distance.
 *
 * ## Le signe
 *
 * La convention de signe du yaw de MediaPipe n'est pas vérifiable sans mire. Si
 * elle est globalement inversée, `sinθ` et `sinθcosθ` changent tous deux de
 * signe, donc A et B aussi : les VALEURS ABSOLUES, elles, ne bougent pas. Or le
 * front est anatomiquement devant les tempes et la caméra est devant le sujet —
 * deux faits, pas deux mesures. On mesure les magnitudes et on pose les signes.
 *
 * @param faceWidthMm largeur naïve du visage, pour l'échelle de chaque vue.
 * @throws CalibrationError en nommant ce qui manque.
 */
export function fitDepthAndDistance(
  views: readonly RotatedView[],
  faceWidthMm: number,
): DepthAndDistance {
  const usable = views.filter(isUsableProbeView);
  if (usable.length < MIN_FIT_VIEWS) {
    throw new CalibrationError(
      `Seulement ${usable.length} vue(s) exploitable(s) sur ${views.length}. ` +
        `Tournez la tête plus lentement, d'un côté puis de l'autre, sans la pencher.`,
    );
  }

  const angles = usable.map((v) => Math.abs(v.yawRad));
  const yawSpreadRad = Math.max(...angles) - Math.min(...angles);
  if (yawSpreadRad < MIN_YAW_SPREAD_RAD) {
    throw new CalibrationError(
      `Toutes les vues sont au même angle (${((yawSpreadRad * 180) / Math.PI).toFixed(0)}° d'écart). ` +
        `Il faut balayer progressivement, sinon la profondeur et la distance ne se distinguent pas.`,
    );
  }

  let suu = 0;
  let suv = 0;
  let svv = 0;
  let sug = 0;
  let svg = 0;

  const rows: Row[] = [];
  for (const v of usable) {
    const s = Math.sin(v.yawRad);
    const u = s;
    const w = s * Math.cos(v.yawRad);
    const g = frontalOffsetMm(v, faceWidthMm);
    rows.push({ u, w, g });
    suu += u * u;
    suv += u * w;
    svv += w * w;
    sug += u * g;
    svg += w * g;
  }

  const sol = solve2x2(suu, suv, svv, sug, svg);
  if (sol === null) {
    throw new CalibrationError(
      `Les angles balayés ne permettent pas de séparer la profondeur de la distance. ` +
        `Tournez la tête plus franchement, jusqu'à environ 25° de chaque côté.`,
    );
  }

  const half = faceWidthMm / 2;
  const depthMm = Math.abs(sol.a);

  // ⚠️ Le coefficient du terme en `sinθ·cosθ` ne vaut PAS `a²/D`, mais
  // `(a² + Δz²)/D`.
  //
  // Le développement exact de `u = f·X/Z` fait apparaître un second terme de
  // même forme, `−(Δz²/D)·sinθ·cosθ`, qui vient du rapprochement du front
  // lui-même quand la tête tourne. Les deux sont indiscernables par la
  // régression : elle mesure leur somme.
  //
  // Ne pas en tenir compte n'affecte pas la profondeur — elle est portée par
  // l'autre régresseur — mais sous-estime la DISTANCE de 27 % sur une tête
  // adulte. Vérifié au banc : 509 mm rendus pour 700 mm réels, avant correction.
  const lever = half * half + depthMm * depthMm;
  const distanceMm = Math.abs(sol.b) > 0 ? lever / Math.abs(sol.b) : Infinity;

  // 🔴 Incertitude par JACKKNIFE, et non par les résidus.
  //
  // La formule des résidus suppose des erreurs indépendantes d'une vue à
  // l'autre. Sur une vraie vidéo elles ne le sont pas du tout : le détecteur se
  // trompe de la même façon sur toutes les images d'une même phase de rotation,
  // le flou de bougé est corrélé, le roll dérive lentement. Résultat mesuré sur
  // la première vraie prise : les résidus annonçaient une profondeur sûre, et
  // la valeur passait de 15 mm à 44 mm selon l'image frontale retenue.
  //
  // On refait donc l'ajustement en retirant chaque vue à tour de rôle, et on
  // prend la DISPERSION des résultats. C'est plus lent — une trentaine de
  // systèmes 2×2 — et c'est la seule mesure d'incertitude que la première
  // confrontation au réel n'a pas démentie.
  const jack = jackknife(rows, half);
  const depthRelError = Math.min(1, jack.depthSd / Math.max(depthMm, 1e-6));
  const distanceRelError = Math.min(1, jack.leverSd / Math.max(Math.abs(sol.b), 1e-9));

  if (depthMm < DEPTH_MIN_MM || depthMm > DEPTH_MAX_MM) {
    throw new CalibrationError(
      `Profondeur mesurée : ${depthMm.toFixed(0)} mm, hors de tout plausible ` +
        `(${DEPTH_MIN_MM}–${DEPTH_MAX_MM} mm). Le visage a probablement été perdu en route.`,
    );
  }
  // ⚠️ Une distance hors plage n'est PAS une panne : c'est le cas NOMINAL sur
  // une vraie vidéo. Le banc l'avait annoncé — ±300 mm d'écart-type sur 700
  // dès 0,5 px de bruit — et la première vraie prise l'a confirmé en rendant
  // 4 cm. La profondeur, elle, reste bonne.
  //
  // On ne jette donc pas la mesure : on marque la distance comme inutilisable
  // (`relError = 1`), et la fusion en aval lui donnera un poids nul. Lever ici
  // faisait perdre AUSSI la profondeur, et la correction de parallaxe avec elle.
  const distanceUsable =
    Number.isFinite(distanceMm) && distanceMm >= DISTANCE_MIN_MM && distanceMm <= DISTANCE_MAX_MM;

  return {
    depthMm,
    depthRelError,
    distanceMm: distanceUsable ? distanceMm : NaN,
    distanceRelError: distanceUsable ? distanceRelError : 1,
    views: usable.length,
    yawSpreadRad,
  };
}
