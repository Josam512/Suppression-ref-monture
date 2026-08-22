/**
 * scripts/ci.mjs — LA chaîne complète (guide c40, c47).
 *
 *   typecheck → unit → build → single → smoke → smoke-single (l'artefact
 *   EXACT que le téléphone ouvre) → journey (le parcours fondamental, pt 75)
 *   → faults (la matrice de pannes, pt 74) → chaos (c46).
 *
 * « Ça marche » = TOUTE cette chaîne est verte, sur le build Vite ET sur
 * l'artefact autonome. Le Samsung ne sert qu'à la validation finale du
 * matériel, jamais à découvrir le prochain bug logiciel évident.
 *
 * `--quick` saute le chaos (~100 s) pour les itérations locales.
 */

import { execSync } from 'node:child_process';

const quick = process.argv.includes('--quick');

const steps = [
  ['typecheck', 'npm run typecheck'],
  ['tests unitaires', 'npx vitest run'],
  // ⚠️ AVANT tout build : sur un clone neuf (runner GitHub), public/wasm n'existe
  // pas — seuls `npm run dev/build` le synchronisent via pre-hooks, or cette
  // chaîne appelle `npx vite build` et `npm run single` directement. Sans cette
  // étape, `build-single-file.mjs` meurt en ENOENT et `dist/` part sans runtime
  // MediaPipe (constaté sur le premier run Actions, 2026-08-22).
  ['wasm vendorisé (sync-wasm)', 'node scripts/sync-wasm.mjs'],
  ['build Vite', 'npx vite build'],
  ['artefact autonome (npm run single)', 'npm run single'],
  ['banc navigateur (smoke)', 'node scripts/smoke.mjs'],
  ['banc de l’artefact autonome (smoke-single)', 'node scripts/smoke-single.mjs'],
  ['parcours fondamental (journey)', 'node scripts/journey-no-card.mjs'],
  ['matrice de pannes (faults)', 'node scripts/faults.mjs'],
  ...(quick ? [] : [['chaos (~100 s)', 'node scripts/chaos.mjs']]),
];

const t0 = Date.now();
for (const [name, cmd] of steps) {
  console.log(`\n━━━ ${name} ━━━ (${cmd})`);
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    console.error(`\n❌ CI ROUGE à l'étape « ${name} ». Rien ne se livre tant que ce n'est pas vert.`);
    process.exit(1);
  }
}
console.log(`\n✅ CI complète verte en ${Math.round((Date.now() - t0) / 1000)} s (${steps.length} étapes).`);
