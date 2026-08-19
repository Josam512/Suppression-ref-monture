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

## ✅ La chaîne V1 tourne sur la vraie vidéo — telle quelle

Téléphone tenu à la main, salon, fenêtre et stores derrière, tête décentrée.
**Aucune reprise de vue.** Résultat :

| | |
|---|---|
| Profondeur carte ↔ coins des yeux | **36,8 mm ± 1 %** (37 vues) |
| Reliquat anatomique yeux → tempes | 12 mm déclarés (± 6) |
| Biais de parallaxe corrigé | **+6,7 %** |
| Largeur des repères 234↔454 | 129,6 mm brute → **138,3 mm** |
| **Écart temporal** | **152,2 mm ± 2,8 mm** (1,8 %) |
| Incertitude d'échelle | **1,65 %** |

Contrôle de stabilité sur une autre image frontale de la même vidéo :
profondeur **35,5 mm** contre 36,8 — **3,6 % d'écart**. Avant correctifs, la même
comparaison donnait 14,6 contre 43,8 mm.

### Trois défauts, et un seul les causait tous

**1. La référence sagittale n'était pas un point physique.** Le milieu des
repères 234/454 servait de référence pour la rotation. Or ces points sont sur le
CONTOUR : quand la tête tourne ils ne suivent pas la peau, ils **glissent le long
de la silhouette**. Leur milieu se déplace de plusieurs centimètres sans
qu'aucune profondeur soit en cause. La profondeur sortait alors à **99 mm quel
que soit le point sondé** — front, sellion, glabelle, pointe du nez. Le coupable
n'était pas la sonde mais la référence.

Avec les **coins externes des yeux**, qui sont de vrais points anatomiques et
sont à la hauteur exacte où passe une monture :

| Référence | Profondeur du front | Stabilité |
|---|---|---|
| tempes 234/454 (glissantes) | **refus, 99 mm** | — |
| **coins externes 33/263** | **36,8 mm** | **±1 %** |
| coins internes 133/362 | 26,7 mm | ±2 % |
| ailes du nez 129/358 | 13,9 mm | ±6 % |

Les trois dernières lignes se hiérarchisent exactement comme l'anatomie l'exige.
C'est la meilleure preuve que la mesure fonctionne.

**2. Un décalage constant que la moyenne n'éliminait pas.** Le repère sagittal
n'est jamais exactement sur le plan médian. La relation devient `g = c − Δz·sinθ`
et diviser chaque vue par `sinθ` transforme `c` en `c/sinθ`, qui explose aux
petits angles — de façon parfaitement CONSTANTE d'une vue à l'autre, donc avec
l'air d'une bonne mesure. La pente l'élimine : **Theil–Sen**, médiane des pentes
de toutes les paires de vues. C'est la mesure différentielle à deux vues du §4,
généralisée à toutes les paires, avec une médiane pour résister aux images
floues.

**3. On modélisait le FOND.** L'ancienne recherche du bord de tête
échantillonnait l'arrière-plan au bord de l'image et balayait vers l'intérieur.
Elle imposait donc un mur uni et une tête centrée — elle transformait un problème
de mesure en contraintes pour le client. Elle a trouvé le montant d'une fenêtre
à 83 mm de la tempe.

`core/headGrowth.ts` part désormais **de la tête** : une zone de référence prise
sur la tempe apprend la peau ET les cheveux de cette personne dans cette lumière,
puis on croît vers l'extérieur jusqu'au décrochage. **L'arrière-plan n'est jamais
lu.** Mur bleu à pois verts compris.

> ⚠️ La distance au plus proche des échantillons, jamais à leur moyenne : une
> tête a au moins deux couleurs très éloignées, peau et cheveux. Les moyenner
> donnerait un gris qui ne ressemble à rien, et la frontière tomberait au milieu
> du visage.

### 🔴 Un estimateur supprimé, pas désactivé

L'ajustement à deux paramètres qui tirait d'un coup la profondeur et la distance
a été **retiré du dépôt**. Il passait sur la tête de synthèse et mentait avec
assurance sur le réel. Le garder « au cas où » aurait laissé un piège. La
distance n'est plus ajustée : elle est fixée à la fenêtre de travail, où elle ne
pèse que 3,4 % de la profondeur.

## 🔴 Première vraie vidéo d'un vrai sujet — 2026-08-17

Un sujet sans lunettes, carte à plat sur le front, rotation de tête. 11,4 s,
720×1280, filmée **au téléphone tenu à la main**. Codec HEVC : Chromium ne le
décode pas, transcodage en VP9 par un ffmpeg embarqué (`imageio-ffmpeg`).

**Ce que la vidéo contient**, relevé par `scripts/v1-on-video.mjs` :

| | |
|---|---|
| visage détecté | **148 images sur 172 (86 %)** |
| yaw balayé | −69° à +62° |
| roll médian | 4,5° |
| carte, contrôle de forme | rapport 1,570 pour 1,586 attendu → **−1,0 %**, carte quasi parallèle |
| largeur des repères 234↔454 | **129,6 mm** |

**Et les deux mesures qui ont REFUSÉ de conclure :**

| Mesure | Résultat | Cause nommée |
|---|---|---|
| Parallaxe (profondeur front↔tempes) | **refusée** | instable à ±100 % |
| Écart temporal | **refusée** | débord de 83 mm : cheveux et fond chargé |

### Ce que ces refus valent

C'est le comportement pour lequel tout le projet est bâti : **rien n'a produit
un chiffre faux d'allure normale.** Chaque maillon incertain s'est arrêté en
nommant sa cause. Première confrontation au réel, aucune valeur inventée.

### 🔴 Le défaut que seule la vraie vidéo pouvait révéler

