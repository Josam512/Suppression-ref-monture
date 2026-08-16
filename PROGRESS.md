# PROGRESS.md — état d'avancement

> Tenu à jour après chaque lot (CLAUDE.md §9.1 règle 9).
> Dernière mise à jour : 2026-08-16.

## Ce qui marche

| Lot | Contenu | État |
|---|---|---|
| 0 | `.githooks/pre-commit` (8 barrages, **sans husky**), `core.hooksPath`, `tests/meta.test.ts` | ✅ vérifié en tentant de le contourner |
| 1 | Vite + TS `strict` + Vitest, `core/geom.ts` | ✅ |
| 2 | `tracking/landmarker.ts`, modèle vendorisé, garde de monotonie S5 | ✅ |
| 3a | Échelle iris + refus si lunettes portées (S2) | ✅ |
| 3b | `core/calibration.ts` : carte, contrôle de distance (B4), plage 95–175 mm (B5) | ✅ |
| 4 | `prep/DetourTool.tsx` + `prep/alphaBBox.ts` (B3) | ✅ |
| 5 | `core/transform.ts` (T3), `render/composite.ts`, correctif S1 | ✅ |
| 6 | `core/verdict.ts` : seuil proportionnel borné, `classify` par intervalles (B2) | ✅ |
| 7 | `render/temple.ts` : branche + occlusion | ✅ code écrit, **rendu jamais vu** (voir plus bas) |
| 8 | Calibration humaine des deux constantes | ❌ **à faire — bloquant pour la mise en ligne** |

**Contrôles automatiques :** 49 tests Vitest au vert · `tsc --noEmit` en `strict` (avec
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) sans erreur · `npm run build` OK ·
`npm run smoke` (banc navigateur, §8.3) 6/6 vert.

## Constantes calibrées

| Constante | Valeur | Calibrée le | Sur combien d'essais |
|---|---|---|---|
| `FACE_WIDTH_CORRECTION_MM` | **0 (provisoire)** | — | 0 |
| `VERTICAL_OFFSET_MM` | **3 (provisoire)** | — | 0 |

> 🔴 **Tant que ces deux lignes portent « provisoire », la légende chiffrée est décalée.**
> `FACE_WIDTH_CORRECTION_MM` pèse 5 à 10 mm, soit plus que le seuil de décision lui-même : à 0,
> des montures correctes s'afficheront « sous-taillées », de façon parfaitement cohérente donc
> invisible. Protocole au §5 du CLAUDE.md — 3 montures de largeurs différentes, 2 morphologies,
> médiane des écarts, et on ne fige pas si la dispersion dépasse 3 mm.

## Ce qui reste, et pourquoi ça n'a pas été fait

1. **Lot 8 — calibration humaine.** Aucun agent ne peut mesurer un vrai visage devant une vraie
   webcam. C'est la seule tâche strictement bloquante avant une mise en ligne.

2. **Aucune monture réelle n'est préparée.** `public/frames/` est vide : préparer une monture
   suppose une photo réelle détourée, que seul l'opticien possède. Aucun sprite factice n'a été
   créé — un faux sprite aurait donné l'illusion que le rendu est validé alors qu'il ne l'est pas.
   Passer par `prep.html` pour en produire un vrai.

3. **Le rendu n'a jamais été vu sur un visage.** Toute la géométrie est testée en calcul pur, et
   le banc navigateur vérifie que la boucle tourne — mais la mire de synthèse de Chromium ne
   contient aucun visage. **Le sprite n'a donc jamais été composité sur de vrais landmarks.** Les
   critères d'acceptation visuels des lots 5 et 7 restent ouverts.

4. **Le banc `.y4m` du §8.3 n'est pas alimenté.** Il faudrait une courte vidéo de visage au format
   `.y4m` dans `tests/fixtures/` pour tester le compositing en CI. À produire par l'humain.

5. **Détection automatique du port de lunettes (S2) : remplacée par une question explicite.**
   Un détecteur approximatif qui laisse passer un porteur de lunettes est pire que pas de
   détecteur, puisqu'il produit une mesure fausse d'allure normale. L'application demande donc
   « portez-vous des lunettes ? » et bascule sur la carte si oui. À remplacer par une vraie
   détection le jour où elle sera fiable — pas avant.

6. **Correction de parallaxe par rotation de tête (B4, parade n°2) : non implémentée.** Seule la
   parade n°1 l'est (distance minimale de 60 cm). En conséquence `CARD_REL_ERROR` reste à 2,5 %.
   Arbitrage rendu : la rotation ne se déclenchera qu'en cas de doute, pas systématiquement.

## Écarts assumés avec le rapport d'analyse

- **Masquage du décentrement.** Le rapport proposait `relError <= 0.02`. Ce seuil serait devenu
  inapplicable une fois B4 appliqué (la carte passe à 0,025 et serait masquée elle aussi). On
  propage l'incertitude jusqu'au décentrement lui-même. Conséquence : le décentrement est
  désormais **affiché en mode iris** sur une monture courante. Détail au §5 du CLAUDE.md.

- **`'incertain'` renommé `'indetermine'`** et retiré de l'affichage client (§0.0.1) : on ne montre
  jamais un jugement flou, on redemande la carte une fois, puis on laisse la personne regarder.

## Journal

- **2026-08-16** — Correction du contrat : 15 correctifs (B1–B5, S1–S5, T1–T8) + 3 arbitrages.
- **2026-08-16** — Implémentation des lots 0 à 7. Six défauts supplémentaires relevés pendant le
  codage, dont un (`onLost` qui ne dessinait pas) qu'aucune relecture n'avait attrapé et qui
  reconstituait le bug #3 à l'identique. Table complète au §13 du CLAUDE.md.
