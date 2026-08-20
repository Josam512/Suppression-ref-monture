/**
 * core/provisionalScale.ts — l'échelle d'UNE seule frame, pour ne jamais
 * laisser l'écran vide.
 *
 * ## Pourquoi ce fichier existe (audit humain, 2026-08-21, point 4)
 *
 * `renderScene.ts` sortait avant de dessiner tant que `cal === null`. Le suivi
 * du visage pouvait être parfait — 478 landmarks stables — et l'écran restait
 * désespérément vide parce que la mesure MÉTRIQUE n'avait pas encore convergé.
 * Deux choses distinctes étaient liées par une seule condition :
 *
 *     suivi visuel (tracking)      ≠      métrologie absolue (mm certifiés)
 *
 * ## Ce que ce n'est PAS
 *
 * 🔴 Ce n'est ni un slider (§1 bug #1), ni un présupposé de taille (§0.0.3) :
 * aucune constante de largeur de visage n'entre ici. L'échelle vient de la
 * MÊME source physique que la calibration définitive — l'étalon biologique de
 * l'iris (`eyePlaneScale`) — simplement lue sur une seule image au lieu d'être
 * médianisée sur trente. C'est la même mesure, pas encore convergée.
 *
 * ## Ce que ça oblige l'IHM à faire
 *
 * Une échelle d'une seule frame porte tout le bruit de détection : elle suffit
 * à POSER l'image, jamais à AFFIRMER un millimètre. L'appelant doit donc :
 *   · dessiner la monture (c'est le cœur du produit, §0.0.2) ;
 *   · et geler la légende chiffrée — `verdict` reste `null`, exactement comme
 *     la règle 3 gèle les chiffres sans jamais interrompre l'essayage (§5).
 * Le nom `provisional` est là pour qu'aucun appelant ne puisse l'oublier.
 *
 * ## 🔴 Le biais qu'il porte, mesuré et NON corrigé
 *
 * La largeur 234↔454 est prise au plan des TEMPES ; le mm/px de l'iris vaut au
 * plan des YEUX, plus près de l'objectif. Il manque donc le terme de parallaxe
 * que `calibrateAuto` applique sur la mesure définitive : l'aperçu sort
 * quelques pour cent TROP ÉTROIT, et ce biais dépend de la distance (mesuré :
 * ~4 % d'écart entre 40 et 70 cm, `tests/autogates.test.ts`).
 *
 * Il n'est pas corrigé ici — le corriger demanderait la distance, donc la
 * chaîne complète, donc plus rien de « provisoire ». C'est précisément pour
 * cette raison que ce module n'a le droit de POSER qu'une image, et jamais
 * d'afficher un millimètre.
 */

import { faceWidthPx } from './faceMetrics.js';
import type { NormalizedLandmark } from './geom.js';
import { irisQualityOf } from './irisQuality.js';
import { eyePlaneScale, ocularPixelsOf } from './ocularScale.js';
import type { UserCalibration } from './calibration.js';

export interface ProvisionalScale {
  /** Utilisable par `frameMetrics` — pour DESSINER, jamais pour conclure. */
  cal: UserCalibration;
  /** Largeur d'iris retenue, en pixels : ce que le HUD doit montrer. */
  irisPx: number;
}

/**
 * L'échelle de CETTE frame, ou `null` si les iris n'y sont pas exploitables.
 *
 * `null` n'est pas une erreur : c'est « je ne peux pas encore poser l'image
 * honnêtement », et l'appelant l'affiche comme tel plutôt que de dessiner une
 * monture à une taille inventée.
 */
export function provisionalScale(
  lm: readonly NormalizedLandmark[],
  w: number,
  h: number,
  discrepancyMax: number,
  nowMs: number,
): ProvisionalScale | null {
  const eyes = ocularPixelsOf(lm, w, h);
  const iris = irisQualityOf(eyes.hvidLeftPx, eyes.hvidRightPx, discrepancyMax);
  if (!iris.ok) return null;

  const scale = eyePlaneScale(eyes);
  if (scale === null) return null;

  return {
    cal: {
      faceWidthMm: faceWidthPx(lm, w, h) * scale.mmPerPx,
      source: 'auto',
      relError: scale.relError,
      measuredAt: nowMs,
    },
    irisPx: iris.widthPx,
  };
}
