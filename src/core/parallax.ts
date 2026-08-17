/**
 * core/parallax.ts — MESURER la profondeur au lieu de la supposer.
 * (CLAUDE.md §4, correctif B4, parade n°2 : « rotation de tête ».)
 *
 * ## Le problème que ce fichier résout
 *
 * La carte est posée sur le FRONT. Les repères 234/454 qui servent à mesurer le
 * visage sont sur le contour, 20 à 40 mm EN ARRIÈRE de ce plan. En projection
 * perspective l'échelle varie en 1/z : la carte est donc vue « trop grande »
 * par rapport aux tempes, et la largeur de visage sort SOUS-ESTIMÉE de 3 à 7 %.
 *
 * C'est un biais SYSTÉMATIQUE, pas du bruit. Les « 3 mesures concordantes »
 * exigées par le §4 ne le détectent pas : elles le confirment, puisque les
 * trois partagent exactement le même biais.
 *
 * ## Ce qu'on extrait, et ce qu'on n'extrait pas
 *
 * 🔴 AUCUNE 3D n'est introduite. On ne reconstruit aucun maillage, on n'affiche
 * rien en 3D, aucune bibliothèque de géométrie projective n'entre ici. On
 * extrait UN scalaire — un écart de profondeur en millimètres — de deux images.
 * Le rendu reste du sprite 2D sur canvas. C'est très exactement le cadrage que
 * le §4 pose pour cette parade, et il ne doit pas être élargi : si une tâche
 * future invoque ce fichier pour justifier un solveur de pose 3D, elle
 * contredit le contrat.
 */

import { at, CalibrationError, midpoint, px, type NormalizedLandmark } from './geom.js';
import { EYE_L, EYE_R, faceWidthPx } from './faceMetrics.js';

/**
 * Repère de mi-front, sur le plan sagittal — là où la carte repose.
 *
 * Il n'a pas besoin d'être exactement au point de contact de la carte : la
 * mesure ci-dessous est DIFFÉRENTIELLE entre deux vues, ce qui élimine tout
 * décalage constant de ce repère (voir `depthOffsetMm`).
 */
export const FOREHEAD = 151;

/** Repère de sonde effectif — surchargeable en atelier pour comparer. */
export let PROBE_LANDMARK = FOREHEAD;
export function setProbeLandmark(i: number): void {
  PROBE_LANDMARK = i;
}

/**
 * ⭐ Paire symétrique servant de RÉFÉRENCE sagittale : les COINS EXTERNES DES YEUX.
 *
 * ## Pourquoi surtout pas 234/454
 *
 * C'était le choix d'origine, et c'est la plus grosse erreur de ce fichier. Les
 * repères 234/454 sont sur le CONTOUR du visage : quand la tête tourne, ils ne
 * suivent pas un point de la peau, ils **glissent le long de la silhouette**.
 * Ce ne sont pas des points physiques, et leur milieu se déplace de plusieurs
 * dizaines de millimètres sans qu'aucune profondeur soit en cause.
 *
 * Mesurée sur la première vraie vidéo, la profondeur sortait alors à **99 mm**
 * quel que soit le repère sondé — front, sellion, glabelle, pointe du nez. Le
 * coupable n'était donc pas la sonde mais la référence. Avec les coins externes
 * des yeux, qui sont eux de vrais points anatomiques, la même vidéo donne
 * **36,8 mm à ±1 %**.
 *
 * ## Pourquoi les coins EXTERNES
 *
 * Ils sont à hauteur des yeux — exactement la ligne où l'écart temporal est
 * mesuré, et où passe la face d'une monture. Le plan qu'ils définissent est donc
 * celui dont on veut l'échelle, à quelques millimètres près, alors que les
 * canthus internes ou les ailes du nez sont nettement plus en avant : la même
 * vidéo donne 26,7 mm et 13,9 mm avec eux. La différence n'est pas du bruit,
 * c'est de l'anatomie — et c'est bien la preuve que la mesure fonctionne.
 */
export let REFERENCE_PAIR: [number, number] = [EYE_L, EYE_R];
export function setReferencePair(a: number, b: number): void {
  REFERENCE_PAIR = [a, b];
}

