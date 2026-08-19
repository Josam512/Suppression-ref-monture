# ÉTAT DE L'ART — métrologie faciale monoculaire pour l'essayage de lunettes

> Synthèse de la recherche menée le 2026-08-19 sur six axes (littérature
> médicale/ophtalmologique, anthropométrie, géométrie multi-vues et profondeur,
> modèles de landmarks, technologies commerciales et brevets, datasets et
> validation). **Les six rapports détaillés, avec l'intégralité des sources,
> sont dans `docs/recherche/01…06-*.md`** ; ce document est la synthèse qui
> tranche. Chaque affirmation importante porte sa source (DOI, PMID, brevet,
> URL) — ici ou dans l'annexe correspondante.
>
> Convention d'étiquetage imposée par la mission :
> **MESURÉ** (sur ce client) · **DÉDUIT** (géométriquement) · **PRÉDIT** (par
> modèle appris) · **PRIOR** (statistique de population) · **HYPOTHÈSE** ·
> **NON DÉMONTRÉ**.

---

## 1. Le problème physique

Une caméra projette : `taille_px = taille_mm × focale_px / distance_mm`. Une
équation, deux inconnues — l'échelle absolue est perdue. La structure-from-motion
monoculaire ne la récupère pas : la reconstruction n'est définie qu'à une
similitude près (Hartley & Zisserman ; annexe 03 §1). Ce qui brise l'ambiguïté,
et RIEN d'autre :

1. un objet de taille connue dans l'image (carte ISO, iris…) ;
2. un déplacement de caméra de norme connue (IMU/VIO — inaccessible au web) ;
3. un capteur actif (TrueDepth — inaccessible au web et absent des PC) ;
4. intrinsèques connues **et** distance connue par ailleurs.

Toute méthode « sans référence » cache donc l'une de ces ancres — le plus
souvent un prior statistique sur la taille des visages, enfoui dans un réseau.

## 2. Ce qu'une caméra monoculaire peut / ne peut pas mesurer

| Grandeur | Statut | Précision atteignable |
|---|---|---|
| Rapports de longueurs dans un même plan | MESURÉ | excellent (limité par les landmarks, ~0,5 %) |
| Pose de la tête (yaw/roll/pitch) | MESURÉ | ~2–5° (annexe 04) |
| Forme 3D relative (rotation de tête) | DÉDUIT | correcte, sans échelle |
| Focale de l'objectif | DÉDUIT (auto-calibration, N vues) | ±4–12 % (mesuré dans CE dépôt, `cardSweep`) |
| **Échelle absolue** | **impossible sans ancre** | — |
| Distance caméra↔visage | DÉDUIT si iris + focale | ±5–30 % selon la focale |

Aucune API navigateur n'expose la focale : `MediaTrackSettings` /
`getCapabilities` n'ont pas de champ focale (spec W3C vérifiée, annexe 03 §5) ;
l'EXIF n'existe pas sur un flux webcam. La focale ne peut venir que d'une
auto-calibration (la mire carte de ce dépôt) ou d'un a priori de champ (60–90°
sur les caméras frontales).

## 3. L'écart pupillaire par webcam

### 3.1 Les chiffres de référence

- PD adulte : 63,36 ± 3,83 mm (Dodgson 2004, ANSUR N=3976, DOI 10.1117/12.529999) ;
  hommes 64,7 ± 3,7, femmes 62,3 ± 3,6, plage 52–78 mm. Recalculé sur les CSV
  publics ANSUR II (N=6068) : 63,3 ± 3,65 mm (annexe 02 §1).
- Enfants : ~46–48 mm à 3–4 ans, ~55–56 mm à 9–10 ans, adulte vers 15–18 ans
  (MacLachlan & Howland 2002, PMID 12090630).
- Asymétrie monoculaire moyenne : ~0,75 mm (PMC4269086) → les demi-écarts sont
  requis pour les verres progressifs.

### 3.2 Ce que valent les méthodes existantes (validations indépendantes)

| Méthode | Capteur | Erreur mesurée | Source |
|---|---|---|---|
| EyeMeasure / Warby Parker | **TrueDepth** (actif) | MAE **0,51 mm** | Cureus 2023, N=44, PMID 37529827 |
| PDCheck AR | TrueDepth | MAE 1,38 mm | idem |
| GlassesOn (6over6) | RGB + réflexe cornéen + IMU | ±2 mm revendiqués (ANSI Z80.17), **aucune validation indépendante** | annexe 05 §3 |
| App photo RGB (2012) | RGB seul | biais −3,2 mm, LoA ±6 mm | PMID 22581116 |
| Carte ISO sur le front | RGB + carte | ~±1–2 mm | annexes 01, 06 |
| Iris comme étalon | RGB seul | **±2,3 mm (1σ)**, MAPE 2,9–4,3 % | Sci Rep 2023, DOI 10.1038/s41598-023-40839-6 |

