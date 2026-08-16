/**
 * scripts/fit-correction.mjs — ajuste la correction de largeur sur les mesures.
 *
 * Lit docs/calibration/mesures.json, ajuste les deux modeles, et imprime soit
 * les lignes a recopier dans core/verdict.ts, soit la raison du refus.
 */

import { readFileSync } from 'node:fs';
import { fitCorrection, loocvErrorMm, rendu } from '../src/prep/fitCorrection.ts';

const data = JSON.parse(readFileSync('docs/calibration/mesures.json', 'utf8'));
const rows = data.mesures;

console.log(`${rows.length} mesure(s) sur ${new Set(rows.map((r) => r.sujet)).size} sujet(s)\n`);
for (const m of ['decalage', 'rapport']) {
  const e = loocvErrorMm(rows, m);
  console.log(`  ${m.padEnd(9)} erreur croisee par sujet : ${Number.isFinite(e) ? e.toFixed(2) + ' mm' : '— (moins de 2 sujets)'}`);
}
console.log(`\n${rendu(fitCorrection(rows))}`);
