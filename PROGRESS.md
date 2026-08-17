# PROGRESS.md — état d'avancement

> Tenu à jour après chaque lot (CLAUDE.md §9.1 règle 9).
> Dernière mise à jour : 2026-08-17.

## Les deux versions

Ce ne sont pas deux applications. C'est **le même moteur de mesure**, avec une source d'étalon
différente. Une fois la largeur du visage connue en millimètres, la chaîne de mesure et le rendu
sont strictement identiques — c'est ce que verrouille le garde-fou §11.4.

| | **V1 — Vente en ligne** | **V2 — Mode magasin** |
|---|---|---|
| Qui | Le client, chez lui, sans opticien ni instrument | L'opticien, client portant une monture du rayon |
| Question posée | « Est-ce à ma taille ? » (métrologie) | « Ce coloris me va-t-il ? » (esthétique) |
| Étalon | **La carte bancaire, obligatoire une fois au début**, puis la rotation de tête | La monture portée, cotes connues |
| Précision | **~1 %** sur l'échelle (parallaxe ET distance mesurées) · ~2 % sur l'écart temporal | **2 %** |
| Geste | 2 s avec une carte, puis tourner la tête à gauche et à droite | 2 clics de l'opticien |
| Spécificité de rendu | aucune | **la monture réelle est RECOLORIÉE** (2,5 D) ; repli sur le sprite dilaté de 1,5 mm |
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
| 8 | Calibration humaine des deux constantes | ⚠️ `FACE_WIDTH_CORRECTION_MM` **remplacée par une mesure** (§14.2) ; `VERTICAL_OFFSET_MM` reste à calibrer |
| ⭐ V1+ | Carte obligatoire, parallaxe mesurée, écart temporal mesuré | ✅ voir plus bas |
| V2-0 | `assertSameModel` | ✅ |
| V2-1 | `calibrateWithWornFrame` (2 %, T8) | ✅ |
| V2-2 | Sélecteur de coloris + dilatation `OVERLAY_PADDING_MM` | ⚠️ devenue le REPLI : le rendu nominal est le recoloriage |
| ⭐ V2+ | Recoloriage 2,5 D de la monture réelle | ✅ chaîne prouvée ; qualité à juger sur vidéo réelle |
| V2-3 | Pointage en 2 clics de la monture portée | ✅ |

**Contrôles automatiques :** 117 tests Vitest · `tsc --noEmit` en `strict` sans erreur ·
`npm run build` OK · `npm run smoke` : 22 contrôles verts, dont la preuve métrologique ci-dessous.

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
> n'établit **rien** sur la justesse de la mesure du visage réel — laquelle est traitée, depuis
> le 2026-08-17, par la mesure de l'écart temporal (voir plus bas).


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

### Les quatre défauts du rendu, et leur correctif

| Défaut | Cause | Correctif |
|---|---|---|
| Branche 10 à 20 % trop longue | le modèle plan ignore le galbe et l'angle d'ouverture | **la longueur vient du réglet**, comme la largeur de la face ; le redressement ne sert plus qu'à la forme, et l'écart reste affiché comme contrôle |
| Fragment de tenon en l'air | la coupe à la charnière est une verticale, le tenon ne l'est pas | on ne garde que la **composante connexe** la plus grande |
| Branches repliées visibles dans les verres | elles sont dans la photo studio, donc dans le sprite | l'ouverture d'un verre étant convexe par ligne, tout ce qui est **entre le premier et le dernier pixel d'ouverture** d'une rangée est effacé |
| Occlusion inactive hors ligne | l'outil ne passait pas le contour du visage | il le passe — et cela a révélé le bug ci-dessous |

### 🔴 `destination-out` perçait un trou dans tout ce qui était dessous

L'occlusion s'appliquait **directement sur le canvas principal**. Or
`destination-out` efface tout ce qui est déjà peint à cet endroit, pas
seulement la branche.

