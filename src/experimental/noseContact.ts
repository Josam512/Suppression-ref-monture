/**
 * experimental/noseContact.ts — 🧪 PROTOTYPE : où le pont de la monture vient
 * reposer sur CE nez (mission 2026-08-20, §5–6).
 *
 * ⚠️ HORS PRODUCTION. La pose baseline (§14.6 : X = sellion, Y = ligne des
 * canthi / centres optiques) reste LA pose de rendu — ce module ne déplace
 * RIEN. Il calcule un candidat comparatif, affiché par l'atelier seulement.
 *
 * ## La logique physique (eyewear-fit paramétrique)
 *
 * Un pont de largeur intérieure DBL descend le long de l'arête du nez jusqu'à
 * la hauteur où le nez est AUSSI LARGE que lui. C'est la règle des ateliers de
 * lunetterie sur mesure : le contour de pont se détermine par le sellion et le
 * profil de largeur de la racine nasale — pas par une constante.
 *
 *   - axe médian du nez : MESURÉ (moindres carrés sur la chaîne médiane x/y) ;
 *   - profil de largeur : MESURÉ (paires latérales converties par l'échelle
 *     de la calibration EXISTANTE) ;
 *   - point de repos : INTERPOLÉ dans le profil mesuré — jamais extrapolé :
 *     hors du profil, le résultat est null et la raison est dite ;
 *   - profondeur du dorsum : z RELATIF MediaPipe, normalisé sur lui-même —
 *     🔴 JAMAIS une échelle métrique (§4 : translation/échelle canoniques
 *     interdites ; seul un profil sans dimension est toléré, en diagnostic).
 *
 * 🔴 Il est INTERDIT d'introduire un VERTICAL_OFFSET_MM constant ici : tout
 * dépend du visage observé et de la monture considérée (§14.6, T1).
 *
 * ⚠️ Les indices ci-dessous sont des CANDIDATS issus de la topologie du
 * maillage ; la sonde d'atelier (`scripts/preview-vto.mjs`) les confronte au
 * sujet réel, et `noseContactCandidate` vérifie lui-même leur cohérence
 * géométrique (symétrie autour de l'axe, profil croissant) — un jeu d'indices
 * faux fait chuter la confiance au lieu de produire un chiffre plausible.
 */

import { dist, type NormalizedLandmark, type Pt } from '../core/geom.js';

/** Chaîne médiane du nez, du sellion vers la pointe (168 = sellion, §4). */
export const NOSE_MIDLINE: readonly number[] = [168, 6, 197, 195, 5];

/**
 * Paires latérales (gauche, droite) — PAROIS du nez, de la racine vers le bas.
 *
 * ⭐ Sondées sur le sujet réel le 2026-08-20 (photo sans lunettes, yaw −1,6°) :
 * largeurs mesurées 16,0 → 20,1 → 20,2 → 20,2 → 22,6 → 23,4 mm, asymétrie
 * ≤ 0,9 mm — un profil de paroi croissant, physiquement cohérent.
 *
 * 🔴 Premier jet corrigé par la sonde : les paires initiales (122/351,
 * 196/419, 3/248…) suivaient l'ARÊTE du dorsum (~11 mm, non croissant) — le
 * garde-fou interne l'avait signalé sur la vraie photo avant toute correction.
 */
export const NOSE_WIDTH_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [193, 417],
  [188, 412],
  [174, 399],
  [236, 456],
  [134, 363],
  [220, 440],
];

export interface NoseContactInput {
  lm: readonly NormalizedLandmark[];
  w: number;
  h: number;
  /** Échelle de la calibration EXISTANTE — jamais déduite du z MediaPipe. */
  pxPerMm: number;
  /** Largeur intérieure du pont de la monture considérée (DBL), en mm. */
  pontMm: number;
  /** L'ancre de pose BASELINE (m.poseAnchor), pour comparaison seulement. */
  baselineAnchor: Pt;
}

export interface NoseContactResult {
  /** Axe médian du nez : origine au sellion, direction unitaire vers le bas. */
  axis: { origin: Pt; dir: Pt };
  /** Largeur du nez en mm, aux hauteurs mesurées (ordonnées croissantes). */
  widthProfile: Array<{ y: number; widthMm: number }>;
  /** Où le pont de CETTE monture repose — null si hors du profil MESURÉ. */
  restPoint: Pt | null;
  /** Écart vertical repos ↔ ancre baseline, en mm (+ = plus bas). Diagnostic. */
  restOffsetMm: number | null;
  /** Profil de protrusion du dorsum, normalisé 0..1. ESTIMÉ (z relatif). */
  dorsumRelDepth: number[] | null;
  confidence: number;
  notes: string[];
}

const toPx = (l: NormalizedLandmark, w: number, h: number): Pt => ({ x: l.x * w, y: l.y * h });

