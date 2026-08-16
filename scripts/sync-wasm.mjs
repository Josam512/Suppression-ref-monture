/**
 * scripts/sync-wasm.mjs — copie le runtime wasm de MediaPipe dans public/wasm.
 *
 * Pourquoi ce script plutôt qu'un commit des fichiers : le runtime pèse ~33 Mo
 * et n'est qu'une recopie de `node_modules`. Le versionner alourdirait chaque
 * clone sans rien apporter — alors que le MODÈLE, lui, est bien vendorisé dans
 * `public/models/` : c'est lui que le contrat exige de ne jamais aller chercher
 * sur un CDN au runtime (§1 bug #4).
 *
 * Zéro dépendance : uniquement les modules natifs de Node.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';

const SRC = 'node_modules/@mediapipe/tasks-vision/wasm';
const DEST = 'public/wasm';

if (!existsSync(SRC)) {
  console.error(`❌ ${SRC} introuvable. Lancer « npm install » d'abord.`);
  process.exit(1);
}

mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, { recursive: true });
console.log(`✅ runtime wasm synchronisé : ${SRC} → ${DEST}`);