Dans l'application le canvas est transparent au-dessus d'un `<video>`, donc le
trou tombait sur du vide et **ne se voyait pas**. Sur un outil qui dessine une
photo dans le même canvas, il a percé le visage en noir d'un seul coup. Le
défaut était là depuis le début, masqué par la configuration.

Deux correctifs, tous deux nécessaires :
1. l'occlusion se fait sur un **calque isolé**, composé ensuite — elle ne peut
   plus atteindre quoi que ce soit d'autre ;
2. la branche est dessinée **avant** la face, ce qui est aussi le bon ordre
   physique : la branche passe derrière la tête, la face est devant.

⚠️ Le banc du §8.3 a immédiatement signalé ce changement d'ordre : ses deux
contrôles de yaw mesuraient la bounding box peinte, branche comprise. Le banc
utilise désormais un profil vide, puisqu'il mesure la face.

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

## La carte, une seule fois — jamais redemandée

Arbitrage humain, V1 : le client montre sa carte **une fois**, et la mesure sert
à tous les essayages suivants. C'est ce que fait l'application — la calibration
est écrite en `localStorage` et le changement de monture n'y touche jamais. Un
contrôle du banc navigateur le vérifie de bout en bout : un client déjà calibré
arrive directement sur l'essayage, sans qu'on lui reparle ni de ses lunettes ni
de sa carte.

## Ajuster la correction sur des mesures réelles

`prep/fitCorrection.ts` + `npm run fit:correction` absorbent les mesures que
l'humain fournira, et répondent à la question que le contrat ne pouvait pas
trancher : **décalage constant en millimètres, ou proportion ?**

Les deux modèles sont ajustés, et une **validation croisée par sujet** décide —
on retire toutes les mesures d'une personne à la fois et on regarde si le modèle
sait prédire un visage qu'il n'a jamais vu. C'est la seule propriété qui
intéresse un client à distance.

État actuel, sur les 2 mesures disponibles :

```
  decalage  erreur croisée par sujet : 6,60 mm
  rapport   erreur croisée par sujet : 7,29 mm
  → Non publiable : il faut 8 mesures sur 3 sujets, sous 3 mm.
```

L'outil **refuse**, et c'est le comportement attendu. Les mesures se déposent
dans `docs/calibration/mesures.json`, avec pour chacune son origine — compas,
monture jugée bien ajustée, ou simple monture portée — car ces trois sources
n'ont pas la même valeur de preuve.

> ⚠️ Un modèle à **un seul paramètre**, délibérément. Avec quelques dizaines de
> mesures, tout ce qui a plus d'un degré de liberté apprendra le bruit et
> paraîtra excellent. Le jour où les mesures se comptent en centaines, le point
> d'entrée pour un modèle plus riche est dans ce fichier — et le protocole de
> validation qui l'empêchera de se mentir à lui-même aussi.

## Constantes calibrées

| Constante | Valeur | Calibrée le | Sur combien d'essais |
|---|---|---|---|
| `FACE_WIDTH_CORRECTION_MM` | **0 (provisoire)** — ⚠️ désormais un REPLI : elle ne sert que si la mesure de l'écart temporal échoue | — | 0 |
| `FACE_WIDTH_CORRECTION_RATIO` | **1 (neutre)** | — | 0 |
| `VERTICAL_OFFSET_MM` | **3 (provisoire)** | — | 0 |

> 🔴 **`VERTICAL_OFFSET_MM` reste provisoire, et elle décale toujours la pose du sprite.**
>
> ⭐ `FACE_WIDTH_CORRECTION_MM`, en revanche, n'est plus sur le chemin nominal depuis le
> 2026-08-17 : l'écart temporal est MESURÉ sur chaque client (§14.2 du CLAUDE.md). Elle ne
> reprend la main que si cette mesure échoue — fond chargé, cheveux, rotation refusée — et
> l'application le dit alors en clair. C'est ce qui débloque la mise en ligne : on n'attend
> plus qu'une constante unique représente un écart de ~20 mm variant de ±4 mm selon le visage,
> ce que la confrontation aux vraies montures avait montré impossible.

