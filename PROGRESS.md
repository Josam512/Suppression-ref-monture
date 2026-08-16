# PROGRESS — Essayage virtuel

Journal de bord imposé par `CLAUDE.md` §9.1.9 : ce qui marche, ce qui reste,
la valeur des constantes calibrées.

---

## Lot 0 — Garde-fous mécaniques ✅ (à valider par l'humain)

### Ce qui marche

Six barrières installées et **vérifiées en essayant de les franchir** (critère
d'acceptation du §10). Chaque tentative de commit ci-dessous a bien été refusée :

| Barrière | Origine | Vérifiée |
|---|---|---|
| Test désactivé (`.skip`, `.todo`, `xit`, `xdescribe`) | §9.0b | ✅ bloqué |
| Slider de taille (`scaleSlider`, `sizeSlider`, `adjustScale`…) | §1 bug #1 | ✅ bloqué |
| Dépendance 3D (`three`, `@react-three`, `.glb`, `.gltf`, WebGL) | §0 | ✅ bloqué |
| Branchement sur le mode hors `calibration.ts` | §11.4 + rapport B2 | ✅ bloqué |
| Vocabulaire de sélection de montures | rapport §0.1 | ✅ bloqué |
| Constante de taille en dur (80–200 hors `export const`) | §9.1.6 + rapport §0.3 | ✅ bloqué |

Plus, dans le même hook : `npm run typecheck`, `npm test`, et l'affichage
systématique de `git diff --cached --stat` (§9.0d) pour qu'un lot qui déborde
saute aux yeux.

### Écarts assumés par rapport au contrat

1. **`core.hooksPath` au lieu de husky.** Le §9.0a nomme `.husky/pre-commit`,
   mais husky est une dépendance npm, ce que le §9.1.8 interdit sans validation.
   `git config core.hooksPath .githooks` fait strictement la même chose avec
   zéro paquet. Les hooks restent versionnés, donc visibles en revue.
   → Installation après clonage : `sh scripts/setup-hooks.sh`
2. **`@types/node` ajouté en devDependency.** Types uniquement, aucun runtime.
   Rendu nécessaire par `tests/meta.test.ts`, que le §9.0b impose et qui lit le
   système de fichiers pour compter les tests.
3. **Barrières 4, 5 et 6 renforcées** par rapport au §9.0a, suite au rapport :
   - la 4 attrape désormais `source ===` (et pas seulement `'worn-frame'`) :
     le grep d'origine laissait passer le `cal.source === 'iris'` de
     `classify()`, pourtant tout aussi fatal à l'architecture (rapport B2) ;
   - la 5 et la 6 sont nouvelles, issues du cadrage §0.1 et §0.3 du rapport.
4. **Barrières implémentées en Node plutôt qu'en `grep` enchaînés.**
   `grep -rn "filter"` produirait un faux positif sur chaque `Array.filter`,
   ce qui pousserait à désactiver le garde-fou entier. Un garde-fou qu'on
   désactive ne garde rien. Voir `scripts/check-guards.mjs`.

### Constantes calibrées

Aucune à ce stade.

### Ce qui reste

- **Tag git `lot-0-ok`** : à poser par l'humain après validation (§9.0c).
  Volontairement pas posé par l'agent — un tag est une attestation de revue.

---

## Décisions en attente (bloquent les lots 3b et 6, pas les lots 1 et 2)

1. **Seuil de « ça lui va »** : 4 mm fixe, ou ~3 % de la largeur du visage ?
   `THRESHOLD_MM = 4` est un chiffre d'adulte : sur un visage de 105 mm il est
   proportionnellement deux fois plus sévère que sur 145 mm. → lot 6
2. **Rotation de la tête pendant la calibration carte** : systématique, ou
   seulement si la première mesure est douteuse ? → lot 3b
3. **`CLAUDE.md`** : corrigé d'abord et relu, ou code direct avec relecture du
   diff ? Les 15 défauts sont dans `docs/rapport-essayage-virtuel.md`. → global

---

## Lots suivants

Voir `CLAUDE.md` §10. Rappel : **ne pas démarrer le lot N+1 tant que le lot N
n'est pas validé par l'humain.**
