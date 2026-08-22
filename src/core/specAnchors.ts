/**
 * core/specAnchors.ts — les ancres d'un spec CONTRE les dimensions RÉELLES de
 * l'image (ré-audit A15).
 *
 * `parseFrameSpec` ne connaît pas l'image : sa borne d'ancrage est un proxy
 * dérivé de la bbox. Ici, une fois l'image chargée (useSprites), les ancres et
 * la bbox alpha sont confrontées aux vraies dimensions — un spec dont le
 * `bridgeCenter` vit hors du fichier décalerait toute la monture sans rien
 * signaler, exactement le mode d'échec que le contrat combat (T4/B3).
 *
 * Calcul pur : ce fichier reçoit des NOMBRES, jamais un élément image — les
 * dimensions de fichier restent interdites dans la chaîne de MESURE (§9.0.g) ;
 * ici elles ne servent qu'à VALIDER, pas à mesurer.
 */

import type { FrameSpec } from './frameSpec.js';
import type { Pt } from './geom.js';

function outOf(name: string, p: Pt, w: number, h: number): string | null {
  if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) {
    return `« ${name} » (${p.x}, ${p.y}) hors de l'image réelle (${w}×${h})`;
  }
  return null;
}

/** Ancres du sprite de FACE vs l'image de face réelle. `null` = tout va bien. */
export function frontAnchorsInImageError(spec: FrameSpec, imageW: number, imageH: number): string | null {
  const bb = spec.alphaBBox;
  if (bb.x + bb.w > imageW || bb.y + bb.h > imageH) {
    return (
      `alphaBBox (${bb.x},${bb.y},${bb.w},${bb.h}) déborde de l'image réelle ` +
      `(${imageW}×${imageH}) — la bbox est périmée ou l'image a été remplacée`
    );
  }
  const anchors: ReadonlyArray<readonly [string, Pt | undefined]> = [
    ['bridgeCenter', spec.bridgeCenter],
    ['lensCenterL', spec.lensCenterL],
    ['lensCenterR', spec.lensCenterR],
    ['templeRootL', spec.templeRootL],
    ['templeRootR', spec.templeRootR],
  ];
  for (const [name, p] of anchors) {
    if (p === undefined) continue;
    const err = outOf(name, p, imageW, imageH);
    if (err !== null) return err;
  }
  return null;
}

/** Ancres du sprite de PROFIL vs l'image de profil réelle. `null` = tout va bien. */
export function profileAnchorsInImageError(spec: FrameSpec, imageW: number, imageH: number): string | null {
  return outOf('hingeProfile', spec.hingeProfile, imageW, imageH);
}