**La précision sub-millimétrique publiée n'existe qu'avec un capteur de
profondeur.** En RGB pur sans objet externe, le plafond démontré est
l'iris-étalon : ±2–3 mm (1σ), ~68 % des sujets dans la tolérance ANSI de ±2 mm.

### 3.3 La convergence — le biais systématique corrigeable

Le client fixe son écran à 30–80 cm : ses yeux convergent, et le PD mesuré est
un PD **de près**. Sous-estimation : 2,1 mm à 30 cm, 1,6 mm à 40 cm, 1,1 mm à
60 cm (géométrie du centre de rotation de l'œil, 13,5 mm derrière la cornée,
pupille d'entrée à 3,05 mm ; annexe 01 §15) :

```
PD_loin = PD_mesuré × (D + 13,5) / (D + 3,05)
```

C'est un biais DÉDUIT géométriquement, à corriger systématiquement — la plupart
des apps RGB ne le font pas. Il ne faut pas le confondre avec la règle
d'atelier « PD près = PD loin − 4 mm » (centration au plan des verres).

### 3.4 Les verres portés — l'interdit confirmé

Grossissement/minification ≈ 1,4–2 %/dioptrie (`SM = 1/(1 − d·Fv)`, d ≈ 15 mm) :
un myope de −4 D voit son iris minifié de ~5,7 %, soit ~3,5 mm d'erreur sur le
PD si l'échelle vient de l'iris. Mesurer SANS lunettes est une condition de
validité, pas une préférence (annexe 01 §11).

## 4. Iris / HVID — l'étalon anatomique

- HVID adulte : **11,71 ± 0,42 mm** (Rüfer 2005, N=390, Orbscan II, PMID
  15778595) ; 11,65 ± 0,36 (Gharaee 2014, N=1001, PMID 24790875).
- **Populations** : Japonais 11,10 / Chinois 11,26 / Blancs 11,75 mm (PMID
  25325762) ; Saoudiens 11,95 ± 0,39. Un prior unique porte donc jusqu'à ~4 %
  de biais selon la population.
- **Instruments** : mêmes yeux, Orbscan 11,77 vs OCT 12,42 mm (PLOS ONE,
  10.1371/journal.pone.0254832) — le « HVID vrai » dépend de la définition ;
  ce que MediaPipe mesure est le limbe *visible*, ≈ HVID Orbscan.
- **Âge — le point décisif** : 9,8 mm à la naissance → ~11,7 mm à 24–36 mois.
  L'iris est un étalon **valide dès ~2–3 ans**, le seul dont le biais ne dépend
  pas de la croissance (annexes 01 §5, 02 §3). Le PD, lui, grandit jusqu'à
  15 ans : tout prior de PD adulte serait faux de ~20 % sur un enfant de 6 ans.
- **La pupille est inutilisable** : 2–8 mm selon la luminance, hippus permanent,
  CV ≥ 30 % — dix fois pire que l'iris (annexe 01 §7). Confirmé, clos.
- Erreur honnête de la constante 11,7 : CV 3,4–4,3 % (1σ). Le moyennage de
  frames tue le bruit de détection, jamais ce biais biologique fixe.

## 5. Anthropométrie faciale — moyennes ET covariances

Recalculé sur données brutes publiques ANSUR II (annexe 02, script reproductible) :

| Corrélation | r |
|---|---|
| PD ↔ largeur bizygomatique (zy-zy) | 0,44 (H) / 0,48 (F) |
| PD ↔ largeur de tête (eu-eu) | 0,31 / 0,28 |
| zy-zy ↔ eu-eu | 0,65 / 0,61 |
| HVID ↔ PD | **aucune corrélation publiée trouvée** → quasi-orthogonaux |
| HVID gauche ↔ droit | ICC 0,94–0,98 (deux yeux ≠ deux mesures indépendantes) |

Conséquences chiffrées :
- Prédire le PD depuis la largeur du visage ne réduit son écart-type que de
  ~10–15 % (SD résiduel 3,1 mm) — un prior facial n'apporte presque rien.
- La fente palpébrale (30,9 ± 1,9 mm adulte) ajoute un peu d'information à
  l'iris (r HVID↔PFL non publié — HYPOTHÈSE encadrée par un calcul en pire cas,
  `core/ocularPrior.ts`), mais n'est **pas mature avant 8–11 ans** : à gater,
  jamais à imposer.