## Ce qui reste, et pourquoi ça n'a pas été fait

1. **Lot 8 — calibration humaine.** Aucun agent ne peut mesurer un vrai visage devant une vraie
   webcam. ⭐ Depuis le 2026-08-17, ce lot ne bloque plus que `VERTICAL_OFFSET_MM` (la hauteur
   à laquelle le sprite se pose sur le nez) : la largeur, elle, est mesurée.

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

6. ✅ **Correction de parallaxe par rotation de tête (B4, parade n°2) : implémentée.** Les deux
   parades sont en place. `CARD_REL_ERROR` à 2,5 % reste la valeur du chemin SANS rotation ;
   avec rotation, l'incertitude est calculée à partir de ce qui a réellement été mesuré.

7. **La qualité du recoloriage V2 sur une vraie monture filmée.** La chaîne est prouvée de bout
   en bout, la qualité ne l'est pas — elle attend la vidéo de magasin.

## Écarts assumés avec le rapport d'analyse

- **Masquage du décentrement** — sur l'incertitude propagée, pas sur `relError <= 0.02` (qui
  serait devenu inapplicable après B4). Conséquence : le décentrement est désormais **affiché en
  mode iris** sur une monture courante. Détail au §5 du CLAUDE.md.
- **`'incertain'` renommé `'indetermine'`** et retiré de l'affichage client (§0.0.1).
- **`verdict()` prend 6 paramètres** et non 5 : sans le yaw, sa propre règle 3 était
  inimplémentable (T9).

## 🔴 2026-08-17 — l'écart temporal est mesuré, et la V2 recolorie le réel

Trois arbitrages humains, détaillés au §14 du CLAUDE.md. Ce qu'ils changent, concrètement.

### V1 — la carte d'abord, puis « tournez la tête »

La carte n'est plus un recours en zone grise : c'est le premier écran, une seule fois, et
la mesure sert à tous les essayages suivants. L'iris n'est plus une source de mesure —
il devient la **seconde opinion** qui relit la carte et signale un écart de plus de 12 %.

La rotation qui suit rend mesurables deux grandeurs jusqu'ici supposées.

**1. La parallaxe de la carte (B4).** La carte est posée sur le front, 20 à 40 mm devant
les repères temporaux. En perspective, elle fait sortir le visage 3 à 7 % trop petit. Ce
n'est pas du bruit : c'est un biais que les « 3 mesures concordantes » du §4 ne peuvent
pas voir, puisqu'elles le partagent toutes les trois. Deux vues tournées suffisent à le
mesurer — un écart de profondeur, un scalaire, aucune 3D.

> ⚠️ Un piège découvert en route : le milieu de deux points **projetés** n'est pas la
> projection de leur milieu. Quand la tête tourne, la tempe la plus proche tire le milieu
> apparent vers elle. Non corrigé, ce terme ajoutait **19 %** à la profondeur mesurée. Il
> se retranche exactement — c'est de la projection, pas de la morphologie.

**2. L'écart temporal lui-même.** Les repères 234/454 lisent 115 mm sur un homme dont la
monture fait 136 mm au réglet, et l'écart varie d'au moins ±4 mm d'un visage à l'autre :
**aucune constante ne peut représenter ça**. Il se lit désormais dans les pixels, à la
frontière tête/fond, à hauteur des yeux — là où passe la face d'une monture. Le mouvement
de la rotation confirme que le bord trouvé est celui de la tête, et non un montant de porte.

Chaque cas douteux est **refusé avec sa raison en clair**, et la mesure retombe sur les
repères : fond chargé, chevelure sur les tempes, débords asymétriques, bord immobile,
cadrage trop serré. Jamais une valeur approximative sans le dire.