/** Moindres carrés x = a + b·y — le nez est quasi vertical à l'écran. */
function fitAxis(pts: Pt[]): { origin: Pt; dir: Pt } {
  const n = pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.y - my) * (p.x - mx);
    den += (p.y - my) * (p.y - my);
  }
  const b = den > 1e-9 ? num / den : 0;
  const norm = Math.hypot(b, 1);
  return { origin: pts[0] ?? { x: mx, y: my }, dir: { x: b / norm, y: 1 / norm } };
}

export function noseContactCandidate(input: NoseContactInput): NoseContactResult {
  const { lm, w, h, pxPerMm, pontMm, baselineAnchor } = input;
  const notes: string[] = [];
  let confidence = 1;

  const mid = NOSE_MIDLINE.map((i) => toPx(lm[i] ?? { x: 0.5, y: 0.5 }, w, h));
  const axis = fitAxis(mid);

  // — Profil de largeur, trié du haut (racine) vers le bas.
  const axisXAt = (y: number): number => axis.origin.x + (axis.dir.x / axis.dir.y) * (y - axis.origin.y);
  const profile: Array<{ y: number; widthMm: number }> = [];
  for (const [li, ri] of NOSE_WIDTH_PAIRS) {
    const a = toPx(lm[li] ?? { x: 0.5, y: 0.5 }, w, h);
    const b = toPx(lm[ri] ?? { x: 0.5, y: 0.5 }, w, h);
    const y = (a.y + b.y) / 2;
    const widthMm = dist(a, b) / pxPerMm;
    // Cohérence : la paire doit être symétrique autour de l'axe médian. Un jeu
    // d'indices faux échoue ICI, au lieu de produire un profil plausible.
    const midOffset = Math.abs((a.x + b.x) / 2 - axisXAt(y));
    if (midOffset > 0.35 * dist(a, b)) {
      confidence *= 0.5;
      notes.push(`Paire (${li},${ri}) asymétrique autour de l'axe : indices à re-sonder.`);
      continue;
    }
    profile.push({ y, widthMm });
  }
  profile.sort((p, q) => p.y - q.y);

  // Le nez s'élargit vers le bas : les inversions franches trahissent la sonde.
  for (let i = 1; i < profile.length; i++) {
    const prev = profile[i - 1];
    const cur = profile[i];
    if (prev !== undefined && cur !== undefined && cur.widthMm < prev.widthMm - 1.5) {
      confidence *= 0.7;
      notes.push(`Profil non croissant à y=${cur.y.toFixed(0)} : mesure bruitée ou indices faux.`);
    }
  }

  // — Le point de repos : première hauteur où le nez atteint la largeur du pont.
  let restPoint: Pt | null = null;
  if (profile.length >= 2) {
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1];
      const b = profile[i];
      if (a === undefined || b === undefined) continue;
      if (a.widthMm <= pontMm && b.widthMm >= pontMm) {
        const t = b.widthMm === a.widthMm ? 0 : (pontMm - a.widthMm) / (b.widthMm - a.widthMm);
        const y = a.y + t * (b.y - a.y);
        restPoint = { x: axisXAt(y), y };
        break;
      }
    }
    if (restPoint === null) {
      const top = profile[0];
      const bottom = profile[profile.length - 1];
      notes.push(
        top !== undefined && top.widthMm > pontMm
          ? `Nez déjà plus large que le pont (${pontMm} mm) à la racine : repos au-dessus de la zone mesurée.`
          : `Nez plus étroit que le pont (${pontMm} mm) sur toute la zone mesurée (max ` +
              `${bottom === undefined ? 0 : bottom.widthMm.toFixed(0)} mm) : le repos serait plus bas — ` +
              `hors du profil, on ne l'invente pas.`,
      );
      confidence *= 0.6;
    }
  } else {
    notes.push('Profil de largeur insuffisant : pas de point de repos calculable.');
    confidence = 0;
  }

  // — Diagnostic z : RELATIF, normalisé sur lui-même. Jamais converti en mm.
  let dorsumRelDepth: number[] | null = null;
  const zs = NOSE_MIDLINE.map((i) => lm[i]?.z).filter((z): z is number => z !== undefined);
  if (zs.length === NOSE_MIDLINE.length) {
    const min = Math.min(...zs);
    const span = Math.max(...zs) - min;
    dorsumRelDepth = span > 1e-9 ? zs.map((z) => (z - min) / span) : zs.map(() => 0);
    notes.push('Profil du dorsum : z RELATIF MediaPipe, sans dimension — jamais métrique (§4).');
  }

  return {
    axis,
    widthProfile: profile,
    restPoint,
    restOffsetMm: restPoint === null ? null : (restPoint.y - baselineAnchor.y) / pxPerMm,
    dorsumRelDepth,
    confidence,
    notes,
  };
}