/** En deçà, sin(θ) est trop petit et le bruit des repères domine le signal. */
export const MIN_PROBE_YAW_RAD = 0.17; // ~10°
/** Au-delà, les repères latéraux décrochent et le modèle plan ne tient plus. */
export const MAX_PROBE_YAW_RAD = 0.61; // ~35°
/** Une tête inclinée mélange les axes : on dé-projette le roll, mais pas au-delà. */
export const MAX_PROBE_ROLL_RAD = 0.26; // ~15°

/** Bornes de plausibilité anatomique du front → tempes. Détecteur de panne. */
export const DEPTH_MIN_MM = 5;
export const DEPTH_MAX_MM = 60;

/** Incertitude relative sur la profondeur mesurée (bruit des repères ÷ sin θ). */
export const DEPTH_REL_UNCERTAINTY = 0.25;
/** Incertitude relative sur la distance caméra, qui repose sur un HFOV supposé. */
export const DISTANCE_REL_UNCERTAINTY = 0.2;

/** Une vue tournée : les repères, l'angle MESURÉ, et les dimensions de l'image. */
export interface RotatedView {
  lm: readonly NormalizedLandmark[];
  yawRad: number;
  rollRad: number;
  w: number;
  h: number;
}

/** Vrai si la vue est exploitable par la sonde. Sert aussi à l'IHM de collecte. */
export function isUsableProbeView(v: RotatedView): boolean {
  const yaw = Math.abs(v.yawRad);
  return yaw >= MIN_PROBE_YAW_RAD && yaw <= MAX_PROBE_YAW_RAD && Math.abs(v.rollRad) <= MAX_PROBE_ROLL_RAD;
}

/**
 * Écart horizontal signé, en millimètres : repère de front − milieu des repères
 * temporaux, projeté sur l'axe des yeux pour ne pas mélanger le roll.
 *
 * L'échelle de CETTE vue se déduit de la largeur apparente dé-projetée du
 * cos(yaw) — exactement comme `frameMetrics`. Elle n'entre que dans un terme
 * correctif du second ordre : une erreur de 10 % dessus vaut 0,5 % au total.
 */
export function frontalOffsetMm(v: RotatedView, faceWidthMm: number): number {
  const pxPerMm = faceWidthPx(v.lm, v.w, v.h) / Math.cos(v.yawRad) / faceWidthMm;

  const f = px(at(v.lm, PROBE_LANDMARK), v.w, v.h);
  const m = midpoint(
    px(at(v.lm, REFERENCE_PAIR[0]), v.w, v.h),
    px(at(v.lm, REFERENCE_PAIR[1]), v.w, v.h),
  );

  const c = Math.cos(v.rollRad);
  const s = Math.sin(v.rollRad);
  return ((f.x - m.x) * c + (f.y - m.y) * s) / pxPerMm;
}

/**
 * Décalage perspectif du MILIEU des deux tempes, en millimètres.
 *
 * 🔴 Le piège que ce terme corrige. Le milieu de deux points PROJETÉS n'est pas
 * la projection de leur milieu : dès que la tête tourne, la tempe la plus proche
 * s'étale et tire le milieu apparent vers elle. En développant
 * `u = f·X/Z` pour les deux tempes en `(±a, 0)` on obtient exactement
 * `u_milieu/f ≈ a²·cos θ·sin θ / D²`, soit `a²·cos θ·sin θ / D` une fois
 * converti en millimètres.
 *
 * Ce n'est pas une approximation morphologique — `a` est mesuré, `D` est estimé
 * — mais une propriété de la projection. Non corrigé, il ajoute près de 20 % au
 * signal cherché, dans le même sens quelles que soient les vues : un biais, donc,
 * que la mesure différentielle à deux vues ne peut pas éliminer.
 */
export function midpointPerspectiveBiasMm(
  halfWidthMm: number,
  distanceMm: number,
  yawRad: number,
): number {
  if (!Number.isFinite(distanceMm) || distanceMm <= 0) return 0;
  return (halfWidthMm * halfWidthMm * Math.cos(yawRad) * Math.sin(yawRad)) / distanceMm;
}