- Enfants : en-en à 93 % de sa taille adulte à 5 ans, zy-zy à ~80 % à 7 ans
  (Farkas, N≈1594) — tout prior facial adulte est interdit sur eux.
- La largeur de monture ↔ zy-zy : relation publiée **absente** de la littérature
  optique (lacune documentée) ; règle métier : façade ≈ largeur temporale
  + 2 mm/côté (Brooks & Borish, annexe 02 §16).

## 6. Landmarks faciaux

- **MediaPipe FaceLandmarker (478 pts)** : IOD MAE 2,62 % en suivi (model card
  officielle V2), au niveau du désaccord inter-annotateurs humains (2,56 % MAD,
  Kartynnik 2019). Région des yeux : ~6 % NME (Attention Mesh 2020). Licence
  Apache 2.0 vérifiée, 3,76 Mo, WASM/WebGPU. Erreur de distance via iris :
  4,3 % ± 2,4 % (4,8 % avec lunettes) — chiffres Google, validés contre
  iPhone 11 sur 200 participants (annexe 04 §7).
- **Alternatives** (STAR CVPR23, LDEQ, SPIGA, PIPNet, HRNet, FAN, InsightFace,
  OpenSeeFace…) : aucune n'offre à la fois des landmarks d'iris, un runtime web
  maintenu et une licence commerciale. InsightFace : modèles non commerciaux.
  Détecteurs de pupille dédiés (PuRe, DeepVOG, EllSeg) : entraînés sur infrarouge
  rapproché, domain gap rédhibitoire sur webcam RGB (annexe 04 §13).
- **Landmark sliding** : l'ambiguïté des points de CONTOUR est tangentielle et
  prouvée (STAR/ADNet). Points anatomiquement stables : centres d'iris, canthi,
  points nasaux (type A). Points de silhouette 234/454, ovale : type B — ils
  glissent sous rotation. Points occultés : hallucinés sans score d'occlusion
  (type C). Cette taxonomie DOIT piloter quel point sert à quoi.
- **Enfants** : aucune évaluation MediaPipe par âge publiée ; la littérature
  (InfAnFace) montre une dégradation sur jeunes enfants. NON DÉMONTRÉ → à
  couvrir par le protocole sujets réels.

**Verdict : GARDER MediaPipe.** Le maillon faible n'est pas le modèle, c'est la
mise à l'échelle métrique.

## 7. Multi-vues / rotation de tête

Une rotation de tête devant caméra fixe est un mouvement relatif caméra↔tête :
elle fournit de la **forme relative** (profondeurs entre points du visage) et
peut porter une **auto-calibration de focale**, mais **jamais l'échelle absolue
seule** (annexe 03 §§1–3). Ce que ce dépôt en a déjà tiré, mesuré :

- focale : ±20–25 % sur 1 vue → ±4–8 % sur 50 vues (médiane, `cardSweep`) ;
- profondeur carte↔canthi : mesurée, avec garde-fou à ±50 % (`depthFit`) ;
- largeur temporale : mesurable par silhouette + masque de mouvement quand une
  échelle existe (`temporalWidth`).

La rotation reste donc précieuse SANS carte : combinée à l'échelle iris, elle
convertit la forme relative en millimètres — c'est la voie de la largeur
temporale mesurée (§15). Elle est facultative dans l'UX, jamais bloquante.

## 8. Intrinsèques caméra

- Navigateur : rien d'exposé (vérifié, annexe 03 §5).
- Auto-calibration depuis la mire carte : le `CameraProfile` persistant de ce
  dépôt est exactement l'état de l'art applicable ; il survit aux sessions et
  sert la V2 sans carte (distance par iris).
- À défaut : champ supposé 60–90° → distance à ±25–30 %. Acceptable partout où
  la distance n'entre que dans des termes du second ordre (convergence,
  parallaxe de plan) ; jamais suffisant pour une échelle au premier ordre.
- Perspective : à 30 cm, le nez paraît +30 % (« selfie effect », JAMA Facial
  Plast Surg 2018) ; la distance est encodée dans la perspective du visage
  (Fried SIGGRAPH 2016, Burgos-Artizzu ECCV 2014 — précision décimétrique).

## 9. Profondeur monoculaire apprise