**Ce que ça vaut, sur une tête de test projetée en perspective exacte** (jamais par le
modèle plan qu'utilise la sonde — un test qui rendrait à la sonde sa propre formule serait
vert par construction, leçon S4) :

| Contrôle | Résultat |
|---|---|
| profondeur front ↔ tempes retrouvée | à mieux que 10 % |
| largeur vraie des repères retrouvée | **à mieux que 1 %** |
| idem, avec une caméra dont le champ réel diverge de 25 % du champ supposé | à mieux que 2 % |
| écart temporal retrouvé (136 mm vrais) | à moins de 3 mm |
| incertitude annoncée | 2,0 % sur l'échelle, 2,2 % sur l'écart temporal |

`UserCalibration` porte deux champs de plus, `temporalWidthMm` et son incertitude, qui
supplantent `FACE_WIDTH_CORRECTION_MM` quand ils existent. `frameMetrics` est **inchangée** :
`faceWidthMm` reste la largeur du segment 234↔454, seule grandeur homologue de `faceWidthPx`.

### V2 — la monture réelle est RECOLORIÉE, pas recouverte

Renversement complet du §11.6. On ne pose plus un sprite par-dessus la monture portée : on
repeint ses propres pixels. La géométrie, la perspective, l'occlusion, le flou de bougé,
l'ombre du sourcil et le reflet qui glisse viennent du réel — tout ce qui coûte cher à
simuler est déjà dans l'image, gratuitement. Seule la **matière** est substituée.

C'est ce que la demande appelle « au moins du 2,5 D », et **aucune 3D n'y entre** : pas de
maillage, pas de WebGL, une boucle sur les pixels d'un rectangle.

Conséquence : **le liseré du §11.6 disparaît**, puisqu'il n'y a plus deux montures
superposées. Le sprite dilaté reste le repli quand le recoloriage ne retrouve pas la
monture dans l'image — et il le dit alors, au lieu de peindre n'importe quoi.

**Preuve sur une vraie photo** — `docs/verification/recolor-avant.png` et `-apres.png` :
59 images sur 59 recoloriées, la matière change, les yeux restent visibles derrière les
verres, la peau n'est pas touchée.

> ⚠️ Ce que cette preuve établit et ce qu'elle n'établit pas. La photo de départ est
> elle-même un composite d'un lot précédent : elle valide **la chaîne**, pas la qualité
> finale sur une vraie monture filmée. Le contrôle « aucun liseré sur monture noire » et
> le jugement esthétique restent ouverts, et **attendent la vidéo réelle de magasin**.
>
> Commande prête : `node scripts/recolor-video.mjs <video> <slug-porté> <slug-voulu> <faceWidthMm>`.
> Une simple photo suffit aussi : `node scripts/still-to-video.mjs <photo> essai.webm 2`.

### 🔴 Le porteur de lunettes — un trou relevé par l'humain, pas par les tests

> « pourquoi tu fais toujours un test avec une photo d'un gars qui porte déjà des
> lunettes, en lui rajoutant une lunette sur le visage »

La remarque portait sur les images de vérification, mais elle désignait un vrai
défaut de la V1. La ligne où l'on cherche le bord de la tête passe **à hauteur des
coins externes des yeux** — c'est-à-dire exactement là où passent les **branches**
d'une monture déjà portée. Rien ne le détectait : on aurait mesuré la monture du
client et on lui aurait annoncé sa tête, au millimètre.

Trois erreurs se cumulaient d'ailleurs chez un porteur qui garde ses lunettes :

| Ce qui casse | Ampleur |
|---|---|
| Le bord de tête trouvé est le bord de la monture | quelques mm par côté, **dans le sens qui élargit** |
| L'iris du contrôle de cohérence est minifié ou grossi par les verres | ~10 %, soit 2 à 3 fois le plancher biologique (§4, S2) |
| L'essayage lui-même est illisible : monture réelle sous monture virtuelle | rédhibitoire |

