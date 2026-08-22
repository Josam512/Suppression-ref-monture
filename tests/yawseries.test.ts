/**
 * tests/yawseries.test.ts — SÉRIE de yaw 0/10/20/30/40° (ré-audit, section AF ;
 * guide c17/c34/S1). Le banc render-proof vérifie 20° contre 0° sur les pixels
 * peints ; ici la LOI est balayée sur tout le domaine utile, en calcul pur :
 *
 *   - la hauteur rendue ne bouge JAMAIS (un yaw ne raccourcit rien
 *     verticalement — la « respiration » verticale est la signature du bug S1) ;
 *   - la largeur rendue suit cos(yaw) EXACTEMENT UNE fois — à 30/40°, cos et
 *     cos² sont séparés sans ambiguïté (0,866 vs 0,750 ; 0,766 vs 0,587) ;
 *   - l'échelle `livePxPerMm` est ISOTROPE : constante sur toute la série
 *     (frameMetrics dé-projette AVANT de convertir) ;
 *   - l'échelle de la BRANCHE (templeAffine) est constante : une branche qui
 *     « respire » avec le yaw serait un double cos passé par l'autre porte.
 */

import { describe, expect, it } from 'vitest';

import { frameMetrics } from '../src/core/faceMetrics.js';
import {
  renderedFrameHeightPx,
  renderedFrameWidthPx,
  templeAffine,
} from '../src/core/transform.js';
import { makeCal, SPEC_132 } from './fixtures/builders.js';
import { H, W, makeFaceAtYaw } from './fixtures/landmarks.js';

const DEGREES = [0, 10, 20, 30, 40] as const;
const RAD = (deg: number): number => (deg * Math.PI) / 180;

function metricsAt(deg: number) {
  const yaw = RAD(deg);
  return frameMetrics(makeFaceAtYaw(yaw), W, H, makeCal(), yaw);
}

describe('série yaw 0→40° — aucune respiration, cos appliqué UNE fois (AF)', () => {
  const m0 = metricsAt(0);
  const width0 = renderedFrameWidthPx(SPEC_132, m0);
  const height0 = renderedFrameHeightPx(SPEC_132, m0);

  it('la hauteur rendue est CONSTANTE sur toute la série', () => {
    for (const deg of DEGREES) {
      const h = renderedFrameHeightPx(SPEC_132, metricsAt(deg));
      expect(Math.abs(h / height0 - 1), `hauteur à ${deg}°`).toBeLessThan(0.005);
    }
  });

  it('la largeur rendue suit cos(yaw) — et PAS cos²(yaw)', () => {
    for (const deg of DEGREES) {
      const ratio = renderedFrameWidthPx(SPEC_132, metricsAt(deg)) / width0;
      expect(Math.abs(ratio - Math.cos(RAD(deg))), `largeur à ${deg}°`).toBeLessThan(0.01);
      if (deg >= 20) {
        // La signature du bug S1 : cos² — clairement séparée à partir de 20°.
        expect(Math.abs(ratio - Math.cos(RAD(deg)) ** 2), `cos² exclu à ${deg}°`).toBeGreaterThan(0.05);
      }
    }
  });

  it('l’échelle livePxPerMm est isotrope : constante sur la série', () => {
    for (const deg of DEGREES) {
      expect(Math.abs(metricsAt(deg).livePxPerMm / m0.livePxPerMm - 1), `échelle à ${deg}°`).toBeLessThan(0.005);
    }
  });

  it('la BRANCHE ne respire pas : épaisseur constante, raccourci en sin(yaw) UNE fois', () => {
    // templeAffine : le long de la branche, s·sin(|yaw|) (colonne a,b) ;
    // perpendiculairement, s (colonne c,d) — un raccourci de perspective
    // raccourcit, il n'amincit pas. La série vérifie LES DEUX lois. (À 0°, la
    // direction est dégénérée et la branche fondue : série depuis 10°.)
    const t10 = templeAffine(SPEC_132, metricsAt(10), -1);
    const thickness10 = Math.hypot(t10.c, t10.d);
    for (const deg of [10, 20, 30, 40]) {
      const t = templeAffine(SPEC_132, metricsAt(deg), -1);
      const thickness = Math.hypot(t.c, t.d);
      expect(Math.abs(thickness / thickness10 - 1), `épaisseur à ${deg}°`).toBeLessThan(0.005);
      const alongPerSin = Math.hypot(t.a, t.b) / Math.sin(RAD(deg));
      // s (l'épaisseur) EST l'échelle de référence : along/sin doit la retrouver
      // exactement — un sin appliqué deux fois ferait diverger ce rapport.
      expect(Math.abs(alongPerSin / thickness - 1), `sin appliqué une fois à ${deg}°`).toBeLessThan(0.005);
    }
  });
});
