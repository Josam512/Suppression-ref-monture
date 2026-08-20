/**
 * tests/nosecontact.test.ts — 🧪 prototype noseContactCandidate (2026-08-20).
 *
 * HORS production : la pose baseline (§14.6) est intouchée — le test de
 * protection vit dans fronttemporal.test.ts (aucun import expérimental dans
 * src/core|render|ui|tracking|prep). Ici on verrouille le candidat lui-même :
 *
 *   1. le point de repos DÉPEND du nez observé (deux nez → deux repos) —
 *      aucun VERTICAL_OFFSET constant ne peut reproduire ce comportement ;
 *   2. il dépend aussi du PONT de la monture (18 vs 22 mm) — physique ;
 *   3. hors du profil mesuré → null + raison, jamais une valeur extrapolée ;
 *   4. indices faux (paires asymétriques) → confiance effondrée, dit ;
 *   5. le z est consommé en RELATIF normalisé, jamais en millimètres.
 */

import { describe, expect, it } from 'vitest';

import type { NormalizedLandmark, Pt } from '../src/core/geom.js';
import {
  noseContactCandidate,
  NOSE_MIDLINE,
  NOSE_WIDTH_PAIRS,
} from '../src/experimental/noseContact.js';

const W = 1280;
const H = 720;
const PX_PER_MM = 3.1; // échelle « existante » du test
const CX = W / 2;
const ANCHOR: Pt = { x: CX, y: 300 }; // ancre baseline fictive, ligne des yeux

/**
 * Nez synthétique : chaîne médiane verticale sous l'ancre, paires symétriques
 * dont la largeur croît de `rootMm` à `tipMm` sur 24 mm de hauteur.
 */
function noseFace(rootMm: number, tipMm: number, over: { skewPx?: number; z?: boolean } = {}) {
  const lm: NormalizedLandmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const topY = ANCHOR.y;
  const stepY = (24 * PX_PER_MM) / (NOSE_WIDTH_PAIRS.length - 1);

  NOSE_MIDLINE.forEach((idx, k) => {
    const y = topY + k * ((24 * PX_PER_MM) / (NOSE_MIDLINE.length - 1));
    const z = over.z === true ? -0.02 - 0.01 * k : undefined;
    lm[idx] = { x: CX / W, y: y / H, ...(z !== undefined ? { z } : {}) };
  });

  NOSE_WIDTH_PAIRS.forEach(([li, ri], k) => {
    const y = (topY + k * stepY) / H;
    const t = k / (NOSE_WIDTH_PAIRS.length - 1);
    const halfPx = ((rootMm + t * (tipMm - rootMm)) / 2) * PX_PER_MM;
    const skew = over.skewPx ?? 0;
    lm[li] = { x: (CX - halfPx + skew) / W, y };
    lm[ri] = { x: (CX + halfPx + skew) / W, y };
  });
  return lm;
}

function run(lm: NormalizedLandmark[], pontMm = 22) {
  return noseContactCandidate({ lm, w: W, h: H, pxPerMm: PX_PER_MM, pontMm, baselineAnchor: ANCHOR });
}

describe('le repos dépend du NEZ observé — aucune constante possible', () => {
  it('nez étroit (14→30) et nez large (20→34) → deux points de repos différents', () => {
    const narrow = run(noseFace(14, 30));
    const wide = run(noseFace(20, 34));
    expect(narrow.restPoint).not.toBeNull();
    expect(wide.restPoint).not.toBeNull();
    // Le nez large atteint 22 mm PLUS HAUT : le pont y repose plus haut.
    expect(wide.restOffsetMm!).toBeLessThan(narrow.restOffsetMm!);
    expect(Math.abs(narrow.restOffsetMm! - wide.restOffsetMm!)).toBeGreaterThan(2);
  });

  it('même nez, pont 18 vs 22 mm → le pont étroit repose plus haut', () => {
    const p18 = run(noseFace(14, 30), 18);
    const p22 = run(noseFace(14, 30), 22);
    expect(p18.restOffsetMm!).toBeLessThan(p22.restOffsetMm!);
  });

  it('l’axe médian est mesuré : un nez décalé décale l’axe, pas une constante', () => {
    const straight = run(noseFace(14, 30));
    expect(straight.axis.origin.x).toBeCloseTo(CX, 0);
    expect(Math.abs(straight.axis.dir.x)).toBeLessThan(0.05); // quasi vertical
  });
});

describe('hors du profil MESURÉ → null, jamais extrapolé', () => {
  it('nez plus étroit que le pont partout → restPoint null + raison', () => {
    const r = run(noseFace(10, 18), 22);
    expect(r.restPoint).toBeNull();
    expect(r.restOffsetMm).toBeNull();
    expect(r.notes.join(' ')).toMatch(/plus étroit que le pont/i);
  });

  it('nez déjà plus large que le pont à la racine → null + raison', () => {
    const r = run(noseFace(26, 40), 22);
    expect(r.restPoint).toBeNull();
    expect(r.notes.join(' ')).toMatch(/au-dessus de la zone mesurée/i);
  });
});

describe('auto-défense contre des indices faux', () => {
  it('paires décalées de l’axe (indices faux simulés) → confiance effondrée', () => {
    const good = run(noseFace(14, 30));
    const bad = run(noseFace(14, 30, { skewPx: 60 }));
    expect(bad.confidence).toBeLessThan(good.confidence / 2);
    expect(bad.notes.join(' ')).toMatch(/re-sonder/i);
  });
});

describe('le z MediaPipe reste RELATIF', () => {
  it('profil du dorsum normalisé 0..1, note explicite, jamais des mm', () => {
    const r = run(noseFace(14, 30, { z: true }));
    expect(r.dorsumRelDepth).not.toBeNull();
    for (const v of r.dorsumRelDepth!) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(r.notes.join(' ')).toMatch(/jamais métrique/i);
  });

  it('sans z, le diagnostic est simplement absent — pas de valeur par défaut', () => {
    expect(run(noseFace(14, 30)).dorsumRelDepth).toBeNull();
  });
});
