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

## Lot 1 — Squelette Vite + TS + Vitest, `core/geom.ts`, webcam ⏳ (validation humaine requise)

### Ce qui marche, vérifié ici

| Vérification | Résultat |
|---|---|
| `npm run typecheck` (TS strict + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | ✅ 0 erreur |
| `npm test` | ✅ 15 tests (13 sur `geom.ts`, 2 méta) |
| `npm run build` | ✅ 28 modules, 146 kB (47 kB gzip) |
| `npm run dev` → `http://localhost:5173` | ✅ sert `index.html`, `main.tsx`, `Camera.tsx` en 200 |

`src/core/geom.ts` implémente les signatures **figées** du §7 à l'identique :
`Pt`, `dist`, `midpoint`, `px`, `smoothstep`, `CalibrationError`. Aucun ajout,
aucun paramètre optionnel en plus.

Deux tests méritent d'être signalés parce qu'ils encodent du sens physique,
pas seulement de l'arithmétique :

- **`dist` est invariante par rotation** — c'est ce qui garantit que le roll de
  la tête ne modifie pas une largeur mesurée.
- **`smoothstep` est monotone croissante** — c'est ce qui garantit que la
  branche du lot 7 ne clignotera pas quand la tête tourne.

### ⚠️ Ce qui n'est PAS vérifié

**Le critère d'acceptation « la vidéo s'affiche » n'a pas pu être validé.**
Ce conteneur n'a pas de webcam. Le serveur répond, le bundle se construit, la
boucle de rendu est écrite — mais personne n'a vu d'image.

À faire de ton côté, en 30 secondes :

```bash
npm install && sh scripts/setup-hooks.sh
npm run dev          # puis ouvrir http://localhost:5173
```

Attendu : le navigateur demande l'autorisation caméra, puis le bandeau passe au
vert avec « Caméra active — 1280×720 » et tu te vois en miroir. Si le bandeau
reste orange ou passe au rouge, le message affiché dit quoi faire.

### Choix structurels posés dès maintenant (pénibles à rattraper plus tard)

- **La boucle de rendu est déjà sous sa forme définitive** (§1 bug #3) : elle
  replanifie *avant* tout traitement, `try/catch` autour du travail, compteur
  d'échecs consécutifs affiché à l'écran dès 5 frames. Le lot 2 n'aura qu'à y
  brancher le FaceLandmarker.
- **Le miroir est appliqué une seule fois**, en CSS sur `.camera__stage` (§6).
  `src/core/` travaille en coordonnées non miroitées, et rien d'autre ne doit
  toucher au miroir.
- **`onloadedmetadata` → dimensionner le canvas → *puis seulement* démarrer la
  boucle** (§2). L'ordre inverse donne un canvas 0×0 et un écran noir.

### Dépendances installées (stack imposée §3, aucune hors contrat)

`vite`, `@vitejs/plugin-react`, `react` 18, `react-dom` 18, `@mediapipe/tasks-vision`,
`typescript`, `vitest`, `@types/*`.

`@mediapipe/tasks-vision` est installé dès le lot 1 alors qu'il ne sert qu'au
lot 2 : `geom.ts` importe son type `NormalizedLandmark`, imposé par la signature
figée de `px()`. L'alternative aurait été de redéclarer le type localement,
c'est-à-dire de le faire diverger tôt ou tard.

### Constantes calibrées

Aucune. `FACE_WIDTH_CORRECTION_MM` (rapport S3) n'existera qu'au lot 6 et devra
être calibrée sur **au moins 3 montures de largeurs différentes**.

### Ce qui reste

- Validation humaine + tag `lot-1-ok`.
- Lot 2 : `tracking/landmarker.ts`, modèle `face_landmarker.task` vendorisé
  dans `public/models/`, 478 points en overlay, ≥ 25 fps, chargement en %.

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