/**
 * Écart de profondeur front ↔ plan des repères temporaux, en millimètres.
 *
 * ## La géométrie, en trois lignes
 *
 * Repère de tête : X à droite, Z vers le fond. Rotation de `yaw` autour de la
 * verticale. En prenant le milieu des tempes pour origine, le front est en
 * `(0, −Δz)` avec Δz > 0. Après rotation, son abscisse vaut `−Δz·sin(yaw)`.
 * L'écart front↔tempes projeté est donc `g(θ) = −Δz·sin θ` : il est NUL de
 * face, et croît avec l'angle. C'est ce signal-là qu'on mesure.
 *
 * ## Pourquoi DEUX vues, et pas une
 *
 * Avec une seule vue, tout décalage constant — repère 151 pas exactement sur le
 * plan sagittal, tête pas parfaitement centrée, asymétrie du visage — se
 * confondrait avec le signal. La différence entre une vue à gauche et une vue à
 * droite l'élimine : `g(θ1) − g(θ2) = −Δz·(sin θ1 − sin θ2)`.
 *
 * ## Pourquoi la valeur absolue
 *
 * Le SIGNE de `yawRad` dépend d'une convention (celle de la matrice MediaPipe)
 * qu'on ne peut pas vérifier sans mire. La MAGNITUDE, elle, ne dépend d'aucune
 * convention. Or le front est anatomiquement DEVANT les tempes, toujours : le
 * signe est un fait, pas une mesure. On mesure donc ce qui se mesure, et on
 * pose ce qui est certain. Ce n'est pas un présupposé de taille (§0.0.3) : la
 * VALEUR reste entièrement mesurée.
 *
 * @param faceWidthMm largeur naïve du visage, pour l'échelle des deux vues.
 * @param distanceMm distance caméra estimée — n'entre que dans la correction
 *        perspective du milieu, donc au second ordre.
 * @throws CalibrationError si les vues ne permettent pas de conclure.
 */
export function depthOffsetMm(
  a: RotatedView,
  b: RotatedView,
  faceWidthMm: number,
  distanceMm: number,
): number {
  if (!isUsableProbeView(a) || !isUsableProbeView(b)) {
    throw new CalibrationError(
      `Rotation insuffisante ou tête inclinée. Tournez la tête d'environ 20° de chaque côté, ` +
        `sans la pencher, en gardant les yeux sur l'écran.`,
    );
  }
  if (Math.sign(a.yawRad) === Math.sign(b.yawRad)) {
    throw new CalibrationError(
      `Les deux vues sont du même côté. Il en faut une à gauche ET une à droite.`,
    );
  }

  const half = faceWidthMm / 2;
  const corrected = (v: RotatedView): number =>
    frontalOffsetMm(v, faceWidthMm) + midpointPerspectiveBiasMm(half, distanceMm, v.yawRad);

  const denom = Math.sin(a.yawRad) - Math.sin(b.yawRad);
  const depth = Math.abs((corrected(b) - corrected(a)) / denom);

  if (!Number.isFinite(depth) || depth < DEPTH_MIN_MM || depth > DEPTH_MAX_MM) {
    throw new CalibrationError(
      `Profondeur mesurée : ${depth.toFixed(0)} mm, hors de tout plausible (${DEPTH_MIN_MM}–${DEPTH_MAX_MM} mm). ` +
        `Le visage a probablement été perdu pendant la rotation. Recommencez.`,
    );
  }
  return depth;
}

/**
 * Facteur qui ramène l'échelle du plan de la CARTE à celui des TEMPES.
 *
 * `k_tempes = k_carte / (1 + Δz/z)`, donc une longueur mesurée avec l'échelle
 * de la carte doit être MULTIPLIÉE par ce facteur. Il est toujours > 1 : la
 * carte, plus proche, fait paraître le visage plus petit qu'il n'est.
 */
export function parallaxFactor(depthMm: number, distanceMm: number): number {
  if (!Number.isFinite(distanceMm) || distanceMm <= 0) return 1;
  return 1 + depthMm / distanceMm;
}

/**
 * Ce qu'il RESTE d'erreur une fois la parallaxe mesurée.
 *
 * Le biais brut valait `Δz/z`, soit 3 à 7 %. Après mesure il ne reste que
 * l'incertitude SUR cette correction — un ordre de grandeur plus petit. C'est
 * là tout le gain : on ne gagne presque rien en précision affichée, on
 * supprime un biais systématique qui, lui, ne se voyait nulle part.
 */
export function parallaxResidualRelError(depthMm: number, distanceMm: number): number {
  if (!Number.isFinite(distanceMm) || distanceMm <= 0) return 0;
  return (depthMm / distanceMm) * Math.hypot(DEPTH_REL_UNCERTAINTY, DISTANCE_REL_UNCERTAINTY);
}
