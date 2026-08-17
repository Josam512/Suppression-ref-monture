/**
 * core/cardEdges.ts — retrouver les quatre coins de la carte tout seul.
 *
 * ## Ce que ça résout
 *
 * `core/cardPose.ts` a besoin des quatre sommets, et il en a besoin sur BEAUCOUP
 * d'images : sur une seule vue la distance sort à ±20 %, sur cinquante à ±4 %.
 * Or on ne peut pas demander à un client d'ajuster cinquante cadres.
 *
 * Il n'en ajuste qu'un, grossièrement — voire il pose le doigt sur un coin, et
 * les trois autres suivent : la carte est un rectangle, ses bords sont des
 * droites, et un bord de carte sur une peau ou un fond est le contraste le plus
 * franc de la vignette. Le reste est de l'accrochage sur les bords.
 *
 * ## Comment
 *
 * Pour chacun des quatre côtés du quadrilatère approché :
 *
 *   1. on échantillonne des points le long du côté, en évitant les coins —
 *      c'est là que les deux bords se mélangent ;
 *   2. en chaque point on cherche, PERPENDICULAIREMENT au côté et sur quelques
 *      pixels seulement, le maximum du gradient de luminance ;
 *   3. on ajuste une droite sur les points trouvés, en écartant les aberrants —
 *      un chiffre gravé, un reflet, un doigt qui dépasse ;
 *   4. on intersecte les droites consécutives : voilà les quatre coins.
 *
 * La recherche est volontairement COURTE (quelques pixels) : une carte est
 * couverte de contrastes internes — bandes, hologramme, numéros — et une
 * recherche large accrocherait le mauvais. On raffine, on ne détecte pas.
 *
 * 🔴 Aucune 3D, aucune bibliothèque : des différences finies et une droite des
 * moindres carrés totaux.
 */

import { CalibrationError, type Pt } from './geom.js';
import { luma, type ImageBuffer } from './silhouette.js';
import type { CardQuad } from './cardPose.js';

/** Portée de la recherche perpendiculaire, en pixels de part et d'autre. */
export const SNAP_RADIUS_PX = 7;
/** Nombre de points échantillonnés le long de chaque côté. */
export const SAMPLES_PER_EDGE = 32;
/** Fraction de chaque extrémité laissée de côté : les coins mélangent deux bords. */
export const EDGE_MARGIN = 0.05;
/**
 * Au-delà, l'accrochage a suivi autre chose que la carte : on refuse.
 *
 * ⚠️ Valeur pour le cadre POINTÉ par le client, qui est déjà proche. Le suivi
 * d'une image à l'autre, lui, doit tolérer le déplacement réel de la tête entre
 * deux images : il passe sa propre tolérance.
 */
export const MAX_CORNER_SHIFT_PX = 12;
/** En deçà, le contraste est trop faible pour qu'un bord soit un bord. */
export const MIN_EDGE_GRADIENT = 6;

interface Line {
  /** Point du milieu de la droite. */
  p: Pt;
  /** Direction unitaire. */
  d: Pt;
}

/**
 * Luminance en coordonnées CONTINUES, par interpolation bilinéaire.
 *
 * 🔴 Le `−0,5` n'est pas cosmétique. Le pixel d'indice `i` couvre l'intervalle
 * `[i, i+1)` : sa valeur est celle de son CENTRE, en `i + 0,5`. Les coins que
 * pointe le client, eux, sont en coordonnées continues. Confondre les deux
 * décale tout d'un demi-pixel sur chaque axe — ce qui s'est vu immédiatement au
 * banc : les quatre coins raffinés ressortaient à 0,7 px de la vérité, de façon
 * parfaitement stable, quelle que soit la qualité de l'image.
 *
 * Un demi-pixel est négligeable partout ailleurs dans ce projet. Ici, le signal
 * qui porte la focale fait un ou deux pixels (§cardSweep) : c'est un tiers de
 * la mesure.
 */
