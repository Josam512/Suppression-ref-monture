#!/usr/bin/env node
/**
 * Garde-fous mécaniques du projet — CLAUDE.md §9.0a, §11.4,
 * et renforcements du rapport docs/rapport-essayage-virtuel.md §6.
 *
 * Ce script est appelé par le hook pre-commit. Il ne dépend d'aucun paquet :
 * il tourne même si node_modules a disparu.
 *
 * Pourquoi un script plutôt que des `grep` enchaînés dans le hook :
 *   - `grep -rn "filter"` produirait un faux positif sur chaque Array.filter,
 *     ce qui pousserait à désactiver le garde-fou entier. Un garde-fou qu'on
 *     désactive ne garde rien.
 *   - la détection des constantes de taille en dur exige de comprendre la
 *     ligne (déclaration exportée ? commentaire ?), pas juste de la matcher.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const ROOT = process.cwd();
let failures = 0;

function walk(dir, exts = ['.ts', '.tsx']) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // répertoire absent : rien à contrôler, pas une erreur
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (name === 'node_modules' || name === '.git') continue;
    if (statSync(full).isDirectory()) out = out.concat(walk(full, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

/** Retire les commentaires pour que les contrôles ne s'appliquent qu'au code réel. */
function stripComments(line) {
  return line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
}

function fail(rule, file, lineNo, line, hint) {
  failures++;
  console.error(`\n❌ ${rule}`);
  console.error(`   ${relative(ROOT, file)}:${lineNo}`);
  console.error(`   ${line.trim()}`);
  if (hint) console.error(`   → ${hint}`);
}

/** Contrôle générique : un motif interdit dans un ensemble de fichiers. */
function forbid({ rule, files, pattern, hint, skipFile = () => false, useRawLine = false }) {
  for (const file of files) {
    if (skipFile(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((raw, i) => {
      const line = useRawLine ? raw : stripComments(raw);
      if (pattern.test(line)) fail(rule, file, i + 1, raw, hint);
      pattern.lastIndex = 0;
    });
  }
}

const srcFiles = walk(join(ROOT, 'src'));
const coreRenderFiles = [
  ...walk(join(ROOT, 'src', 'core')),
  ...walk(join(ROOT, 'src', 'render')),
];
const testFiles = walk(join(ROOT, 'tests'));

// ─── 1. Aucun test désactivé (§9.0b) ────────────────────────────────────────
// Un agent bloqué supprime le test gênant plutôt que le bug.
forbid({
  rule: 'Test désactivé détecté (§9.0b)',
  files: testFiles,
  pattern: /\b(?:it|test|describe)\.(?:skip|todo|concurrent\.skip)\b|\bx(?:it|describe)\s*\(/,
  hint: "Un test ne se neutralise jamais pour faire passer un commit. Réparer le code, ou signaler que le test est faux et demander.",
});

// ─── 2. Aucun slider de taille (§1 bug #1) ──────────────────────────────────
// C'est la régression n°1 du projet : si l'utilisateur règle l'échelle,
// l'app répond toujours « ça vous va » et ne sert à rien.
forbid({
  rule: 'Slider de taille interdit (§1 bug #1)',
  files: srcFiles,
  pattern: /scale-?slider|size-?slider|adjust-?scale|glasses-?scale/i,
  hint: "L'échelle est CALCULÉE (§4), jamais saisie. Aucun paramètre libre dans la chaîne de mesure.",
  useRawLine: true, // même en commentaire : on ne veut pas voir l'idée revenir
});

// ─── 3. Aucune 3D (§0 hors périmètre) ───────────────────────────────────────
forbid({
  rule: 'Dépendance 3D interdite (§0)',
  files: srcFiles,
  pattern: /from\s+['"]three['"]|@react-three|\.glb\b|\.gltf\b|WebGLRenderer/,
  hint: 'Le rendu est du compositing de sprites 2D sur <canvas>. Rien d\'autre.',
});

// ─── 4. Aucun branchement sur le mode hors calibration.ts (§11.4) ───────────
// Corrige aussi la faille relevée en B2 du rapport : le grep d'origine ne
// cherchait que 'worn-frame' et laissait passer `cal.source === 'iris'`,
// pourtant présent dans classify() et tout aussi fatal à l'architecture.
forbid({
  rule: 'Branchement sur le mode interdit hors calibration.ts (§11.4 + rapport B2)',
  files: coreRenderFiles,
  pattern: /source\s*===|mode\s*===|isStore|isMagasin|isCard|isIris/,
  skipFile: (f) => basename(f) === 'calibration.ts',
  hint: "L'aval ne doit pas savoir d'où vient l'échelle. Piloter par cal.relError, jamais par cal.source.",
});

// ─── 5. Aucune sélection de montures (rapport §0.1) ─────────────────────────
// L'app ne trie rien, ne rejette rien, ne recommande rien : la personne VOIT.
// NB : `filter` seul n'est pas interdit — Array.prototype.filter est légitime.
forbid({
  rule: 'Vocabulaire de sélection de montures interdit (rapport §0.1)',
  files: srcFiles,
  pattern:
    /\b(?:recommend\w*|suggest\w*|filterFrames|frameFilter|compatibleFrames|monturesCompatibles|rejectFrame|rankFrames|bestFrames|frameScore|sortFrames)\b/i,
  hint: "Aucun tri, aucun rejet, aucune recommandation. Toute monture reste essayable ; le livrable est l'image live.",
});

// ─── 6. Aucune constante de taille en dur (§9.1.6 + rapport §0.3) ───────────
// Toute longueur anatomique ou de monture (80–200 mm) doit être une constante
// exportée et documentée, ou un index MediaPipe nommé. Jamais un littéral nu.
const SIZE_MIN = 80;
const SIZE_MAX = 200;
for (const file of coreRenderFiles) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((raw, i) => {
    const line = stripComments(raw);
    if (/^\s*export\s+const\s/.test(line)) return; // la déclaration est le bon endroit
    for (const m of line.matchAll(/(?<![\w.])(\d{2,3}(?:\.\d+)?)(?![\w.])/g)) {
      const v = Number.parseFloat(m[1]);
      if (v >= SIZE_MIN && v <= SIZE_MAX) {
        fail(
          'Constante de taille en dur (§9.1.6 + rapport §0.3)',
          file,
          i + 1,
          raw,
          `« ${m[1]} » : une monture va de 80 à 160 mm, un visage de 95 à 175 mm. Aucune moyenne, aucun littéral nu — déclarer une constante exportée et documentée (ou un index MediaPipe nommé).`,
        );
      }
    }
  });
}

// ─── Verdict ────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} violation(s) des garde-fous. Commit refusé.\n`);
  process.exit(1);
}
console.log('✅ Garde-fous : aucune violation.');
