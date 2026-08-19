# Références biométriques oculaires pour l'échelle métrique absolue depuis une caméra RGB unique, et mesure de l'écart pupillaire (PD) sans objet de référence

*Rapport de recherche — 2026-08-19. Toutes les valeurs sont sourcées (DOI / PMID / URL). Les termes techniques anglais sont conservés.*

---

## 1. Diamètre d'iris visible horizontal (HVID / white-to-white, WTW)

### 1.1 Définitions — attention, trois choses différentes

| Grandeur | Définition | Valeur typique |
|---|---|---|
| **HVID / WTW (white-to-white)** | Diamètre horizontal de la zone sombre visible (cornée claire + iris vu au travers), mesuré entre les transitions sclère→limbe visibles | ~11,6–11,8 mm |
| **Diamètre cornéo-limbal anatomique** | Diamètre externe réel du limbe anatomique (mesuré en OCT) — le limbe a une largeur ~1 mm de chaque côté, non visible en photo | **~13,4–13,7 mm**, soit ~1,5 mm de plus que le HVID (Bergmanson & Martin, *Clin Exp Optom* 2017, DOI [10.1111/cxo.12583](https://onlinelibrary.wiley.com/doi/10.1111/cxo.12583) ; limbe nasal-temporal 13,64 ± 0,55 mm, [arXiv:1906.09149](https://arxiv.org/pdf/1906.09149/1000)) |
| **Ce que mesurent les landmarks iris de MediaPipe** | Le contour de l'iris **visible en pixels dans l'image RGB**, c.-à-d. la frontière limbique apparente ≈ HVID (pas le limbe anatomique, pas l'iris anatomique qui est ~0,5 mm derrière la cornée) | HVID en px ; constante interne 11,7 mm ([MediaPipe Iris, Google AI Blog 2020](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/) ; [doc GitHub](https://github.com/google/mediapipe/blob/master/docs/solutions/iris.md)) |

Important : le HVID **sous-estime** le diamètre cornéo-limbal réel, et sa valeur dépend de l'instrument/définition de la frontière : sur les mêmes yeux, Orbscan IIz donne 11,77 ± 0,40 mm et un OCT swept-source (DRI Triton) 12,42 ± 0,47 mm — **écart inter-instruments jusqu'à ~0,65 mm** (Kang & Lim, *PLOS ONE* 2021, DOI [10.1371/journal.pone.0254832](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0254832), PMC8284630). Un détecteur RGB (MediaPipe) a sa propre « définition » implicite de la frontière — d'où un biais systématique propre au modèle, en plus de la variance biologique.

### 1.2 Études de population (adultes)

| Étude | Population / n | Instrument | Moyenne ± SD (mm) | Plage |
|---|---|---|---|---|
| **Rüfer, Schröder & Erb 2005** | 390 sujets blancs, 10–80 ans (743 yeux) | Orbscan II | **11,71 ± 0,42** (valeur la plus citée) ; limites normales (moy ± 2 SD) **10,7–12,6** | 10,7–12,6 | 
| | | | *Cornea* 2005;24(3):259-61, PMID [15778595](https://pubmed.ncbi.nlm.nih.gov/15778595/), [abstract LWW](https://journals.lww.com/corneajrnl/abstract/2005/04000/white_to_white_corneal_diameter__normal_values_in.3.aspx) | |
| **Gharaee et al. 2014** (Iran, Mashhad) | 1 001 sujets sains 18–45 ans | Orbscan II | **11,65 ± 0,36** (médiane 11,60 ; mode 11,70) ; hommes 11,60 ± 0,35 vs femmes 11,71 ± 0,36 | **10,5–13,6** — PMID [24790875](https://pubmed.ncbi.nlm.nih.gov/24790875/), [PMC4003087](https://pmc.ncbi.nlm.nih.gov/articles/PMC4003087/) |
| **Hashemi et al. 2015** (population adulte, Iran) | étude de distribution | Orbscan | ~11,6–11,8 ; ↓ avec l'âge | PMID [27239570](https://pubmed.ncbi.nlm.nih.gov/27239570/), DOI [10.1016/j.joco.2015.09.001](https://www.sciencedirect.com/science/article/pii/S2452232515000025) |
| **Hashemi, Tehran Eye Study 2010** | population de Téhéran | — | WTW ↓ avec l'âge ; corrèle avec longueur axiale | [ResearchGate](https://www.researchgate.net/publication/38083813_White-to-White_Corneal_Diameter_in_the_Tehran_Eye_Study) |
| **Étude saoudienne 2025 (Pentacam AXL)** | adultes saoudiens | Pentacam | **11,95 ± 0,39** ; hommes 12,12 ± 0,38 > femmes 11,84 ± 0,36 | [PeerJ 19227](https://peerj.com/articles/19227/), [PMC11970417](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11970417/) |
| **Inde, IOLMaster 2019** | — | IOLMaster | **11,79** (IC95 11,78–11,81) | PMID [31719734](https://pubmed.ncbi.nlm.nih.gov/31719734/) |
| **Myopes chinois 2021** | myopes | — | **11,65 ± 0,38** | [PMC8639187](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8639187/) |
| **Hickson-Curran et al. 2014** (comparaison ethnique) | Chinois / Japonais / Blancs | topographie | **11,26 / 11,10 / 11,75** — écart inter-ethnique jusqu'à **0,65 mm (~5,5 %)** | PMID [25325762](https://pubmed.ncbi.nlm.nih.gov/25325762/) ; autre étude : OD 11,26 ± 0,60, OS 11,19 ± 0,57 ([EC Ophthalmology](https://ecronicon.net/assets/ecop/pdf/ECOP-10-00511.pdf)) |

### 1.3 Variation avec l'âge (enfants !), le sexe, la réfraction

- **Naissance** : ~9,8–10,0 mm (moyenne 9,8 ; plage 9,0–10,5) ([Ento Key, Neonatal Ophthalmology](https://entokey.com/neonatal-ophthalmology-ocular-development-in-childhood/) ; nouveau-nés nigérians : [S2211505614000453](https://www.sciencedirect.com/science/article/pii/S2211505614000453)).
- **Croissance** : 9,78 ± 0,14 mm à la naissance → **11,72 ± 0,04 mm à 36 mois** ; plateau ~11,5 mm atteint dans les 24 premiers mois ([PMC9589223](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9589223/)) ; valeur adulte 11,7 mm atteinte vers 2–7 ans.
- **Conséquence clé pour l'échelle iris** : la constante ~11,7 mm est à peu près valide **dès ~2 ans** (erreur < 2 % vs adulte), mais **totalement invalide < 1 an** (−15 % à la naissance).
- **Sexe** : hommes > femmes de ~0,1–0,3 mm dans la plupart des études (Saoudite : +0,28 mm ; Rüfer : pas de différence significative ; Gharaee : femmes légèrement > hommes — l'effet sexe est petit, ~1–2 %).
- **Âge adulte** : légère **diminution** avec l'âge (Gharaee 2014, Hashemi 2010/2015).
- **Réfraction** : corrélation positive WTW ↔ longueur axiale (r ≈ 0,38) et avec l'équivalent sphérique ; les yeux myopes longs ont un WTW légèrement plus grand ([ScienceDirect S1572100024004459](https://www.sciencedirect.com/science/article/pii/S1572100024004459) ; [PMC8639187](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8639187/)). Effet faible (< 0,2 mm sur la plage courante) mais systématique.

### 1.4 Erreur honnête d'une constante fixe 11,7 mm

- SD biologique intra-ethnie : **0,36–0,50 mm** → CV = **3,4–4,3 %** (1σ).
- MediaPipe assume 11,7 ± 0,5 mm ([Google AI Blog](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/)) et mesure empiriquement une **erreur relative moyenne de profondeur de 4,3 % (SD 2,4 %)** ; **4,8 % (SD 3,1 %) avec lunettes** ; < 10 % d'erreur garanti, validé contre le capteur de profondeur iPhone 11 (~200 sujets).
- **Sur un PD de 63 mm** : 1σ ≈ **±2,3 mm**, IC95 ≈ **±4,4 mm** (SD 0,42) à **±5,3 mm** (SD 0,5). S'y ajoutent : biais ethnique possible ~−0,5 mm (Asie de l'Est, ~−4 %), biais de définition de frontière du détecteur (jusqu'à ±0,3 mm), foreshortening cosinus si le regard n'est pas face caméra.
- Validation indépendante de l'approche « échelle par HVID » : Sci Rep 2023 (Iran, deep learning, constante 12,2 mm) → **MAPE 2,9 % (horizontal) et 4,3 % (vertical)** sur des mesures faciales (DOI [10.1038/s41598-023-40839-6](https://www.nature.com/articles/s41598-023-40839-6), [PMC10447546](https://pmc.ncbi.nlm.nih.gov/articles/PMC10447546/)).

**Verdict : l'iris comme étalon donne une échelle absolue à ~3–4 % près (1σ), soit ±2–3 mm sur un PD — insuffisant seul pour une ordonnance progressive (< 1 mm requis), acceptable pour verres unifocaux tolérants (±2 mm ANSI).**

---

## 2. Diamètre pupillaire comme référence d'échelle : **inutilisable — confirmé**

- Plage physiologique : **2–8 mm** selon la luminance (photopique 2–4 mm ; scotopique 4–8 mm) — StatPearls [NBK603732](https://www.ncbi.nlm.nih.gov/books/NBK603732/) ; formule unifiée luminance→diamètre : Watson & Yellott 2012, *J Vis*, DOI [10.1167/12.10.12](https://jov.arvojournals.org/article.aspx?articleid=2279420).
- Même à luminance constante : fluctuations cognitives/lecture de **0,78–1,38 mm** (plage 95 % médiane) ([PMC12717228](https://pmc.ncbi.nlm.nih.gov/articles/PMC12717228/)) ; « pupillary unrest » spontané ~0,25 mm à 0,02–2 Hz.
- CV effectif ≥ 30–50 % en conditions non contrôlées, vs 3,5 % pour le HVID : **un ordre de grandeur pire**. De plus, le **centre pupillaire se déplace** avec la dilatation (~0,1–0,3 mm, typiquement vers le temporal — Wildenmann & Schaeffel, *Ophthalmic Physiol Opt* 2013), ce qui affecte même la mesure du PD (bruit ~0,2–0,6 mm sur le PD selon l'éclairage).
- Usage légitime : distinguer pupille (2–8 mm, variable) et iris (11,7 mm, stable) ; ne jamais utiliser la pupille comme étalon.

---

## 3. Mesure du PD par caméra sans objet de référence : études de validation

### 3.1 Distinction critique : TrueDepth (profondeur active) vs RGB pur

- **TrueDepth (iPhone X+)** : projecteur IR à points → carte de profondeur métrique vraie ; l'échelle absolue vient du hardware, pas d'une hypothèse anatomique. Erreur du capteur < 2 % jusqu'à 2 m (validation Google, [blog MediaPipe](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/)).
- **RGB pur** : l'échelle doit venir soit d'un objet de référence (carte ISO/IEC 7810 ID-1 : 85,60 × 53,98 mm), soit d'une hypothèse anatomique (HVID ≈ 11,7 mm), soit d'une géométrie connue (distance écran-visage contrôlée, reflets cornéens — brevets 6over6 [US2018/0140186](https://www.freepatentsonline.com/y2018/0140186.html), [US9323075](https://patents.google.com/patent/US9323075B2/en)).

### 3.2 Résultats chiffrés

| Étude / App | Techno | n | Résultat (vs gold standard pupillomètre/autoréf.) | Source |
|---|---|---|---|---|
| **Cureus 2023** — EyeMeasure, Warby Parker, PDCheck AR | **TrueDepth** (les 2 premières) | 44 | **MAE 0,51 mm** (EyeMeasure et Warby Parker) ; **PDCheck AR : MAE 1,375 mm** ; Warby Parker jugée la plus précise | PMID [37529827](https://pubmed.ncbi.nlm.nih.gov/37529827/), [texte Cureus](https://www.cureus.com/articles/169122-comparing-the-effectiveness-of-smartphone-applications-in-the-measurement-of-interpupillary-distance) |
| **Clin Optom 2024 « From Rulers to Apps »** — EyeMeasure v1.22 vs pupillomètre Topcon PD-5, règle, autoréf. KR-8100P | TrueDepth | 40 | L'app donne des PD de loin **significativement plus petits** que les autres méthodes (biais négatif) ; la règle PD surestime vs pupillomètre ; Bland-Altman MD ± 1,96 SD | DOI [10.2147/OPTO.S491431](https://www.tandfonline.com/doi/full/10.2147/OPTO.S491431), PMID [39697273](https://pubmed.ncbi.nlm.nih.gov/39697273/), [PMC11654209](https://pmc.ncbi.nlm.nih.gov/articles/PMC11654209) |
| **McMahon et al. 2012** (app iPod 1re génération, RGB) | RGB (photo) | — | pupillomètre−app : **biais −3,24 mm, LoA jusqu'à +9,57 mm** ; répétabilité app **−6,63/+6,51 mm** — pire que l'auto-mesure au miroir (biais +0,46 mm, LoA −5,22/+6,14) | *Optom Vis Sci* 2012;89(6), PMID [22581116](https://pubmed.ncbi.nlm.nih.gov/22581116/) |
| **J Phys Conf Ser 2022** — Glassify Me, Vistech, Ultimate PD Rule | RGB (carte de crédit comme référence pour Glassify Me) | — | Glassify Me la plus précise : différence moyenne **0,2 mm** vs autoréfractomètre (p = 0,48, non significatif) | DOI [10.1088/1742-6596/2243/1/012001](https://iopscience.iop.org/article/10.1088/1742-6596/2243/1/012001/pdf) |
| **GlassesOn (6over6)** | RGB + géométrie propriétaire (reflets cornéens + distance estimée) | — | Revendication : **PD à ±2 mm** (norme ANSI Z80.17), dispositif médical FDA Class 1 listé, CE, TGA ; pas d'étude indépendante publiée trouvée | [App Store](https://apps.apple.com/us/app/glasseson/id1153638659), [AppBrain](https://www.appbrain.com/app/glasseson-%7C-pupils-lenses/com.sixoversix.copyglass) |
| **EyeQue PDCheck** | RGB + **lunettes-étalon** imprimées de repères (objet de référence porté) | — | Revendication **±1 mm** ; brevet [US11707191](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11707191) | [eyeque.com/pdcheck](https://www.eyeque.com/pdcheck), [GlobeNewswire 2019](https://www.globenewswire.com/news-release/2019/01/07/1681404/0/en/Introducing-EyeQue-PDCheck-the-Most-Accurate-Way-to-Capture-Your-Pupillary-Distance-a-Critical-Measure-for-Ordering-Eyeglasses-Online.html) |
| **Opthy (EssilorLuxottica)** | smartphone (iOS) | — | Revendication : conforme ANSI Z80.1 / ISO 21987 ; pas de validation indépendante publiée | [essilorluxottica.com](https://www.essilorluxottica.com/en/newsroom/stories/new-breakthrough-opthy-app-measures-pupillary-distance/), [App Store](https://apps.apple.com/gb/app/opthy/id1624663408) |
| **EyeMeasure (Dotty Digital)** | TrueDepth | — | Revendication ±0,5 mm ; PD de près et de loin | [App Store](https://apps.apple.com/us/app/eyemeasure/id1417435049) |
| **Warby Parker app** | TrueDepth (API Apple) | — | « Professional-grade precision » ; validée indirectement par Cureus 2023 (MAE 0,51 mm) | [MacRumors 2017](https://www.macrumors.com/2017/11/08/warby-parker-app-iphone-x-trudepth/), [warbyparker.com/app](https://www.warbyparker.com/app) |
| **Auglio Auto PD** (web, RGB) | RGB | — | Revendication : **±1,5 mm dans 91 % des cas** | [auglio.com](https://auglio.com/en/products/auto-pd-measurement) |
| **MediaPipe Iris** (brique de base RGB) | RGB + constante iris 11,7 mm | ~200 | Erreur de **profondeur** 4,3 % ± 2,4 % (4,8 % avec lunettes) → même ordre pour l'échelle → ±2–3 mm sur PD | [Google AI Blog 2020](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/) |

**Synthèse** : les apps **TrueDepth** atteignent MAE ≈ 0,5 mm (indépendamment vérifié) ; les solutions **RGB pur sans référence** sont soit non validées indépendamment (GlassesOn ±2 mm revendiqués), soit limitées à ±1,5–3 mm ; la 1re génération d'apps photo RGB était catastrophique (biais 3 mm, LoA ±6 mm). L'objet de référence (carte) ramène le RGB à ~±1–2 mm mais contredit l'exigence « sans objet ».

---

## 4. Biais de réfraction : mesurer à travers des lunettes portées

- Grossissement spectacle (« spectacle magnification ») : **SM = 1/(1 − d·Fv)** (power factor ; d = distance verre→pupille d'entrée ≈ 15 mm ; Fv = puissance vertex arrière) ; approximation SM ≈ 1 + d·Fv, soit **~1,4–2 %/dioptrie** ([Optician Online CPD](https://www.opticianonline.net/cpd-archive/41), [Opterio](https://www.opterio.com/learn/spectacle-magnification-abo), [Optography](https://optography.org/spectacle-magnification/)).
- Chiffres : −2 D → iris vu −2,9 % ; −4 D → **−5,7 %** ; −6 D → −8,3 % ; +4 D → +6,4 % (calcul avec d = 15 mm).
- **Mécanisme du biais sur le PD iris-référencé** : les pupilles étant vues à travers les centres optiques (déplacement prismatique ≈ 0 si les lunettes sont bien centrées), la position des pupilles est peu biaisée, mais **l'iris est minifié/magnifié localement** → le facteur mm/px est faussé de tout le SM → un myope de −4 D verra son PD **surestimé d'environ 5–6 % (~3,5 mm)** si l'échelle vient de l'iris vu à travers le verre. Si lunettes décentrées, s'ajoute un déplacement prismatique des images pupillaires (règle de Prentice, P = c·F).
- Confirmation empirique : MediaPipe passe de 4,3 % à **4,8 % d'erreur (SD 3,1 %) avec lunettes** ([Google AI Blog](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/)).
- **Règle pratique : faire retirer les lunettes** (les lentilles de contact, plaquées sur la cornée, ont un grossissement négligeable ~0,25 %/D).

---

## 5. Statistiques de population du PD

### 5.1 Adultes (Dodgson 2004, base ANSUR n = 3 976, 17–51 ans)

- **Ensemble : 63,36 ± 3,83 mm** ; min 52, max 78 mm.
- **Hommes : 64,7 ± 3,7 mm** ; **Femmes : 62,3 ± 3,6 mm** (Δ ≈ 2,4 mm, p < 10⁻⁸⁵).
- Majorité des adultes : 50–75 mm ; quasi-totalité : 45–80 mm.
- Source : Dodgson, *Proc SPIE* 5291:36–46 (2004), DOI [10.1117/12.529999](http://spie.org/Publications/Proceedings/Paper/10.1117/12.529999), [PDF](http://www.neildodgson.com/pubs/EI5291A-05.pdf). Étude moderne concordante : hommes 63,6 ± 3,9 / femmes 61,1 ± 3,5 ([J Optometry 2021](https://www.sciencedirect.com/science/article/pii/S1888429620301205)).

### 5.2 Courbe de croissance pédiatrique (MacLachlan & Howland 2002 ; n = 1 311, 1 mois–19 ans, 4 294 visites)

- Référence : *Ophthalmic Physiol Opt* 2002;22(3):175–182, DOI [10.1046/j.1475-1313.2002.00023.x](https://onlinelibrary.wiley.com/doi/abs/10.1046/j.1475-1313.2002.00023.x), PMID [12090630](https://pubmed.ncbi.nlm.nih.gov/12090630/). PD mesurés à 0,66 m puis **corrigés à la fixation infinie via les rayons de rotation oculaire dépendant de l'âge** (bonne pratique !).
- Valeurs indicatives : nourrisson ~40 mm ; **3–4 ans : 46–48 mm ; 5–6 ans : 50–52 mm ; 7–8 ans : 53–54 mm ; 9–10 ans : 55–56 mm** ; valeurs adultes vers 16–18 ans (min enfant 5 ans ≈ 40 mm selon Dodgson).
- Contraste clé : **le PD croît jusqu'à l'adolescence alors que le HVID est adulte dès ~2 ans** → l'iris reste un étalon valable chez l'enfant, mais le PD mesuré doit être daté.

### 5.3 Asymétrie monoculaire (PD monoculaire = pupille → milieu du nez)

- PD monoculaires : droite 31,65 ± 1,86 mm (26–38), gauche 30,90 ± 1,80 mm (26–37) → **asymétrie moyenne ~0,75 mm**, souvent > 1 mm (« Nasopupillary Asymmetry », [PMC4269086](https://pmc.ncbi.nlm.nih.gov/articles/PMC4269086/)).
- Autre série : PD monoculaire droit femmes 30,1 ± 1,6 mm / hommes 31,4 ± 2,0 mm ([J Optometry 2021, S1888429620301205](https://www.sciencedirect.com/science/article/pii/S1888429620301205)).
- Conséquence : pour verres progressifs, mesurer les **PD monoculaires par rapport au milieu réel du nez/arête**, pas PD/2.

---

## 6. Plan cornéen vs plan pupillaire vs centre oculaire ; PD de loin vs PD de près ; erreur de convergence caméra

### 6.1 Ce qu'est le PD opticien

- **PD de loin (distance PD)** : distance entre centres des pupilles d'entrée, yeux en fixation à l'infini (axes visuels parallèles). C'est la valeur d'ordonnance standard.
- **PD de près (near PD / centration de près)** : distance entre les points où les axes visuels convergents percent le **plan des verres** en vision de près. Formule opticien : **PD_près = PD_loin × l / (l + s)** avec l = distance de travail depuis le plan des verres et **s = 27 mm** (plan des verres → centre de rotation : 12–14 mm de vertex + ~13,5 mm) — à 40 cm : facteur 0,937 → la fameuse règle « −4 mm » ([Masaryk University, Spectacle technique](https://is.muni.cz/do/rect/el/estud/lf/ps21/spectacle_technique_technology/web/pages/01_02_near_measurement.html), [OptoGrid near-PD calculator](https://www.optogrid.com/tools/near-pd-calculator/)).
- Anatomie des plans : pupille d'entrée ≈ **3,05 mm derrière l'apex cornéen** ; **centre de rotation ≈ 13,5 mm derrière la cornée** (mesure classique Fry & Hill 1962 : 14,8 mm derrière l'apex, 0,79 mm en nasal — cité par [Points de Vue/Essilor](https://www.pointsdevue.com/article/role-eyes-centre-rotation-lens-design) ; dépend de la réfraction/longueur axiale : Ohlendorf et al. 2022, DOI [10.1111/opo.12940](https://onlinelibrary.wiley.com/doi/full/10.1111/opo.12940) — plus profond chez les myopes).

### 6.2 Erreur de convergence pour une caméra à 30–60 cm — quantification

Quand le sujet **fixe la caméra**, les yeux convergent : chaque pupille d'entrée pivote en nasal autour du centre de rotation. Le PD photographié est donc un **PD de près**, plus petit que le PD de loin.

Géométrie : θ = atan[(PD/2)/(D + z)] avec D = distance caméra→cornée, z = 13,5 mm ; la pupille d'entrée est p = z − 3,05 ≈ 10,5 mm en avant du centre de rotation → **PD_mesuré ≈ PD_loin − 2·p·sin θ ≈ PD_loin × [1 − p/(D + z)]**.

**Correction : PD_loin = PD_mesuré / [1 − p/(D + z)] ≈ PD_mesuré + PD_mesuré·p/(D + z)** (p ≈ 10,5 mm si l'on détecte les centres pupillaires ; p ≈ 13,5 mm si l'on détecte le centre du limbe/plan cornéen).

| Distance caméra D | Sous-estimation (centres pupillaires) | (centre limbique/cornéen) |
|---|---|---|
| 30 cm | **−2,1 mm (−3,3 %)** | −2,7 mm |
| 40 cm | **−1,6 mm (−2,5 %)** | −2,1 mm |
| 50 cm | −1,3 mm (−2,0 %) | −1,7 mm |
| 60 cm | **−1,1 mm (−1,7 %)** | −1,4 mm |
| 100 cm | −0,65 mm | −0,84 mm |

(calculs pour PD 63 mm ; l'erreur est proportionnelle au PD et ~inverse de D). **Ne pas confondre** avec la règle « −4 mm » : celle-ci concerne la centration au plan des verres (s = 27 mm), pas la position physique des pupilles (p ≈ 10,5 mm). Une app qui fait fixer la caméra à 40 cm et ne corrige pas la convergence a un biais systématique ≈ **−1,6 mm** ; alternative : faire fixer une cible lointaine derrière la caméra (mais le regard décentré introduit un foreshortening de l'iris ≈ cos θ, négligeable < 0,5 % à ces angles). PupiMetric revendique explicitement cette correction 3D ([pupimetric.com](https://www.pupimetric.com/)).

### 6.3 Parallaxe des plans

La pupille d'entrée (3,05 mm derrière la cornée) et le limbe (plan cornéen) ne sont pas dans le même plan : en vue non frontale, le centre pupillaire apparent se déplace par rapport au centre limbique (~3 mm × sin(angle de pose)). À 5° de pose : ~0,27 mm par œil — d'où l'exigence de frontalité ou d'une correction de pose 3D.

---

## 7. Répétabilité (precision) vs justesse (trueness) — par méthode

| Méthode | Justesse (biais vs référence) | Répétabilité (LoA ou SD) | Source |
|---|---|---|---|
| **Pupillomètre cornéen (Topcon PD-5, Essilor CRP)** | référence de facto, alignée sur le PD anatomique | la meilleure des méthodes cliniques (LoA les plus étroites) | [S0275540898000337](https://www.sciencedirect.com/science/article/abs/pii/S0275540898000337), [S0275540898000234](https://www.sciencedirect.com/science/article/abs/pii/S0275540898000234) |
| **Règle PD par examinateur** | biais **+0,59 mm** vs pupillomètre, LoA **−0,69/+1,88 mm** | inter-session bonne ; sensible à la parallaxe examinateur | McMahon 2012, PMID [22581116](https://pubmed.ncbi.nlm.nih.gov/22581116/) ; [J Optometry 2021](https://www.sciencedirect.com/science/article/pii/S1888429620301205), PMID [33883087](https://pubmed.ncbi.nlm.nih.gov/33883087/) |
| **Auto-mesure au miroir** | biais +0,46 mm, LoA −5,22/+6,14 mm | répétabilité −3,61/+4,75 mm | McMahon 2012 |
| **Mesure par un ami** | biais +2,00 mm, LoA −3,80/+7,81 mm | −3,74/+3,94 mm | McMahon 2012 |
| **App photo RGB 2012 (iPod)** | biais −3,24 mm, LoA jusqu'à +9,57 mm | **−6,63/+6,51 mm** (très mauvaise) | McMahon 2012 |
| **Apps TrueDepth (EyeMeasure, Warby Parker)** | MAE **0,51 mm** (justesse vérifiée indépendamment) ; tendance à sous-estimer légèrement le PD de loin | répétabilité rapportée bonne (< 0,5 mm typ.) mais peu quantifiée en LoA publiées | Cureus 2023, PMID [37529827](https://pubmed.ncbi.nlm.nih.gov/37529827/) ; Clin Optom 2024, DOI [10.2147/OPTO.S491431](https://www.tandfonline.com/doi/full/10.2147/OPTO.S491431) |
| **RGB + iris 11,7 mm (MediaPipe-like)** | justesse limitée par la biologie : **±2,3 mm (1σ) / ±4,4 mm (95 %)** de la seule variance HVID + biais ethnique | répétabilité potentiellement excellente (< 0,5 mm en moyennant N frames : le bruit de détection se moyenne, **pas** l'erreur de constante) | calcul §1.4 ; [MediaPipe](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/) |
| **RGB + carte ISO/IEC 7810** | ±1–2 mm si carte au plan des yeux (erreur de plan carte↔yeux = source dominante) | modérée (pose de la carte) | [J Phys Conf Ser 2022](https://iopscience.iop.org/article/10.1088/1742-6596/2243/1/012001/pdf) ; [ROKA PD chart](https://img.roka.com/rx/ROKA_PD_CHART.pdf) |
| **Eye-tracking IR (RightEye)** | validé vs pupillomètre (corrélations p < 0,001) | pupille à 0,3–1,0 mm ; < 0,3 mm avec mentonnière ; Cronbach α > 0,7 | Murray et al., *TVST* 2017, DOI [10.1167/tvst.6.4.2](https://tvst.arvojournals.org/article.aspx?articleid=2642909), PMID [28685104](https://pubmed.ncbi.nlm.nih.gov/28685104/) |

Le point conceptuel central : **avec une constante anatomique, on peut être extrêmement répétable et pourtant faux** — l'erreur de la constante (3,5 % ≈ 2,3 mm) est un biais par sujet, invisible dans les tests de répétabilité. Toute annonce de précision fondée sur la répétabilité seule est trompeuse.

---

## 8. Tableau comparatif final

| Méthode | Référence d'échelle | Données nécessaires | Échelle absolue ? | Précision (justesse) | Population | Webcam ? | Limites |
|---|---|---|---|---|---|---|---|
| Pupillomètre cornéen | mécanique interne | appareil dédié | Oui | ±0,25–0,5 mm | tous | Non | coût, en boutique |
| Règle PD + examinateur | règle mm | examinateur formé | Oui | ±1 mm (LoA ~±1,3) | tous | Non | parallaxe examinateur |
| **App TrueDepth** (EyeMeasure, Warby Parker) | carte de profondeur IR structurée | iPhone X+ | **Oui (hardware)** | **MAE ≈ 0,5 mm** | ados/adultes | **Non** (iPhone requis) | pas d'Android/webcam ; sous-estime légèrement le PD de loin |
| RGB + carte bancaire (Glassify Me…) | objet ISO 85,60 mm | photo + carte sur le front | Oui (objet) | ±1–2 mm (Δmoy 0,2 mm meilleure étude) | tous | Oui | plan carte ≠ plan pupilles ; coopération |
| RGB + lunettes-étalon (PDCheck) | monture marquée | frames dédiées | Oui (objet porté) | ±1 mm revendiqué ; MAE 1,4 mm mesuré (version AR) | tous | Oui | objet à posséder |
| **RGB + iris HVID 11,7 mm** (MediaPipe-like) | constante anatomique | 1 webcam, visage frontal, sans lunettes | **Pseudo-absolue (hypothèse)** | biais/sujet **±2,3 mm (1σ), ±4,4 mm (95 %)** + convergence −1à−2 mm si non corrigée | valide ≥ ~2 ans ; biais Asie de l'Est ~−4 % | **Oui** | SD biologique irréductible ; lunettes interdites (1,5–2 %/D) ; frontalité requise |
| RGB + géométrie propriétaire (GlassesOn/6over6) | reflets cornéens + distance estimée | smartphone | Partielle | ±2 mm revendiqués (ANSI Z80.17), non vérifié indépendamment | adultes | ~Oui | opaque, app retirée de Google Play (2025) |
| RGB + distance connue (écran/mise au point) | distance caméra-sujet contrôlée | protocole contraint | Oui si distance fiable | dépend du contrôle de D (erreur PD ∝ erreur D) | tous | Oui | fragile en pratique |
| Pupille comme étalon | diamètre pupillaire | — | **Non** | CV ≥ 30 % → inutilisable | — | — | luminance, cognition, hippus |

---

## 9. Recommandations pratiques (pipeline webcam RGB pur)

1. **Étalon = HVID** (jamais la pupille). Moyenner la détection sur ≥ 30 frames et sur les deux yeux (réduit le bruit de détection, pas le biais de constante).
2. Annoncer honnêtement : **±2,3 mm (1σ)** de biais possible par sujet avec la constante 11,7 mm ; proposer la saisie d'un HVID personnalisé (mesuré une fois chez l'opticien) qui transforme la méthode en quasi-exacte.
3. **Corriger la convergence** : PD_loin = PD_mes × (D + 13,5)/(D + 13,5 − 10,5) (D en mm, détection pupillaire), soit +1,6 mm à 40 cm ; estimer D par la taille d'iris elle-même (auto-cohérent) ou par la focale EXIF + pinhole model.
4. **Refuser la mesure avec lunettes portées** (biais 1,4–2 %/D → jusqu'à ±4 mm) ; contacts OK.
5. Exiger la **frontalité** (pose < 5°) et un regard caméra ; sinon correction de pose 3D.
6. **Enfants** : constante iris valide dès ~2 ans (HVID adulte précoce), mais jamais < 1 an ; le PD pédiatrique évolue (46→56 mm entre 3 et 10 ans) donc re-mesurer à chaque équipement.
7. Cible de qualité : ANSI Z80.17 tolère ~±2 mm sur le PD pour de l'unifocal — atteignable en RGB pur pour ~68 % des sujets seulement (1σ = 2,3 mm) ; pour du progressif (< 1 mm), il faut TrueDepth, objet de référence ou HVID personnalisé.

---

## 10. Bibliographie condensée (clé → identifiant)

1. Rüfer F, Schröder A, Erb C. *Cornea* 2005;24:259-61 — PMID 15778595.
2. Gharaee H et al. (Iran, Orbscan II, n=1001) — PMID 24790875 / PMC4003087.
3. Hashemi H et al. *J Curr Ophthalmol* 2015 — PMID 27239570 ; Tehran Eye Study 2010 (ResearchGate 38083813).
4. Kang & Lim. *PLOS ONE* 2021 — DOI 10.1371/journal.pone.0254832 (WTW inter-instruments).
5. Hickson-Curran et al. *Optom Vis Sci* 2014 — PMID 25325762 (ethnies).
6. Étude saoudienne Pentacam AXL 2025 — PeerJ 19227 / PMC11970417.
7. Bergmanson & Martin. *Clin Exp Optom* 2017 — DOI 10.1111/cxo.12583 (corneo-limbal ~13,4 mm).
8. Corneal diameter 0–36 mois — PMC9589223 ; nouveau-nés — S2211505614000453 ; Ento Key (neonatal).
9. MediaPipe Iris — Google AI Blog 2020, github.com/google-ai-edge/mediapipe (iris.md).
10. Sci Rep 2023, HVID scaling deep learning — DOI 10.1038/s41598-023-40839-6.
11. Watson & Yellott. *J Vis* 2012 — DOI 10.1167/12.10.12 (pupille vs luminance) ; StatPearls NBK603732.
12. Cureus 2023 (Warby Parker/EyeMeasure/PDCheck AR) — PMID 37529827.
13. *Clin Optom* 2024 « From Rulers to Apps » — DOI 10.2147/OPTO.S491431 / PMID 39697273.
14. McMahon, Irving & Lee. *Optom Vis Sci* 2012 — PMID 22581116.
15. J Optometry 2021 (manuel vs pupillomètre) — PMID 33883087 / S1888429620301205.
16. Dodgson NA. *Proc SPIE* 5291 (2004) — DOI 10.1117/12.529999 (ANSUR).
17. MacLachlan & Howland. *Ophthalmic Physiol Opt* 2002 — DOI 10.1046/j.1475-1313.2002.00023.x / PMID 12090630.
18. Nasopupillary Asymmetry — PMC4269086.
19. Murray, Hunfalvay & Bolte. *TVST* 2017 — DOI 10.1167/tvst.6.4.2 / PMID 28685104.
20. Fry & Hill 1962 (centre de rotation 14,8 mm) via pointsdevue.com ; Ohlendorf 2022 — DOI 10.1111/opo.12940.
21. Near PD : is.muni.cz (Masaryk, spectacle technique) ; formule l/(l+27).
22. Spectacle magnification : opticianonline.net CPD ; opterio.com ; optography.org.
23. Brevets 6over6 : US2018/0140186, US9323075 ; EyeQue US11707191.
24. GlassesOn (ANSI Z80.17, FDA Class 1) — App Store id1153638659 ; Opthy — essilorluxottica.com.
25. IOP Conf. Ser. 2022 (Glassify Me) — DOI 10.1088/1742-6596/2243/1/012001.
26. J Phys/IOLMaster Inde — PMID 31719734 ; myopes chinois — PMC8639187.