Depth Pro (Apple), Metric3D v2, Depth Anything v2/3, UniDepth, ZoeDepth :
AbsRel 4,5 % in-domain au MIEUX, 5–15 % en zéro-shot (annexe 03 §9). À 50 cm,
c'est ±25–75 mm sur la distance → ±3–10 mm sur un PD. **La « metric depth »
n'est PAS une métrologie millimétrique du visage**, et son échelle est un prior
appris (taille typique des visages) — la circularité que le contrat §4 interdit.
Écarté pour la mesure ; utilisable tout au plus comme contrôle de cohérence
grossier. PRÉDIT, jamais MESURÉ.

## 10. 3DMM / modèles de visage

- FLAME, DECA, SMIRK : caméra orthographique, échelle libre — sans objet ici.
- MediaPipe Face Geometry : **canonique confirmé** (doc officielle) — le
  « visage moyen habillé en mathématiques », interdit à juste titre.
- **MICA (ECCV 2022)** : le seul travail visant l'échelle absolue par identité
  (entraîné sur ~2 300 identités scannées) ; ~0,9–1,1 mm médian sur NoW en
  évaluation métrique, queues à 2–3 mm+. C'est un PRIOR appris par identité —
  remarquable, mais : licence non commerciale, ~100 Mo+ hors navigateur, biais
  d'entraînement non caractérisés sur enfants. À suivre, pas à embarquer.

## 11. Technologies commerciales

| Acteur | Méthode d'échelle | RGB seul ? |
|---|---|---|
| Warby Parker, EyeMeasure, Topology | TrueDepth (capteur actif) | non |
| Zeiss VISUFIT, Hoya visuReal, Rodenstock | multi-caméras calibrées en magasin | non |
| Ditto | carte ISO sur le front | non (carte) |
| FittingBox | carte (produit PD) ; échelle statistique par morphologie (VTO) | partiellement |
| 6over6 / GlassesOn | réflexes cornéens + IMU + capteur | oui (hors web) |
| Auglio | iris-étalon | oui — ±1,5 mm revendiqués « dans 91 % des cas », non validé indépendamment |
| Snap True Size | réservé aux appareils Face ID | non |

**Aucun acteur majeur ne délivre un PD de prescription en RGB pur sans étalon**
(annexe 05). Ceux qui affichent du RGB-sans-carte font de l'iris-étalon, avec
les ±2–3 mm qui vont avec.

## 12. Brevets clés

- US10702149B2, US11931105, EP3294112B1 (6over6/Limon) — PD par réflexes
  cornéens + estimation de distance par capteurs du téléphone.
- US9628697B2 / WO2011113936 (FittingBox/Choukroun) — PD sans carte par
  mouvement prédéterminé + optimisation {distance, PD, focale, rayon oculaire} ;
  jamais commercialisé.
- US6231188B1 (1998) et US10861180 — l'iris comme étalon d'échelle (antériorité).
- US9236024 (Glasses.com/Luxottica) — le « mirror trick » : l'appareil lui-même,
  vu dans un miroir, sert de référence.
- Famille Ditto US8708494, US9254081, US9842246 — carte sur le front.
- Détail complet et liens : annexe 05.

## 13. Datasets

| Dataset | N | Âges | Vérité métrique | PD ? | Accès |
|---|---|---|---|---|---|
| FaceBase « 3D Facial Norms » | 2454 | 3–40 | 34 mesures anthropométriques + 24 landmarks 3D | non (pupilles absentes) | DUA recherche |
| ANSUR II (CSV publics) | 6068 | adultes | 93 mesures dont PD, zy-zy, eu-eu | **oui** | domaine public |
| Headspace | 1519 | enfants incl. | scans 3D échelle vraie | non | académique |
| FaceScape | 847 | adultes | scans 3D | non | non commercial |
| Texas 3DFRD | 118 | adultes | px calibré ≈ 0,32 mm | déductible | recherche |
| EVE (eye-tracking) | 54 | adultes | **distance caméra↔sujet vraie** | non | recherche |
| GazeCapture | 1474 | — | cibles écran, PAS la distance sujet | non | recherche |
| Synthétique FLAME/FaceSynthetics | ∞/100k | — | PD exact par construction | oui | FLAME non commercial |

**Aucun dataset public ne couple photos/vidéos et PD d'opticien** : la
validation finale passe obligatoirement par de vrais sujets (§16).

## 14. Comparaison chiffrée des méthodes d'échelle (webcam RGB, sans objet externe)

