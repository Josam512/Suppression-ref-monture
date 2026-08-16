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
| 7 | `render/temple.ts` : branche + occlusion | ⚠️ code écrit ; **aucune photo de profil à plat**, donc `profile.png` transparent |
| 8 | Calibration humaine des deux constantes | ❌ **à faire — bloquant pour la mise en ligne** |
| V2-0 | `assertSameModel` | ✅ |
| V2-1 | `calibrateWithWornFrame` (2 %, T8) | ✅ |
| V2-2 | Sélecteur de coloris + dilatation `OVERLAY_PADDING_MM` | ⚠️ mesurée au banc ; contrôle « aucun liseré » ouvert |
| V2-3 | Pointage en 2 clics de la monture portée | ✅ |

**Contrôles automatiques :** 64 tests Vitest · `tsc --noEmit` en `strict` sans erreur ·
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


## 🔴 Première confrontation aux vraies montures et aux vrais visages — 2026-08-16

### Trois montures réelles sont préparées

`public/frames/` n'est plus vide. Détourage automatique depuis les photos studio
(`tools/prepare_frame.py`), fond ET verres rendus transparents, centres optiques
détectés comme trous fermés dans la silhouette.

| Monture | A | pont | B | largeur totale | échelle | contrôle A+pont |
|---|---|---|---|---|---|---|
| `ecaille-claire` | 47 | 22 | 43 | **136,0 mm** (réglet) | 6,787 px/mm | ✅ 2,3 % |
| `severine` | 49 | 19 | 42 | **134,0 mm** (réglet) | 7,463 px/mm | ✅ 1,9 % |
| `p8-m252` | 43 | 23 | 38 | 139,5 mm *(déduite)* | 6,282 px/mm | ⚠️ impossible |

Le contrôle croisé compare l'écart centre-à-centre des deux verres à `A + pont`,
la relation du système boxing. Sur les deux montures dont la largeur vient du
réglet, il passe à 2 % — **la chaîne de l'échelle 1 est donc vérifiée sur de
vraies montures**, pas seulement sur un rectangle de synthèse.

⚠️ La `p8-m252` n'a pas de largeur au réglet : son échelle est déduite de
`A + pont`, ce qui consomme la redondance et supprime le contrôle. Les 139,5 mm
obtenus sont vraisemblablement surestimés de 2 à 3 %. **À remesurer.**

### Le sprite a enfin été composité sur un vrai visage

`scripts/fit-on-photo.mjs` pose une monture préparée sur une photo fixe, à
l'échelle réelle. Le contrôle décisif est l'**auto-superposition** : on repose
sur la personne la monture qu'elle porte réellement.

**Résultat : le sprite se confond avec la monture réelle en largeur.** Les bords
externes coïncident. C'était le dernier maillon jamais vérifié du projet.

Deux choses se voient aussitôt, et ce sont exactement les deux constantes du
lot 8 : le sprite se pose **trop bas** (`VERTICAL_OFFSET_MM` provisoire à 3 mm),
et la légende annonce **« votre visage 115 mm »** pour un homme adulte.

### 🔴 `FACE_WIDTH_CORRECTION_MM` : l'écart est de l'ordre de 20 mm, pas de 5 à 10

Deux essais, deux visages, deux montures de largeur connue au réglet :

| Visage | Monture portée | Largeur réelle | Lue sur 234/454 | Écart |
|---|---|---|---|---|
| homme | ecaille-claire | 136,0 mm | 115,1 mm | **+20,9 mm** |
| femme | severine | 134,0 mm | 119,7 mm | **+14,3 mm** |

**Dispersion : 6,6 mm — au-delà des 3 mm du protocole. On ne fige donc pas.**

Trois lectures possibles, à trancher par l'humain :
1. mon pointage des bords est fait à l'œil sur une image agrandie, à ±2 % près ;
2. les deux montures ne « vont » pas également bien aux deux visages, or tout le
   protocole repose sur cette hypothèse ;
3. l'écart n'est peut-être pas une constante en millimètres mais une proportion
   — les rapports valent 1,18 et 1,12, qui ne concordent pas mieux.

Ce qui est acquis, en revanche : **l'écart est bien plus grand que les 5 à 10 mm
estimés dans le rapport**, et avec la constante à 0 l'application annonce à un
homme adulte un visage de 115 mm. Le lot 8 n'est pas un raffinement, c'est un
préalable.

### Ce qui manque encore, précisément

- La **largeur totale au réglet de la `p8-m252`** — sans elle, pas de contrôle.
- Une **3ᵉ monture de largeur nettement différente** : 134 et 136 mm sont trop
  proches pour que le protocole ait du sens.
- Une **vraie photo de profil à plat** de chaque monture. Aucune n'en a : le
  `profile.png` livré est **entièrement transparent**, ce qui n'affiche aucune
  branche plutôt qu'une branche de géométrie fausse. Le lot 7 reste donc ouvert.
- La **vignette « ORIGINE FRANCE »** est encore collée sur le verre de la
  `p8-m252` et se retrouve dans le sprite. C'est précisément le travail de
  `app.py`, déjà présent dans ce dépôt.

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

2. ✅ **Trois montures réelles sont préparées** (voir plus haut). Reste la largeur au réglet de
   la `p8-m252` et une monture de largeur nettement différente.

3. ✅ **Le rendu a été vu sur un vrai visage**, et il se superpose à la monture réellement portée.
   Restent ouverts : le lot 7 (aucune photo de profil à plat) et le contrôle V2-2 (coloris clair
   sur monture noire).

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