function lumaAt(buf: ImageBuffer, xc: number, yc: number): number {
  const x = xc - 0.5;
  const y = yc - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const a = luma(buf, x0, y0);
  const b = luma(buf, x0 + 1, y0);
  const c = luma(buf, x0, y0 + 1);
  const d = luma(buf, x0 + 1, y0 + 1);
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/**
 * Point de plus fort gradient le long de la normale, ou `null` si trop plat.
 *
 * ⚠️ On rend la position SOUS-PIXEL, par interpolation parabolique des trois
 * gradients autour du maximum. Sans cela l'accrochage serait quantifié au pixel
 * — et c'est très exactement ce pixel-là que toute la mesure de focale cherche
 * (§cardPose : le signal fait un ou deux pixels).
 */
function snap(buf: ImageBuffer, p: Pt, n: Pt): Pt | null {
  let best = -1;
  let bestT = 0;
  const g: number[] = [];

  for (let i = 0; i <= 2 * SNAP_RADIUS_PX; i++) {
    const t = i - SNAP_RADIUS_PX;
    const before = lumaAt(buf, p.x + n.x * (t - 1), p.y + n.y * (t - 1));
    const after = lumaAt(buf, p.x + n.x * (t + 1), p.y + n.y * (t + 1));
    const mag = Math.abs(after - before) / 2;
    g.push(mag);
    if (mag > best) {
      best = mag;
      bestT = t;
    }
  }

  if (best < MIN_EDGE_GRADIENT) return null;

  const i = bestT + SNAP_RADIUS_PX;
  const gm = g[i - 1];
  const g0 = g[i];
  const gp = g[i + 1];
  let sub = 0;
  if (gm !== undefined && g0 !== undefined && gp !== undefined) {
    const denom = gm - 2 * g0 + gp;
    if (Math.abs(denom) > 1e-9) sub = (0.5 * (gm - gp)) / denom;
  }
  const t = bestT + Math.max(-1, Math.min(1, sub));
  return { x: p.x + n.x * t, y: p.y + n.y * t };
}

/** Distance d'un point à une droite. */
const residual = (l: Line, q: Pt): number =>
  Math.abs((q.x - l.p.x) * -l.d.y + (q.y - l.p.y) * l.d.x);

/**
 * Droite d'un bord, par consensus (RANSAC déterministe) puis moindres carrés.
 *
 * 🔴 Pourquoi pas un simple rejet à la médiane, qui était la première version.
 *
 * Sur la vraie vidéo, le sujet TIENT sa carte : son pouce couvre plus de la
 * moitié du bord droit. Un rejet à la médiane suppose que les aberrants sont
 * minoritaires — ici ils sont majoritaires, la médiane bascule du côté du
 * pouce, et le coin sortait à 16 px de sa place. Le consensus, lui, cherche la
 * droite qui explique le PLUS de points, quel que soit leur nombre relatif.
 *
 * L'énumération est exhaustive sur les paires (≈300 pour 24 points) : pas de
 * tirage au sort, donc pas de résultat qui change d'une exécution à l'autre.
 */
export const INLIER_PX = 1.5;
export const MIN_INLIERS = 7;

function fitLine(pts: readonly Pt[]): Line {
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
      if (len < 1) continue;
      const cand: Line = { p: a, d: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
      const inliers = pts.filter((q) => residual(cand, q) <= INLIER_PX);
      if (inliers.length > best.length) best = inliers;
    }
  }

  if (best.length < MIN_INLIERS) {
    throw new CalibrationError(
      `Un bord de la carte n'est pas une droite nette : masqué par un doigt, ` +
        `ou confondu avec le fond. Tenez la carte par le bord court.`,
    );
  }

  // Second tour : la droite du consensus, affinée, reclasse ses propres points.
  const refined = fit(best);
  const all = pts.filter((q) => residual(refined, q) <= INLIER_PX);
  return all.length >= MIN_INLIERS ? fit(all) : refined;
}

function intersect(a: Line, b: Line): Pt {
  const det = a.d.x * -b.d.y - a.d.y * -b.d.x;
  if (Math.abs(det) < 1e-9) {
    throw new CalibrationError('Deux bords de la carte sont parallèles : cadre invalide.');
  }
  const rx = b.p.x - a.p.x;
  const ry = b.p.y - a.p.y;
  const t = (rx * -b.d.y - ry * -b.d.x) / det;
  return { x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t };
}

/**
 * Raffine un quadrilatère approché en accrochant ses quatre bords sur l'image.
 *
 * @param quad cadre approché — celui du client, ou celui de l'image précédente.
 * @throws CalibrationError si un bord n'est pas trouvable, ou si le résultat
 *         s'éloigne trop du départ : mieux vaut perdre une vue que d'en ajouter
 *         une fausse au balayage.
 */
export function refineQuad(
  buf: ImageBuffer,
  quad: CardQuad,
  tolerancePx = MAX_CORNER_SHIFT_PX,
): CardQuad {
  // Deux passes. La première part d'un cadre approximatif : ses normales sont
  // légèrement de travers, et les points sont échantillonnés au mauvais endroit
  // le long du bord. La seconde repart du résultat, donc des bonnes normales —
  // et c'est elle qui fait descendre l'erreur sous le demi-pixel, qui est très
  // exactement l'enjeu (§cardSweep : le signal de focale fait un ou deux pixels).
  let out = onePass(buf, quad);
  out = onePass(buf, out);

  for (let c = 0; c < 4; c++) {
    const p = out[c] as Pt;
    const seed = quad[c] as Pt;
    const shift = Math.hypot(p.x - seed.x, p.y - seed.y);
    if (shift > tolerancePx) {
      throw new CalibrationError(
        `L'ajustement s'est écarté du cadre de ${shift.toFixed(0)} px au coin ${c} ` +
          `(limite ${tolerancePx}) : la carte a probablement été perdue de vue.`,
      );
    }
  }
  return out;
}

function onePass(buf: ImageBuffer, quad: CardQuad): CardQuad {
  const lines: Line[] = [];

  for (let e = 0; e < 4; e++) {
    const a = quad[e] as Pt;
    const b = quad[(e + 1) % 4] as Pt;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 4 * SNAP_RADIUS_PX) {
      throw new CalibrationError('Le cadre est trop petit pour être ajusté sur la carte.');
    }
    const n = { x: -dy / len, y: dx / len };

    const pts: Pt[] = [];
    for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
      const u = EDGE_MARGIN + ((1 - 2 * EDGE_MARGIN) * i) / (SAMPLES_PER_EDGE - 1);
      const hit = snap(buf, { x: a.x + dx * u, y: a.y + dy * u }, n);
      if (hit !== null) pts.push(hit);
    }
    if (pts.length < 6) {
      throw new CalibrationError(
        `Un bord de la carte n'est pas assez contrasté pour être suivi. ` +
          `Éclairez un peu plus, ou posez la carte sur une zone unie.`,
      );
    }
    lines.push(fitLine(pts));
  }

  const out: Pt[] = [];
  for (let c = 0; c < 4; c++) {
    const prev = lines[(c + 3) % 4];
    const next = lines[c];
    if (prev === undefined || next === undefined) throw new CalibrationError('Bord manquant.');
    out.push(intersect(prev, next));
  }

  return out as unknown as CardQuad;
}
