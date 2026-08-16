#!/usr/bin/env node
/**
 * Vendorisation du runtime MediaPipe — CLAUDE.md §1 bug #4.
 *
 * Objectif : ZÉRO CDN au runtime. L'app ne doit jamais rester bloquée sur
 * « Chargement des modèles d'IA... » à cause d'un réseau tiers, sans qu'on
 * puisse distinguer « ça charge » de « c'est mort ».
 *
 * Ce script copie le WASM depuis node_modules vers public/. Il ne télécharge
 * RIEN : la reproductibilité vient de package-lock.json.
 *
 * Le modèle face_landmarker.task, lui, est commité dans public/models/ —
 * « vendorisé » au sens strict du contrat.
 */

import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const DEST = join(process.cwd(), 'public', 'mediapipe', 'wasm');

try {
  statSync(SRC);
} catch {
  console.error(`❌ Introuvable : ${SRC}\n   Lancer 'npm install' d'abord.`);
  process.exit(1);
}

mkdirSync(DEST, { recursive: true });

let copied = 0;
let bytes = 0;
for (const name of readdirSync(SRC)) {
  const from = join(SRC, name);
  if (!statSync(from).isFile()) continue;
  copyFileSync(from, join(DEST, name));
  copied++;
  bytes += statSync(from).size;
}

const mb = (bytes / 1024 / 1024).toFixed(1);
console.log(`✅ MediaPipe vendorisé : ${copied} fichiers (${mb} Mo) → public/mediapipe/wasm/`);
