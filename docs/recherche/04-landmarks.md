# Précision et stabilité des modèles de landmarks visage/iris pour la mesure MÉTRIQUE dans le navigateur
## MediaPipe FaceLandmarker vs alternatives — Revue de littérature (août 2026)

> Contexte : mesure métrique (PD, cotes de monture) à partir d'une webcam dans le navigateur. Toutes les affirmations sont sourcées. Les erreurs « NME/IOD MAE » sont normalisées par la distance inter-oculaire (IOD ≈ 60–65 mm chez l'adulte) : **1 % IOD ≈ 0,6 mm** en ordre de grandeur.

---

## 1. MediaPipe FaceMesh / FaceLandmarker (468/478 points) — précision publiée

### 1.1 Papiers Google

**Kartynnik et al. 2019, « Real-time Facial Surface Geometry from Monocular Video on Mobile GPUs »** ([arXiv:1907.06724](https://arxiv.org/abs/1907.06724)) :
- Maillage de **468 sommets 3D**, prédit par un CNN type MobileNetV2 sur un crop 256×256 (192×192 pour la version légère).
- Métrique : **MAD (mean absolute distance) normalisée par l'IOD** (distance entre centres des yeux). Le z n'est PAS évalué (obtenu par données synthétiques) ; seule la 2D est comparée aux annotations humaines.
- **Plancher d'ambiguïté humaine : 2,56 % IOD MAD**, mesuré entre 11 annotateurs entraînés sur 58 images. Autrement dit, même des humains ne s'accordent qu'à ~1,6 mm près par point : c'est la limite basse de ce que « précis » veut dire pour ce type de maillage.

**Grishchenko et al. 2020, « Attention Mesh: High-fidelity Face Mesh Prediction in Real-time »** ([arXiv:2006.10962](https://arxiv.org/abs/2006.10962), résumé chiffré chez [DeepAI](https://deepai.org/publication/attention-mesh-high-fidelity-face-mesh-prediction-in-real-time) et [EmergentMind](https://www.emergentmind.com/topics/mediapipe-face-mesh)) :
- Architecture unifiée avec sous-modèles d'attention 64×64 sur les yeux et la bouche.
- **NME global : 3,11 % (Attention Mesh) vs 2,99 % (cascade)**, mais **région des yeux : 6,04 % vs 6,28 %** (l'attention améliore les yeux) — noter que l'erreur dans la région oculaire est ~2× l'erreur moyenne du maillage.
- **>50 FPS sur Pixel 2**, latence réduite de 25–30 % vs la cascade.

**MediaPipe Iris 2020** (blog Google Research, [« MediaPipe Iris: Real-time Iris Tracking & Depth Estimation »](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/) ; papier [« Real-time Pupil Tracking from Monocular Video for Digital Puppetry », arXiv:2006.11341](https://arxiv.org/abs/2006.11341)) :
- Sous-modèle prédisant **5 points d'iris par œil** (centre pupille + 4 points du cercle irien) + 16 points de contour d'œil ([doc officielle iris.md](https://github.com/google/mediapipe/blob/master/docs/solutions/iris.md)).
- **Estimation de distance sujet–caméra par la taille de l'iris : erreur relative moyenne 4,3 %, écart-type 2,4 %** ; revendication générale « distance métrique avec <10 % d'erreur sans capteur de profondeur ».
- Hypothèse clé : **diamètre horizontal de l'iris ≈ constant, 11,7 ± 0,5 mm** dans la population.
- Validation : comparaison au capteur de profondeur de l'iPhone 11 sur **>200 participants**, capteur de référence lui-même précis à **<2 % jusqu'à 2 m**.

### 1.2 Model Card officielle (Face Mesh V2 / FaceLandmarker, 478 points, 15/09/2022)

Source primaire : [Model Card MediaPipe Face Mesh V2 (PDF)](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf) — texte intégral extrait :

| Évaluation | IOD MAE (mode tracking) | IOD MAE (réacquisition, 1ʳᵉ frame) |
|---|---|---|
| **Total (1700 selfies, 17 sous-régions ONU)** | **2,62 % (σ 1,03)** | **3,24 % (σ 1,29)** |
| Meilleure région (Mélanésie/Micronésie/Polynésie) | 2,06 % | 2,76 % |
| Pire région (Amérique centrale) | 3,27 % | 3,85 % |
| Genre (H / F) | 2,61 % / 2,62 % | 3,25 % / 3,24 % |
| Peau Fitzpatrick 1→6 | 2,90 / 2,64 / 2,68 / 2,55 / 2,49 / 2,77 % | 3,75 / 3,27 / 3,33 / 3,13 / 3,09 / 3,48 % |

- La version 09/2022 (celle du FaceLandmarker actuel) est passée de **2,88 → 2,76 % IOD MAE** et a ajouté les **10 landmarks d'iris** (468→478).
- **Interprétation métrique** : 2,62 % IOD ≈ **~1,6 mm d'erreur moyenne par landmark** pour une IOD de 63 mm — et c'est une erreur *moyenne sur tout le maillage*, en *tracking* (le mode le plus favorable). Le mode réacquisition (première frame) est ~25 % pire.
- **Limites déclarées** : visage tourné >80° par rapport à la caméra, roulis >8°, visage visible <50 %, visage trop loin → hors domaine. La carte avertit explicitement d'un **« jittering » (bruit inter-frames)** accru en basse lumière/bruit/mouvement.
- Équité : écart max inter-régions 1,21 pt (tracking), inter-teints 0,41 pt — jugé conforme à leur critère (2,56 % = désaccord humain). Un ticket GitHub rapporte néanmoins ~**1–1,25 % d'écart de précision/rappel** de la chaîne complète pour les visages africains à peau foncée ([issue #3645](https://github.com/google-ai-edge/mediapipe/issues/3645)).

### 1.3 Évaluations indépendantes

- **Contexte chirurgical** ([arXiv:2507.18248](https://arxiv.org/abs/2507.18248), 2025) : MediaPipe robuste en nombre de points, mais éclairage et angles de tête identifiés comme facteurs majeurs de dégradation.
- **Pose de tête clinique** ([Evaluation of SOTA Head Pose Estimation Algorithms for Clinical Scenarios, 2022](https://www.researchgate.net/publication/363526243_Evaluation_of_Various_State_of_the_Art_Head_Pose_Estimation_Algorithms_for_Clinical_Scenarios)) : erreur moyenne d'angle de tête **11,0° pour MediaPipe vs ≤5,6° pour 3DDFA_V2** (OpenFace 2.0 : 14,1°). Les auteurs recommandent 3DDFA_V2 quand le patient bouge — la pose estimée par MediaPipe est donc à utiliser comme *gate* qualitatif, pas comme mesure.
- Un survey ([EmergentMind, synthèse](https://www.emergentmind.com/topics/mediapipe-face-mesh)) rapporte un **NME ≈ 3,12 sur 300W** pour Face Mesh, comparable à 3DDFA et meilleur que Dlib/FAN classiques (à prendre avec prudence : protocole de conversion 468→68 points non standardisé).
- **Jitter** : pas de benchmark officiel ; plainte utilisateurs documentée ([issue #3495 « How can I get More Temporally Stable Face Landmarks!? »](https://github.com/google/mediapipe/issues/3495)). En pratique la littérature applicative post-filtre MediaPipe (Kalman + OPTICS, One-Euro) pour stabiliser ([Towards Stabilizing Facial Landmark Detection and Tracking](https://www.sciencedirect.com/science/article/abs/pii/S0016003219309561)). Dans une évaluation pour la langue des signes, MediaPipe a obtenu **le plus faible jitter médian (J_jerk = 2,46)** parmi les systèmes testés, mais avec des distributions largement recouvrantes ([arXiv:2604.24609](https://arxiv.org/pdf/2604.24609)).
- **Lunettes/occlusion** : MediaPipe prédit *toujours* tous les points, occlus ou non, sans score d'occlusion par point ([issue #3008 — même problème documenté côté mains](https://github.com/google-ai-edge/mediapipe/issues/3008)) ; les montures épaisses dégradent silencieusement les points d'yeux, sans signal d'alerte exploitable.

---

## 2. La revendication « iris ~4,3 % » et ses implications pour l'échelle métrique

Vérification du chiffre exact : le **4,3 % (σ 2,4 %) est l'erreur relative moyenne de l'estimation de DISTANCE par la taille d'iris**, pas l'erreur de localisation du landmark ([blog Google Research](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/), repris dans [iris.md](https://github.com/google/mediapipe/blob/master/docs/solutions/iris.md) : « relative error less than 10% »). L'erreur de *landmark* d'iris n'est pas publiée séparément en % du diamètre irien dans le blog ; le papier pupille (arXiv:2006.11341) renvoie à sa Table 1 sans chiffre public largement cité.

**Conséquence pour un facteur d'échelle mm/pixel basé sur l'iris** (PD = distance_pupilles_px × 11,7 / diamètre_iris_px) :

1. **Variabilité biologique** : le diamètre cornéen « white-to-white » vaut 11,65 ± 0,36 mm ([étude population adulte, ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2452232515000025)), 11,80 mm (plage normale 10,8–12,8 mm à ±2σ) ([Orbscan II, population iranienne](https://pubmed.ncbi.nlm.nih.gov/24790875/)), 11,95 ± 0,39 mm (Arabie saoudite, [PMC11970417](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11970417/)), 11,65 ± 0,38 mm (myopes chinois, [PMC8639187](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8639187/)). **±1σ ≈ ±3–4 %, et biais inter-populations ~0,3 mm (≈2,5 %)**.
2. Donc, même avec des landmarks d'iris *parfaits*, une échelle iris donne **~4,3 % d'erreur moyenne** → sur une PD de 63 mm, **≈ ±2,7 mm en moyenne**, et jusqu'à ±6 mm à 2σ. À comparer à la tolérance optique usuelle (~1 mm sur la PD) et aux applis dédiées : Eye Measure / Warby Parker atteignent **MAE 0,51 mm** sur la PD (vs pupillomètre numérique, n = 44) parce qu'elles utilisent le TrueDepth/objet de référence, PDCheck AR : 1,375 mm ([Cureus/PMC10389117](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10389117/)).
3. **Verdict** : l'iris est un excellent *point* (petit, contrasté, quasi-circulaire, stable en rotation), mais un mauvais *étalon métrique*. Pour la mesure, il faut une référence externe (carte ISO/IEC 7810 au front — pratique documentée, [brevet US12108988](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12108988) et outils type [EndMyopia PD tool](https://start.endmyopia.org/tools/pupillary-distance)) ou un capteur de profondeur.

---

## 3. Alternatives avec benchmarks publiés (NME, % de l'IOD ou de la diagonale bbox)

| Modèle | NME 300W full (68 pts) | NME WFLW full (98 pts) | NME COFW | Notes |
|---|---|---|---|---|
| FAN (Bulat & Tzimiropoulos, ICCV 2017, [arXiv:1703.07332](https://arxiv.org/abs/1703.07332)) | ~ sature les datasets 2D de l'époque | — | — | Hourglass ; référence historique 2D/3D, LS3D-W (230k images 3D) |
| HRNet ([SD-HRNet, PMC9919355](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9919355/)) | ~3,32 | ~4,60 | 3,45 | lourd (HRNetV2-W18 ~9,7M params) |
| PIPNet ([arXiv:2003.03771](https://arxiv.org/abs/2003.03771)) | ~3,19 (R101) | ~4,31 (R101) | **3,18** (meilleur COFW rapporté par [Lite-HRNet Plus](https://arxiv.org/pdf/2308.12133)) | **35,7 FPS CPU / 200 FPS GPU** (version légère) |
| ADNet (ICCV 2021, [arXiv:2109.05721](https://arxiv.org/abs/2109.05721)) | 2,93 | 4,14 | 4,68 | loss anisotrope le long de la normale au contour |
| SLPT (CVPR 2022, [arXiv:2203.06541](https://arxiv.org/abs/2203.06541)) | — | 4,14 | — | transformer à patchs locaux |
| SPIGA (BMVC 2022, [GitHub](https://github.com/andresprados/SPIGA)) | top 300W/COFW-68/MERL-RAV | **4,14** ([PapersWithCode](https://paperswithcode.com/paper/shape-preserving-facial-landmarks-with-graph)) | top COFW-68 | CNN+GNN + headpose ; **licence BSD-3-Clause** ; GPU requis |
| **STAR Loss (CVPR 2023, [GitHub](https://github.com/ZhenglinZhou/STAR), [arXiv:2306.02763](https://arxiv.org/abs/2306.02763))** | **2,87** (2,52 common / 4,32 challenging) | **4,02** | 4,62 | SOTA 2023, traite l'ambiguïté sémantique |
| LDEQ + RwR (CVPR 2023, [OpenAccess](https://openaccess.thecvf.com/content/CVPR2023/html/Micaelli_Recurrence_Without_Recurrence_Stable_Video_Landmark_Detection_With_Deep_Equilibrium_CVPR_2023_paper.html)) | — | **3,92** | — | SOTA WFLW + **métrique de flicker NMF** et dataset vidéo WFLW-V |
| InsightFace 2d106det ([doc](https://github.com/deepinsight/insightface/blob/master/alignment/coordinate_reg/README.md)) | pas de NME publié comparable | — | — | 106 pts, régression directe rapide ; **modèles non-commerciaux** |
| OpenSeeFace ([GitHub](https://github.com/emilianavt/OpenSeeFace)) | pas de NME publié | — | — | 66 pts, MobileNetV3, optimisé avatar/VTuber, pas fidélité géométrique ; **BSD-2** |
| MediaPipe FaceLandmarker (rappel) | ~3,12 (300W, non officiel) | — | — | 478 pts **dont 10 iris** ; IOD MAE 2,62 % sur son propre jeu |
| Apple ARKit + TrueDepth (hors web) | — | — | — | nuage de points : σ **0,29→0,74 mm** entre 175 et 450 mm de distance ([Springer 2025](https://link.springer.com/article/10.1007/s00170-025-15968-z)) ; base des applis PD à 0,5 mm |

**Qui localise le mieux la région des yeux ?** Les 98 points WFLW incluent les contours d'yeux ; STAR/LDEQ/SPIGA sont les plus précis sur ce protocole. Mais **aucun des modèles académiques (FAN, HRNet, PIPNet, ADNet, SLPT, SPIGA, STAR, LDEQ) ne fournit de landmarks d'iris/pupille** — seuls MediaPipe (478 pts), ARKit (native iOS) et les détecteurs de pupille spécialisés (§4) en ont. Or pour la PD, c'est le **centre pupillaire** qu'il faut, pas le canthus.

**Reconstruction métrique 3D** : MICA (ECCV 2022, [arXiv:2204.06607](https://arxiv.org/abs/2204.06607)) reconstruit un visage *métrique* (erreur réduite de 15–24 % vs SOTA sur NoW/benchmark métrique) — piste recherche intéressante, mais réseau lourd (ArcFace backbone), pas web-temps réel, licence non-commerciale (dépend d'ArcFace/FLAME).

---

## 4. Détecteurs d'iris/pupille spécialisés

- **PuRe** ([arXiv:1712.08900](https://arxiv.org/abs/1712.08900)) : détection de pupille algorithmique temps réel, **72,02 % de détection à ±5 px** sur les benchmarks agrégés (ExCuSe/ElSe/PupilNet) — meilleur que tous les concurrents algorithmiques.
- **DeepVOG** ([ResearchGate](https://www.researchgate.net/publication/334131613_DeepVOG_Open-source_pupil_segmentation_and_gaze_estimation_in_neuroscience_using_deep_learning)) : segmentation pupille U-Net, **précision médiane ~1,0 px sur le centre pupillaire**, gaze ~0,5°.
- **EllSeg** ([arXiv:2007.09600](https://arxiv.org/abs/2007.09600)) / **RITnet** : segmentation d'ellipse complète (pupille+iris+sclère), robustes aux occlusions ; RITnet/DenseElNet à <2 % d'écart sur OpenEDS.
- **Segmentation d'iris SOTA (2024-2025)** : IoU **95,9 %** (modèle clinique iris+sourcil, [PMC12561859](https://pmc.ncbi.nlm.nih.gov/articles/PMC12561859/)) ; U-Net VGG16 IoU 96,8 % (iris bovin, [PMC11007464](https://pmc.ncbi.nlm.nih.gov/articles/PMC11007464/)). Mesures de limbe automatisées : MAPE ~4,0 %.

**MAIS** : tous ces modèles sont entraînés sur des images **infrarouges rapprochées d'eye-trackers** (têtes montées, VR) ou des photos cliniques à fort grossissement — pas sur des webcams RGB à 40–60 cm où l'iris fait 15–30 px. Aucun n'a de portage web officiel (PyTorch/ONNX exportable en théorie via onnxruntime-web, effort d'ingénierie + domain gap). **Sur webcam RGB, le sous-modèle iris de MediaPipe reste l'option pratique de référence.**

---

## 5. Stabilité sémantique : le problème du « landmark sliding »

- **Ambiguïté sémantique des contours** : les points de contour de mâchoire/joues n'ont **pas de définition anatomique** — ils sont annotés « équirépartis le long du contour » et glissent librement le long de celui-ci ; c'est démontré et quantifié par **STAR Loss (CVPR 2023)** ([arXiv:2306.02763](https://arxiv.org/abs/2306.02763)) : la variance d'annotation est fortement **anisotrope, maximale le long de la tangente au contour**. ADNet ([arXiv:2109.05721](https://arxiv.org/abs/2109.05721)) exploite la même observation (erreur biaisée le long de la normale vs tangente). Voir aussi « Semantic Alignment » ([arXiv:1903.10661](https://arxiv.org/abs/1903.10661)).
- **Auto-occlusion en yaw** : deux conventions existent — landmarks « visibles » qui glissent sur la silhouette (annotations 2D type 300W/WFLW) vs landmarks 3D fixes projetés (300W-LP, AFLW2000-3D, LS3D-W de FAN, [arXiv:1703.07332](https://arxiv.org/abs/1703.07332) ; Disney « Continuous Landmark Detection with 3D Queries », [supplément](https://assets.studios.disneyresearch.com/app/uploads/2023/10/Continuous-Landmark-Detection-with-3D-Queries-Supp-Mat.pdf)). MediaPipe appartient à la seconde famille (topologie 3D fixe), ce qui limite le glissement — au prix d'un z synthétique non évalué (model card).
- **Hiérarchie de stabilité anatomique** (consensus de la littérature ci-dessus) : **canthi internes/externes, centre pupillaire/iris, pointe et racine du nez, commissures des lèvres = stables** (définition anatomique ponctuelle) ; **contour mandibulaire, ligne des sourcils, joues = instables** (glissement + auto-occlusion). Pour la mesure métrique, ne dériver les cotes que des points de la première catégorie.

---

## 6. Stabilité temporelle / jitter en vidéo

- **LDEQ + « Recurrence without Recurrence » (CVPR 2023)** : première formalisation récente avec la métrique **NMF (Normalized Mean Flicker)** et le dataset vidéo **WFLW-V (1000 vidéos)** ; améliore NME de 10 % et NMF de 13 % sur le sous-ensemble difficile par rapport au meilleur modèle + filtre classique réglé à la main ([OpenAccess CVPR](https://openaccess.thecvf.com/content/CVPR2023/html/Micaelli_Recurrence_Without_Recurrence_Stable_Video_Landmark_Detection_With_Deep_Equilibrium_CVPR_2023_paper.html)).
- Benchmark historique : **300VW** (114 vidéos, 3 catégories de difficulté), évalué en AUC/failure rate ([arXiv:1811.00342](https://arxiv.org/abs/1811.00342)).
- **Lissage** : le standard de facto est le **filtre 1€ (One-Euro, Casiez et al., CHI 2012)** — passe-bas à fréquence de coupure adaptative à la vitesse : peu de jitter à basse vitesse, peu de lag à haute vitesse ([ACM DL](https://dl.acm.org/doi/10.1145/2207676.2208639), [PDF auteur](https://gery.casiez.net/publications/CHI2012-casiez.pdf)). MediaPipe l'utilise en interne sur ses landmarks ([EmergentMind](https://www.emergentmind.com/topics/mediapipe-face-mesh)). Alternatives : filtrage hiérarchique global+local ([Information Sciences 2020](https://www.sciencedirect.com/science/article/abs/pii/S0016003219309561)), Kalman+OPTICS (littérature clinique), 1DFormer ([arXiv:2311.00241](https://arxiv.org/abs/2311.00241)).
- **Implication mesure** : le jitter étant ~zéro-moyenne, la **médiane/moyenne sur 30–100 frames en pose contrôlée** élimine l'essentiel de la variance temporelle ; elle n'élimine PAS le biais systématique (pose, monture, échelle iris).

---

## 7. Déployabilité web/mobile, tailles, licences

| Modèle | Taille (vérifiée) | Runtime web | Licence |
|---|---|---|---|
| MediaPipe FaceLandmarker (`face_landmarker.task`) | **3,76 Mo** (float16, mesuré : 3 758 596 o) | **tasks-vision officiel : WASM + WebGL/WebGPU**, API JS ([guide web](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)) | **Apache 2.0, modèles inclus** ([LICENSE](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE), [FAQ commerciale](https://quickpose.ai/faqs/can-mediapipe-be-used-commercially/)) |
| FaceMesh attention (`face_landmark_with_attention.tflite`) | 2,50 Mo | TFJS `face-landmarks-detection` (WASM/WebGL) ([tfjs-models](https://github.com/tensorflow/tfjs-models/tree/master/face-landmarks-detection)) | Apache 2.0 |
| Iris standalone (`iris_landmark.tflite`) | 2,64 Mo | TFJS (2020) | Apache 2.0 |
| InsightFace 106 pts | ~5 Mo (ONNX) | onnxruntime-web possible | code MIT/Apache mais **modèles pré-entraînés : recherche non commerciale uniquement** ([README](https://github.com/deepinsight/insightface)) |
| SPIGA | ~150 Mo+ (CNN+GNN) | non (PyTorch, GPU) | BSD-3-Clause ([repo](https://github.com/andresprados/SPIGA)) |
| PIPNet | 45–170 Mo (R18/R101) | ONNX possible ([pipnet-onnx](https://github.com/yakhyo/pipnet-onnx)) ; 35,7 FPS CPU desktop | licence non précisée dans le repo (à clarifier avant usage commercial) |
| STAR / ADNet / SLPT / LDEQ | >100 Mo, GPU | non portés web | codes recherche, licences variées |
| OpenSeeFace | qq Mo (ONNX MobileNetV3) | conçu pour desktop/Unity (UDP), pas de build web | **BSD-2-Clause** ([repo](https://github.com/emilianavt/OpenSeeFace)) |
| ARKit/TrueDepth | natif iOS | **non web** | propriétaire Apple |

Performance navigateur : Google ne publie que des latences mobiles (Pixel 6) pour FaceLandmarker et « >50 FPS Pixel 2 » pour Attention Mesh ; les retours d'implémentation web rapportent du temps réel (30–60 FPS) en WebGL/WebGPU sur laptop et haut-de-gamme mobile, la résolution d'entrée étant le levier principal ([guide web officiel](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js), [tutoriels](https://medium.com/@kenzic/real-time-face-tracking-in-the-browser-with-mediapipe-7c818c96b4ca)). Aucun modèle académique SOTA n'a de runtime web maintenu.

---

## 8. Enfants et diversité ethnique

- **Enfants** : la model card MediaPipe **ne mentionne aucune évaluation par âge**. La littérature montre que les modèles adultes se dégradent sur nourrissons/enfants : datasets dédiés créés exprès — **InfAnFace** (410 images de nourrissons, 68 pts) et **NeoLoc-68** néonatal ([arXiv:2606.20823](https://arxiv.org/html/2606.20823v1)) ; le fine-tuning avec augmentation de rotation est nécessaire pour combler l'écart. Études ASD pédiatriques (5–9 ans) utilisent MediaPipe **sans validation métrique** ([MDPI Computers 2026](https://www.mdpi.com/2073-431X/15/2/124)). Une étude empirique sur personnes âgées démentes montre que « plus de données » ne suffit pas à corriger les biais d'âge ([arXiv:1905.07446](https://arxiv.org/abs/1905.07446)). ⚠️ En plus, l'étalon iris 11,7 mm est un chiffre **adulte** ; prudence pour les montures enfants.
- **Diversité** : la model card V2 montre un écart teint de peau faible (2,49–2,90 % IOD MAE, cf. §1.2), mais la *détection* amont (BlazeFace) présente ~1–1,25 % d'écart précision/rappel pour les visages africains foncés ([issue #3645](https://github.com/google-ai-edge/mediapipe/issues/3645)). En pupillométrie, le contraste iris/pupille est plus faible pour les iris foncés — la littérature smartphone contourne par le spectre rouge lointain ([Scientific Reports 2023](https://www.nature.com/articles/s41598-023-40796-0)) ; pour la *délimitation du limbe* (notre cas), l'effet est moindre que pour la pupille, mais mérite un test interne sur iris très foncés.

---

## 9. Tableau comparatif final

| Modèle | Points | Iris ? | Benchmarks NME | Stabilité temporelle | Runtime web | Licence | Verdict usage métrique |
|---|---|---|---|---|---|---|---|
| **MediaPipe FaceLandmarker** | 478 (3D) | **Oui (2×5)** | 2,62 % IOD MAE (interne) ; ~3,1 sur 300W (non officiel) ; yeux ~6 % IOD (papier) | filtre intégré ; jitter documenté en conditions dégradées | **Oui, officiel (WASM/GPU), 3,76 Mo** | **Apache 2.0** | ✅ seul candidat web complet ; échelle iris à proscrire, moyenner les frames |
| STAR Loss | 68/98 | Non | **2,87 / 4,02 / 4,62** (300W/WFLW/COFW) | non traité | Non | recherche | précision contours SOTA mais inutilisable web, pas d'iris |
| LDEQ+RwR | 98 | Non | **3,92 WFLW** + NMF flicker | **SOTA stabilité vidéo** | Non | recherche | référence conceptuelle anti-jitter |
| SPIGA | 68/98 | Non | 4,14 WFLW, top COFW-68 | tracker vidéo fourni | Non (GPU) | BSD-3 | bon serveur-side éventuel |
| PIPNet | 68/98 | Non | ~3,19/4,31/3,18 | non traité | ONNX possible | non précisée | léger, mais pas d'iris ni de web officiel |
| InsightFace 106 | 106 | Non | pas de benchmark public comparable | non traité | onnxruntime-web | ⚠️ **modèles non commerciaux** | exclu pour un produit |
| OpenSeeFace | 66 | Non | non publié | bonne (optimisé animation) | Non | BSD-2 | optimisé avatar, pas mesure |
| FAN | 68 (2D/3D) | Non | sature 300W (2017) | non | trop lourd | recherche | dépassé |
| Pupille spécialisés (PuRe/DeepVOG/EllSeg) | pupille/iris | **Oui** | ~1 px centre pupille (IR rapproché) | bonne (conçus tracking) | Non (domain gap webcam RGB) | libres divers | pas transposables webcam sans réentraînement |
| ARKit/TrueDepth | maillage dense | Oui (gaze) | σ 0,3–0,7 mm (nuage de points) | excellente | **Non web** | Apple | l'étalon-or mobile natif, hors périmètre navigateur |

---

## 10. Recommandations pour la mesure métrique en navigateur

1. **Garder MediaPipe FaceLandmarker** : unique modèle avec iris, runtime web officiel, 3,76 Mo, Apache 2.0, équité documentée. Aucune alternative web-déployable ne le domine.
2. **Ne jamais utiliser l'iris comme étalon d'échelle** pour des cotes à ±1 mm : erreur moyenne ~4,3 % (≈2,7 mm sur une PD) due à la variabilité biologique de 11,7±0,5 mm. Utiliser une carte ISO 7810 plaquée au front (même plan que les pupilles) ou toute référence de taille connue.
3. **Budget d'erreur réaliste** : erreur landmark moyenne ~2,6 % IOD (~1,6 mm) par point en tracking ; les distances entre points quasi-frontaux (PD via centres d'iris) sont meilleures que la moyenne (points « stables »), mais viser <1 mm exige : pose frontale contrôlée (yaw/pitch < ~10°), agrégation médiane sur ≥30 frames, rejet des frames à forte vitesse/clignement.
4. **N'utiliser que des landmarks anatomiquement stables** (centres d'iris, canthi, nez) — jamais l'ovale du visage ni les contours de joues pour des largeurs de monture (landmark sliding démontré par STAR/ADNet).
5. **Lissage** : One-Euro sur l'affichage, mais **médiane multi-frames sur la mesure** (le filtre réduit le jitter, pas le biais).
6. **Gates qualité** : la pose MediaPipe est imprécise (~11° d'erreur) — l'utiliser comme seuil grossier, pas comme correction fine ; détecter les lunettes portées (biais silencieux sur les points d'yeux) et demander la mesure sans lunettes.
7. **Enfants** : aucune validation publiée de MediaPipe sur enfants + étalon iris adulte inapplicable → exiger la référence carte et valider en interne sur une cohorte pédiatrique avant toute promesse de précision.