**Le correctif est une mesure, pas une supposition.** On mesure la largeur de la
tête à **deux hauteurs** : à hauteur des yeux, et 14 mm plus haut, sur la tempe nue.
En descendant du front vers la pommette une tête se rétrécit ou reste égale — elle
ne s'élargit pas. Un élargissement franc à hauteur des yeux ne peut donc pas venir
de l'anatomie : quelque chose dépasse. Au-delà de 4 mm, la mesure est **refusée**
avec « retirez-les — sinon je mesurerais votre monture, pas votre visage ».

> ⚠️ Le test est volontairement **à sens unique**. Des cheveux sur la ligne haute
> l'élargiraient, ce qui rapproche l'écart de zéro : le contrôle se tait alors au
> lieu de crier à tort. Il rate des cas, il n'en invente pas. Une contre-épreuve
> vérifie qu'un visage nu passe toujours — sans elle, un refus systématique
> satisferait le premier test.

Et la consigne « **Retirez vos lunettes** » est désormais la première ligne de
l'écran de calibration, avant même la carte.

### 🔴 La distance caméra n'est plus supposée — elle est mesurée

> « si le client a mis sa carte bancaire sur le front ne me parle plus après de
> prendre la distance du client. Ça c'est de la paresse. »

C'en était. La correction de parallaxe vaut `1 + Δz/D` : la profondeur était
mesurée, la distance venait d'un **champ de vision supposé de 60°**, dans une
chaîne dont tout le contrat dit qu'elle ne tolère aucune hypothèse.

Les deux se séparent parce qu'elles dépendent de l'angle différemment :

```
g(θ) = −Δz·sin θ  −  (a² + Δz²)/D · cos θ·sin θ
```

Une régression linéaire à deux inconnues sur le **balayage** de la rotation les
sépare. Deux extrêmes n'y suffisent pas — il faut un étalement d'angles, d'où la
sonde qui retient une vue par tranche (`ui/rotationProbe.ts`) au lieu des deux
meilleures.

> ⚠️ Le coefficient du second terme ne vaut pas `a²/D` mais `(a² + Δz²)/D` : le
> front se rapproche lui aussi quand la tête tourne, et les deux effets sont
> indiscernables par la régression. Non corrigé : **509 mm rendus pour 700 mm
> réels**, soit 27 % de faux.

**Et le résultat de mesure qui a décidé la conception :**

| Bruit sur les repères | Profondeur Δz | Distance D |
|---|---|---|
| 0 px | 29,6 mm (vrai 30) | 643 mm (vrai 700) |
| 0,25 px | 30,0 ± 1,7 mm | 686 **± 209** mm |
| 0,5 px | 29,0 ± 3,6 mm | 582 **± 308** mm |
| 1 px | 31,1 ± 7,7 mm | 621 **± 318** mm |

La profondeur est robuste ; **la distance ne l'est pas** — elle est portée par un
effet perspectif du second ordre. La conclusion honnête n'est donc ni « on la
suppose » ni « on la mesure », mais : **on la mesure, la régression annonce sa
propre incertitude, et on la fusionne avec la fenêtre de travail que
l'application impose** (60 cm–1 m), chacune pesée par sa variance. Quand la
mesure est bonne elle domine ; quand elle est mauvaise elle s'efface. C'est la
donnée qui décide, et le champ de vision supposé a quitté la chaîne de mesure.

Un test vérifie qu'une caméra à 75° donne **exactement** le même résultat qu'à 60°.

### Peut-on descendre à 1,5 % avec l'anatomie ? Non — et ça se démontre

Analyse complète, sourcée, dans **`docs/echelle-anatomique.md`**. L'estimateur
multivarié demandé a une borne d'information en forme fermée, `1/√(μᵀΣ⁻¹μ)`, et
il suffit d'y injecter les statistiques publiées :

