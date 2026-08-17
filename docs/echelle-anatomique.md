# Peut-on descendre à ≤ 1,5 % d'erreur d'échelle avec l'anatomie périoculaire ?

> Question posée le 2026-08-17 : ne pas se contenter de DHIV = 11,7 mm pour tout le monde,
> construire un estimateur multivarié `ŝ = argmin_s (sP − μ)ᵀ Σ⁻¹ (sP − μ)` exploitant la
> **covariance**, et dire si l'on peut passer d'environ 3 % à **≤ 1–1,5 %**, soit ±1–2 mm sur
> une largeur temporale de 140 mm.

**Réponse courte : non, pas par cette voie — et la raison se démontre, elle ne se teste pas.**
La borne d'information de cet estimateur a une forme fermée. En y injectant les moyennes,
écarts-types et corrélations publiés, elle vaut **3,2 à 3,4 %**, soit **±4,5 mm sur 140 mm**.
Aucune pondération de ces variables ne fera mieux : c'est l'information de Fisher du problème,
pas une limite d'implémentation.

Mais la question mérite mieux qu'un « non » : elle éclaire **où l'erreur se trouve réellement**,
et ce qui, dans la V1, la fait effectivement descendre sous 1 %.

---

## 1. La borne, et pourquoi elle tranche sans essai clinique

L'estimateur demandé a une solution explicite :

```
ŝ = (PᵀΣ⁻¹μ) ÷ (PᵀΣ⁻¹P)
```

En écrivant les vraies dimensions du sujet `X = μ + e` avec `e ~ N(0, Σ)`, et en développant
au premier ordre autour de `e = 0` :

```
ŝ ÷ s₀ ≈ 1 − (eᵀΣ⁻¹μ) ÷ (μᵀΣ⁻¹μ)      d'où      Var(ŝ ÷ s₀) = 1 ÷ (μᵀΣ⁻¹μ)
```

**L'erreur relative d'échelle vaut donc exactement `1/√(μᵀΣ⁻¹μ)`.** C'est implémenté dans
`src/core/ocularPrior.ts` (`scaleBound`) et vérifié dans `tests/ocular.test.ts`.

Cette forme a une conséquence qu'il faut voir tout de suite : **ajouter une variable ne fait
gagner que la part d'information qu'elle n'a pas déjà en commun avec les autres.** C'est
précisément la demande — « élimine celles qui n'apportent rien après prise en compte des
corrélations » — et le résultat est que presque tout est éliminé.

---

## 2. Les données, avec leur provenance

| Grandeur | Moyenne | Écart-type | CV | Source |
|---|---|---|---|---|
| HVID / white-to-white | 11,95 mm | 0,39 mm | **3,3 %** | Pentacam AXL, adultes saoudiens |
| idem | 12,25 mm | 0,49 mm | 4,0 % | Piñero |
| idem | 12,0 mm | 0,5 mm | 4,2 % | Claude et al., photographies |
| Fente palpébrale (en→ex) | 30,91 mm (H) | 1,82 mm | **5,9 %** | photogrammétrie adulte |
| idem | 29,62 mm (F) | 2,21 mm | 7,5 % | idem |
| idem | 32,17 mm (H) | 2,79 mm | 8,7 % | autre cohorte |
| Corrélation interoculaire du diamètre cornéen | — | — | **r = 0,87–0,98** (ICC 0,94–0,98) | études de symétrie interoculaire |

### 🔴 Le piège que personne ne mentionne : le désaccord sur la MOYENNE

Sur les mêmes yeux, quatre appareils donnent des moyennes de **11,77 · 12,25 · 12,40 · 12,42 mm**
(Orbscan IIz, Galilei G2, IOLMaster 700, DRI Triton OCT). Soit **5,5 % d'écart entre instruments**,
là où la dispersion biologique interindividuelle vaut 3,3 %.

**Le choix de la constante injecte donc un biais plus grand que la variabilité qu'on cherche à
modéliser.** Et ce biais est systématique : il décale tous les clients dans le même sens, ce
qu'aucun moyennage ne corrige. C'est exactement le mode d'échec que ce projet combat partout
ailleurs. Avant même de parler de covariance, **il n'existe pas de « vraie » valeur de μ**, parce
que « le bord visible de l'iris » n'est pas la même frontière selon qu'on la lit en lumière
blanche, en infrarouge, ou par tomographie.

---

## 3. Les cinq modèles demandés, chiffrés

Borne `1/√(μᵀΣ⁻¹μ)`, et sa traduction sur une largeur temporale de 140 mm :