La profondeur sortait à **14,6 mm sur une image frontale et 43,8 mm sur une
autre — même vidéo, mêmes vues, une seule vue d'écart dans le filtre**. Or
l'incertitude calculée sur les **résidus** de la régression, elle, annonçait une
mesure sûre.

La formule des résidus suppose des erreurs indépendantes d'une vue à l'autre.
Sur une vraie vidéo elles ne le sont pas du tout : le détecteur se trompe de la
même façon sur toutes les images d'une même phase de rotation, le flou de bougé
est corrélé, le roll dérive lentement. L'incertitude est donc calculée par
**jackknife** — on refait l'ajustement en retirant chaque vue à tour de rôle et
on prend la dispersion. Elle annonce ±100 %, ce qui est la vérité.

Et une correction de parallaxe appliquée avec ±100 % d'incertitude **ajoute
autant d'erreur qu'elle en retire, sous couvert de correction**. Au-delà de
50 %, la correction est donc refusée : `MAX_DEPTH_REL_ERROR`.

### Pourquoi cette prise-là ne pouvait pas marcher — et ce que ça dit du produit

1. **Caméra tenue à la main.** Elle casse les deux mesures à la fois : le « yaw »
   mesuré mélange rotation de tête et mouvement de caméra, et le masque de
   mouvement devient inutile puisque le fond bouge aussi. ⚠️ **Ce n'est PAS le
   cas nominal du produit** : la V1 tourne sur une webcam d'ordinateur, fixe par
   construction. Le téléphone à la main est le pire cas, pas le cas d'usage.
2. **Fond chargé à hauteur des yeux** : fenêtre, chevalet, stores. Le bord
   tête/fond n'y est pas trouvable.
3. **Tête au bord du cadre** sur la première image frontale : 26 px de marge à
   droite. Le contrôle « cadrage trop serré » l'a vu et refusé.

**Ce qu'il faut pour la prochaine prise :** appareil **posé**, mur uni derrière,
tête **centrée** avec de la marge des deux côtés, cheveux dégagés des tempes,
puis rotation lente. Trente secondes, et les trois mesures deviennent testables.

### Deux défauts trouvés en route, tous deux invisibles là où on regardait

| Défaut | Pourquoi il ne se voyait pas | Correctif |
|---|---|---|
| `putImageData` **remplace** les pixels au lieu de les composer : le recoloriage découpait un rectangle noir autour de la monture | dans l'application, le canvas est transparent au-dessus du `<video>` — le trou tombait sur du vide. **Le mode d'échec exact de `destination-out`, une deuxième fois** | composition par `drawImage` sur un calque isolé |
| La règle des 300 lignes du §3 n'était vérifiée par **rien** | sept fichiers l'avaient franchie ou l'approchaient sans que rien ne le signale | barrage `i` du hook + test `guards.test.ts` |

**Contrôles :** 120 tests Vitest · `tsc --noEmit` en `strict` · `npm run build` · `npm run smoke`
23 contrôles verts, dont la preuve métrologique du rendu inchangée à 131,82 mm pour 132,00 attendus.

---

## « Des lunettes sont posées sur le nez, pas sur les yeux » — ce que ça change, et ce que ça ne change pas

C'est vrai. Et la conclusion que j'en avais tirée au tour précédent — *donc il faut
dessiner le sprite à l'échelle du plan du nez, soit ~6 % plus grand* — était **fausse**.
Je la corrige avant de la coder, parce qu'elle aurait cassé le seul critère de succès
du projet en ayant l'air de l'améliorer.

### Pourquoi la conclusion est fausse

Une monture n'est pas plate. Son plan avant (pont, faces des verres) est **mesuré** à
~48 mm devant les repères temporaux sur le sujet réel. Mais sa **largeur**, les 132 mm
qu'on affiche, ne se réalise pas là : elle se réalise à ses **tenons**, plaqués sur les
côtés de la tête, à quelques millimètres devant le contour du visage. C'est là que
l'opticien pose son réglet, et c'est là que la caméra voit les deux bords.

Mettre tout le sprite à l'échelle du pont dessinerait donc une monture **6 % plus large
qu'elle n'est** — 8 mm sur 132. Un opticien lirait 140 mm sur un visage de 152 là où la
réalité donne 132. Et l'image aurait l'air **meilleure**, puisque sa partie centrale
tomberait mieux : le mode d'échec exact que tout ce dépôt combat.

**Verrouillé** dans l'invariant « la distance ne change pas le rapport monture/visage »,
qui affirme désormais aussi que ce rapport n'est **pas** celui du plan du pont.

### Ce que le plan du nez gouverne réellement — et qui est maintenant juste

