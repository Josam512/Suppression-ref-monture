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
| 7 | `render/temple.ts` : branche + occlusion | ⚠️ branches extraites des photos 3/4 et redressées ; `templeAffine` corrigée ; longueur à ±20 % |
| 8 | Calibration humaine des deux constantes | ❌ **à faire — bloquant pour la mise en ligne** |
| V2-0 | `assertSameModel` | ✅ |
| V2-1 | `calibrateWithWornFrame` (2 %, T8) | ✅ |
| V2-2 | Sélecteur de coloris + dilatation `OVERLAY_PADDING_MM` | ⚠️ mesurée au banc ; contrôle « aucun liseré » ouvert |
| V2-3 | Pointage en 2 clics de la monture portée | ✅ |

**Contrôles automatiques :** 68 tests Vitest · `tsc --noEmit` en `strict` sans erreur ·
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

| Monture | A | pont | B | largeur (réglet) | échelle | pire écart des 4 cotes |
|---|---|---|---|---|---|---|
| `ecaille-claire` | 47 | 22 | 43 | **136,0 mm** | 6,787 px/mm | ✅ 3,1 % |
| `severine` | 49 | 19 | 42 | **134,0 mm** | 7,463 px/mm | ✅ 3,4 % |
| `p8-m252` | 43 | 23 | 38 | **132,0 mm** | 10,750 px/mm | ✅ 3,3 % |

La boîte englobante de chaque verre donne **A, le pont et B** — les trois cotes
du système boxing, soit trois mesures indépendantes du même facteur d'échelle.
C'est exactement le garde-fou à 3 cotes du §4, exécuté automatiquement. Les
trois montures passent sous 3,4 %.

> ⚠️ Deux erreurs corrigées en route, toutes deux attrapées par le garde-fou.
> **La `p8-m252` avait d'abord été livrée à 139,5 mm**, largeur *déduite* de
> `A + pont` faute de réglet : la vraie valeur est **132 mm**, soit 5,7 % de
> faux. Le mode « sans réglet » a été conservé mais il annonce désormais
> lui-même qu'il supprime tout contrôle. Et le centre du verre était pris comme
> **centroïde de surface** au lieu de **centre de la boîte** : sur une forme
> panto ou hexagonale l'écart atteint plusieurs millimètres, et le contrôle
> refusait une monture correcte.

**Biais systématique observé :** la cote A mesurée sur l'ouverture visible est
toujours 1 à 1,5 mm sous la cote annoncée, sur les trois montures. C'est
attendu — la drageoir où le verre s'encastre n'est pas visible. Cohérent, donc
sans effet sur l'échelle, qui vient de la largeur totale.

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

### Les branches viennent des photos trois quarts — pas besoin de profil à plat

Une monture vue de trois quarts tourne autour d'un axe **vertical**. Les
dimensions verticales ne se raccourcissent donc pas du tout : c'est le
raisonnement de S1, appliqué à l'envers.

- La **hauteur de verre** donne l'échelle, insensible à l'angle.
- L'**écart des centres optiques**, lui, est raccourci en `cos θ` → **θ se
  mesure**, il n'est pas supposé.
- La branche étant perpendiculaire à la face, sa longueur apparente vaut
  `L·sin θ` : on la redresse en l'étirant de `1/sin θ`.

| Monture | Angle de vue mesuré | Branche redressée | Annoncée | Écart |
|---|---|---|---|---|
| `ecaille-claire` | 29,5° | 174,5 mm | 145 mm | +20,3 % |
| `severine` | 40,0° | 137,1 mm | 147 mm | −6,7 % |
| `p8-m252` | 38,7° | 160,4 mm | 145 mm | +10,6 % |

**Aucune 3D n'est introduite** : on extrait deux scalaires d'une image, ce que
le §4 autorise explicitement pour la carte.

La longueur est donc juste à ±20 %, pas au millimètre — les branches ont un
galbe et un angle d'ouverture que ce modèle plan ignore. C'est suffisant pour
une branche crédible, insuffisant pour une cote. **Ce n'est pas ajusté sur la
valeur annoncée** : l'écart affiché est un contrôle, pas un réglage.

⚠️ Une première version cherchait la charnière sur la hauteur de la silhouette.
Résultat : 12 mm sur une monture, 179 mm sur une autre. Heuristique abandonnée —
la charnière se **calcule**, à `largeur/2` du centre, projetée par le `cos θ`
mesuré.

### Le rendu de la branche est corrigé

`drawTemple` appliquait à la branche **l'affine de la face** : elle était donc
posée au milieu du visage et **rétrécissait** quand la tête tournait, soit
l'inverse exact du réel. `core/transform.ts` expose désormais `templeAffine`,
ancrée à la charnière et proportionnelle à `sin(yaw)`. Quatre tests le
verrouillent, dont « longueur nulle de face » et « ancrage ≠ centre du pont ».

Restent trois défauts visibles à tête tournée : longueur +10 %, un fragment de
tenon parasite au-dessus de la branche, et l'occlusion derrière l'oreille non
active dans l'outil hors-ligne.

### Ce qui manque encore, précisément

- **Le protocole de calibration bute sur sa propre hypothèse.** Sur le même
  visage, deux montures qu'il porte réellement donnent +20,9 mm (136 mm) et
  ~+12 mm (132 mm) : 8,6 mm d'écart pour 4 mm de différence de monture. Or les
  deux lui vont. **« La largeur de la monture égale la largeur du visage » porte
  donc au moins ±4 mm de jeu**, et aucune quantité de montures ne réduira ce
  jeu. Pour aller plus fin il faudrait une mesure directe des tempes au
  compas, pas une monture.
- Le **détourage laisse les branches repliées visibles à travers les verres**,
  puisqu'elles sont dans la photo. Peu gênant sur un visage, mais visible.

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
