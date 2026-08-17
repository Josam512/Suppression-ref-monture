/**
 * render/ycc.ts — luminance et chrominance, séparées.
 *
 * Le recoloriage V2 (§11) repose entièrement sur cette séparation : la vidéo
 * réelle apporte la LUMIÈRE — l'ombre sous le sourcil, le reflet sur l'acétate,
 * la perspective, le grain — et la photo produit apporte la MATIÈRE. Mélangés
 * en RVB, les deux sont inséparables ; séparés, la substitution est triviale.
 *
 * ⚠️ Volontairement du YCbCr BT.601, pas un espace perceptuel. Ce n'est pas de
 * la colorimétrie de laboratoire : c'est une décomposition rapide, réversible
 * et sans dépendance, appliquée à quelques dizaines de milliers de pixels par
 * image. Le critère du projet reste la JUSTESSE DE LA TAILLE, pas le
 * photoréalisme (§0).
 */

export interface Ycc {
  y: number;
  cb: number;
  cr: number;
}

export function toYcc(r: number, g: number, b: number): Ycc {
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    cb: 128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    cr: 128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  };
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

export function toRgb(c: Ycc): [number, number, number] {
  const cb = c.cb - 128;
  const cr = c.cr - 128;
  return [
    clamp255(c.y + 1.402 * cr),
    clamp255(c.y - 0.344136 * cb - 0.714136 * cr),
    clamp255(c.y + 1.772 * cb),
  ];
}

/** Distance colorimétrique simple, chrominance pondérée comme la luminance. */
export function distanceYcc(a: Ycc, b: Ycc): number {
  return Math.hypot(a.y - b.y, a.cb - b.cb, a.cr - b.cr);
}
