# PROGRESS.md — état d'avancement

> Tenu à jour après chaque lot (CLAUDE.md §9.1 règle 9).
> Dernière mise à jour : 2026-08-16.

## Les deux versions

Ce ne sont pas deux applications. C'est **le même moteur de mesure**, avec une source d'étalon
différente. Une fois la largeur du visage connue en millimètres, la chaîne de mesure et le rendu
sont strictement identiques — c'est ce que verrouille le garde-fou §11.4.

| | **V1 — Vente en ligne** | **V2 — Mode magasin** |
|---|---|---|
| Qui | Le client, chez lui, sans opticien ni instrument | L'opticien, client portant une monture du rayon |
| Question posée | « Est-ce à ma taille ? » (métrologie) | « Ce coloris me va-t-il ? » (esthétique) |
| Étalon | L'iris (11,7 mm), puis une carte bancaire en cas de doute | La monture portée, cotes connues |
| Précision | 4,3 % (iris) · 2,5 % (carte) | **2 %** — la meilleure des trois |
| Geste | Aucun, puis 2 s avec une carte | 2 clics de l'opticien |
| Spécificité de rendu | aucune | sprite dilaté de 1,5 mm pour couvrir la monture réelle |
| Code spécifique | — | **1 fonction + 1 valeur d'énumération** |

L'écran d'accueil propose explicitement les deux, avec leur public, leur étalon et leur précision.

## Ce qui marche

| Lot | Contenu | État |
|---|---|---|
| 0 | `.githooks/pre-commit` (8 barrages, **sans husky**), `core.hooksPath`, `meta.test.ts` | ✅ vérifié en tentant de le contourner |
| 1 | Vite + TS `strict` + Vitest, `core/geom.ts` | ✅ |
| 2 | `tracking/landmarker.ts`, modèle vendorisé, garde de monotonie S5 | ✅ |
| 3a | Échelle iris + refus si lunettes portées (S2) | ✅ |
| 3b | Carte + contrôle de distance (B4) + plage 95–175 mm (B5) | ✅ |
| 4 | `prep/DetourTool.tsx` + `prep/alphaBBox.ts` (B3) | ✅ |
| 5 | `core/transform.ts` (T3), `render/composite.ts`, correctif S1 | ✅ |
| 6 | `core/verdict.ts` : seuil proportionnel borné, `classify` par intervalles (B2) | ✅ |
| 7 | `render/temple.ts` : branche + occlusion | ✅ code écrit, **rendu jamais vu sur un visage** |
| 8 | Calibration humaine des deux constantes | ❌ **à faire — bloquant pour la mise en ligne** |
| V2-0 | `assertSameModel` | ✅ |
| V2-1 | `calibrateWithWornFrame` (2 %, T8) | ✅ |
| V2-2 | Sélecteur de coloris + dilatation `OVERLAY_PADDING_MM` | ⚠️ mesurée au banc ; contrôle « aucun liseré » ouvert |
| V2-3 | Pointage en 2 clics de la monture portée | ✅ |

**Contrôles automatiques :** 56 tests Vitest · `tsc --noEmit` en `strict` sans erreur ·
`npm run build` OK · `npm run smoke` : 19 contrôles verts, dont la preuve métrologique ci-dessous.

## La preuve que l'image est juste

`npm run smoke` compose le sprite avec le vrai `drawFrame`, sur un vrai canvas, puis **remesure
les pixels peints et les reconvertit en millimètres**. Dernier passage :

| Contrôle | Attendu | Mesuré |
|---|---|---|
| largeur peinte reconvertie en mm | 132,00 mm | **131,82 mm** |
| le padding alpha n'élargit pas la monture (B3) | 132,00 mm | 131,82 mm |
| centre peint ↔ centre du pont projeté | 640,00 px | 640,00 px |
| décalage vertical sous le sellion (T1) | 3,00 mm | 3,00 mm |
| hauteur peinte à 20° vs 0° (S1) | 149 px | 150 px |
| largeur à 20° / largeur à 0° = cos(yaw) (S1) | 0,940 | 0,940 |
| dilatation V2 de chaque côté (§11.6) | 1,50 mm | 1,71 mm |
| la dilatation reste centrée | 640,00 px | 640,00 px |

Écart global : **0,18 mm sur 132**, soit 0,14 % — très en deçà de la tolérance de ±3 %.

> ⚠️ Ce que cette preuve établit, et ce qu'elle n'établit pas. Elle établit que **la chaîne
> géométrique est juste** : spec.json → affine → drawImage → pixels → millimètres. Elle
> n'établit **rien** sur la justesse de la mesure du visage réel, qui dépend des deux constantes
> non calibrées ci-dessous, ni sur le rendu d'une vraie monture sur un vrai visage.

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
   webcam. Seule tâche strictement bloquante avant une mise en ligne.

2. **Aucune monture réelle n'est préparée.** `public/frames/` est vide : il faut une photo réelle
   détourée, que seul l'opticien possède. **Aucun sprite factice n'a été créé** — un faux sprite
   aurait donné l'illusion que le rendu est validé alors qu'il ne l'est pas. Le rectangle du banc
   de mesure vit dans `tests/`, jamais dans `public/frames/`.

3. **Le rendu n'a jamais été vu sur un visage.** La géométrie est prouvée au pixel près, mais la
   mire de synthèse de Chromium ne contient aucun visage : le sprite n'a jamais été composité sur
   de vrais landmarks. Les critères visuels des lots 5, 7 et V2-2 restent ouverts.

4. **Le banc `.y4m` n'est pas alimenté.** Une courte vidéo de visage dans `tests/fixtures/`
   permettrait de tester le compositing sur de vrais landmarks en CI. À produire par l'humain.

5. **Détection automatique du port de lunettes (S2) : remplacée par une question explicite.**
   Un détecteur approximatif qui laisse passer un porteur de lunettes est pire que pas de
   détecteur, puisqu'il produit une mesure fausse d'allure normale.

6. **Correction de parallaxe par rotation de tête (B4, parade n°2) : non implémentée.** Seule la
   parade n°1 l'est (distance minimale de 60 cm), d'où `CARD_REL_ERROR` à 2,5 %.

## Écarts assumés avec le rapport d'analyse

- **Masquage du décentrement** — sur l'incertitude propagée, pas sur `relError <= 0.02` (qui
  serait devenu inapplicable après B4). Conséquence : le décentrement est désormais **affiché en
  mode iris** sur une monture courante. Détail au §5 du CLAUDE.md.
- **`'incertain'` renommé `'indetermine'`** et retiré de l'affichage client (§0.0.1).
- **`verdict()` prend 6 paramètres** et non 5 : sans le yaw, sa propre règle 3 était
  inimplémentable (T9).

## Journal

- **2026-08-16** — Correction du contrat : 15 correctifs (B1–B5, S1–S5, T1–T8) + 3 arbitrages.
- **2026-08-16** — Lots 0 à 7. Six défauts relevés pendant le codage, dont un (`onLost` qui ne
  dessinait pas) qu'aucune relecture n'avait attrapé et qui reconstituait le bug #3 à l'identique.
- **2026-08-16** — Lots V2-0 à V2-3, séparation explicite des deux versions à l'accueil, et banc
  de preuve métrologique du rendu (`tests/render-proof.html`).
