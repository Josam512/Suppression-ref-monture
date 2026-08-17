# À quoi sert la distance caméra, et ce qui décide entre une 46 et une 48

> Répond à deux questions posées le 2026-08-17 : « je ne sais pas quelle est cette
> distance de 42,1 cm ni à quoi elle sert » et « l'important est qu'il soit capable de
> choisir entre une taille 48 et une taille 46 ».
>
> Les deux n'en font qu'une. C'est l'objet de ce document.

---

## 1. La distance de 42 cm : ce que c'est

C'est la distance entre **l'objectif et la carte bancaire**, donc entre l'objectif et le
front du client, au moment de la calibration. Rien de plus.

Elle n'est pas demandée au client et ne lui est jamais affichée. Elle est **mesurée** par
`core/cardPose.ts` : un rectangle aux cotes normalisées vu en perspective est une mire de
calibration ; ses quatre coins donnent une homographie, l'homographie donne la focale, et
la focale donne la distance en millimètres.

## 2. Pourquoi elle change le résultat — le seul point qui compte

La carte est posée **sur le front**. Les repères qui servent à mesurer la largeur du
visage (234 / 454) sont sur le **contour**, environ 5 cm **en arrière** de ce plan.

En projection perspective, l'échelle varie en `1/z` : ce qui est plus près paraît plus
grand. La carte paraît donc **trop grande** par rapport au plan du visage, et le visage
en ressort **trop étroit**. Le biais vaut `Δz / z` :

| Distance supposée ou mesurée | Biais de parallaxe | Sur un visage de 145 mm |
|---|---|---|
| 780 mm (l'a priori d'origine) | 6,8 % | 9,9 mm |
| **421 mm (mesuré)** | **12,9 %** | **18,7 mm** |

**C'est un biais systématique, pas du bruit.** Trois mesures concordantes ne le détectent
pas : elles le confirment, puisqu'elles le partagent. Se tromper d'un facteur deux sur la
distance laisse donc ~9 mm d'erreur sur la largeur du visage — et cette erreur ne se
signale nulle part.

## 3. Pourquoi ça décide de la 46 contre la 48

Un pas de calibre de 2 mm change la largeur totale de la monture d'environ **4 mm**,
2 mm par verre. Voilà la grandeur à laquelle il faut se comparer.

**Ce que l'application rend exactement, quelle que soit la calibration.** Le rapport
entre deux tailles du même modèle ne dépend que de leurs `spec.json` respectifs. Une
calibration fausse agrandit ou rétrécit les deux ensemble : l'écart entre elles survit
intact. Verrouillé par un test qui balaie ±10 % de biais de calibration.

> ⚠️ Une première rédaction de ce document affirmait que l'erreur de calibration, étant
> commune aux deux rendus, « ne brouille pas le choix ». **C'est faux, et le test l'a
> dit.** Ce qui est commun, c'est le rapport des deux montures **entre elles**. Leur
> rapport au **visage**, lui, se déplace en `1/calibration`.

**Ce qui reste incertain, et de combien.**

| Maillon | Incertitude | En pas de calibre |
|---|---|---|
| Carte, chaîne complète | 2,5 % → 3,3 mm sur 132 | **0,8 pas** |
| Iris seul | 4,3 % → 5,7 mm | 1,4 pas |
| Statistique anatomique seule (borne) | ≥ 2,99 % → ≥ 4,2 mm | ≥ 1,0 pas |
| Distance supposée au lieu de mesurée | jusqu'à 6 % de biais | ~2 pas |

**Conclusion, sans enjoliver.** Deux tailles voisines sont départageables **par
comparaison à l'écran** : la personne voit deux images qui diffèrent du bon écart, et
elle tranche. Elles ne le sont **pas de façon absolue** : dire « il vous faut une 48 »
demanderait une calibration sous 1,5 %, et l'app ne le dit de toute façon jamais (§0.0.1).

C'est cohérent avec le produit : *la personne voit si ça lui va, l'app ne le lui dit pas.*
Mais cela fixe la priorité technique sans ambiguïté.

## 4. Ce qui reste à faire, et dans cet ordre

1. **Terminer le recoupement de la distance.** Les 42,1 cm sortent d'une seule voie, la
   pose de la carte. Le contrôle croisé par la taille apparente de la carte n'a jamais été
   terminé. Tant qu'il ne l'est pas, le biais de parallaxe de 12,9 % repose sur une mesure
   non recoupée — et c'est le plus gros contributeur d'erreur de toute la chaîne.
2. **Descendre la calibration sous 1,5 %** si l'on veut un jour trancher une taille dans
   l'absolu. Sinon, s'en tenir à la comparaison, qui est déjà juste.
3. Le reste — écart temporal, longueur de branche — pèse beaucoup moins. C'est **la face**
   qui décide de la taille, pas la branche.

---

## Annexe — pourquoi la statistique anatomique ne remplace pas la carte

Question posée : les mesures du visage ont des moyennes et une interdépendance, cela ne
réduit-il pas fortement l'erreur ?

Mesuré, pas supposé (`core/ocularPrior.ts`, `tests/ocular.test.ts`) :

- L'estimateur optimal a une **borne d'information** en forme fermée, `1/√(μᵀΣ⁻¹μ)`.
  Aucune pondération de ces variables ne fera mieux.
- Sur tout le domaine de corrélations défendable, elle reste entre **2,99 % et 3,34 %** —
  soit **plus de 4 mm** sur l'écart temporal, au-dessus du seuil de lecture de 3 à 5 mm.
- Ajouter les dimensions de croissance que le fichier exclut délibérément (largeur de nez,
  de bouche, bizygomatique) ne fait descendre qu'à **2,78 %**. Gain réel, insuffisant.
- ⚠️ **Sous-estimer les corrélations rend la borne trop optimiste**, pas l'inverse : à
  `INTEROCULAR_R = 0,5` elle donne 2,90 %, à 0,999 elle donne 3,35 %. La valeur retenue
  (0,94) est déjà près du bord pessimiste.

**Défaut trouvé au passage, et corrigé.** À corrélation ~0,95, Σ approche la singularité
et son inverse extrait un contraste de variance quasi nulle : la borne tombe à **1,39 %**,
meilleure que la carte, sans qu'aucune information ait été ajoutée. Ce chiffre n'existe
que si `r` vaut 0,95 au centième près — ce que personne ne connaît. La trappe était
ouverte : il suffisait qu'un lot futur « améliore » les corrélations vers les valeurs
hautes publiées pour croire avoir battu la carte. `robustScaleBound` rend désormais le
pire cas sur ±0,05 de corrélation et refuse franchement quand le conditionnement est rompu.
