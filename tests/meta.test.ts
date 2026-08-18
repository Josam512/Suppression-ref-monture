/**
 * tests/meta.test.ts — le compteur de tests (CLAUDE.md §9.0.b).
 *
 * Un agent bloqué a tendance à supprimer le test gênant plutôt que le bug.
 * Ce compteur rend la suppression visible immédiatement.
 *
 * ⚠️ Se met à jour UNIQUEMENT en même temps qu'on ajoute un test, jamais pour
 * réparer une suite devenue rouge.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ⭐ T6 : l'ancienne valeur (12) ne correspondait à rien — la §8 n'en listait que 11.
const EXPECTED_MIN_TESTS = 189; // V1 : 49 | V2 : 56 | lot 7 : 68 | borne robuste : 143 | calibres : 147 | focalSpread : 151 | profil camera : 165 | cadre a remplir : 177 | seance filmee : 182 | carte trouvee toute seule : 189
// écart temporal mesuré + règle des 300 lignes : 94 | recoloriage V2 2,5 D : 101 | lunettes portees refusees : 103 | distance mesuree + borne anatomique : 117
// carte = mire de calibration (focale + distance mesurées) : 132 | accrochage des coins + balayage : 139

const TESTS_DIR = 'tests';

function countTests(): number {
  let total = 0;
  for (const name of readdirSync(TESTS_DIR)) {
    if (!name.endsWith('.test.ts')) continue;
    const body = readFileSync(join(TESTS_DIR, name), 'utf8');
    total += (body.match(/^\s*it\(/gm) ?? []).length;
  }
  return total;
}

describe('méta', () => {
  it(`la suite compte au moins ${EXPECTED_MIN_TESTS} tests`, () => {
    const actual = countTests();
    expect(
      actual,
      `${actual} tests trouvés pour ${EXPECTED_MIN_TESTS} attendus. ` +
        `Si des tests ont été SUPPRIMÉS, les restaurer. S'ils ont été AJOUTÉS, ` +
        `relever EXPECTED_MIN_TESTS dans le même commit.`,
    ).toBeGreaterThanOrEqual(EXPECTED_MIN_TESTS);
  });
});
