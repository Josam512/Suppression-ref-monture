# Jeux de données publics et méthodologie de validation pour la mesure faciale métrique (PD, HVID, largeurs de visage) à partir d'images/vidéo

*Rapport de recherche — 19 août 2026. Toutes les affirmations sont sourcées (liens en note ou en fin de section).*

---

## 1. Constat général

1. **Aucun jeu de données public ne couple des photos/vidéos de visages avec une PD mesurée par un opticien** (pupillomètre). Toutes les études de validation d'applications PD publiées utilisent des cohortes internes (30–44 sujets) jamais diffusées, pour des raisons de confidentialité et de réglementation médicale.
2. Les meilleurs substituts sont : (a) les **scans 3D à échelle métrique réelle** (3D Facial Norms, Headspace, FRGC v2, Texas 3DFRD, Bosphorus…), sur lesquels on peut mesurer des distances inter-landmarks vraies et, pour certains, rendre des images 2D synthétiques avec vérité terrain exacte ; (b) les **données synthétiques** (FLAME/BFM, Microsoft FaceSynthetics) où l'échelle est connue par construction ; (c) les **normes anthropométriques** (ANSUR, 3DFN) pour les distributions de référence.
3. **Aucun jeu de données iris/périoculaire public ne fournit le HVID en millimètres.** La littérature clinique fournit en revanche des distributions de HVID/WTW très solides (≈ 11,7 ± 0,4 mm), qui bornent l'erreur de toute mise à l'échelle « iris = constante ».
4. La méthodologie de validation de référence en optométrie est **Bland–Altman (biais + limites d'agrément à 95 %)**, complétée par MAE/RMSE/P95 et par la comparaison aux tolérances **ISO 21987 / ANSI Z80.1** (≈ ±1 mm par œil pour un verre progressif ; imbalance prismatique 0,67 Δ horizontal / 0,33 Δ vertical).

---

## 2. Jeux de données 3D avec vérité terrain anthropométrique (question 1)

### 2.1 Tableau récapitulatif

| Dataset | N sujets | Âges (enfants ?) | Population | Landmarks / annotations | Dimensions physiques ? PD vraie ? HVID ? | Accès | Licence / usage commercial |
|---|---|---|---|---|---|---|---|
| **FaceBase 3D Facial Norms (3DFN, Weinberg)** | **2 454** | **3–40 ans (oui, enfants)** | USA, ascendance européenne (« Caucasiens » auto-déclarés), sains | 24 landmarks 3D (x,y,z) par sujet | **34 mesures anthropométriques** (distances inter-landmarks + mesures directes au pied à coulisse : circonférence crânienne, etc.) dont largeur intercanthale (en–en), extercanthale (ex–ex), fente palpébrale ; **pas de PD pupillaire vraie** (pupilles non landmarkées), pas de HVID | facebase.org — stats agrégées libres ; données individuelles (landmarks, mesures, scans 3D, génotypes) sous demande d'accès (DUA FaceBase, génotypes via dbGaP) | Recherche uniquement (accord d'utilisation des données) |
| **FaceScape** | 847 | Adultes surtout (âge + sexe fournis) | Chine (Univ. Nanjing) | Modèles topologiquement uniformes ; paramètres caméra fournis | 16 940 modèles 3D (20 expressions/sujet), ~400 k images multi-vues 4K ; échelle issue d'un rig multi-caméras calibré ; pas d'anthropométrie directe ni PD | Demande de clé de licence (site NJU-3DV) | **Non commercial strict** (interdiction explicite d'usage direct/indirect à but lucratif) |
| **Headspace (Liverpool-York, LYHM)** | 1 519 | Large éventail, **enfants inclus** (collecte à l'hôpital pédiatrique Alder Hey) | Royaume-Uni | Scans 3dMD tête complète (bonnet), métadonnées démographiques | Scans à l'échelle métrique du système 3dMD ; pas de mesures caliper ni PD/HVID | Formulaire signé (universitaires vérifiables) à N. Pears, Univ. York ; 38 Go | Recherche universitaire non commerciale uniquement |
| **BU-3DFE** | 100 | 18–70 ans (adultes) | Multi-ethnique (Binghamton) | **83 landmarks** par scan ; 2 500 scans (6 expressions × 4 intensités + neutre) | Scans à échelle du scanner 3dMD ; pas d'anthropométrie caliper, pas de PD | Demande à Binghamton University | Recherche ; usage commercial à négocier |
| **BP4D-Spontaneous / BP4D+** | 41 / 140 | 18–29 ans (adultes) | Multi-ethnique | 4D dynamique (3D + vidéo), codage FACS ; 83 landmarks | Maillages dynamiques métriques ; aucune mesure physique directe | Demande à Binghamton | Recherche uniquement |
| **FRGC v2.0** | 466 | Adultes (étudiants majoritairement) | USA (Notre Dame) | 4 007 scans 3D texturés (Minolta Vivid 900/910, données de profondeur métriques) + ~50 k images 2D | Range-scans en vraies coordonnées mm ; pas de PD ni caliper | Accord de licence (Univ. Notre Dame / NIST) | Recherche uniquement |
| **Bosphorus** | 105 (60 H / 45 F) | Adultes | Turquie | **24 landmarks manuels** par scan ; 4 666 scans (poses, expressions, occlusions) | Scanner à lumière structurée Inspeck (métrique) ; pas d'anthropométrie | Accord académique (Univ. Boğaziçi) | Recherche uniquement |
| **CoMA (MPI)** | 12 | Adultes | — | 4D 60 fps, 12 expressions extrêmes, topologie FLAME | Maillages métriques (erreurs rapportées en mm) | Enregistrement coma.is.tue.mpg.de | Recherche non commerciale (licence MPI) |
| **D3DFACS** | 10 | Adultes | Royaume-Uni (Bath) | 519 séquences d'expressions codées FACS ; recalage FLAME dispo (MPI) | 4D métrique ; pas d'anthropométrie | Demande (Univ. Bath / MPI pour les versions recalées) | Recherche |
| **NoW benchmark** | 100 | Adultes | — | 2 054 photos iPhone X + 1 scan 3D de référence par sujet | Benchmark d'erreur de reconstruction **métrique (mm)** face neutre ; pas de PD/caliper | Enregistrement (now.is.tue.mpg.de), soumission au challenge | Recherche non commerciale |
| **FaMoS (MPI, TEMPEH 2023)** | 95 | Adultes | — | 28 séquences dynamiques/sujet, ~600 k frames, topologie FLAME | 4D métrique multi-vues calibré | Enregistrement MPI | Recherche non commerciale |
| **Florence 2D/3D (MICC)** | 53 | Adultes | Italie | Scan 3D haute résolution + vidéos HD / PTZ / extérieur par sujet | Scans métriques ; conçu pour lier 2D↔3D ; pas d'anthropométrie | Demande au MICC (Univ. Florence) | Recherche |
| **Texas 3DFRD** | 118 | Adultes | USA (multi-ethnique) | 1 149 paires image couleur + carte de profondeur alignées, normalisées en pose ; landmarks fournis | **Résolution pixel calibrée ≈ 0,32 mm** (stéréo MU-2) → distances métriques mesurables directement dans l'image | Demande (UT Austin, LIVE) | Recherche |
| **CASIA-3D FaceV1** | 123 | Adultes | Chine | 4 624 scans (Minolta VIVID 910, métrique) ; poses, expressions, illumination | Range-data métrique ; pas d'anthropométrie | Accord CBSR/NLPR | Recherche |

**Points clés :**
- Le **3DFN** est le seul de la liste avec une vraie batterie anthropométrique individuelle (34 mesures) et des **enfants dès 3 ans**, mais la **PD pupillaire n'y figure pas** : la stéréophotogrammétrie landmarke les canthi (en, ex), pas les pupilles. La PD peut être *approchée* par (en–en + ex–ex)/2, une approximation clinique classique à valider en soi.
- Tous les scans 3D listés sont **à l'échelle métrique réelle** (scanners calibrés), donc utilisables pour générer des paires (image 2D rendue avec intrinsèques connus ↔ distances 3D vraies), y compris une pseudo-PD (centres d'iris repérés manuellement sur la texture, projetés sur le maillage).
- **Aucun** ne contient de HVID en mm.
- **Licences : quasi toutes non commerciales.** Pour un produit commercial, ces données servent à la *validation interne* (usage à vérifier au cas par cas dans chaque accord) mais généralement **pas** à l'entraînement de modèles commercialisés.

Sources : [FaceBase 3DFN](https://www.facebase.org/resources/human/facial_norms/) ; [Weinberg et al. 2016, Cleft Palate Craniofac J / PMC4841760](https://pmc.ncbi.nlm.nih.gov/articles/PMC4841760/) ; [PubMed 26492185](https://pubmed.ncbi.nlm.nih.gov/26492185/) ; [FaceScape (NJU-3DV)](https://nju-3dv.github.io/projects/FaceScape/) ; [FaceScape GitHub](https://github.com/zhuhao-nju/facescape) ; [arXiv 2111.01082](https://arxiv.org/abs/2111.01082) ; [Headspace (York)](https://www-users.york.ac.uk/~np7/research/Headspace/) ; [accord LYHM](https://www-users.york.ac.uk/~np7/research/LYHM/LYHMagreement08.pdf) ; [Dai et al., IJCV 2020](https://link.springer.com/article/10.1007/s11263-019-01260-7) ; [récapitulatif BU-3DFE/FRGC/Bosphorus, arXiv 2010.08391](https://arxiv.org/pdf/2010.08391v1) ; [Bosphorus (BIOID 2008)](https://academics.boun.edu.tr/bulent.sankur/sites/bulent.sankur/files/inline-files/Conf_BIOID_Bosporus.pdf) ; [FLAME-Universe (CoMA, D3DFACS, FaMoS, NoW)](https://github.com/TimoBolkart/FLAME-Universe) ; [Florence 2D/3D (MICC)](https://www.micc.unifi.it/resources/datasets/florence-3d-faces/) ; [Texas 3DFRD (descriptif)](https://github.com/blancaag/face-datasets/blob/master/3D/README.md) ; [CASIA-3D](https://github.com/huyhieupham/3D-Face-Recognition).

---

## 3. Jeux de données avec PD « vraie » (question 2)

- **Recherche exhaustive négative** : aucun dataset public « photos + PD mesurée au pupillomètre » n'a été identifié (requêtes « interpupillary distance dataset », « PD ground truth dataset », littérature télé-optométrie, brevets). Les brevets (Warby Parker [US 8 459 792], 6over6 [US 9 323 075], etc.) décrivent des méthodes, pas des données publiées.
- **MeGlass** (14 832 images avec lunettes / 33 087 sans, 1 710 identités, issu de MegaFace) : uniquement des étiquettes présence/absence de lunettes — **pas de PD** ([MeGlass GitHub](https://github.com/cleardusk/MeGlass)). Idem **SoF (Specs on Faces)** : occlusions par lunettes, pas de mesure métrique.
- Les études de validation d'apps construisent leurs propres cohortes, jamais diffusées : 44 sujets (Cureus 2023), 39 sujets (J. Phys. Conf. 2022), 30 sujets (J. Optom. 2021) — voir §8.
- **ANSUR (1988)** : PD mesurée au pied à coulisse sur 3 976 militaires US (17–51 ans) — **pas d'images**, mais la référence pour la distribution : moyenne 63,36 mm, σ 3,83 mm ; hommes 64,7 ± 3,7 mm, femmes 62,3 ± 3,6 mm ; plage 52–78 mm ; enfants ≥ 5 ans : jusqu'à ~40 mm ([Dodgson 2004, SPIE 5291](http://www.neildodgson.com/pubs/EI5291A-05.pdf)). Indispensable pour vérifier qu'un échantillon de validation couvre la plage (queues < 58 et > 68 mm).
- Publications récentes construisant une vérité terrain interne : [MDPI Appl. Sci. 2023 (BlendMask + ERT, images 300W et CAS-PEAL-R1)](https://www.mdpi.com/2076-3417/13/15/8628) ; [Vision–Geometry Fusion 2025](https://doi.org/10.3390/asi8060181) — mesures PD/hauteur pupillaire, mais données non publiées.
- **Conséquence pratique** : la vérité terrain PD devra être **collectée en interne** (protocole §9), ou simulée (scans 3D §2, synthèse §6).

---

## 4. Datasets périoculaires / iris et échelle métrique — HVID (question 3)

- **CASIA-IrisV4** (p. ex. Interval : 2 639 images), **UBIRIS v2** (2 250 images), **ND-IRIS-0405** (64 980 images NIR 640×480, 356 sujets) : images proches infrarouge pour la biométrie ; la seule vérité terrain disponible est la **segmentation** (cercles iris/pupille, masques paupières) via **IRISSEG-EP** (Univ. Salzburg / Halmstad). **Aucun ne fournit le diamètre d'iris en millimètres ni la distance capteur–œil** ; l'échelle mm n'est donc pas reconstituable. Sources : [IRISSEG (Halmstad)](https://github.com/HalmstadUniversityBiometrics/Iris-Segmentation-Groundtruth-Database) ; [ND-IRIS-0405](https://www.researchgate.net/publication/241404880_The_ND-IRIS-0405_Iris_Image_Dataset).
- **Distributions cliniques du HVID/WTW** (mesures biométriques ophtalmiques, utilisables comme prior) :
  - Étude populationnelle (Chine rurale, n = 1 721) : WTW moyen **11,75 ± 0,40 mm** ([PLOS ONE 2021 / PMC8284630](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0254832)).
  - Différences ethniques : HVID moyen 11,26 mm (Chinois), 11,10 mm (Japonais), 11,75 mm (Caucasiens) ([Hickson-Curran et al., PubMed 25325762](https://pubmed.ncbi.nlm.nih.gov/25325762/)).
  - **Attention à l'instrument** : le « HVID » dépend fortement du dispositif — 11,77 ± 0,40 mm (Orbscan IIz) vs 12,40–12,42 mm (IOLMaster 700, DRI Triton) sur les mêmes yeux ([PLOS ONE 2021](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0254832)). Plage « normale » admise : 11,0–13,0 mm.
  - **Implication quantitative** pour une mise à l'échelle « iris = constante » : σ ≈ 0,40 mm sur ~11,75 mm ⇒ ~3,4 % d'erreur d'échelle à 1σ, ~6,8 % à 2σ, soit sur une PD de 63 mm : **±2,1 mm (1σ) / ±4,3 mm (95 %)**, plus un biais systématique possible de ~0,5 mm selon l'ethnie et le choix de la constante (11,7 vs 12,2 mm). C'est la limite fondamentale documentée de l'approche.
- **Preuve de concept publiée** : Scientific Reports 2023 (population iranienne, n = 94) — segmentation d'iris par deep learning, HVID fixé à **12,2 mm**, mise à l'échelle de mesures faciales linéaires : **MAPE 2,9 % (horizontal) et 4,3 % (vertical)** ([PMC10447546](https://pmc.ncbi.nlm.nih.gov/articles/PMC10447546/)) — cohérent avec la borne théorique ci-dessus.

---

## 5. Datasets eye-tracking et distance caméra–sujet (question 4)

| Dataset | Vérité terrain réellement disponible | Utilisable pour valider une distance estimée par l'iris ? |
|---|---|---|
| **GazeCapture** (MIT, 1 474 sujets, > 2 M images, iPhone/iPad) | Position du point regardé **en pixels écran et en cm dans le plan de l'écran relatif à la caméra (x, y)** + type d'appareil et orientation. **Pas de profondeur / distance caméra–visage mesurée** (aucun capteur de profondeur pendant la collecte). | **Non directement** : la distance sujet-caméra n'est pas une vérité terrain. Licence : recherche uniquement, enregistrement ([GazeCapture](https://gazecapture.csail.mit.edu/), [LICENSE](https://github.com/CSAILVision/GazeCapture/blob/master/LICENSE.md)). |
| **MPIIGaze / MPIIFaceGaze** (15 sujets, webcams portables) | Cibles de regard en coordonnées écran ; la « position 3D de la tête » est **estimée** par ajustement de modèle facial + calibration écran-caméra (miroir), pas mesurée par un capteur indépendant. | Faiblement : la distance fournie est elle-même un produit d'estimation. |
| **EVE** (ETH Zürich, ECCV 2020, 54 participants, > 12 M frames) | **4 caméras calibrées et synchronisées** (Basler + 3 webcams, extrinsèques/intrinsèques fournies) + Tobii Pro Spectrum 150 Hz : **origine 3D du regard (position des yeux) en coordonnées caméra** et point de regard écran. | **Oui — meilleur candidat** : la position 3D des yeux issue du rig stéréo calibré donne une vraie distance caméra–œil pour chaque frame ([EVE GitHub](https://github.com/swook/EVE), [DATASET.md](https://github.com/swook/EVE/blob/master/DATASET.md)). Licence recherche (ETH). |

Verdict : pour valider « distance estimée depuis le diamètre d'iris en pixels », utiliser **EVE** (vérité 3D calibrée), ou un protocole interne avec télémètre laser — c'est ce que fait la littérature (26 participants, télémètre laser Bosch GLM120C comme vérité terrain dans [AppliedMath 2025](https://doi.org/10.3390/appliedmath5030118)).

---

## 6. Données synthétiques à échelle connue (question 5)

- **FLAME** (MPI) : modèle de tête 3D à l'échelle métrique humaine ; en rendant des visages FLAME avec des intrinsèques caméra connus, on obtient une **vérité terrain exacte par construction** (PD, largeurs, distance caméra) — idéal pour tester le pipeline géométrique (projection, biais de pose, distorsion) *indépendamment* de la variabilité biologique. Modèle gratuit pour la recherche scientifique non commerciale (enregistrement flame.is.tue.mpg.de) ; **licence commerciale via Meshcapade** (comme SMPL). Les datasets d'entraînement FLAME (CoMA, D3DFACS recalé, FaMoS) sont non commerciaux ([FLAME-Universe](https://github.com/TimoBolkart/FLAME-Universe)).
- **Basel Face Model (BFM 2009/2017/2019)** : modèle morphable construit sur scans enregistrés, échelle mm ; licence recherche après signature (Univ. Bâle), licence commerciale négociable. Même usage : génération d'images avec PD synthétique connue.
- **Microsoft FaceSynthetics (« Fake It Till You Make It », ICCV 2021)** : **100 000 images** synthétiques photoréalistes avec **70 landmarks 2D (68 iBUG + 2 centres de pupilles)** et segmentation par pixel — précieux pour entraîner/évaluer la détection des centres pupillaires et du limbe. **Mais** : seules les images + annotations 2D sont distribuées (pas les paramètres caméra ni le maillage 3D), donc **pas d'échelle métrique exploitable** telle quelle. Licence : *Research Use of Data Agreement* — **recherche non commerciale uniquement** ([GitHub](https://github.com/microsoft/FaceSynthetics), [page projet](https://microsoft.github.io/FaceSynthetics/), [papier](https://www.microsoft.com/en-us/research/wp-content/uploads/2021/10/ICCV_2021_FaceSynthetics.pdf)).
- Recommandation : construire un **banc synthétique interne** (FLAME/BFM + moteur de rendu, intrinsèques réels des smartphones cibles, distances 25–60 cm, poses ±20°) pour cartographier l'erreur géométrique du pipeline avant toute validation humaine.

---

## 7. Exigences cliniques : quelle précision faut-il ? (question 6)

### 7.1 Tolérances normatives (verres montés)

- **ISO 21987:2017 « Optique ophtalmique — Verres montés »** ([iso.org](https://www.iso.org/standard/65161.html)) :
  - Verres **progressifs** : position du point de centrage/fitting point à **±1,0 mm** par œil, horizontalement et verticalement (le monoculaire !), différence verticale entre les deux verres ≤ 1,0 mm (§5.5.2.2 ; cf. analyse Optician/BS EN ISO 21987 : « manufacturing tolerance for PPL monocular centration is 1 mm regardless of power ») ([Optician, lens standards](http://assets.markallengroup.com/article-images/image-library/147/uploads/importedimages/lens-standard.pdf), [OptiBoard/CPD](https://www.opticianonline.net/cpd-archive/209)).
  - Verres **unifocaux/multifocaux** : tolérance exprimée en **imbalance prismatique** (Table 5), fonction de la puissance (colonnes ≤ 3,37 D / > 3,37 D) — pour les faibles puissances la tolérance en mm est donc plus lâche, pour les fortes puissances elle se resserre.
- **ANSI Z80.1** (équivalent US) : imbalance prismatique tolérée **0,67 Δ horizontal / 0,33 Δ vertical**, soit ≈ **2,5 mm** de décentrement horizontal cumulé et ≈ **1 mm** vertical pour des puissances usuelles ([Vision Council, ANSI Z80.1-2015 quick ref](https://thevisioncouncil.org/sites/default/files/ANSI%20Z80%201-2015_Quick%20Reference%20v2.pdf) ; [PMC10394263](https://pmc.ncbi.nlm.nih.gov/articles/PMC10394263/)).
- **ANSI Z80.17** (dispositifs de réfraction/mesure) : c'est la norme que cite 6over6/GlassesOn pour revendiquer « **PD à ±2 mm** » ([fiche GlassesOn](https://www.nowsecure.com/marc-app/glasseson-pupils-lenses-android/)).

### 7.2 Traduction clinique (règle de Prentice)

Prisme induit Δ = c(cm) × F(D) ([Optogrid, Prentice](https://www.optogrid.com/blog/prentices-rule-induced-prism/) ; [PMC10394263](https://pmc.ncbi.nlm.nih.gov/articles/PMC10394263/)) :
- Erreur de PD de **1 mm** sur un verre de −4,00 D ⇒ 0,4 Δ par œil ; en binoculaire (même sens) les effets horizontaux s'ajoutent → une erreur binoculaire de 2 mm à −4,00 D ≈ 0,8 Δ, au-delà de la tolérance ANSI (0,67 Δ).
- Verre de +3,00 D avec 1 mm d'erreur : 0,3 Δ/œil — significatif pour un progressif ([Optogrid, progressive errors](https://www.optogrid.com/blog/progressive-lens-fitting-errors/)).
- Seuils symptomatiques : imbalance **verticale > ~0,5 Δ** mal tolérée (flou, asthénopie, diplopie) ; l'horizontale est tolérée jusqu'à plusieurs Δ ([Frontiers Neurol. 2016](https://www.frontiersin.org/journals/neurology/articles/10.3389/fneur.2016.00062/full) ; [PMC10394263](https://pmc.ncbi.nlm.nih.gov/articles/PMC10394263/) : décentrement moyen 3,5 mm → 0,7 Δ, ~40 % de plaintes visuelles).
- Un décentrement de 2 mm peut réduire le champ binoculaire de ~25 % ([2020mag, digital centration CE](https://www.2020mag.com/ce/taking-the-measure-of-digital)).

### 7.3 Objectifs de précision qui en découlent

| Cas d'usage | Erreur PD totale acceptable | Justification |
|---|---|---|
| Unifocal faible puissance (|F| ≤ 3 D) | ≤ ±2 mm (binoculaire) | 0,6 Δ < tolérance ANSI 0,67 Δ ; cohérent avec la revendication GlassesOn ±2 mm |
| Unifocal forte puissance (> 6 D) | ≤ ±1 mm | Prentice : 1 mm = 0,6–0,8 Δ ; les études d'apps signalent l'échec sur fortes corrections |
| **Progressifs / PD monoculaire** | **≤ ±1 mm par œil** | ISO 21987 §5.5.2.2 (fitting point ±1 mm) ; couloirs de progression étroits (≥ 2 mm) |

### 7.4 Méthode statistique de référence

- **Bland–Altman (limites d'agrément)** est explicitement la méthode de choix en optométrie/ophtalmologie ; les coefficients de corrélation sont à proscrire pour l'agrément : **McAlinden, Khadka & Pesudovs, Ophthalmic Physiol Opt 2011** ([Wiley](https://onlinelibrary.wiley.com/doi/full/10.1111/j.1475-1313.2011.00851.x), [PubMed 21615445](https://pubmed.ncbi.nlm.nih.gov/21615445/)) ; clarification 2012 ([OPO](https://onlinelibrary.wiley.com/doi/10.1111/j.1475-1313.2012.00929.x)).
- Rapporter les **IC des limites d'agrément**, de préférence par la méthode exacte de **Carkeet** (Optom Vis Sci 2015, [Wiley](https://onlinelibrary.wiley.com/doi/abs/10.1097/OPX.0000000000000513) ; [Carkeet & Goh 2018](https://journals.sagepub.com/doi/10.1177/0962280216665419)) ; revue de pratique dans Optom Vis Sci 2020 ([PubMed 31895271](https://pubmed.ncbi.nlm.nih.gov/31895271/)).
- Tailles d'échantillon : les approximations de Bland-Altman sont trop permissives pour n < 40–76 ([BMC Med Res Methodol 2018](https://link.springer.com/article/10.1186/s12874-018-0505-y)) ; recommandation générique ≈ **50 sujets × 3 mesures répétées par méthode** ([Springer, J Clin Monit Comput 2022](https://link.springer.com/article/10.1007/s10877-022-00853-x)) ; calcul formel possible (α, β, différence attendue, bornes cliniques ±1 ou ±2 mm) via [Lu et al. 2016, PubMed 27838682](https://pubmed.ncbi.nlm.nih.gov/27838682/) / [MedCalc](https://www.medcalc.org/en/manual/sample-size-bland-altman.php) ; attentes FDA résumées par [Innolitics](https://innolitics.com/articles/bland-altman-sample-size-guide/).

---

## 8. Études de validation d'apps PD publiées : effectifs, protocoles, référence (question 7)

| Étude | N | Référence | Protocole | Résultats clés |
|---|---|---|---|---|
| **Han et al., Cureus 2023** ([PubMed 37529827](https://pubmed.ncbi.nlm.nih.gov/37529827/), [PMC10389117](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10389117/)) | **44 sujets** | **Pupillomètre numérique**, un seul examinateur entraîné | 3 apps (EyeMeasure, Warby Parker, PDCheck AR) ; MAE + fréquence dans des tolérances ±0,05 → ±1,00 mm | MAE 0,51 mm (EyeMeasure, Warby Parker) vs 1,38 mm (PDCheck) ; erreurs < 0,33 Δ pour myopies faibles/modérées ⇒ dans la tolérance ISO |
| **Harsono et al., J. Phys. Conf. Ser. 2243 (2022)** ([IOP PDF](https://iopscience.iop.org/article/10.1088/1742-6596/2243/1/012001/pdf)) | **39 étudiants, 19–22 ans** | **Auto-réfractomètre** (PD affichée) | 3 apps Android/iOS (Pupil Distance Meter Pro, Glassify Me, Ultimate PD Rule) ; Bland-Altman | Glassify Me : diff. moyenne 0,2 mm (p = 0,48 NS) ; autres apps : écarts 0,6 et 2,1 mm |
| **J. Optom. 2021 (Espagne)** ([ScienceDirect S1888429620301205](https://www.sciencedirect.com/science/article/pii/S1888429620301205)) | **30 sujets** | Manuel (règle) vs automatique, 2 sessions | Répétabilité inter-session + agrément | Diff. moyenne < 1 mm dans toutes conditions ; ~92 % des sujets dans ±2 mm en VP |
| **McMahon et al. 2012, « self-measurement »** ([PubMed 22581116](https://pubmed.ncbi.nlm.nih.gov/22581116/)) | Sujets non entraînés + examinateurs | **Pupillomètre** vs règle PD | Auto-mesure miroir + règle vs mesures pro | Examinateur (règle vs pupillomètre) : biais +0,59 mm, LoA −0,69/+1,88 mm ; répétabilité pupillomètre LoA −0,79/+0,73 mm ; règle −1,04/+1,20 mm ; **auto-mesure : LoA −3,61/+4,75 mm** |
| **Systèmes de centration vidéo pro** (Zeiss i.Terminal 2) | — | Affichage 0,1 mm ; thèse « Accuracy and precision of fitting measurements with the Zeiss i.Terminal 2 » ([NSU](https://digitallibrary.nsuok.edu/work/ns/b9779e7c-314b-491c-ba79-bf0ef756dbf8)) | Utilisé comme référence dans des validations académiques (n = 30, MAE/RMSE/Bland-Altman) | Référence « premium » alternative au pupillomètre |
| **GlassesOn / The Framery (6over6)** ([NowSecure](https://www.nowsecure.com/marc-app/glasseson-pupils-lenses-android/)) | Essais internes (non publiés) | — | Dispositif médical classe I (FDA/CE/TGA), adultes 18+, unifocal −6,00/+3,00 D | Revendication : **PD dans ±2 mm** (ANSI Z80.17) ; exclut progressifs et prismes |

**Erreur de l'instrument de référence lui-même** (à intégrer au budget d'erreur) : répétabilité d'un pupillomètre numérique σ < 0,3 mm / LoA ≈ ±0,76 mm ; règle PD en mains expertes : biais ~+0,6 mm vs pupillomètre, LoA ±1,3 mm ([PubMed 22581116](https://pubmed.ncbi.nlm.nih.gov/22581116/) ; [Optogrid, digital pupillometer](https://www.optogrid.com/blog/digital-pupillometer/)). ⇒ **le pupillomètre numérique est la référence à utiliser, pas la règle**, et sa répétabilité doit être mesurée et rapportée dans l'étude.

---

## 9. Protocole de validation recommandé

### 9.1 Échantillon
- **N ≥ 50 sujets** (cible 80–100 pour des IC serrés sur les LoA ; les approximations B-A sont fragiles sous n = 40–76 — cf. §7.4), recrutement stratifié :
  - PD : couvrir 54–74 mm avec sur-échantillonnage des queues (< 58, > 68 mm) — distribution de référence ANSUR/Dodgson (63,4 ± 3,8 mm) ;
  - phototypes/ethnies variés (le HVID moyen varie de ~11,1 à ~11,75 mm selon l'origine — biais d'échelle possible) ; port de lunettes/lentilles ; maquillage ; âges (si revendication enfants : cohorte pédiatrique dédiée, PD dès ~40 mm) ;
  - critères d'exclusion documentés (strabisme, nystagmus, chirurgie cornéenne pour le bras HVID).

### 9.2 Référence et mesures
- Référence : **pupillomètre numérique** (PD de loin ET monoculaires), **2 mesures × 2 opérateurs** → biais inter-opérateurs + répétabilité de la référence (Sw, LoA) rapportés.
- Optionnel « or » : colonne de centration vidéo (i.Terminal 2) sur un sous-échantillon ; pour la distance caméra-sujet : télémètre laser (pratique validée, cf. AppliedMath 2025).
- App/algorithme : **3 acquisitions par condition** ; conditions croisées = distance (25/40/60 cm), éclairage (intérieur faible/normal, extérieur), pose (frontal, ±10–20° yaw/pitch), appareil (2–3 modèles de smartphones aux intrinsèques différents). Enregistrer le taux d'échec d'acquisition (métrique à part entière).

### 9.3 Métriques (toutes en mm, PD binoculaire ET monoculaire)
1. **Biais** (erreur moyenne signée) + IC 95 % ;
2. **MAE** et **RMSE** ;
3. **P90 / P95 de l'erreur absolue** (lien direct avec « % de montages hors tolérance ») ;
4. **% dans ±0,5 / ±1,0 / ±2,0 mm** (seuils = ISO 21987 progressif ±1 mm ; ANSI ±2 mm unifocal) ;
5. **Bland–Altman** : biais, LoA 95 % = biais ± 1,96 σd, **IC exacts des LoA (Carkeet)**, inspection de la proportionnalité de l'erreur (pente vs moyenne — l'erreur d'échelle HVID est proportionnelle à la PD) ;
6. **Répétabilité** : Sw intra-sujet, coefficient de répétabilité 2,77·Sw (méthode McAlinden 2011) ; comparer à celle de la référence ;
7. Analyses en sous-groupes pré-spécifiées : PD extrême, ethnie, éclairage, appareil, distance.
- **Critère de succès suggéré** : |biais| ≤ 0,3 mm ; LoA 95 % ⊂ [−2 ; +2] mm (unifocal) ; P95 ≤ 1 mm pour revendication progressifs ; taux d'échec < 5 %.

### 9.4 Étapes amont (sans humains)
1. **Banc synthétique** FLAME/BFM (vérité exacte par construction) : erreur géométrique pure du pipeline (pose, distance, distorsion, intrinsèques) ;
2. **Rejeu sur scans 3D publics** (3DFN via demande FaceBase pour distances inter-canthales vraies ; Texas 3DFRD avec pixel = 0,32 mm ; FRGC/Bosphorus) : rendu 2D → mesure → comparaison aux distances 3D ;
3. **Validation distance-iris** sur EVE (origine 3D du regard calibrée) ou télémètre laser ;
4. Puis étude clinique §9.1–9.3, pré-enregistrée, rapportée selon les recommandations OPO (McAlinden 2011).

---

## 10. Sources principales

1. FaceBase 3D Facial Norms — https://www.facebase.org/resources/human/facial_norms/ ; Weinberg et al. 2016 — https://pmc.ncbi.nlm.nih.gov/articles/PMC4841760/ ; https://pubmed.ncbi.nlm.nih.gov/26492185/
2. FaceScape — https://nju-3dv.github.io/projects/FaceScape/ ; https://github.com/zhuhao-nju/facescape ; https://arxiv.org/abs/2111.01082
3. Headspace / LYHM — https://www-users.york.ac.uk/~np7/research/Headspace/ ; https://www-users.york.ac.uk/~np7/research/LYHM/LYHMagreement08.pdf ; Dai et al., IJCV 2020 — https://link.springer.com/article/10.1007/s11263-019-01260-7
4. BU-3DFE / FRGC v2 / Bosphorus (synthèse) — https://arxiv.org/pdf/2010.08391v1 ; Bosphorus — https://academics.boun.edu.tr/bulent.sankur/sites/bulent.sankur/files/inline-files/Conf_BIOID_Bosporus.pdf
5. FLAME-Universe (CoMA, D3DFACS, FaMoS, NoW, licences) — https://github.com/TimoBolkart/FLAME-Universe
6. Florence 2D/3D — https://www.micc.unifi.it/resources/datasets/florence-3d-faces/ ; Texas 3DFRD — https://github.com/blancaag/face-datasets/blob/master/3D/README.md
7. MeGlass — https://github.com/cleardusk/MeGlass
8. ANSUR / Dodgson 2004 — http://www.neildodgson.com/pubs/EI5291A-05.pdf
9. HVID/WTW : PLOS ONE 2021 — https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0254832 ; PubMed 25325762 ; Sci Rep 2023 (échelle par HVID) — https://pmc.ncbi.nlm.nih.gov/articles/PMC10447546/
10. IRISSEG-EP — https://github.com/HalmstadUniversityBiometrics/Iris-Segmentation-Groundtruth-Database ; ND-IRIS-0405 — https://www.researchgate.net/publication/241404880_The_ND-IRIS-0405_Iris_Image_Dataset
11. GazeCapture — https://gazecapture.csail.mit.edu/ ; https://github.com/CSAILVision/GazeCapture/blob/master/LICENSE.md ; EVE — https://github.com/swook/EVE/blob/master/DATASET.md
12. FaceSynthetics — https://github.com/microsoft/FaceSynthetics ; https://microsoft.github.io/FaceSynthetics/
13. ISO 21987:2017 — https://www.iso.org/standard/65161.html ; analyse Optician — http://assets.markallengroup.com/article-images/image-library/147/uploads/importedimages/lens-standard.pdf ; ANSI Z80.1 quick ref — https://thevisioncouncil.org/sites/default/files/ANSI%20Z80%201-2015_Quick%20Reference%20v2.pdf
14. Prentice / prismes : https://pmc.ncbi.nlm.nih.gov/articles/PMC10394263/ ; https://www.frontiersin.org/journals/neurology/articles/10.3389/fneur.2016.00062/full ; https://www.optogrid.com/blog/prentices-rule-induced-prism/
15. Bland–Altman en optométrie : McAlinden et al. 2011 — https://onlinelibrary.wiley.com/doi/full/10.1111/j.1475-1313.2011.00851.x ; Carkeet 2015 — https://onlinelibrary.wiley.com/doi/abs/10.1097/OPX.0000000000000513 ; tailles d'échantillon — https://pubmed.ncbi.nlm.nih.gov/27838682/ ; https://link.springer.com/article/10.1186/s12874-018-0505-y ; https://www.medcalc.org/en/manual/sample-size-bland-altman.php
16. Validations d'apps PD : Cureus 2023 — https://pubmed.ncbi.nlm.nih.gov/37529827/ ; J. Phys. Conf. Ser. 2022 — https://iopscience.iop.org/article/10.1088/1742-6596/2243/1/012001/pdf ; J. Optom. 2021 — https://www.sciencedirect.com/science/article/pii/S1888429620301205 ; auto-mesure — https://pubmed.ncbi.nlm.nih.gov/22581116/ ; Clin. Optom. 2024 — https://www.dovepress.com/a-comparative-analysis-of-interpupillary-distance-measurement-techniqu-peer-reviewed-fulltext-article-OPTO ; GlassesOn — https://www.nowsecure.com/marc-app/glasseson-pupils-lenses-android/
17. Distance par IPD statistique + télémètre laser — https://doi.org/10.3390/appliedmath5030118 ; PD par vision — https://www.mdpi.com/2076-3417/13/15/8628

*Notes de fiabilité : les valeurs exactes de la Table 5 d'ISO 21987 (imbalance prismatique par classe de puissance) n'ont pas pu être citées chiffre à chiffre (texte normatif payant, accès proxy bloqué) — la structure (colonnes ≤ 3,37 D / > 3,37 D) et le ±1 mm progressif sont confirmés par des sources secondaires professionnelles. La résolution 0,32 mm/pixel du Texas 3DFRD provient de la documentation du dataset relayée par des dépôts tiers ; à reconfirmer sur la page UT Austin (live.ece.utexas.edu) avant citation formelle.*