| Modèle | Borne | Sur 140 mm |
|---|---|---|
| HVID seul | 3,35 % | ±4,7 mm |
| HVID gauche + droit (r = 0,94) | 3,30 % | ±4,6 mm |
| HVID + fente palpébrale | 3,24 % | ±4,5 mm |
| Modèle complet 4 variables | 3,20 % | ±4,5 mm |
| HVID prédit depuis le visage (R = 0,5) | 2,90 % | ±4,1 mm |

Trois faits décident :

1. **Le second œil n'apporte rien** : r = 0,94 entre les deux yeux, donc 1,5 % de
   gain sur l'erreur, pas 30 %. C'est presque la même mesure faite deux fois.
2. **La fente palpébrale est deux fois plus dispersée** (6–8 % contre 3,3 %).
3. **La cornée atteint sa taille adulte vers 3 ans** et se découple de la
   croissance du crâne — ce qui en fait un bon étalon absolu et, pour la même
   raison, un mauvais candidat à la prédiction par les proportions faciales.

Et un piège que personne ne mentionne : **quatre appareils donnent des moyennes
de 11,77 à 12,42 mm** sur les mêmes yeux, soit 5,5 % — plus que la variabilité
biologique qu'on cherche à modéliser. Le choix de la constante injecte donc un
biais plus grand que le problème.

Vérification croisée : un travail publié fait exactement le modèle 1 sur 94
sujets avec mesures de référence et obtient **MAPE 2,9 %** ; la borne théorique
prédit 3,35 % d'écart-type, soit 2,7 % de MAPE. **La théorie et l'expérience
concordent à 0,3 point.**

**La conclusion est constructive** : l'erreur n'est pas dans l'étalon, elle est
dans la mesure. La carte ISO 7810 a **0,1 %** d'incertitude normative contre
3,3 % de variabilité biologique pour le HVID. Le facteur 3 se gagne en
supprimant les biais autour d'un étalon déjà parfait — c'est ce que fait la
mesure de parallaxe — pas en cherchant un meilleur étalon biologique.

### Deux défauts trouvés en route, tous deux invisibles là où on regardait

| Défaut | Pourquoi il ne se voyait pas | Correctif |
|---|---|---|
| `putImageData` **remplace** les pixels au lieu de les composer : le recoloriage découpait un rectangle noir autour de la monture | dans l'application, le canvas est transparent au-dessus du `<video>` — le trou tombait sur du vide. **Le mode d'échec exact de `destination-out`, une deuxième fois** | composition par `drawImage` sur un calque isolé |
| La règle des 300 lignes du §3 n'était vérifiée par **rien** | sept fichiers l'avaient franchie ou l'approchaient sans que rien ne le signale | barrage `i` du hook + test `guards.test.ts` |

**Contrôles :** 117 tests Vitest · `tsc --noEmit` en `strict` · `npm run build` · `npm run smoke`
21 contrôles verts, dont la preuve métrologique du rendu inchangée à 131,82 mm pour 132,00 attendus.

## Journal

- **2026-08-17** — Carte obligatoire en V1, parallaxe et écart temporal **mesurés**,
  recoloriage 2,5 D en V2. Deux défauts trouvés dont un identique en nature à celui du
  lot précédent (`putImageData` après `destination-out`).
- **2026-08-16** — Correction du contrat : 15 correctifs (B1–B5, S1–S5, T1–T8) + 3 arbitrages.
- **2026-08-16** — Lots 0 à 7. Six défauts relevés pendant le codage, dont un (`onLost` qui ne
  dessinait pas) qu'aucune relecture n'avait attrapé et qui reconstituait le bug #3 à l'identique.
- **2026-08-16** — Lots V2-0 à V2-3, séparation explicite des deux versions à l'accueil, et banc
  de preuve métrologique du rendu (`tests/render-proof.html`).
