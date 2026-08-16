/**
 * tests/guards.test.ts — les garde-fous qui verrouillent des PRINCIPES.
 *
 * Leçon de B2 et S4 : un test garde-fou dont le résultat dépend du choix d'une
 * fixture n'est pas un garde-fou. Chaque test ci-dessous balaie un domaine, ou
 * inspecte le dépôt lui-même.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CalSource } from '../src/core/calibration.js';
import { CalibrationError } from '../src/core/geom.js';
import { assertSameModel, parseFrameSpec } from '../src/core/frameSpec.js';
import { classify } from '../src/core/verdict.js';

import { LANDMARKS_138 } from './fixtures/landmarks.js';
import { callVerdict, makeCal, SPEC_132, specForTotalWidthMm } from './fixtures/builders.js';

const SOURCES: readonly CalSource[] = ['iris', 'card', 'worn-frame'];

/** Balaie la zone limite ET les écarts francs, des deux côtés du seuil. */
const DELTAS = [-18, -8, -5, -4.1, -3, -1, 0, 1, 3, 4.1, 5, 8, 18];

describe('GARDE-FOU B2 — classify ignore `source`', () => {
  it('à relError égal, les 3 sources donnent le même statut pour TOUT delta', () => {
    for (const delta of DELTAS) {
      const statuses = SOURCES.map((source) => classify(delta, makeCal({ source, relError: 0.02 })));
      expect(new Set(statuses).size, `divergence à delta=${delta}`).toBe(1);
    }
  });

  it('à relError différent, le statut PEUT changer — c\'est la précision qui décide', () => {
    // La contre-épreuve du test précédent : si rien ne faisait jamais varier le
    // statut, le garde-fou ci-dessus serait vert par construction.
    const precise = classify(-5, makeCal({ source: 'iris', relError: 0.005 }));
    const flou = classify(-5, makeCal({ source: 'iris', relError: 0.043 }));
    expect(precise).toBe('sous-taillee');
    expect(flou).toBe('indetermine');
  });
});

describe('GARDE-FOU §11.4 — les 3 sources suivent le même chemin en aval', () => {
  it('statut et delta identiques pour toute largeur de monture', () => {
    for (const delta of DELTAS) {
      const spec = specForTotalWidthMm(138 + delta);
      const vs = SOURCES.map((source) =>
        callVerdict(LANDMARKS_138, makeCal({ source, relError: 0.02 }), spec),
      );

      const statuses = vs.map((v) => v.status);
      expect(new Set(statuses).size, `statuts divergents à delta=${delta}`).toBe(1);
      expect(vs[2]!.deltaMm).toBeCloseTo(vs[0]!.deltaMm, 6);
      expect(vs[1]!.thresholdMm).toBeCloseTo(vs[0]!.thresholdMm, 6);
    }
  });
});

describe('GARDE-FOU §0.0.1 — le code ne branche jamais sur la source', () => {
  const roots = ['src/core', 'src/render'];

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
    }
    return out;
  }

  it('aucun `source ===` hors calibration.ts', () => {
    for (const root of roots) {
      for (const file of walk(root)) {
        if (file.endsWith('calibration.ts')) continue;
        const body = readFileSync(file, 'utf8');
        expect(body, `${file} branche sur la source`).not.toMatch(/source\s*[=!]==/);
      }
    }
  });

  it('la mesure ne lit jamais les dimensions du fichier image (B3)', () => {
    for (const file of walk('src/core')) {
      const body = readFileSync(file, 'utf8');
      expect(body, `${file} lit les dimensions du PNG`).not.toMatch(
        /\bimg\.(width|height)\b|\.naturalWidth\b/,
      );
    }
  });

  it('le rendu ne recompose jamais sa propre transformée (T3)', () => {
    for (const file of walk('src/render')) {
      const body = readFileSync(file, 'utf8');
      expect(body, `${file} recompose une matrice`).not.toMatch(
        /ctx\.(scale|rotate|translate)\s*\(/,
      );
    }
  });

  it('aucun vocabulaire de sélection dans src/', () => {
    for (const root of ['src']) {
      for (const file of walk(root)) {
        const body = readFileSync(file, 'utf8');
        expect(body, `${file} contient du vocabulaire de tri`).not.toMatch(
          /\b(recommendFrames|filterFrames|rejectFrame|bestMatch|montures_compatibles)\b/,
        );
      }
    }
  });
});

describe('GARDE-FOU — le hook pre-commit n\'a pas été vidé', () => {
  it('contient tous les barrages du §9.0', () => {
    const hook = readFileSync('.githooks/pre-commit', 'utf8');
    for (const needle of [
      'npm run typecheck',
      'npm test',
      'scaleslider',
      "from 'three'",
      'source ===',
      'img\\.width',
      'ctx\\.scale',
    ]) {
      expect(hook, `barrage manquant : ${needle}`).toContain(needle);
    }
  });
});

describe('T4 — validation du spec.json', () => {
  it('accepte un spec complet', () => {
    expect(() => parseFrameSpec(SPEC_132)).not.toThrow();
  });

  it('nomme le champ manquant plutôt que de compléter par défaut', () => {
    const { bridgeCenter: _omitted, ...sansAncrage } = SPEC_132;
    expect(() => parseFrameSpec(sansAncrage)).toThrow(/bridgeCenter/);

    const { alphaBBox: _omitted2, ...sansBBox } = SPEC_132;
    expect(() => parseFrameSpec(sansBBox)).toThrow(/alphaBBox/);
  });

  it('refuse une largeur saisie à la main qui contredit la bbox alpha', () => {
    const menteur = { ...SPEC_132, totalWidthMm: 140 };
    expect(() => parseFrameSpec(menteur)).toThrow(CalibrationError);
    expect(() => parseFrameSpec(menteur)).toThrow(/bbox alpha/);
  });
});

describe('GARDE-FOU §11.5 — un coloris est le MÊME modèle', () => {
  it('accepte une variation de fabrication', () => {
    const ref = specForTotalWidthMm(132, { slug: 'ref' });
    const colorway = { ...ref, slug: 'ecaille', aMm: 44.5 };
    expect(() => assertSameModel(ref, colorway)).not.toThrow();
  });

  it('rejette un coloris rattaché au mauvais modèle, en le nommant', () => {
    const ref = specForTotalWidthMm(132, { slug: 'ref' });
    const autre = { ...ref, slug: 'intrus', aMm: 52 };
    expect(() => assertSameModel(ref, autre)).toThrow(/intrus/);
    expect(() => assertSameModel(ref, autre)).toThrow(/mauvais modèle/);
  });
});
