/**
 * core/edgeLines.ts — la droite d'un bord, à partir de points bruités.
 *
 * Extrait de `core/cardEdges.ts` pour tenir sous les 300 lignes du §3. Ce
 * fichier ne connaît ni carte, ni image : il ne voit que des points et des
 * droites. C'est ce qui le rend testable sans image du tout.
 */

import { CalibrationError, type Pt } from './geom.js';

export interface Line {
  /** Un point de la droite. */
  p: Pt;
  /** Direction unitaire. */
  d: Pt;
}

/** Distance d'un point à une droite. */
const residual = (l: Line, q: Pt): number =>
  Math.abs((q.x - l.p.x) * -l.d.y + (q.y - l.p.y) * l.d.x);

/**
 * Droite d'un bord, par consensus contraint par le cadre de départ.
 *
 * ## Deux critères faux avant celui-ci, et ce qu'ils coûtaient
 *
 * 1. **Rejet à la médiane.** Il suppose les aberrants minoritaires. Le sujet
 *    TIENT sa carte : son pouce couvre le milieu d'un bord court. Les aberrants
 *    y sont majoritaires, la médiane bascule de leur côté, le coin sortait à
 *    16 px.
 *
 * 2. **Consensus « le plus de points ».** Même issue, et pour la même raison :
 *    le contour du pouce est une droite plus longue et mieux échantillonnée que
 *    les vingt pixels de bord qui dépassent de part et d'autre. Il gagne.
 *
 * 🔴 Ce que ces deux-là oubliaient : **un bord masqué n'est pas un bord
 * inconnu.** La carte est un rectangle rigide, le cadre de départ vient du
 * client (ou de l'image précédente), et il est déjà à quelques pixels près. La
 * bonne droite n'est donc pas celle qui a le plus de points — c'est celle qui
 * est **compatible avec ce qu'on sait déjà**, et qui explique le mieux les
 * points qui restent. Quatre pixels de bord visible suffisent alors ; le pouce,
 * lui, est écarté d'office parce qu'il est trop loin du cadre.
 *
 * L'énumération des paires est exhaustive : pas de tirage au sort, donc pas de
 * résultat qui change d'une exécution à l'autre.
 */
export const INLIER_PX = 1.5;
/** Un bord partiellement masqué a peu de points : quatre suffisent à une droite. */
export const MIN_INLIERS = 4;
/** Décalage maximal admis entre la droite trouvée et le bord du cadre de départ. */
export const MAX_LINE_SHIFT_PX = 10;
/** Écart angulaire maximal, en radians. Un bord ne pivote pas. */
export const MAX_LINE_TILT_RAD = 0.2; // ~11°
/**
 * Nombre minimal de bords RÉELLEMENT accrochés sur l'image.
 *
 * ⚠️ Sans ce compte, le repli sur le cadre de départ rendrait n'importe quelle
 * image acceptable — y compris une image uniformément grise : les quatre bords
 * retomberaient sur la graine, le contrôle de déplacement des coins verrait
 * zéro écart, et la vue entrerait dans le balayage sans qu'aucun pixel n'ait
 * été mesuré. C'est le mode d'échec silencieux que ce projet combat.
 */
export const MIN_MEASURED_EDGES = 2;

/** Vrai si la droite candidate reste compatible avec le bord du cadre de départ. */
function nearSeed(cand: Line, a: Pt, b: Pt): boolean {
  if (residual(cand, a) > MAX_LINE_SHIFT_PX) return false;
  if (residual(cand, b) > MAX_LINE_SHIFT_PX) return false;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-6) return false;
  const cross = Math.abs(cand.d.x * ((b.y - a.y) / len) - cand.d.y * ((b.x - a.x) / len));
  return Math.asin(Math.min(1, cross)) <= MAX_LINE_TILT_RAD;
}

export interface EdgeFit {
  line: Line;
  /** Vrai si la droite vient des PIXELS, faux si elle est reprise de la graine. */
  measured: boolean;
}

export function fitLine(pts: readonly Pt[], seedA: Pt, seedB: Pt): EdgeFit {
  const fit = (xs: readonly Pt[]): Line => {
    const n = xs.length;
    const cx = xs.reduce((s, q) => s + q.x, 0) / n;
    const cy = xs.reduce((s, q) => s + q.y, 0) / n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const q of xs) {
      sxx += (q.x - cx) ** 2;
      syy += (q.y - cy) ** 2;
      sxy += (q.x - cx) * (q.y - cy);
    }
    // Vecteur propre dominant de la matrice de covariance 2×2.
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { p: { x: cx, y: cy }, d: { x: Math.cos(theta), y: Math.sin(theta) } };
  };

  let best: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i];
      const b = pts[j];
      if (a === undefined || b === undefined) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 3) continue; // deux points trop proches : direction non fiable
      const cand: Line = { p: a, d: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
      if (!nearSeed(cand, seedA, seedB)) continue; // ⭐ le pouce sort ici
      const inliers = pts.filter((q) => residual(cand, q) <= INLIER_PX);
      if (inliers.length > best.length) best = inliers;
    }
  }

  // ⭐ Aucun consensus compatible : le bord est TOTALEMENT masqué. Ce n'est pas
  // une panne — c'est un bord qu'on connaît par ailleurs. On garde celui du
  // cadre de départ : la carte est rigide, et un rectangle dont trois bords
  // sont accrochés n'a plus beaucoup de liberté sur le quatrième. La vue
  // restera dans le balayage, simplement un peu moins précise que les autres.
  const seedLen = Math.hypot(seedB.x - seedA.x, seedB.y - seedA.y);
  const seedLine: Line = {
    p: seedA,
    d: { x: (seedB.x - seedA.x) / seedLen, y: (seedB.y - seedA.y) / seedLen },
  };
  if (best.length < MIN_INLIERS) return { line: seedLine, measured: false };

  // Second tour : la droite du consensus, affinée, reclasse ses propres points.
  const refined = fit(best);
  const all = pts.filter((q) => residual(refined, q) <= INLIER_PX);
  const out = all.length >= MIN_INLIERS ? fit(all) : refined;
  return nearSeed(out, seedA, seedB)
    ? { line: out, measured: true }
    : { line: seedLine, measured: false };
}

export function intersect(a: Line, b: Line): Pt {
  const det = a.d.x * -b.d.y - a.d.y * -b.d.x;
  if (Math.abs(det) < 1e-9) {
    throw new CalibrationError('Deux bords de la carte sont parallèles : cadre invalide.');
  }
  const rx = b.p.x - a.p.x;
  const ry = b.p.y - a.p.y;
  const t = (rx * -b.d.y - ry * -b.d.x) / det;
  return { x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t };
}