| # | Modèle | Borne | Sur 140 mm |
|---|---|---|---|
| 1 | HVID seul | **3,35 %** | ±4,7 mm |
| 2 | HVID gauche + droit (r = 0,94) | **3,30 %** | ±4,6 mm |
| 3 | HVID + fente palpébrale (r = 0,3) | 3,24 % | ±4,5 mm |
| 3′ | idem, r = 0 (hypothèse la plus favorable) | 2,94 % | ±4,1 mm |
| 4 | Modèle complet 4 variables, covariance réelle | **3,20 %** | ±4,5 mm |
| 5 | HVID prédit depuis les proportions, R = 0,5 | 2,90 % | ±4,1 mm |
| 5′ | idem, R = 0,9 | 1,46 % | ±2,0 mm |

### Ce que chaque ligne dit

**Modèle 1 → 2 : le second œil ne sert à rien.** Avec r = 0,94, la borne passe de 3,35 % à
3,30 % : **1,5 % de gain sur l'erreur**, pas 30 %. La forme fermée du cas symétrique est
`CV × √((1+r)/2)`, et pour r → 1 elle tend vers CV. Deux yeux d'une même personne ne sont pas
deux mesures indépendantes — c'est presque la même mesure faite deux fois. C'est très exactement
le point soulevé dans la demande, et il **joue contre** l'ajout de variables plutôt que pour.

**Modèle 3 : la fente palpébrale est deux fois trop dispersée.** À 6–8 % de CV contre 3,3 %,
elle n'entraîne pas la borne vers le bas. Sa seule configuration utile serait une corrélation
très élevée avec le HVID (r ≥ 0,9), qui permettrait à leur **différence** de porter de
l'information — mais rien ne la publie, et rien n'y invite : ce sont deux tissus dont la
croissance n'est pas couplée. La conclusion a été vérifiée sur tout le domaine r ∈ [0, 0,8] et
n'en dépend pas ; c'est un test dédié.

**Modèle 4 : le modèle complet ne gagne rien non plus.** 3,20 %. Les quatre variables portent
essentiellement une seule information.

**Modèle 5 : il faudrait R ≈ 0,90 entre les proportions faciales et le HVID individuel.**
Prédire réduit l'écart-type résiduel d'un facteur `√(1−R²)` ; pour passer de 3,35 % à 1,5 % il
faut **R = 0,90**. Or la cornée atteint sa taille adulte vers **3 ans** et cesse ensuite de
suivre la croissance craniofaciale. C'est précisément ce qui en fait un bon étalon *absolu* — sa
valeur ne dépend pas de la taille du visage — et un mauvais candidat à la prédiction *par* le
visage, pour exactement la même raison. **Les deux propriétés sont la même propriété.** Une
corrélation plausible (R = 0,5) ne ferait passer que de 3,35 % à 2,90 %.

### Le calcul à l'envers

Avec k variables de même qualité que le HVID et **mutuellement indépendantes**, la borne vaut
`CV/√k`. Pour 1,5 % il faudrait **k = 6** : six dimensions périoculaires aussi peu dispersées
que le diamètre cornéen, et sans corrélation entre elles. La seconde meilleure candidate connue
est deux fois pire, et toutes les dimensions d'un même visage sont corrélées entre elles.

---

## 4. Vérification contre la littérature empirique

Un travail publié fait exactement ce que décrit le modèle 1 : segmentation de l'iris, HVID
**fixé à 12,2 mm**, mise à l'échelle de mesures faciales sur photographie, 94 sujets avec
mesures physiques de référence. Résultat : **MAPE 2,9 % en horizontal**, 4,3 % en vertical.

Pour une loi normale, `MAPE ≈ 0,80 × SD`. Une MAPE de 2,9 % correspond donc à un écart-type de
**3,6 %** — la borne théorique du modèle 1 vaut 3,35 %. **La théorie et l'expérience concordent
à 0,3 point.** C'est la meilleure validation disponible du cadre de calcul ci-dessus, et elle
confirme que le plancher est bien là où le calcul le place.

---

## 5. Ce que ce projet ne peut pas produire, et ce qu'il faudrait

La demande inclut MAE, erreur médiane, 95ᵉ percentile et biais moyen **par méthode, sur des
sujets avec mesures physiques de référence**. Ces chiffres ne peuvent pas être produits ici :
le projet ne possède **aucun sujet** avec mesure physique de référence — ni HVID au biomètre, ni
écart temporal au compas. Les produire à partir de données simulées reviendrait à mesurer les
hypothèses du simulateur.

Ce qu'il faudrait, précisément :

1. **N ≥ 40 sujets**, avec pour chacun : HVID gauche et droit au biomètre (pas au réglet), fente
   palpébrale gauche et droite, **écart temporal au compas d'épaisseur**, âge, sexe ;
