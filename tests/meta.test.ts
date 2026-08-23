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
// ⚠️ 2026-08-21 — CORRECTION D'UNE ERREUR DE MA PART : la valeur avait été portée
// à 306 d'après le nombre de tests EXÉCUTÉS (309), alors que ce compteur est
// STATIQUE et compte les `it(` du source. Une boucle `for` autour d'un `it(`
// compte pour 1 mais s'exécute N fois : les deux grandeurs ne sont pas
// comparables. Le plancher était donc inatteignable. Valeur réelle : 301.
const EXPECTED_MIN_TESTS = 476; // … | refonte détection : 278 | fiabilisation (127 pts) : 351 | reprise ré-audit A1–A18 : 430 | tempête espacée (STORM_RETRY_MS) : 431 | négociation de capacités (catalogue 2×2×2, 3-erreurs→suivante, tour circulaire, yaw sans matrice) : 444 | mémoire d'appareil : 450 | refonte FaceTracker (sonde de santé) : 451 | VTO autonome (échelle visuelle, décision de scène) : 459 | ré-audit 2026-08-23 (échelle de session, visages validés, tours de renégociation, yaw validé, topologie) : 476
// fiabilisation 2026-08-21 (guide maître 80+47 pts) : 351
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