| Grandeur | Plan | Effet de la correction |
|---|---|---|
| Largeur rendue du sprite | tempes / tenons | **inchangée** — c'était déjà juste |
| `VERTICAL_OFFSET_MM` (pose sur l'arête du nez) | pont | +0,2 mm |
| Décentrement (centre optique du verre) | pont | −6 % sur l'écart lu |

Petit, mais gratuit et du bon côté. `core/framePlane.ts` porte le raisonnement complet,
les trois profondeurs et leurs incertitudes.

### Ce qu'on ne corrige PAS, et pourquoi

Les tenons ne sont pas exactement dans le plan des repères 234/454 : ~8 mm devant, soit
1 % d'échelle. On ne sait pas cette valeur à mieux que ±6 mm — **75 % d'incertitude sur
une correction de 1 %**. Le projet a déjà tranché ce cas de figure (`MAX_DEPTH_REL_ERROR`,
50 %) : au-delà, corriger déplace l'erreur au lieu de la retirer. Ce 1 % reste donc un
biais **déclaré** (`ENDPIECE_AHEAD_MM`) plutôt qu'une correction devinée.

### L'audit qui manquait : le yaw de MediaPipe est-il à l'échelle ?

Toute la profondeur repose dessus au premier ordre (`Δz = Δu / sin θ`). Si MediaPipe
annonçait 20° là où la tête en tourne 30, **toutes** les profondeurs sortiraient gonflées
de 50 %, de façon parfaitement stable d'une vue à l'autre — donc avec l'air d'une bonne
mesure. Rien dans la chaîne ne l'aurait attrapé. Le soupçon était chiffré : 35,6 mm entre
les canthus externes et le sellion, là où l'anatomie en donne plutôt 15 à 20.

Vérifié **sans mire et sans nouvelle prise de vue**, sur la vidéo déjà fournie. Un yaw
tourne autour de la verticale : il raccourcit les longueurs horizontales de `cos θ` et ne
touche à **aucune** longueur verticale. Le rapport

> (écart horizontal des canthus externes) / (hauteur front ↔ menton)

vaut donc `r₀·cos θ`, et il est insensible à la distance caméra puisque les deux termes
s'y échelonnent pareil. `r₀` est pris sur les images frontales **de la personne
elle-même** : aucune morphologie n'est supposée.

**Résultat : 1,013 ± 0,141 sur 70 vues.** MediaPipe est juste, à ±14 % près. La
profondeur mesurée et la parallaxe de +6,7 % tiennent. *(Cet audit vit dans l'atelier,
pas dans `src/` : le §4 interdit un estimateur de yaw 2D dans l'application, et il a
raison — c'est un contrôle, pas une source.)*

**Reste ouvert :** l'écart entre les 35,6 mm mesurés et les 15–20 mm attendus par
l'anatomie n'est pas expliqué par le yaw. Reste l'hypothèse que les repères de MediaPipe
soient régularisés vers son maillage canonique sous rotation. Non tranchable sans une
mesure au pied à coulisse sur le sujet.

---

## « Tu connais les mesures de la carte, il n'y a plus rien d'autre à demander »

Exact. Je lisais la carte comme une **règle à plat** : deux bords, une échelle en px/mm.
Un rectangle de dimensions normalisées vu en perspective est une **mire de calibration** :
ses quatre coins donnent une homographie, et une homographie donne la **focale**, donc la
**distance en millimètres**. Deux grandeurs que je supposais alors qu'elles étaient déjà
dans l'image.

`core/cardPose.ts` fait ça. Deux contraintes suffisent, et elles viennent du seul fait que
la carte est un rectangle de cotes connues : ses deux côtés sont orthogonaux et leur
rapport de longueur est connu. Chacune donne `f²` — donc **deux estimations indépendantes
depuis une seule vue**, dont l'écart est un contrôle de cohérence gratuit.

Vérifié contre la tête de synthèse, qui projette en perspective exacte avec une focale et
une distance connues par construction et jamais communiquées au solveur :

- focale retrouvée à moins de 1 px, à 40°, 60° et 90° de champ — donc **rien n'est supposé
  du champ de vision**, ce que l'ancienne chaîne faisait ;
- distance retrouvée au millimètre, de 620 à 1000 mm, de face comme à 26° ;
- carte parfaitement fronto-parallèle → **refusée**, pas devinée : sans perspective, un
  rectangle ne dit rien de l'objectif, et `f²` sortirait d'un 0/0.

### Le chiffre qui décide, et qui n'est pas celui qu'on espérait

Le client ajuste le cadre à la main. La focale, elle, sort d'un effet du **second ordre** :
sur une carte de 85 mm vue à 78 cm, le raccourci d'un bord à l'autre fait un ou deux
pixels. Le signal est au niveau du bruit.

| Vues | Bruit de pointage | Dispersion sur la distance |
|---|---|---|
| 1 | ±0,25 px | ±12 % |
| 1 | ±0,5 px | **±20 à 25 %** |
| 10 | ±0,5 px | ±8 % |
| 25 | ±0,5 px | ±5,5 % |
| 50 | ±0,5 px | **±4 %**, sans biais |

**Sur une seule image, la mesure est donc PIRE que l'a priori de 780 mm ± 17 % qu'elle
devait remplacer.** Le dire plutôt que de livrer la version qui a l'air plus savante :
c'est exactement le mode d'échec que ce dépôt combat, et il est verrouillé par un test qui
exige que la dispersion mono-vue reste au-dessus de 15 %.

Mais la carte est sur le front pendant **tout** le balayage, et le bruit de pointage n'est
pas corrélé d'une image à l'autre — contrairement au biais de parallaxe, que le moyennage
ne touchera jamais. Cinquante vues ramènent la distance à **±4 %**, soit quatre fois mieux
que la constante. La rotation cesse d'être un moyen de mesurer une profondeur : elle
devient la source de la calibration caméra.

### La chaîne est branchée — et voici où elle bute sur le réel

`core/cardEdges.ts` retrouve les coins tout seul, exactement comme demandé : « si le
client met son doigt sur un coin, tu peux déduire où est l'autre ». Chaque côté est
échantillonné, chaque point accroché sur le maximum de gradient le long de la normale,
puis une droite est ajustée et les droites consécutives intersectées.

Sur une image de synthèse aux coins connus au sous-pixel : **0,05 px d'erreur**, et un
seul coin juste sur quatre suffit à récupérer les trois autres.

**Deux défauts trouvés en route, tous deux invisibles sans vérité terrain :**

| Défaut | Symptôme | Correctif |
|---|---|---|
| Convention de centre de pixel : le pixel `i` a sa valeur en `i + 0,5`, pas en `i` | les quatre coins ressortaient à **0,7 px** de la vérité, de façon parfaitement stable quelle que soit la qualité de l'image | un `−0,5` dans l'interpolation → **0,05 px**, quatorze fois mieux |
| Rejet d'aberrants à la médiane | le pouce du sujet couvre plus de la moitié d'un bord : les aberrants sont **majoritaires**, la médiane bascule de leur côté, le coin sortait à 16 px | consensus RANSAC déterministe : la droite qui explique le PLUS de points, quel que soit leur nombre relatif |

`NOMINAL_DISTANCE_MM` est branchée pour céder la place à la distance mesurée dès qu'elle
existe — et le code ne demande jamais *pourquoi* elle manque, seulement si elle est là
(§11.4).

### Le bord masqué n'était pas un obstacle — c'était un mauvais critère

Sur la vidéo du sujet, la carte est tenue à la main : le pouce couvre le milieu d'un bord
court. Deux critères de sélection de droite ont échoué là-dessus, et **pour la même
raison** :

1. **rejet à la médiane** — il suppose les aberrants minoritaires ; ici ils sont
   majoritaires sur ce bord, la médiane bascule de leur côté, le coin sortait à 16 px ;
2. **consensus « le plus de points »** — le contour du pouce est une droite plus longue et
   mieux échantillonnée que les vingt pixels de bord qui dépassent de part et d'autre. Il
   gagne.

Ce que les deux oubliaient : **un bord masqué n'est pas un bord inconnu.** La carte est un
rectangle rigide et le cadre de départ — celui du client, ou celui de l'image précédente —
dit déjà où il est à quelques pixels près. La bonne droite n'est donc pas celle qui a le
plus de points, c'est celle qui est **compatible avec ce qu'on sait déjà** et qui explique
le mieux les points restants. Quatre pixels de bord visible suffisent ; le pouce est
écarté d'office parce qu'il est trop loin du cadre. Et si un bord est *totalement* masqué,
on garde celui du cadre : la vue reste dans le balayage.

**Effet : 0 cadre suivi → 100 cadres suivis sur 148 images.**

Un garde-fou vient avec (`MIN_MEASURED_EDGES`) : il faut qu'au moins deux bords aient été
réellement accrochés sur les pixels. Sans lui, une image uniformément grise passerait —
les quatre bords retomberaient sur le cadre, aucun coin ne bougerait, et la vue entrerait
dans le balayage sans qu'un seul pixel ait été mesuré.

### 🔴 Ce que la distance mesurée révèle : l'a priori était faux de 46 %

| | Supposé | **Mesuré sur la carte** |
|---|---|---|
| Distance | 78 cm ± 17 % | **42,1 cm** ± 10,7 % |
| Facteur de parallaxe | 6,8 % | **12,9 %** |
| Largeur aux repères 234/454 | 145,2 mm | **153,5 mm** |
| Écart temporal | 160,0 ± 2,9 mm | **169,0 ± 3,5 mm** |

**Recoupement, par une voie indépendante de la pose :** la carte raffinée mesure 145 px de
long ; à la focale trouvée (721 px, soit 1,00 × la largeur d'image → 53° de champ, typique
d'une caméra frontale de téléphone), une carte de 85,6 mm vue de face serait à 42,4 cm. La
pose rend 42,1 cm. Les deux concordent à 0,7 %.

Le sujet filmait à bout de bras : 42 cm est parfaitement plausible, et **78 cm ne l'était
pas**. Toute la chaîne tournait donc avec une distance fausse de près de moitié, et le
biais de parallaxe était sous-corrigé du simple au double — sans que rien ne le signale,
puisque l'a priori était « imposé par la fenêtre de travail ».

> ⚠️ Conséquence immédiate pour le produit : 42 cm est **sous** `CARD_MIN_DISTANCE_MM`
> (600 mm), que le §4 impose comme parade n°1 au biais B4. L'application peut désormais le
> DÉTECTER et dire « reculez » sur une mesure, là où elle ne pouvait que l'espérer.

### La mesure entre enfin dans l'APPLICATION, pas seulement dans l'atelier

Tout ce qui précède ne tournait que dans l'outil d'atelier. L'application, elle, continuait
de calibrer avec les 78 cm supposés — c'est-à-dire avec l'erreur qu'on venait de démontrer.
C'est branché :

| Maillon | Avant | Maintenant |
|---|---|---|
| Ce que le client pointe | deux poignées | deux poignées — **inchangé** |
| Ce qu'on en fait | une largeur en pixels | une **graine** de quadrilatère, accrochée sur les vrais bords |
| Pendant la rotation | 2 images gardées pour la silhouette | + la carte **suivie** de tranche en tranche, 4 coins gardés par vue |
| Distance | 780 mm supposés | **mesurée**, quand le suivi aboutit |

⚠️ Le geste du client **ne change pas d'un pouce**. Il pose deux poignées comme avant ; les
proportions ISO donnent le rectangle, et `core/cardEdges.ts` l'accroche au dixième de pixel.
Il n'a pas à être précis — c'est le seul niveau d'exigence acceptable à distance.

⚠️ **Rien n'est bloquant.** Accrochage raté, carte perdue de vue, focale trop dispersée :
`cardSweep` refuse de lui-même et la chaîne retombe exactement sur son comportement
précédent, avec sa marge honnête. Un client qui n'y arrive pas doit pouvoir essayer des
lunettes quand même (§0.0.2).

⚠️ Aucune image du balayage n'est conservée pour ça : le suivi est fait à la volée et seuls
les quatre coins sont gardés. Huit images de 1280×720 coûteraient 30 Mo pour rien.

**Contrôles :** 139 tests Vitest · `tsc --noEmit` en `strict` · `npm run build` ·
banc navigateur vert (23 contrôles).

## Journal

- **2026-08-17** — ⚠️ **Cadre à remplir : logique écrite, verrou NON VALIDÉ.**
  Renversement de l'IHM de calibration : au lieu de faire traîner un rectangle sur la carte
  (le seul geste long du parcours), l'app affiche un cadre au rapport ISO et le client
  approche la tête. **Le cadre est la graine de l'accrochage** : plus rien à détecter.
  Trois détections automatiques essayées avant, toutes ratées sur la photo réelle —
  rectangles candidats notés au rapport ISO (36 % d'erreur d'échelle), contours fermés type
  scanner de document (**0 candidat** : le contour de la carte n'est pas fermé sur un front
  éclairé, les contours de sa zone font 745 à 2 170 px² pour une carte de 157 874),
  assemblage de segments (57 %). Cause commune : **la lisière des cheveux est un bord plus
  franc que la carte**.
  **Deux contrôles CIRCULAIRES trouvés et corrigés** : comparer les coins accrochés au
  cadre ne peut pas échouer, puisque `refineQuad` contraint sa sortie à rester près de sa
  graine — il verrouillait sur une carte de 282 px pour un cadre de 396 ; compter les bords
  « mesurés » ne suffit pas non plus, le grain de peau fournit assez de gradient. Le seul
  contrôle non circulaire lit les pixels **de part et d'autre du cadre, qui est fixe**.
  **Résultat mesuré** : la marche de luminance culmine à **34,6 exactement là où la carte
  remplit le cadre** (zoom 0,77), contre ~10 ailleurs — facteur 3, le signal existe.
  🔴 **Mais le verrou automatique n'a jamais déclenché** dans la simulation, trop grossière
  (pas de 0,05) pour produire trois images consécutives conformes. `MIN_GUIDE_EDGE_STEP`
  reste **choisi à la main sur une seule photo** et doit être figé depuis une vraie séquence
  webcam. Ne pas livrer, ne pas l'ajuster pour verdir un test.
  Les 12 tests ajoutés couvrent la logique pure et les deux anti-circularités, **pas** la
  boucle de bout en bout.

- **2026-08-17** — **La focale est mesurée une fois, puis mémorisée et réutilisée**
  (`core/cameraProfile.ts`). Le balayage la mesurait déjà, s'en servait pour une
  conversion, puis la **jetait** : à la séance suivante — ou si le client passait la
  rotation — la chaîne retombait sur le champ de vision supposé, faux de 46 % sur le
  premier sujet réel. Elle est désormais persistée sous forme **normalisée**
  (`focale ÷ largeur d'image`), donc invariante par changement de résolution, sous une clé
  `localStorage` **séparée de la calibration** : « refaire la calibration » décrit un
  visage et ne doit pas jeter la mesure d'un objectif. Fusion pondérée par l'inverse de la
  variance entre séances, avec **plancher systématique de 2 %** — le moyennage tue le bruit
  de pointage, pas la distorsion ni le point principal supposé au centre.
  **Ce que ça débloque :** une vue frontale unique, qui ne peut PAS porter la focale et que
  `cameraFromCard` refuse à juste titre, redonne une distance juste par simple division.
  Sur les coins réels de la photo du sujet : **43,1 cm**. 16 tests, dont trois bâtis sur
  ces coins réels.
  ⚠️ Un test écrit « doubler la focale double la distance » a rougi : mesure faite, le
  rapport vaut 1,957 — le terme de fuite de l'homographie ne porte pas la focale. C'était
  l'énoncé qui était faux, pas le code.

- **2026-08-17** — **La contrainte de tournage est retirée.** `isTooCloseForCard` et le
  « reculez, il faut au moins 60 cm » (bouton de validation désactivé) sont **supprimés** :
  c'était un problème de mesure converti en contrainte imposée au client, l'erreur n°11 du
  journal, reprochée à juste titre. Remplacés par `parallaxRelErrorAt` — le biais Δz/z est
  **chiffré** et part grossir la marge affichée. Rien ne bloque plus.
  **Défaut trouvé sur la vraie photo du sujet** : `focalSpread` était calculé, exporté et
  **consommé par rien** dans `src/`. La chaîne rendait « 134 cm » avec **89 % de désaccord
  entre ses deux estimations internes**, sans que rien ne l'arrête. Garde-fou
  `MAX_FOCAL_SPREAD = 0.25` ajouté, avec trois tests de non-régression bâtis sur les coins
  réels de cette photo.
  **Carte Vitale** (et CNI, permis, carte de transport) explicitement acceptées : toutes au
  format ISO 7810 ID-1, donc strictement équivalentes. La Vitale est même recommandée en
  premier — aucun numéro de paiement dessus.

- **2026-08-17** — Question « peut-il choisir entre une 46 et une 48 ? » tranchée et
  chiffrée (`docs/distance-et-calibres.md`). Un pas de calibre vaut ~4 mm de largeur
  totale. Le **rapport entre deux tailles** est rendu exactement, quelle que soit la
  calibration — verrouillé sur un balayage de ±10 % de biais. Leur **rapport au visage**,
  lui, se déplace en 1/calibration : la carte à 2,5 % vaut **0,8 pas de calibre**. Donc
  départageables par comparaison, pas dans l'absolu. ⚠️ Une première rédaction affirmait
  que l'erreur commune « ne brouille pas le choix » : **c'était faux, le test l'a démenti**
  et la thèse a été corrigée, pas le test. Conséquence : le recoupement de la distance
  caméra devient la **priorité n°1**, parce que c'est lui qui porte le biais de parallaxe
  (12,9 % à 42 cm contre 6,8 % à 78 cm supposés, soit ~9 mm sur la largeur du visage).

- **2026-08-17** — La branche **aboutit à l'oreille mesurée** (repères 162 / 389, identifiés
  en annotant 32 candidats sur une photo réelle, pas de mémoire). Sa longueur ne vient plus
  du sprite de profil, connue à ±20 % : les deux extrémités sont connues à l'écran, deux
  points fixent la similitude. Le raccourci en sin(yaw) n'est pas perdu, il est porté par
  l'écart charnière ↔ oreille, qui est lui-même le long de l'axe avant-arrière.
  ⚠️ **Trois tests rectifiés**, tous parce qu'ils verrouillaient le modèle NOMINAL et non
  un invariant physique : « suit sin(yaw) » (remplacé par « le bout tombe sur l'oreille »,
  balayé sur 7 yaw), « longueur nulle de face » (elle est petite, pas nulle), « symétrique
  à tout yaw » (fausse : de trois quarts une branche s'allonge et l'autre se dérobe).
  ⚠️ **Non vérifié sur un vrai visage tourné** — il manque une photo de trois quarts, tête
  nue. Les tests ne portent que sur la fixture de synthèse.

- **2026-08-17** — Audit de la borne d'information (`core/ocularPrior.ts`), demandé pour
  vérifier si elle était mal posée. **Structure correcte** (information de Fisher), et
  conclusion robuste : sur tout le domaine de corrélations défendable elle reste entre
  2,99 et 3,34 %, soit **plus de 4 mm** sur l'écart temporal — au-dessus du seuil de
  lecture de 3 à 5 mm. Ajouter les dimensions de croissance exclues (nez, bouche,
  bizygomatique) ne fait descendre qu'à 2,78 % : gain réel mais insuffisant. La carte
  reste requise. ⚠️ **Sous-estimer les corrélations rend la borne trop OPTIMISTE**, pas
  l'inverse : à `INTEROCULAR_R` = 0,5 elle donne 2,90 %, à 0,999 elle donne 3,35 %.
  **Défaut trouvé et corrigé** : à corrélation ~0,95, Σ⁻¹ extrait un contraste de
  variance quasi nulle et la borne s'effondre à **1,39 %** — meilleure que la carte, sans
  aucune information ajoutée. Trappe ouverte pour quiconque « améliorerait » les
  corrélations vers les valeurs hautes publiées. `robustScaleBound` rend désormais le
  pire cas sur ±0,05 de corrélation, et refuse franchement quand le conditionnement est
  rompu. Quatre tests, dont un qui verrouille le défaut lui-même.

- **2026-08-17** — `VERTICAL_OFFSET_MM` **supprimée**, remplacée par `poseAnchorOf`
  (`core/faceMetrics.ts`) : X sur le sellion, Y sur la ligne des quatre canthi, le sprite
  ancré par ses PROPRES centres optiques. La constante était **incalibrable**, pas
  seulement non calibrée : elle ancrait le pont, alors que les centres optiques sont
  10,4 mm plus bas sur `severine` — et cet écart change d'une monture à l'autre. Les
  centres optiques tombaient donc ~13 mm sous la ligne des yeux. Vérifié sur un **vrai
  visage** (photo du sujet, avant/après dans `docs/verification/`), et verrouillé au banc
  par un contrôle **sans paramètre libre**. Le lot 8 perd sa moitié.

- **2026-08-17** — `core/cardEdges.ts` + `core/edgeLines.ts` + `core/cardSweep.ts` : les
  coins se retrouvent tout seuls (0,05 px sur vérité terrain), un bord masqué par un doigt
  n'arrête plus rien, la focale sort du balayage. **Distance mesurée à 42,1 cm là où la
  chaîne en supposait 78** : le biais de parallaxe était sous-corrigé du simple au double.
  Trois défauts trouvés : convention de demi-pixel, rejet d'aberrants inopérant quand les
  aberrants sont majoritaires, et critère de consensus qui préférait le contour du pouce.
- **2026-08-17** — `core/cardPose.ts` : la carte devient une mire de calibration — focale et
  distance **mesurées**. Caractérisation du bruit : inutilisable sur une vue, ±4 % sur le
  balayage.
- **2026-08-17** — Plans de rendu explicités (`core/framePlane.ts`) : la largeur reste au plan
  des tempes, le pont et le décentrement passent au plan du nez. Correction d'une conclusion
  erronée de ma part, qui aurait dessiné la monture 6 % trop large. Audit du yaw MediaPipe :
  1,013 ± 0,141, il est juste.
- **2026-08-17** — Carte obligatoire en V1, parallaxe et écart temporal **mesurés**,
  recoloriage 2,5 D en V2. Deux défauts trouvés dont un identique en nature à celui du
  lot précédent (`putImageData` après `destination-out`).
- **2026-08-16** — Correction du contrat : 15 correctifs (B1–B5, S1–S5, T1–T8) + 3 arbitrages.
- **2026-08-16** — Lots 0 à 7. Six défauts relevés pendant le codage, dont un (`onLost` qui ne
  dessinait pas) qu'aucune relecture n'avait attrapé et qui reconstituait le bug #3 à l'identique.
- **2026-08-16** — Lots V2-0 à V2-3, séparation explicite des deux versions à l'accueil, et banc
  de preuve métrologique du rendu (`tests/render-proof.html`).

## 2026-08-18 — La séance filmée : c'est le client qui déclenche et qui arrête

**Arbitrage humain**, §14.7 du contrat. Le cadre à remplir et son verrouillage
automatique sont **supprimés** : trois écrans, trois boutons, aucune transition
décidée par la machine. « J'ai fini » est le seul événement qui lance le calcul.

### Deux bugs de mesure trouvés en faisant ce travail

| Bug | Conséquence réelle | Correctif |
|---|---|---|
| La carte n'était relevée qu'aux **tranches d'angle neuves** : 6 vues sur un aller-retour de 120 images, pour un plancher `MIN_SWEEP_VIEWS` de 8. Et l'écran disait « rangez votre carte » pendant que le code la suivait | `cameraFromSweep` refusait **toujours**, en silence → la distance retombait sur l'a priori, faux de 46 % (§14.5). La mire de calibration était écrite, testée, **jamais atteinte** | relevé à chaque image (400 vues, plafonnées) ; la carte reste en main |
| Le gel de l'image et le pointage étant désormais séparés de plusieurs secondes, les repères du visage étaient relus **après**, sur une tête qui avait bougé | rapport carte/visage faux, invisiblement | `ui/freezeFrame.ts` lie image et repères ; sans repères, pas de gel |

### Fichiers supprimés

`core/cardGuide.ts`, `core/cardGuideLock.ts`, `ui/cardGuideStep.ts`,
`tests/guide-on-video.ts`, `scripts/guide-on-video.mjs`, `tests/guide.test.ts`.
La mesure de contraste survit dans `core/edgeStep.ts` — elle ne refuse plus rien
à personne, elle ne sert plus qu'à l'atelier.

### État

- **182 tests au vert** (`tests/capture.test.ts` : 16 nouveaux), typecheck strict clean.
- **Banc navigateur vert**, 26 contrôles.
- ⚠️ **Non couvert de bout en bout** : le câblage des trois boutons entre eux.
  Le flux de CI est une mire, pas un visage ; le banc vérifie le refus de geler
  sans repères et s'arrête là. C'est écrit dans le banc, pas contourné.
- ⚠️ `FACE_WIDTH_CORRECTION_MM` toujours à 0 (lot 8, humain) — supplantée dès que
  la mesure d'écart temporal aboutit.


## 2026-08-18 (soir) — La carte est trouvée toute seule

Le pointage des deux repères est **supprimé**. Deux boutons : « Je filme », « J'ai
fini ». `core/cardFinder.ts` trouve la carte sur chaque image du film ; c'est la
médiane des vues qui porte la mesure.

**Mesuré sur les 179 images réelles du sujet** (`node scripts/card-find.mjs`) :
179/179 images, 4,6 % de dispersion image par image, **0,35 % d'écart-type sur la
médiane**. Élargir la fenêtre de recherche du simple au double déplace la médiane
de 0,3 % — ce sont les pixels qui décident.

⚠️ 0,35 % est de la RÉPÉTABILITÉ, pas de la précision. `relError` ne bouge pas.

**Corrigé au passage :** `.stage` n'avait pas de `max-width`, donc la vidéo
s'affichait en 1080×1920 sur un téléphone — plafond et menton, sans le moindre
signe que quelque chose clochait.

**État :** 189 tests, banc navigateur vert (25 contrôles), typecheck strict clean.
**Non couvert de bout en bout :** le détecteur lui-même en CI (le flux injecté est
une mire, pas un visage).

## 2026-08-19 — Audit runtime, état de l'art, et V2 SANS CARTE

Trois travaux distincts, dans l'ordre exigé par la mission : audit d'abord,
recherche ensuite, code en dernier.

**1. Audit (`docs/AUDIT-RUNTIME-V2.md`).** Le « ça ne se termine jamais » a trois
causes, toutes reproduites en navigateur piloté : (A) la terminaison avait été
déléguée au client SANS diagnostic de suffisance — `probe.complete` calculé,
testé, jamais lu ; (B) l'échec de « J'ai fini » renvoyait à la case départ sans
raison actionnable ; (C) `stepRotation` publiait un setPhase PAR FRAME dès que le
compte stagnait sur un multiple de 5 (0 inclus). S'y ajoutent : état `error`
terminal (« [object Event] »), `npm run smoke` cassé sur clone frais (predev
contourné), FaceLandmarker jamais fermé, promesse d'init sans timeout,
`ocularPrior.ts` (252 l.) mort à 100 %.

**2. État de l'art (`docs/ETAT-DE-L-ART-METROLOGIE-FACIALE.md` + 6 annexes
`docs/recherche/`).** Verdict : en RGB pur sans référence, le plafond démontré
est l'iris-étalon (±2–3 mm sur le PD, 1σ) ; le sub-millimétrique n'existe
qu'avec capteur de profondeur ; la pupille est inutilisable ; les priors
faciaux n'apportent rien et biaisent les enfants ; HVID adulte dès 2–3 ans ;
correction de convergence (+1–2 mm) systématiquement oubliée par les apps.

**3. V2 (`docs/ARCHITECTURE-V2-SANS-CARTE.md`).** Parcours : ouvrir la caméra →
regarder l'écran → « calibration acquise » → essayage. Moteur pur à états
explicites (`core/autoCalibration.ts`) : succès/échec/dégradation/timeout,
WHY_NOT_DONE permanent, une seule transition, collecte ≠ caméra. Échelle =
Mahalanobis périoculaire (iris ×2 + fente gatée anti-enfant, borne en pire cas
~3,2–4,2 %), PD avec correction de convergence et demi-écarts, largeur corrigée
du plan yeux→tempes, focale du CameraProfile carte quand il existe. La carte
devient un MODE DIAGNOSTIC, conservée comme vérité terrain.

**Corrigés au passage :** throttle A1, état error avec « Réessayer »,
timeout d'init nommé, close() du landmarker, message « [object Event] ».

**État : 213 tests verts (24 nouveaux), typecheck strict clean, banc navigateur
35 contrôles verts** — dont : « sans visage, la collecte se TERMINE (échec
nommé) » et « WHY_NOT_DONE affiché ».

**Non démontré, écrit tel quel :** la précision réelle sur sujets (protocole
N≥50 défini, réf. pupillomètre) ; le biais populationnel du HVID ; δz yeux→
tempes (45 ± 12, hypothèse dérivée d'une mesure carte) ; MediaPipe sur enfants ;
la largeur temporale sans carte (machinerie prête, non câblée — lot suivant).

## 2026-08-19 (après-midi) — Vérifications ciblées : demi-PD, cotes monture, 2.5D, parcours sans carte prouvé

**Bug corrigé — étiquetage anatomique des demi-PD.** Les landmarks 468–472 sont
l'iris de l'œil DROIT du client (côté FACEMESH_RIGHT_EYE 33/133), pas le gauche :
`pupilPixelsOf` inversait les libellés OD/OG. Corrigé et verrouillé par le test
d'asymétrie inverse (34/30). Les demi-PD sont MESURÉS individuellement (pupille ↔
pied du sellion projeté sur la ligne des pupilles) — jamais PD/2, testé sur
30/34, 29/35, 31/33, 34/30, et sous roulis de 12°.

**Ajouté.** Incertitude PAR demi-PD (`pdHalfUncertaintyMm`) : chaque œil porte
son erreur-type propre (un œil bruité → marge plus large de ce côté, testé) ;
correction de convergence appliquée PAR ŒIL (équivalence linéaire testée) ;
sources des constantes 13,5 mm (Fry & Hill 1962) et 3,05 mm (Gullstrand–Emsley)
citées dans le code ; note d'héritage du profil caméra nommant la SÉANCE CARTE.

**Cotes monture — tests déterministes (`tests/framedims.test.ts`).** Largeurs
100/120/140/160 exactes à l'échelle du visage ; A52 B30 vs A52 B45 : même largeur,
hauteurs 40/55 mm ; 52□14 vs 52□22 : centres optiques à 66/74 mm, +8 mm de
largeur ; largeur totale = bbox alpha (128 ≠ 2A+DBL = 122, tenons comptés) ;
branche 140 vs 150 → échelle de sprite 140/150 ; pivot = charnière du spec,
jamais le coin du fichier ; branche peinte s'allonge avec le yaw.

**⭐ Parcours sans carte PROUVÉ en navigateur (`npm run journey`).** Un visage
réel (photo du sujet → `tests/fixtures/face.y4m`, régénéré par
`scripts/make-face-y4m.mjs`, non commité) injecté dans getUserMedia :
navigateur VIERGE → mesure auto → « Calibration acquise » (30 images) →
essayage. PD 61,4 ± 2,8 mm (demi-PD 30,4/31,0). Cas B (profil caméra hérité
d'une séance carte) : héritage SIGNALÉ en clair, PD 60,8 ± 2,6 mm — concordant
dans les marges ; l'écart (0,6 mm) est le terme de convergence, qui dépend de la
distance estimée (~22 cm sur cette photo, cas plus près que l'usage réel).

**État : 234 tests verts, typecheck strict clean, banc smoke vert, journey vert.**

## 2026-08-19 (soir) — Branche PHYSIQUE, non-adaptation verrouillée, écart temporal sans carte, pose documentée

**⭐ Refonte de la branche (arbitrage humain : « branche physiquement cohérente
+ fin cachée », jamais « branche déformée + extrémité parfaite »).** L'ancienne
`templeAffine` envoyait l'extrémité nominale exactement sur l'oreille — elle
étirait une 140 mm et comprimait une 150 mm jusqu'à ce que les deux « aillent » :
le slider de taille appliqué à la branche. Supprimée. Désormais : départ au
TENON de la face (`templeRootL/R` marqués dans l'outil de prep, deux nouveaux
clics ; repli documenté = bord de bbox + hauteur du pont pour les fiches
existantes — ce n'est PAS « la vraie charnière », formulation corrigée),
échelle PHYSIQUE `livePxPerMm × sin(|yaw|) / profilePxPerMm`, oreille = DIRECTION
seulement, extrémité libre (l'occlusion cache ce qui passe derrière la tête).
Tests réécrits : échelle identique 140/150, longueur peinte = réelle × sin(yaw)
exactement, direction colinéaire tenon→oreille, tenon explicite prime.

**Non-adaptation (`tests/nonadaptation.test.ts`, 8 tests).** Calibration
BIT-IDENTIQUE en essayant 100→160 mm ; incréments de 2 mm = exactement
2×livePxPerMm ; distances 300–800 mm : mesure et rapport constants ; visages
110–160 mesurés à LEUR taille (pente 1,058 — le résidu vient du prior PFL qui
entre dans sa fenêtre 2σ sur les grands visages, dans la marge annoncée ; jamais
une compression vers une moyenne) ; enfant 110/monture 90 et adulte 150/150
chacun exact ; 150 sur 130 DÉPASSE, 120 sur 150 reste étroite.

**Écart temporal câblé au parcours SANS CARTE (`tests/temporal-auto.test.ts`).**
`calibrateAuto` accepte une `AutoTemporalScene` (frontale figée + masque de
mouvement des vues tournées — PIXELS seulement, aucun landmark de profil : les
repères 234/454 ne sont jamais des points physiques pendant la rotation) ;
`useAutoCalibration` capture 3 images au total (frontale |yaw|≤0,06, un côté
0,17–0,61 chacun) ; échelle au plan des tempes = échelle yeux × (1+45/D).
Mesuré → `temporalWidthMm` alimente la légende (présence de donnée, pas de
branchement) ; non mesuré (pas de rotation, lunettes gardées) → champs ABSENTS
et note en clair. La consigne dit que la rotation est facultative.

**Pose sur le nez (`tests/pose.test.ts`, 6 tests).** Convention §14.6 CONSERVÉE
et déclarée (X = sellion, Y = ligne des canthi — l'alternative « landmarks
nasaux individuels » serait un choix scientifique non démontré, signalé, pas
inventé). Verrouillé : centres optiques sur la ligne des yeux à toute
morphologie (110/138/152 mm), le pont suit CHAQUE monture (1 mm vs 10 mm de
profondeur → aucun décalage constant possible), le regard (iris) ne déplace
rien, sous roulis chaque axe garde sa référence.

**État : 254 tests verts, typecheck strict clean, banc smoke vert (35 contrôles),
journey navigateur vert.** Non démontré, inchangé : précision absolue sur sujets
réels (protocole N≥50), biais populationnel HVID, δz yeux→tempes 45±12 mm
(hypothèse), tenons non marqués sur les fiches existantes (repli en service).
