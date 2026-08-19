# Anthropométrie craniofaciale pour la récupération d'échelle absolue du visage (webcam → lunetterie)

**Objet** : statistiques de population, corrélations et a priori multivariés utilisables pour estimer l'échelle absolue du visage (PD vrai en mm) à partir d'une webcam, pour l'ajustement de montures.
**Date** : 2026-08-19. **Méthode** : revue web (≈20 recherches) + **calculs originaux sur les données brutes publiques ANSUR II** (N = 6 068, téléchargées et analysées localement ; script `ansur_stats.py` dans ce dossier).

**Convention** : PD = distance interpupillaire (interpupillary distance, IPD) ; HVID = diamètre horizontal d'iris visible (≈ white-to-white, WTW) ; en-en = largeur intercanthale interne ; ex-ex = largeur bioculaire (canthi externes) ; al-al = largeur nasale ; zy-zy = largeur bizygomatique ; eu-eu = largeur de tête.

---

## 1. Références classiques : normes de Farkas et pédiatrie

### 1.1 Adultes nord-américains caucasiens (NAW), Farkas 1994

Valeurs de l'atlas de Farkas (*Anthropometry of the Head and Face*, 2e éd., Raven Press 1994), telles que reprises dans la littérature secondaire (les tables complètes ne sont pas en accès libre ; l'ouvrage est consultable sur [archive.org](https://archive.org/details/anthropometryofh0000unse)) :

| Mesure | Hommes (mm) | Femmes (mm) | Statut de la source |
|---|---|---|---|
| en-en (intercanthale) | ≈ 33 ± 2,7 | ≈ 32 ± 2,4 | ordre de grandeur classiquement cité ; plage normale caucasienne 30–35 mm confirmée ([Pocket Dentistry](https://pocketdentistry.com/evaluation-of-the-face/), [cibtech](https://www.cibtech.org/J-Bio-Protocols/PUBLICATIONS/2017/VOL-6-NO-2/01-CJBP-001-Ezejindu-Anthropometric-State.pdf)) |
| ex-ex (bioculaire) | **89,4** | **86,8** | confirmé via données de croissance Farkas ([PubMed 1643059](https://pubmed.ncbi.nlm.nih.gov/1643059/)) |
| Fente palpébrale (ex-en) | ≈ 30–31 | ≈ 29–30 | cf. §1.3 (chartes PFL) |
| al-al (largeur nasale) | ≈ 35 ± 2,6 | ≈ 31 ± 2,0 | Farkas, Phillips & Katic 1998 sur adultes canadiens caucasiens ([SAGE](https://journals.sagepub.com/doi/abs/10.1177/229255039800600302)) |
| zy-zy (bizygomatique) | ≈ 139 ± 5–6 | ≈ 130 ± 5 | cohérent avec ANSUR II blancs : H 141,9 ± 6,0 / F 132,3 ± 5,0 (calcul propre, §3) |
| eu-eu (largeur de tête) | ≈ 151 ± 5–6 | ≈ 144 ± 5 | cohérent avec ANSUR II blancs : H 154,0 ± 5,3 / F 147,1 ± 4,7 (calcul propre) |

⚠️ Les valeurs marquées « ordre de grandeur » proviennent de citations secondaires convergentes, pas d'une lecture directe des tables de Farkas ; pour un a priori de production, utiliser plutôt ANSUR II (données brutes vérifiables, §3) et 3DFN (§2).

### 1.2 Enfants 1–18 ans (Farkas, Posnick, Hreczko 1992 ; N ≈ 1 537–1 594 caucasiens nord-américains)

Résultats clés des trois études morphométriques de 1992 ([croissance de la tête, PMID 1643057](https://pubmed.ncbi.nlm.nih.gov/1643057/) ; [région orbitaire, PMID 1643059](https://pubmed.ncbi.nlm.nih.gov/1643059/) ; [face, PMID 1643058](https://pubmed.ncbi.nlm.nih.gov/1643058/)) :

| Mesure | % taille adulte à 1 an | % à 5 ans | Âge de maturité (F / M) |
|---|---|---|---|
| en-en | 84,1 % | **93,3 %** | 8 ans / 11 ans |
| ex-ex | — | ≈ 85–90 % | 13 ans / 15 ans |
| Circonférence de tête | 87,5 % | ≈ 93–96 % | tôt (croissance quasi achevée à 5 ans) |
| Longueur de tête | 87,1 % | ≈ 92 % | idem |
| zy-zy (largeur de face) | — | ≈ 80 % à 7 ans, croissance graduelle continue après 5 ans | tardive (adolescence) |

- Croissance IPD (MacLachlan & Howland 2002, N = 1 311 sujets / 4 294 visites, 1 mois–19 ans, [DOI 10.1046/j.1475-1313.2002.00023.x](https://onlinelibrary.wiley.com/doi/abs/10.1046/j.1475-1313.2002.00023.x)) : PD ≈ **50 mm à 5 ans → ≈ 60 mm à 15 ans** ; vitesse ≈ 1,0–1,3 mm/an entre 5 et 8 ans, < 0,5 mm/an à 15 ans (repris par [arXiv 2604.15328](https://arxiv.org/pdf/2604.15328)). Autre normogramme pédiatrique : 49,5 mm (36–47 mois), 51,0 mm (48–59 mois) ([ResearchGate tbl2_281069573](https://www.researchgate.net/figure/Mean-interpupillary-distance-mm-values-in-various-age-groups_tbl2_281069573)).
- Chartes classiques en-en/ex-ex enfants : Laestadius 1969 et Feingold & Bossert 1974 (percentiles 3–97 par âge, [Ento Key](https://entokey.com/milestones-and-normative-data/)) ; pic de croissance ICD/OCD entre 8 et 9 ans dans certaines populations ([Allied Academies](https://www.alliedacademies.org/articles/orbitofacial-anthropometric-assessment-of-intercanthal-and-outercanthaldistance-measurement-in-chhattisgarh-region.html)).
- Enfants roumains 3,5–14,5 ans (N = 85) : zy-zy corrèle fortement avec les paramètres de croissance générale (r = 0,526–0,925, p < 0,001) ([MDPI IJERPH 18:5288](https://www.mdpi.com/1660-4601/18/10/5288)).

### 1.3 Longueur de fente palpébrale (PFL)

- Chartes de référence : Thomas 1987 et Hall 1989 (naissance → adulte), mais **surestimant** la PFL normale ; Hall (2010) recommande leur remplacement par Clarren et al. 2010 (chartes canadiennes 6–16 ans, multi-ethniques) ; Strömland et al. pour < 6 ans ([guideline allemand FAS, ScienceDirect](https://www.sciencedirect.com/science/article/pii/S1090379813000512) ; [chartes canadiennes, Astley](https://depts.washington.edu/fasdpn/pdfs/FAR011002_e231-e241_Astley[1].pdf)).
- Ordres de grandeur : ≈ 18 mm à la naissance, ≈ 26–28 mm à 6–16 ans, ≈ 30–31 mm adulte.

---

## 2. Grandes enquêtes modernes et jeux de données

| Dataset | N | Âges | Population | 2D/3D | Mesures utiles | PD ? | HVID ? | Accès public | Licence |
|---|---|---|---|---|---|---|---|---|---|
| **ANSUR II** (Gordon et al. 2014, [DTIC ADA611869](https://apps.dtic.mil/sti/tr/pdf/ADA611869.pdf/)) | 6 068 (4 082 H, 1 986 F) | 17–58 (moy. ≈ 30) | Armée US (multi-ethnique, codée DODRace) | 1D (calipers) | IPD, zy-zy, eu-eu, circonf./longueur de tête, menton-sellion, arcs bitragion | **Oui** | Non | **Oui, CSV brut** ([openlab.psu.edu](https://www.openlab.psu.edu/ansur2/)) | domaine public (US Gov) |
| ANSUR 1988 | 3 976 avec IPD | 17–51 | Armée US | 1D | IPD (H 64,7 ± 3,7 ; F 62,3 ± 3,6 mm) | Oui | Non | données + rapports publics ([UMTRI](https://mreed.umtri.umich.edu/mreed/downloads/anthro/ansur/)) | domaine public |
| **CAESAR** (1998–2000) | ≈ 2 400 US/Canada + 1 900 Europe | 18–65 | civils NA + EU (NL, IT) | **3D corps entier** + 1D | ~250 mesures ; 2 299 têtes ré-annotées → 30 dimensions céphaliques ([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0360835218300305)) ; détails du visage mal capturés par les scanners de l'époque | partiel | Non | **Non** : licence payante SAE/AFRL ([humanshape.org](https://humanshape.org/CAESAR/)) | propriétaire |
| **NIOSH respirator survey** (Zhuang & Bradtmiller 2005, [PMID 16223715](https://pubmed.ncbi.nlm.nih.gov/16223715/)) | 3 997 | 18–66 | travailleurs US (multi-ethnique) | 1D + 3D (sous-éch. ~1 000) | 21 dim. tête-visage dont largeur de face (zy-zy), utilisées pour les panels d'ajustement de masques ; headforms ISO dérivées ([CDC/NIOSH](https://www.cdc.gov/niosh/data/datasets/rd-10130-2020-0/default.html)) | non | Non | résumés + headforms publics ; brut sur demande | publique (résumés) |
| **3D Facial Norms (3DFN)** (Weinberg et al. 2016, [PMID 26492185](https://pubmed.ncbi.nlm.nih.gov/26492185/) ; [FaceBase](https://www.facebase.org/resources/human/facial_norms/)) | 2 454 | **3–40 ans** | US, ascendance européenne | **3D stéréophotogrammétrie** | 24 landmarks 3D + **34 mesures** (en-en, ex-ex, al-al, largeurs faciales…) | Non (pas de pupilles, landmarks canthaux) | Non | **Oui** : stats résumées libres ; données individuelles (landmarks bruts, coordonnées) sur accréditation FaceBase | accès contrôlé recherche |
| MacLachlan & Howland 2002 | 1 311 (4 294 visites) | 1 mois–19 ans | US (Ithaca, NY) | photogrammétrie | PD, diamètre pupillaire, par âge | **Oui** | Non | tables dans l'article | article payant |
| Size Korea (KATS) / enquêtes chinoises (GB/T 23461, CNIS) | dizaines de milliers | tous âges | Corée / Chine | 1D + 3D partiel | eu-eu, zy-zy, dimensions de tête (headforms) | partiel | Non | résumés publics (sites gouvernementaux) | publique (résumés) |
| Chartes ophtalmo pédiatriques (HVID) | études cliniques multiples | 0–36 mois + adultes | diverses | kératométrie/biométrie | HVID/WTW | Non | **Oui** | articles | — |

**Point crucial covariance** : seuls **ANSUR II / ANSUR 1988** (CSV individuels publics) et **3DFN** (données individuelles sur accréditation) permettent de construire une **matrice de covariance complète** entre mesures périoculaires et céphaliques. CAESAR l'autoriserait mais sous licence payante. C'est pourquoi la section 3 repose sur nos calculs ANSUR II.

---

## 3. Structure de corrélation (calculs originaux, ANSUR II, N = 6 068)

Source : données brutes publiques ANSUR II (unités : IPD en 0,1 mm dans le CSV, converti en mm ; autres mesures en mm). Script reproductible : `ansur_stats.py`.

### 3.1 Moyennes et écarts-types

| Mesure | Hommes (N=4 082) | Femmes (N=1 986) | Pooled |
|---|---|---|---|
| **IPD (PD)** | **64,0 ± 3,4 mm** | **61,7 ± 3,6 mm** | 63,3 ± 3,65 mm |
| zy-zy | 142,6 ± 6,2 | 133,8 ± 5,6 | 139,7 ± 7,3 |
| eu-eu | 154,3 ± 5,5 | 147,8 ± 5,2 | 152,2 ± 6,2 |
| Circonf. tête | 574,4 ± 16,1 | 561,1 ± 19,4 | — |
| Longueur tête | 199,5 ± 7,0 | 189,8 ± 7,5 | — |
| Menton–sellion | 122,6 ± 6,7 | 113,1 ± 6,1 | — |
| Percentiles IPD pooled (1/5/25/50/75/95/99) | | | 54,5 / 57,0 / 61,0 / 63,5 / 65,5 / 69,5 / 72,0 mm |

Concordance externe : Dodgson 2004 (ANSUR 1988) — moyenne adulte ≈ 63 mm, quasi-totalité 50–75 mm, minimum enfants ≥ 5 ans ≈ 40 mm ([SPIE 10.1117/12.529999](https://www.spiedigitallibrary.org/conference-proceedings-of-spie/5291/1/Variation-and-extrema-of-human-interpupillary-distance/10.1117/12.529999.short)).

### 3.2 Matrice de corrélation (hommes / femmes / pooled)

r de Pearson avec **IPD** :

| Prédicteur | r (H) | r (F) | r (pooled) |
|---|---|---|---|
| zy-zy (bizygomatique) | **0,437** | **0,475** | 0,520 |
| eu-eu (largeur tête) | 0,306 | 0,284 | 0,394 |
| Circonf. tête | 0,361 | 0,463 | 0,459 |
| Longueur tête | 0,268 | 0,343 | 0,396 |
| Arc bitragion sous-mandibulaire | 0,276 | 0,354 | 0,409 |
| Menton–sellion (hauteur face) | 0,161 | 0,226 | 0,311 |
| Stature | 0,180 | 0,200 | 0,330 |

Autres corrélations intra-sexe notables : r(zy-zy, eu-eu) = 0,653 (H) / 0,609 (F) ; r(zy-zy, arc bitragion) = 0,561 (H).

### 3.3 Régressions pour prédire le PD (mm) — le résultat qui compte

| Modèle (par sexe) | SD résiduel | SD brut | R² |
|---|---|---|---|
| H : PD = 29,74 + 0,240·zy-zy | **3,08 mm** | 3,42 | 0,19 |
| F : PD = 20,33 + 0,309·zy-zy | **3,19 mm** | 3,62 | 0,23 |
| H : PD ~ zy-zy + eu-eu + stature | 3,05 mm | 3,42 | 0,21 |
| Pooled : PD ~ zy-zy | 3,12 mm | 3,65 | 0,27 |
| Pooled : PD ~ zy-zy + eu-eu + sexe | 3,12 mm | 3,65 | 0,27 |

**Conclusion clé** : connaître la largeur du visage (même parfaitement, en mm) ne réduit le SD du PD que de ~3,5 → ~3,1 mm (≈ 10–15 %). eu-eu seul : quasi inutile (R² ≈ 0,08–0,09 intra-sexe). Les mesures céphaliques sont de **mauvais prédicteurs du PD** ; un canal iris (SD ≈ 2,3 mm, §7) bat n'importe quelle combinaison de largeurs faciales. Concordant avec la littérature clinique : corrélation « faible, non significative » entre largeur de face et IPD ([IJOP « Facial Width and Inter-Pupillary Distance »](https://ijop.net/index.php/mlu/article/download/737/691/1345)) ; r(en-en, zy-zy) = 0,224 seulement ([IJDR 2018](https://journals.lww.com/ijdr/fulltext/2018/29040/a_study_to_correlate_various_facial_landmarks_with.10.aspx)).

### 3.4 Sens inverse : prédire la largeur de monture à partir du PD (utile !)

| Modèle | Équation | SD résiduel |
|---|---|---|
| H : zy-zy à partir du PD | zy-zy = 91,7 + 0,795·PD | 5,6 mm (brut 6,2) |
| F : zy-zy à partir du PD | zy-zy = 88,7 + 0,730·PD | 4,9 mm (brut 5,6) |
| H : eu-eu à partir du PD | eu-eu = 122,7 + 0,495·PD | 5,3 mm (brut 5,5) |
| Pooled : zy-zy à partir du PD | zy-zy = 73,8 + 1,042·PD | 6,2 mm (brut 7,3) |

### 3.5 HVID : corrélations disponibles

- HVID/WTW adulte : **11,71 ± 0,42 mm** (Rüfer et al. 2005, Cornea 24(3):259-261, N = 390, biométrie Orbscan ; [ResearchGate](https://www.researchgate.net/publication/7955670_White-to-White_Corneal_Diameter_Normal_Values_in_Healthy_Humans_Obtained_With_the_Orbscan_II_Topography_System)). Population iranienne : 11,68 ± 0,39 ; H 11,77 vs F 11,58 ([PMC4003087](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4003087/)) ; émétropes turcs : H 11,60 ± 0,35 / F 11,71 ± 0,36 ([PMID 22021086](https://pubmed.ncbi.nlm.nih.gov/22021086/)).
- WTW corrèle avec les paramètres **intra-oculaires** : profondeur de chambre antérieure r = 0,46–0,49 ; longueur axiale r = 0,50 ; angle irido-cornéen r = 0,31 ([PMC11970417](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11970417/), [PMC8639187](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8639187/)).
- **Aucune corrélation publiée HVID ↔ PD n'a été trouvée** (recherche dédiée infructueuse). Vu le faible SD relatif du HVID (3,6 %) et son découplage développemental (§6), l'hypothèse d'indépendance HVID ⟂ PD est raisonnable en première approximation — c'est précisément ce qui rend le canal iris informatif.

---

## 4. Largeur de monture vs largeurs céphaliques (littérature de l'optique)

- Règle du métier (dispensing) : la **largeur totale de la façade** doit correspondre à la « largeur de tempe » (temple width / head width aux tempes, mesurée au réglet ou frame ruler ~10 mm derrière les canthi externes) ; la façade ne doit dépasser la face que de ~2 mm de chaque côté. Réf. de manuel : Brooks & Borish, *System for Ophthalmic Dispensing* (3e éd., Butterworth-Heinemann). La littérature **quantitative** (corrélation frame width ↔ zy-zy publiée avec r) est quasi inexistante — c'est une lacune documentée.
- Revue 2025 « African Facial Anthropometry and Spectacle Frame Design » ([DOI 10.2147/OPTO.S536358](https://www.tandfonline.com/doi/full/10.2147/OPTO.S536358), [PMC12515448](https://pmc.ncbi.nlm.nih.gov/articles/PMC12515448/)) : le design des montures repose historiquement sur des anthropométries européennes puis est-asiatiques ; mésajustement documenté (PD, largeur faciale, pont nasal plus large et plat, hauteur de racine nasale plus basse) pour les visages africains → glissement, pression, inconfort, moindre observance.
- Proxy quantitatif utilisable (nos régressions §3.4) : à PD connu, la largeur bizygomatique est prédite à ± 5–6 mm (SD) — soit environ ± une taille de monture ; l'écart tempe-à-tempe réel reste à mesurer directement (le canal image peut le faire une fois l'échelle fixée).
- Lien fonctionnel : la largeur de face (zy-zy) est le déterminant n°1 de l'ajustement des masques respiratoires dans les panels NIOSH ([NAS 2007](https://www.nationalacademies.org/read/11815/chapter/6)) — même logique dimensionnelle que l'appui des branches.

---

## 5. Biais de population : Europe / Afrique / Asie de l'Est ; enfants vs adultes

### 5.1 Adultes, par groupe (calculs propres ANSUR II, DODRace ; mm, moy (SD))

| Groupe | Sexe | N | **PD** | zy-zy | eu-eu |
|---|---|---|---|---|---|
| Blancs | M | 2 817 | 63,3 (3,1) | 141,9 (6,0) | 154,0 (5,3) |
| Blancs | F | 975 | 60,2 (3,2) | 132,3 (5,0) | 147,1 (4,7) |
| Noirs | M | 642 | **66,9 (3,5)** | 143,6 (6,4) | 154,6 (5,8) |
| Noirs | F | 656 | **64,0 (3,3)** | 134,9 (5,4) | 148,0 (5,4) |
| Hispaniques | M | 440 | 64,2 (3,0) | 144,0 (6,0) | 154,9 (5,6) |
| Hispaniques | F | 239 | 61,6 (3,2) | 134,2 (5,7) | 148,4 (5,5) |
| Asiatiques | M | 117 | 64,2 (3,2) | **146,7 (6,4)** | **158,2 (6,7)** |
| Asiatiques | F | 71 | 61,7 (2,9) | **139,2 (6,1)** | **151,9 (5,3)** |

Lectures : PD des adultes noirs ≈ **+3,6 mm** (H) / **+3,8 mm** (F) vs blancs (> 1 SD !) ; visages est-asiatiques ≈ **+4,8 mm** de zy-zy et **+4,2 mm** de eu-eu vs blancs à PD quasi égal. Convergent avec la méta-analyse 2025 des différences ethniques d'IPD ([medRxiv 10.64898/2025.12.30.25343217](https://www.medrxiv.org/content/10.64898/2025.12.30.25343217v1.full)) et avec Farkas et al. 2005 (25 groupes ethniques, en-en et al-al significativement plus larges dans les groupes africains et asiatiques vs NAW ; [J Craniofac Surg 16:615-646](https://journals.lww.com/jcraniofacialsurgery/abstract/10.1097/01.scs.0000171847.58031.9e~international-anthropometric-study-of-facial-morphology-in)) ; comparaison Afro-Américains vs NAW : [PMID 18046155](https://pubmed.ncbi.nlm.nih.gov/18046155/) ; Kényans : [PMC6384287](https://pmc.ncbi.nlm.nih.gov/articles/PMC6384287/).
- HVID : remarquablement stable entre populations (11,6–11,7 mm ± 0,35–0,42 partout, cf. §3.5 : Allemagne, Iran, Turquie, Arabie Saoudite, Chine) — c'est le paramètre facial **le moins biaisé ethniquement**.

### 5.2 Erreurs d'un a priori « adulte européen »

- Sur un **enfant de 6 ans** : PD réel ≈ 51–52 mm vs a priori 63 mm → **erreur d'échelle ≈ +22 %** si l'on force le PD a priori ; en mm : ~11–12 mm d'erreur sur le PD, ~25–30 mm sur une largeur de monture extrapolée. Inversement, une mise à l'échelle **par l'iris** ne se trompe que de (11,71 − HVID(6 ans ≈ 11,7))/11,7 ≈ **< 1 %** (§6).
- Sur un **adulte noir** : PD sous-estimé de ~3,6–3,8 mm (≈ 6 %) si prior blanc strict ; sur un **adulte est-asiatique** : largeur de monture sous-estimée de ~5 mm à PD correct ; le pont nasal requiert de toute façon un ajustement spécifique ([revue OPTO 2025](https://www.dovepress.com/african-facial-anthropometry-and-spectacle-frame-design-a-review-peer-reviewed-fulltext-article-OPTO)).

---

## 6. Croissance : à quel âge chaque mesure atteint sa valeur adulte

| Mesure | Naissance | 1 an | 2 ans | 5 ans | Maturité | Source |
|---|---|---|---|---|---|---|
| **HVID/WTW** | 9,5–10,5 mm (moy 9,78 ± 0,14) | 11,38 ± 0,07 | **11,72 ± 0,04 (24–36 mois) ≈ adulte** | ≈ adulte | **~2 ans** ✔ vérifié | [PMC9589223](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9589223/), [AAO](https://www.aao.org/education/disease-review/iridocorneal-anomalies-in-infants-2), [Ento Key](https://entokey.com/neonatal-ophthalmology-ocular-development-in-childhood/) |
| PD | ≈ 40 mm (nourrisson) | — | ≈ 47–49 | ≈ 50–51 | **~15–16 ans** (croît de ~10 mm entre 5 et 15 ans) | MacLachlan & Howland 2002 |
| en-en | — | 84 % adulte | — | 93 % adulte | 8 ans (F) / 11 ans (M) | Farkas 1992, PMID 1643059 |
| ex-ex | — | — | — | ~85–90 % | 13 ans (F) / 15 ans (M) | idem |
| eu-eu / circonf. tête | — | 87,5 % | — | ~94 % | précoce (≈ 5–10 ans) | PMID 1643057 |
| zy-zy | — | — | — | ~80 % à 7 ans | adolescence tardive | PMID 1643058 |

**Implication décisive pour la mise à l'échelle par iris** : le HVID est adulte (11,7 mm) dès ~2 ans, avec un SD populationnel de seulement 0,42 mm (3,6 %), **stable selon l'âge, le sexe (±0,1–0,2 mm) et l'ethnie**, alors que PD, zy-zy et eu-eu croissent jusqu'à l'adolescence. Un facteur d'échelle iris = 11,7 mm est donc **age-robust de ~3 ans à l'âge adulte** (biais < 1 % dès 2–3 ans), là où tout prior facial adulte se trompe de 10–25 % chez l'enfant. Seule réserve : avant 2 ans, l'iris sous-estime l'échelle (jusqu'à −16 % chez le nouveau-né).

---

## 7. Fusion webcam : iris (px) + PD (px) → PD vrai (mm)

### 7.1 Ce qui est publié

- **MediaPipe Iris** (Google, 2020) : utilise HVID ≈ **11,7 ± 0,5 mm** comme étalon métrique ; erreur relative moyenne de l'estimation de distance caméra-sujet : **4,3 % (SD 2,4 %)** sans lunettes, 4,8 % (SD 3,1 %) avec lunettes ([Google AI Blog](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/), [docs](https://github.com/google/mediapipe/blob/master/docs/solutions/iris.md)).
- Applications PD smartphone : meilleures apps MAE ≈ **0,51 mm** vs pupillomètre (étude Cureus 2023, via [OptoGrid](https://www.optogrid.com/blog/pupillary-distance-app/)) ; GlassifyMe : biais moyen 0,21 mm — mais ces apps utilisent une **carte de crédit (85,60 mm ISO/IEC 7810)** ou le capteur TrueDepth, pas l'iris seul ; iris seul (Auglio) : ±1,5 mm dans 91 % des cas ([Auglio](https://auglio.com/en/products/auto-pd-measurement)).
- **MICA** (ECCV 2022) : reconstruction faciale métrique par apprentissage supervisé sur ~2 300 identités scannées ; démontre que l'échelle est **fondamentalement ambiguë** en monoculaire et l'attaque par prior appris ; application citée : essayage virtuel de lunettes ([arXiv 2204.06607](https://arxiv.org/pdf/2204.06607)).
- **Aucun article trouvé faisant exactement la fusion bayésienne {iris px, PD px} → PD mm avec SD résiduel publié.** C'est un trou dans la littérature ; la meilleure estimation se dérive (ci-dessous).

### 7.2 Dérivation du meilleur estimateur (calcul propre, hypothèses sourcées)

Le rapport R = PD_px / d_iris_px est invariant d'échelle et de distance (pupilles et iris quasi coplanaires, visage frontal). Alors PD_mm = R · HVID_mm, avec HVID ~ N(11,71 ; 0,42²) (Rüfer 2005) :

| Canal | SD sur PD (adulte, R ≈ 5,43) |
|---|---|
| Prior population seul (pooled ANSUR II) | 3,65 mm (3,4 mm si sexe connu) |
| Prior population + zy-zy mesuré en mm | 3,1 mm (plafond des priors faciaux, §3.3) |
| **Canal iris seul** (bruit pixel 0,5–2 % sur R) | **2,30–2,61 mm** (2,28 mm au bruit nul) |
| **Fusion bayésienne iris ⊕ prior population** (produit de gaussiennes, indépendance HVID⟂PD §3.5) | **1,93–2,12 mm** |
| Carte de crédit / TrueDepth (référence) | 0,2–0,5 mm (MAE) |

Formules : σ_iris = √[(R·0,42)² + (PD·ε)²] avec ε le bruit relatif sur R ; σ_post = (σ_iris⁻² + σ_prior⁻²)^(-1/2). Chez l'enfant ≥ 3 ans, remplacer le prior PD par le prior d'âge (MacLachlan) ; le canal iris garde le même σ ≈ 3,6 % · PD ≈ 1,8–1,9 mm à PD = 51 mm, et la fusion reste ≈ 1,6–1,8 mm.

**Recommandations pratiques** : (1) le canal iris est le meilleur étalon sans objet de référence : ~3,6 % (1 σ) d'incertitude d'échelle, quasi insensible à l'âge (≥ 3 ans), au sexe et à l'ethnie ; (2) la fusion avec le prior PD (âge/sexe si connus) gagne ~15 % ; (3) pour passer sous 1 mm il faut une référence physique (carte ISO) ou un capteur de profondeur ; (4) ne jamais utiliser un prior facial adulte européen seul : erreurs de 6 % (adultes non-européens) à 22 % (enfant de 6 ans).

---

## 8. Fichiers produits

- `ansur_stats.py` — script d'analyse reproductible (moyennes, SD, matrices de corrélation, régressions, stats par DODRace, percentiles, fusion bayésienne).
- Données : `anthropometric-stats/data/ansur/ANSUR II {MALE,FEMALE} Public.csv` (domaine public, clonées de [github.com/hkair/anthropometric-stats](https://github.com/hkair/anthropometric-stats), identiques à la distribution officielle PSU OpenLab).

## 9. Sources principales

1. Farkas LG. *Anthropometry of the Head and Face*, 2e éd., Raven Press, 1994. [archive.org](https://archive.org/details/anthropometryofh0000unse)
2. Farkas, Posnick, Hreczko 1992 (croissance tête/orbites/face) : [PMID 1643057](https://pubmed.ncbi.nlm.nih.gov/1643057/), [PMID 1643059](https://pubmed.ncbi.nlm.nih.gov/1643059/), [PMID 1643058](https://pubmed.ncbi.nlm.nih.gov/1643058/)
3. Farkas, Katic, Forrest 2005. Int. anthropometric study, 25 groupes ethniques. J Craniofac Surg 16:615–646. [DOI 10.1097/01.scs.0000171847.58031.9e](https://journals.lww.com/jcraniofacialsurgery/abstract/10.1097/01.scs.0000171847.58031.9e~international-anthropometric-study-of-facial-morphology-in)
4. Gordon et al. 2014. ANSUR II. [DTIC ADA611869](https://apps.dtic.mil/sti/tr/pdf/ADA611869.pdf/) ; données : [PSU OpenLab](https://www.openlab.psu.edu/ansur2/)
5. Dodgson NA 2004. Variation and extrema of human IPD. Proc SPIE 5291. [DOI 10.1117/12.529999](https://www.spiedigitallibrary.org/conference-proceedings-of-spie/5291/1/Variation-and-extrema-of-human-interpupillary-distance/10.1117/12.529999.short)
6. MacLachlan C, Howland HC 2002. Ophthalmic Physiol Opt 22(3):175–182. [DOI 10.1046/j.1475-1313.2002.00023.x](https://onlinelibrary.wiley.com/doi/abs/10.1046/j.1475-1313.2002.00023.x)
7. Rüfer F et al. 2005. WTW normal values (Orbscan II). Cornea 24(3):259–261. [DOI 10.1097/01.ico.0000148312.01805.53](https://www.researchgate.net/publication/7955670)
8. Zhuang Z, Bradtmiller B 2005. NIOSH head-and-face survey. J Occup Environ Hyg 2(11):567–576. [PMID 16223715](https://pubmed.ncbi.nlm.nih.gov/16223715/)
9. Weinberg SM et al. 2016. 3D Facial Norms Database. Cleft Palate Craniofac J 53(6):e185–e197. [PMID 26492185](https://pubmed.ncbi.nlm.nih.gov/26492185/) ; [facebase.org](https://www.facebase.org/resources/human/facial_norms/)
10. MediaPipe Iris 2020. [Google Research Blog](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/)
11. Zielonka, Bolkart, Thies 2022. MICA. ECCV. [arXiv 2204.06607](https://arxiv.org/pdf/2204.06607)
12. Revue 2025 : African Facial Anthropometry and Spectacle Frame Design. Clin Optom. [DOI 10.2147/OPTO.S536358](https://www.tandfonline.com/doi/full/10.2147/OPTO.S536358)
13. Méta-analyse IPD × ethnies 2025. [medRxiv 10.64898/2025.12.30.25343217](https://www.medrxiv.org/content/10.64898/2025.12.30.25343217v1.full)
14. Croissance cornéenne 0–36 mois : [PMC9589223](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9589223/) ; [AAO Iridocorneal Anomalies](https://www.aao.org/education/disease-review/iridocorneal-anomalies-in-infants-2)
15. Chartes PFL : Clarren 2010 / guideline FAS [ScienceDirect S1090379813000512](https://www.sciencedirect.com/science/article/pii/S1090379813000512) ; [Astley, U. Washington](https://depts.washington.edu/fasdpn/pdfs/FAR011002_e231-e241_Astley[1].pdf)
16. CAESAR : [humanshape.org/CAESAR](https://humanshape.org/CAESAR/) ; têtes CAESAR ré-annotées : [DOI 10.1016/j.cie.2018.01.023](https://www.sciencedirect.com/science/article/abs/pii/S0360835218300305)
17. Enfants roumains 3,5–14,5 ans : [MDPI IJERPH 18:5288](https://www.mdpi.com/1660-4601/18/10/5288)
18. Apps PD : [OptoGrid 2026](https://www.optogrid.com/blog/pupillary-distance-app/) ; [Auglio](https://auglio.com/en/products/auto-pd-measurement)