2. une photographie frontale de chacun **avec une référence physique dans le plan du visage** ;
3. de quoi estimer Σ sur **la même cohorte** — les corrélations importent plus que les moyennes,
   et aucune base publique ne donne HVID et anthropométrie faciale sur les mêmes individus.

C'est ce dernier point qui bloque réellement : FaceBase / 3D Facial Norms donne l'anthropométrie
faciale mais **pas le HVID** ; les études ophtalmiques donnent le HVID mais pas les proportions
faciales. La covariance croisée que le modèle 5 exige n'est publiée nulle part.

---

## 6. Ce qui, en revanche, descend réellement sous 1 %

Le raisonnement ci-dessus a une conclusion constructive : **l'erreur n'est pas dans l'étalon,
elle est dans la mesure.**

| Étalon | Incertitude intrinsèque | Nature |
|---|---|---|
| HVID, meilleur cas | 3,3 % | **biologique** — irréductible, biais fixe par personne |
| Carte ISO/IEC 7810 | **0,1 %** (tolérance ±0,09 mm sur 85,60) | **normative** — négligeable |

La carte n'a pas 3 % de variabilité : elle en a 0,1 %. Tout ce qui reste en V1 est de l'erreur de
**mesure** — pointage des bords, parallaxe, distorsion — c'est-à-dire précisément ce sur quoi
l'ingénierie a prise :

| Terme | Avant | Après | Comment |
|---|---|---|---|
| Parallaxe carte ↔ tempes | 3 à 7 %, **biais systématique** | ~0,3 % résiduel | mesurée par rotation (`core/depthFit.ts`) |
| Distance caméra | supposée (champ de 60°) | mesurée, puis fusionnée à la fenêtre imposée | régression à deux inconnues |
| Pointage des deux bords | 1 % | 1 % | irréductible sans détection automatique fiable |
| **Total échelle** | 2,5 % annoncés, biais compris | **~1,0 %** | |

**C'est là que le facteur 3 se gagne** — pas en cherchant un meilleur étalon biologique, mais en
supprimant les biais autour d'un étalon normatif déjà parfait.

---

## 7. Où l'estimateur multivarié a quand même sa place

Il est implémenté (`src/core/ocularPrior.ts`) et il sert, mais pas comme étalon :

- **Contrôle de cohérence.** Relire la carte avec l'anatomie pour attraper un cadre mal pointé.
  À 3,3 %, c'est amplement suffisant pour détecter une erreur de pointage de 10 % — et c'est le
  seul mode d'échec vraiment coûteux de la carte, parce qu'il est silencieux.
- **Repli déclaré.** Un client sans carte peut être servi à 3,3 %, à condition que ce soit
  **écrit à l'écran**. Sur une monture à ±4 mm de la bonne taille, l'image reste juste ; c'est la
  légende chiffrée qui doit s'élargir.
- **Point d'entrée pour de vraies données.** Le jour où la cohorte du §5 existe, il suffit de
  remplacer μ et Σ : la borne se recalcule seule et dira, sans qu'on ait à la croire, ce que ces
  données permettent.

---

## Sources

- [Measurements of white-to-white corneal diameter and anterior chamber parameters using the Pentacam AXL wave — population adulte saoudienne](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11970417/)
- [Repeatability and agreement of white-to-white measurements between four devices](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8284630/) — les moyennes 11,77 / 12,25 / 12,40 / 12,42 mm
- [A deep learning framework to scale linear facial measurements to actual size using horizontal visible iris diameter](https://www.nature.com/articles/s41598-023-40839-6) — HVID fixé à 12,2 mm, 94 sujets, MAPE 2,9 % / 4,3 %
- [Mean human corneal diameter and palpebral fissure lengths as scales for forensic analysis of photographed faces: an analytical review](https://link.springer.com/article/10.1007/s00414-026-03733-0) — 297 études, 324 271 mesures agrégées
- [Photogrammetric Analysis of Palpebral Fissure Dimensions](https://pmc.ncbi.nlm.nih.gov/articles/PMC3482776/)
- [A multicenter study of interocular symmetry of corneal biometrics](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7946893/) — r = 0,87–0,98, ICC 0,94–0,98
- [White-to-white corneal diameter: normal values in healthy humans (Orbscan II)](https://pubmed.ncbi.nlm.nih.gov/15778595/)
- [Growth of the cornea from infancy to adolescence](https://pubmed.ncbi.nlm.nih.gov/16390486/) — taille adulte atteinte vers 3 ans
- [The 3D Facial Norms Database](https://www.researchgate.net/publication/283206271_The_3D_Facial_Norms_Database_Part_1_A_Web-Based_Craniofacial_Anthropometric_and_Image_Repository_for_the_Clinical_and_Research_Community) — anthropométrie faciale, sans HVID
