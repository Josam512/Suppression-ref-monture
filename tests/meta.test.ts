import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Compteur de tests — CLAUDE.md §9.0b.
 *
 * Se met à jour UNIQUEMENT en même temps qu'on AJOUTE un test.
 * Jamais pour réparer une suite en échec : un agent bloqué a tendance à
 * supprimer le test gênant plutôt que le bug, et ce compteur rend la
 * suppression visible immédiatement.
 *
 * Échelle prévue par le contrat §9.0b : lot 3 : 12 | lot 5 : 18 | lot 6 : 24
 * État réel :                            lot 0 :  2 | lot 1 : 15 | lot 2 : 28
 */
const EXPECTED_MIN_TESTS = 28;

const TESTS_DIR = join(process.cwd(), 'tests');

function testFiles(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(testFiles(full));
    else if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

function countTests(): number {
  let total = 0;
  for (const file of testFiles(TESTS_DIR)) {
    const src = readFileSync(file, 'utf8');
    total += [...src.matchAll(/(?<![\w.])(?:it|test)\s*\(/g)].length;
  }
  return total;
}

describe('méta — le filet de sécurité lui-même', () => {
  it('la suite ne perd jamais de test', () => {
    const found = countTests();
    expect(
      found,
      `${found} tests trouvés pour ${EXPECTED_MIN_TESTS} attendus au minimum. ` +
        `Si un test a été supprimé ou neutralisé, le réparer — ne PAS baisser ` +
        `EXPECTED_MIN_TESTS (§9.1.5).`,
    ).toBeGreaterThanOrEqual(EXPECTED_MIN_TESTS);
  });

  it('les garde-fous mécaniques passent', () => {
    // Le hook pre-commit exécute déjà ce script, mais l'avoir aussi dans la
    // suite permet de le voir rouge en `npm test`, sans attendre un commit.
    expect(() =>
      execFileSync('node', ['scripts/check-guards.mjs'], { stdio: 'pipe' }),
    ).not.toThrow();
  });
});