| Méthode | Échelle absolue ? | Erreur d'échelle (1σ) | Enfants | Verdict |
|---|---|---|---|---|
| Iris deux yeux (HVID 11,71 ± 0,50) | PRIOR anatomique | **~4,2 %** | dès 3 ans ✅ | **retenue — socle** |
| + fente palpébrale (covariance complète) | PRIOR | ~3,2 % (borne robuste) | à gater | retenue, gatée |
| + prior de PD populationnel | PRIOR | ~3 % adultes (fusion) | ❌ biais 20 % enfants | **écartée** (universalité) |
| Priors faciaux (zy-zy, eu-eu) | PRIOR | ≥ 7 % | ❌ | écartée |
| Metric depth apprise | PRÉDIT | 5–15 % | non caractérisé | écartée |
| MICA | PRÉDIT | ~1–2 % (statistique) | non caractérisé | non embarquable (licence/poids) |
| Rotation de tête seule | — | ∞ (pas d'échelle) | — | utile pour la FORME uniquement |
| Carte ISO (référence de ce dépôt) | MESURÉ | ~1–2,5 % | ✅ | conservée en diagnostic |

## 15. Méthode recommandée

**Fusion hiérarchique, chaque étage étiqueté** (détail : ARCHITECTURE-V2-SANS-CARTE.md) :

1. **Échelle au plan des yeux** : estimateur de Mahalanobis sur [HVID_G, HVID_D,
   PFL_G, PFL_D] avec covariance complète et borne d'information en pire cas
   (`core/ocularPrior.ts` — code déjà écrit, dormant, désormais branché) ;
   fente palpébrale gatée (enfants). Plancher : ~3,2–4,2 %. MESURÉ × PRIOR.
2. **Agrégation temporelle** : médiane + MAD sur ≥30 frames frontales gatées
   (yaw ≤ 8°, roll ≤ 15°, iris ≥ 8 px) — tue le bruit de détection, jamais le
   biais du prior ; l'incertitude annoncée ne descend jamais sous le plancher.
3. **PD** : centres d'iris (même plan que l'étalon → invariant à la distance),
   + correction de convergence (§3.3) avec distance DÉDUITE (iris + focale du
   `CameraProfile` s'il existe, sinon champ supposé — le terme est du 2d ordre).
4. **Largeur au plan des tempes** : correction de plan 1/z (yeux → 234/454,
   ~45 mm, HYPOTHÈSE dérivée de la mesure carte de ce dépôt), incertitude
   propagée ; **supplantée par la largeur temporale MESURÉE par silhouette
   quand le client tourne la tête** (machinerie `temporalWidth` existante).
5. **Confiance par client** : σ = √(prior² ⊕ erreur-type² ⊕ termes de
   correction²) — affichée, jamais tronquée.
6. **Carte ISO** : conservée comme mode diagnostic et vérité terrain de
   comparaison ; le `CameraProfile` qu'elle a mesuré améliore la V2 sans carte.

Ce qui la distingue d'un simple « pixels ÷ iris × 11,7 » : deux yeux avec leur
corrélation réelle, un second trait gaté, des bornes en pire cas, la correction
de convergence, la correction de plan, la focale mesurée quand elle existe, et
une incertitude propre au client.

## 16. Ce qui reste non démontré

1. La précision RÉELLE de la chaîne sur sujets réels : la borne ~3,2–4,2 % est
   théorique (prior + géométrie) ; le bruit landmarks réel sur webcams médiocres
   peut l'élargir. → protocole ci-dessous.
2. Le biais populationnel du HVID sur la clientèle réelle (±4 % entre extrêmes
   publiés) — mesurable en comparant iris vs carte sur chaque sujet du protocole.
3. La profondeur yeux→tempes (45 ± 12 mm, HYPOTHÈSE) — mesurable par la
   rotation + carte sur quelques sujets.
4. MediaPipe sur les enfants — NON DÉMONTRÉ dans la littérature.
5. La largeur temporale sans carte par silhouette+iris — machinerie testée en
   synthèse, jamais sur sujets réels sans carte.

**Protocole de validation minimal** (détails et métriques : annexe 06 §10) :
N ≥ 50 sujets stratifiés (PD 54–74, enfants inclus, peaux et éclairages variés,
≥ 2 appareils), référence = pupillomètre numérique (LoA ±0,76 mm), 2 mesures ×
2 opérateurs ; distances 30/45/60/80 cm ; avec/sans lunettes ; yaw 0–30°.
Métriques : biais, MAE, RMSE, P50/P90/P95, Bland–Altman (IC exacts, Carkeet
2015), % dans ±1 et ±2 mm. Cibles : |biais| ≤ 0,3 mm ; LoA ⊂ ±2 mm ;
**≤ 1 mm n'est PAS promis** — l'état de l'art RGB pur ne le permet pas, et
l'annoncer sans capteur de profondeur serait une fausse précision (ISO
21987 : ±1,0 mm par œil pour les progressifs → notre mesure sans carte est
au-dessus de cette tolérance, et doit le dire).
