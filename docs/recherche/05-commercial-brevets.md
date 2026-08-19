# Mesure de l'écart pupillaire (PD) et des dimensions faciales sans objet de référence : méthodes publiées et brevets des acteurs commerciaux

*Recherche documentaire — essayage virtuel (VTO) et télé-optométrie. Date : 2026-08-19.*
*Sources : Google Patents / Justia / USPTO (via extraits de recherche — l'accès direct aux bases de brevets était bloqué par le proxy réseau ; les numéros et URLs cités ont été vérifiés par recoupement de plusieurs résultats de recherche), blogs techniques des éditeurs, études cliniques (Cureus/PubMed), documentation développeur Apple/Google/Snap.*

---

## 1. FittingBox (Toulouse, France)

**Positionnement** : pionnier du VTO lunettes (fondé ~2006), revendique **59 brevets internationaux** couvrant IA, mesures optiques, détection de visage, dont 16 brevets sur le « Frame Removal » (réalité diminuée).

### Brevets clés sur la mesure

| Brevet | Titre | Méthode |
|---|---|---|
| [WO2011113936A1](https://patents.google.com/patent/WO2011113936A1/en) / [US9628697B2](https://patents.google.com/patent/US9628697B2/en) (inventeur **Ariel Choukroun**, CTO) | Method and device for measuring an interpupillary distance | **Sans carte** : protocole de **mouvement prédéterminé** — l'utilisateur part à bout de bras et **approche son visage de la caméra** en fixant l'objectif. Optimisation itérative multi-images estimant simultanément : distance à la caméra, PD, focale caméra, rayon du globe oculaire, taille de pupille. Approche « structure-from-motion + modèle d'œil » — pas d'objet de taille connue. Le brevet lui-même note qu'aucun résultat de précision n'est garanti pour ce problème multi-variables et que la détection du cercle pupillaire est difficile. |
| [WO2013045531A1](https://patents.google.com/patent/WO2013045531A1/en) / [US20140253875A1](https://patents.google.com/patent/US20140253875A1/en) / [US10120207B2](https://patents.google.com/patent/US10120207) / [EP2760329](https://patents.google.com/patent/EP2760329A1/en) (Choukroun, avec Visionhub) | Method for determining ocular and optical measurements | Mesures oculaires (PD, PD mono, hauteurs) avec capteur grand public + **image contenant un objet de taille connue** (protocole **carte** bancaire/fidélité) ; reconstruction 3D du « système des yeux » par modélisation de l'œil ; calibration caméra incluse dans les revendications. |
| [US10201273B2](https://patents.google.com/patent/US10201273) / [EP2999393](https://patents.google.com/patent/EP2999393A1) (Choukroun & **Sylvain Le Gallou**) | Method for determining ocular measurements using a consumer sensor | Mesures oculaires avec « capteur grand public » (webcam/smartphone) — extension de la famille précédente. |
| [US10042188B2](https://patents.justia.com/patent/10042188) | Process and method for real-time physically accurate and realistic-looking glasses try-on | Essayage temps réel « physiquement exact » : estimation de la rotation 3D + translation du visage, positionnement des lunettes adapté aux paramètres morphologiques. |

### Ce que fait le produit
- **Outil PD en ligne** (blog officiel « patented pupillary distance measurement tool ») : protocole **carte** (« state-of-the-art card protocol ») — donc la mesure *métrologique* commercialisée reste basée carte, malgré le brevet « mouvement » de 2010.
- **Échelle du VTO sans mesure** : FittingBox documente (FAQ) l'utilisation de **tailles moyennes statistiques** — construction de tailles moyennes de lunettes et calcul d'une **échelle par défaut par catégorie morphologique** (« the absolute size of the virtual glasses is pretty close to accurate scale ») → pour l'affichage, pas pour la prescription.

**Résumé FittingBox** : géométrie = modèle 3D d'œil + calibration caméra + soit objet connu (carte), soit protocole de mouvement (brevet US9628697, apparemment non déployé comme produit de mesure grand public), soit échelle statistique pour le rendu. RGB seul, pas de capteur de profondeur.

---

## 2. Ditto Technologies (San Francisco)

**Méthode historique (vérifiée)** : l'utilisateur tourne la tête devant la webcam en tenant une **carte format carte bancaire contre son front** ; la carte sert de référence d'échelle pour dimensionner la tête et calculer le PD.

| Brevet | Titre | Contenu |
|---|---|---|
| [US8708494B1](https://patents.justia.com/patent/8708494) | Displaying glasses with recorded images | « Scaling reference held to the user's head » ; la référence peut aussi être « une mesure en unités standard, telle que la distance pupillaire » (le PD connu peut servir de référence inverse). |
| [US20140293220](https://patents.justia.com/patent/20140293220) → US9254081 et [US9842246](https://patents.google.com/patent/US9842246) (Kornilov, Surkov, Bhagavathy) | Fitting glasses frames to a user | Capture multi-angles ; « scaling reference » (objet format carte) tenu contre la tête ; comparaison des mesures de tête à une base de données de montures. |
| [US11960146B2](https://patents.justia.com/patent/11960146) (2021→2024) | Fitting of glasses frames including live fitting | Fitting « live » : PD + largeur de visage, largeur de pont de nez, distance nez-pupilles. |
| [US12014462](https://patents.google.com/patent/US12014462) | Generation of a 3D model of a **reference object** to perform scaling of a model of a user's head | Modernisation du principe : modèle 3D de l'objet de référence pour l'échelle du modèle de tête. |

**Aucun brevet « sans carte » identifié** : toute la famille Ditto repose sur un objet de référence physique (ou un PD déjà connu). RGB seul.

---

## 3. 6over6 Vision Ltd (Israël) — GlassesOn / GoEyes

**Statut** : racheté par **1-800 Contacts** (accord déc. 2019, clôture début 2020, valorisation estimée >100 M$ — la mention « acquis par Ubisoft » trouvée sur un agrégateur est une erreur manifeste). App **GlassesOn** : PD « medical grade » en <1 min, paramètres de verres en <10 min ; conforme ANSI Z80.17 ; listée FDA/CE/Health Canada/TGA.

### Brevet PD — le plus révélateur du corpus
Famille « Apparatus, system and method of determining a pupillary distance » (inventeur principal **Ofer Limon**) :
- [US20180140186A1](https://patents.google.com/patent/US20180140186A1/en)
- [US10702149B2](https://patents.google.com/patent/US10702149B2) (accordé 2020)
- [US11931105](https://patents.google.com/patent/US11931105) (continuation, 2024)
- [EP3294112B1](https://patents.google.com/patent/EP3294112B1) et continuation [EP4458252A3](https://patents.google.com/patent/EP4458252A3)
- priorité WO 2016 (WO2016181308/EP3294112, dépôt US 15/572,889)

**Méthode revendiquée (sans carte, sans capteur de profondeur)** :
1. Capture d'une image contenant les **réflexions cornéennes d'une source lumineuse** (flash/écran) sur chaque œil — **premières images de Purkinje** (réflexe cornéen). Le réflexe cornéen est utilisé plutôt que le centre pupillaire apparent car il localise l'axe visuel indépendamment de la réfraction de la cornée et de la parallaxe.
2. Détermination d'une **distance estimée capteur↔pupilles** — les documents de la famille mentionnent l'utilisation d'**informations d'accélération/orientation du dispositif** et de paramètres du capteur (EXIF/autofocus, focale, taille de pixel) pour estimer cette distance.
3. PD = f(positions des réflexions dans l'image, distance estimée, orientation) — conversion pixels→mm par la géométrie projective de la caméra calibrée.

### Brevet verres (contexte)
[US10670494B2](https://patents.google.com/patent/US10670494) « determining one or more optical parameters of a lens » (Limon, Levy, Zlotnik, Aviv) : mesure de puissance sphère/cylindre/axe des verres avec l'écran du téléphone affichant une mire + caméra ; le produit utilise une **carte magnétique standard** comme référence de taille/distance pour cette partie (documenté dans l'app).

**Résumé 6over6** : le PD est mesuré **sans carte** (réflexe cornéen + estimation de distance par capteurs inertiels/paramètres caméra) ; la carte magnétique n'est requise que pour la lensométrie. C'est LE brevet de référence « RGB pur + IMU » du domaine.

---

## 4. Warby Parker (ex JAND, Inc.)

- **App iOS « Digital PD Tool »** : nécessite **iPhone X ou supérieur** (caméra **TrueDepth** / Face ID) — confirmé par la communication officielle Warby Parker (« All you need is an iPhone X and above ») et la page [warbyparker.com/pd/instructions](https://www.warbyparker.com/pd/instructions).
- **Brevet** : [US12108988B2](https://patents.google.com/patent/US12108988) « System and method for measuring pupillary distance and uses thereof » (demande [US20210393121](https://patents.justia.com/patent/20210393121)), cédé à JAND, Inc. puis Warby Parker Inc. ; inventeurs David H. **Goldberg**, Benjamin **Cohen**, Taylor Alexandra **Duffy**. Méthode revendiquée : capture d'une **image 2D + carte de profondeur 3D correspondante** ; localisation des pupilles sur la 2D, raffinement, coordonnées 3D des centres pupillaires, PD = distance euclidienne métrique.
- **Pas de méthode RGB-only identifiée** chez Warby Parker : le fallback est la mesure manuelle (règle/opticien). Leur « Virtual Vision Test » (renouvellement d'ordonnance) est distinct.
- **Précision mesurée indépendamment** : étude Cureus 2023 (Han et al., [PubMed 37529827](https://pubmed.ncbi.nlm.nih.gov/37529827/)) sur 44 sujets vs pupillomètre numérique : **MAE ≈ 0,51 mm** pour Warby Parker et EyeMeasure (TrueDepth), vs **1,375 mm** pour PDCheck AR — meilleure app du panel.

---

## 5. Autres acteurs

### 5.1 Glasses.com / 1-800 Contacts → Luxottica (« l'astuce du miroir »)
[US20130141468A1](https://patents.google.com/patent/US20130141468) → [US9236024B2](https://patents.google.com/patent/US9236024B2/en) « Systems and methods for obtaining a pupillary distance measurement using a mobile computing device » : l'utilisateur se place **devant un miroir**, le téléphone tenu à une position prédéterminée par rapport au visage (**contre le menton**), et photographie **son reflet incluant l'appareil** ; l'échelle est donnée par **les dimensions connues de l'appareil lui-même** ou par un **contenu de taille connue affiché à l'écran** visible dans le reflet. Le téléphone devient l'objet de référence — pas de carte, pas de profondeur. (Glasses.com et sa techno VTO, issues de 1-800 Contacts, sont passées chez Luxottica en 2014.) C'est la famille canonique du « mirror trick » ; la géométrie miroir (trajet optique doublé) y est implicite puisque l'appareil et le visage sont coplanaires dans le reflet.

### 5.2 EssilorLuxottica
- **En magasin** : **Visioffice / Visioffice 2** (avec **clip à repères verts** de taille connue fixé sur la monture — référence physique), colonnes de centrage.
- **En ligne** : hérite des brevets Glasses.com (ci-dessus). Les FAQ Essilor mentionnent aussi la technique « carte bancaire comme référence de taille ». Pas de brevet « sans référence » identifié dans cette recherche.

### 5.3 Zeiss — VISUFIT 1000 (et FrameFinder)
Colonne de centrage : **9 caméras mutuellement calibrées**, une seule prise couvrant **180°**, 45 millions de points → **avatar 3D calibré** ; PD annoncé à **0,1 mm** ; **sans clip de calibration** (l'échelle vient de la calibration multi-caméras de l'appareil, pas d'un objet porté). Mesures : PD, angle pantoscopique, galbe, distance verre-œil. Matériel dédié — pas transposable au smartphone RGB.

### 5.4 Hoya — visuReal
- **visuReal Master** : système de centrage vidéo **6 caméras** calibrées (portique) — même logique que Zeiss.
- **visuReal portable / Move AI** (iPad) : app + **« measurement temple » / cover optique** — un accessoire de géométrie connue fait la mise à l'échelle. Valeurs mesurées : PD mono, hauteurs, boxing, angle pantoscopique, distance vertex, rotation de tête.

### 5.5 Rodenstock
- **ImpressionIST** : système de **centrage vidéo 3D à 2 caméras stéréo calibrées** (mesure PD, diamètre pupillaire, paramètres visage+monture).
- **DNEye Scanner** : aberrométrie/topographie (mesure de l'œil, pas du visage) ; les données de centrage viennent de l'ImpressionIST.

### 5.6 Topology Eyewear (Bespoke, Inc., San Francisco)
Scan facial par **TrueDepth** (iPhone/iPad) : ~30 000 points projetés, mesh visage, lunettes fabriquées sur mesure sans ajustement final. Famille de brevets « Method and system to create custom, user-specific eyewear » : [US20150154678A1](https://patents.google.com/patent/US20150154678A1/en), [US9529213B2](https://patents.google.com/patent/US9529213B2/en), [US11867979B2](https://patents.google.com/patent/US11867979B2/en) — couvre la génération de lunettes anatomiquement ajustées à partir de données d'image/scan (fondateur Eric Varady). Dépend d'un capteur de profondeur pour la métrique.

### 5.7 Perfect Corp
« Automated Pupillary Detection (APD) » revendiquée pour un VTO « true-to-scale » et une mesure de PD « en secondes » par IA ; communication marketing sans détail géométrique publié ; fonctionne dans le navigateur (RGB). Aucune revendication de précision chiffrée trouvée, ni brevet PD clairement attribué à Perfect Corp dans cette recherche (le brevet US10048516 « Methods and systems for measuring human faces and eyeglass frames » est apparu dans les recherches mais son cessionnaire n'a pas pu être confirmé).

### 5.8 Auglio (VTO web, Shopify)
« Auto PD Measurement » **sans app, sans carte, sans règle** — webcam/smartphone RGB. Méthode déclarée : **estimation de la distance caméra↔visage à partir de la taille de la pupille/de l'œil du client** (constante anatomique), suivi de distance annoncé « fiable à 92–94 % » ; précision PD annoncée : **±1,5 mm dans 91 % des cas**. C'est un exemple commercial assumé de la stratégie « iris/pupille comme étalon » avec précision honnêtement dégradée (insuffisante pour verres progressifs, acceptable pour l'échelle d'un VTO).

### 5.9 Snap (Snapchat / Lens Studio)
- Fonction **« True Size Eyewear »** documentée pour les Lenses : le modèle 3D garde son échelle réelle (1 unité = 1 cm) et le visage est mesuré en unités métriques.
- Brevets : [US11562548](https://patents.google.com/patent/US11562548) et [US12067804](https://patents.google.com/patent/US12067804) « True size eyewear in real time / experience in real time », plus US12387447 — « real-world scale computation module » qui calcule l'échelle transformant les mesures physiques réelles vers les landmarks de l'image, et redimensionne l'élément AR selon l'échelle réelle du visage.
- **Limitation matérielle documentée** : True Size n'est supporté que sur les **appareils Apple avec Face ID** (TrueDepth) — Snap ne revendique donc pas d'échelle métrique RGB-only en production.

### 5.10 Meta
Aucune documentation technique ou brevet spécifique sur la mise à l'échelle métrique de l'essayage lunettes (Ray-Ban/Instagram) n'a émergé dans cette recherche ; l'essayage Meta est réputé « cosmétique » (échelle relative au visage détecté, non métrique).

---

## 6. Apple ARKit vs Google ARCore — vérification

- **ARKit (TrueDepth)** : `ARFaceGeometry` fournit un maillage de **1 220 sommets en mètres** (métrique vraie, ancrée sur le capteur structuré). Études indépendantes : erreurs de mesures faciales de l'ordre de **<1 mm à ~1,5 mm** selon le protocole — mean discrepancy 0,387 ± 0,361 mm (EM3D vs CBCT), MAE 1,43 mm linéaire dans une autre étude, erreurs relatives 0,88–9,07 % selon l'angle de tête (ARKit distances faciales) ; ICC intra-observateur 0,96. Apple a vérifié (via l'étude MediaPipe de Google, iPhone 11) une erreur de profondeur **<2 % jusqu'à 2 m**. Distance optimale ~300–400 mm.
- **ARCore Augmented Faces** : **RGB uniquement, sans matériel spécialisé** ; fournit un **« canonical face mesh » de 468 points** défini par rapport à une pose centre-de-tête — le maillage est un modèle **canonique ajusté**, la documentation Google ne garantit **aucune échelle métrique** du visage (contrairement à ARKit). Les distances inter-landmarks ARCore ne peuvent pas être utilisées telles quelles pour un PD en mm. Confirmé par la doc développeur ([developers.google.com/ar/develop/augmented-faces](https://developers.google.com/ar/develop/augmented-faces)).
- **Pont RGB-only de Google** : **MediaPipe Iris** (blog Google Research, août 2020) — le **diamètre horizontal de l'iris est quasi constant : 11,7 ± 0,5 mm** dans toute la population ; en l'utilisant comme étalon, la distance métrique sujet↔caméra est estimée **sans matériel dédié** avec **erreur relative moyenne 4,3 % (σ 2,4 %)** (4,8 % avec lunettes). Validé contre le capteur de profondeur iPhone 11 sur 200+ participants. [Blog](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/) · [Doc](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/iris.md). Conséquence pour le PD : 4,3 % d'erreur d'échelle sur un PD de 63 mm ≈ **±2,7 mm** — utilisable pour un VTO, marginal pour la prescription.

---

## 7. Brevets « iris / limbe cornéen comme référence d'échelle »

| Brevet | Titulaire | Idée |
|---|---|---|
| [US6231188B1](https://patents.google.com/patent/US6231188B1/en) (+ [US6095650](https://patents.google.com/patent/US6095650), [US6508553B2](https://patents.google.com/patent/US6508553), [EP1123036](https://patents.google.com/patent/EP1123036A1/en)) — 1998/2001 | **Virtual Visual Devices, LLC** (inventeurs Feng Gao, Wei Li) | Système interactif de sélection de montures : centres pupillaires, distance inter-pupilles et **rayons d'iris détectés automatiquement pour déterminer l'échelle physique des photos**. Antériorité majeure (fin des années 1990) de l'iris-étalon. |
| [US10861180B2](https://patents.google.com/patent/WO2017156383A1/en) « Measurements using a single image capture device » | **Ohio State Innovation Foundation** | Mesure d'objets/distances dans une image unique en prenant le **diamètre d'iris ≈ 11,5 mm** comme étalon (ratio pixels/mm au plan du visage). |
| Famille « custom eyewear » [US20150154678A1](https://patents.google.com/patent/US20150154678A1/en) etc. | Bespoke/Topology | Mentionne l'**iris comme objet de référence possible** (« reference object can be an iris ») parmi carte/objets connus pour l'échelle du modèle de tête. |
| [US8708494B1](https://patents.justia.com/patent/8708494) | Ditto | Variante inverse : un **PD déjà connu** sert de référence d'échelle. |
| Littérature associée | — | HVID (horizontal visible iris diameter) documenté 11,6–12,0 mm pour ~50 % de la population, plage 10,5–13,5 mm chez l'adulte — c'est la variance qui plafonne la précision de toute méthode limbe-étalon (~±4 %, 2σ). |

À noter aussi, côté « échelle statistique » : des travaux académiques utilisent le **PD moyen de population** pour estimer la distance caméra-sujet (probl. inverse) — p. ex. IEEE 9733446, AppliedMath 2025 — confirmant que iris⇄PD sont les deux constantes anatomiques exploitées dans les deux sens.

---

## 8. Familles « calibration écran » et « miroir »

1. **Miroir + appareil-étalon** : Glasses.com/1-800 Contacts [US9236024](https://patents.google.com/patent/US9236024B2/en) (voir §5.1) — le téléphone photographie son propre reflet ; ses dimensions (ou un motif affiché de taille connue) donnent l'échelle au plan du visage. Aussi [US9323075B2](https://patents.google.com/patent/US9323075B2/en) « System for the measurement of the interpupillary distance using a device equipped with a screen and a camera » (méthode écran+caméra apparentée).
2. **Carte contre l'écran pour calibrer l'écran** : famille d'outils web (règles PD à l'écran, outils « frame size ») où une carte bancaire posée sur l'écran calibre les pixels/mm de l'affichage ; ensuite le visage est mesuré face à la webcam avec la carte sur le front (Zenni, FittingBox web, GlassOn…) ou une règle virtuelle est affichée à taille réelle. Les outils grand public vérifiés dans cette recherche (Zenni « Online PD Tool », GlassesUSA « prescription scanner ») exigent tous une **carte format ISO** comme référence, avec précision annoncée **±1 mm** (GlassesUSA).
3. **Réflexe cornéen + IMU** (6over6, §3) : seule famille identifiée revendiquant le PD **sans aucun objet de référence ni capteur de profondeur**, via Purkinje + estimation de distance par capteurs du téléphone.

---

## 9. Tableau de synthèse

| Acteur | Capteur | Référence d'échelle | Précision annoncée/mesurée |
|---|---|---|---|
| FittingBox (outil PD) | RGB | Carte ISO (brevet mouvement sans carte non commercialisé) | « fiable », non chiffrée publiquement |
| FittingBox (VTO) | RGB | Statistique (catégories morphologiques) | échelle « proche » seulement |
| Ditto | RGB | Carte sur le front | non chiffrée |
| 6over6 GlassesOn (PD) | RGB + IMU | **Aucune** (réflexe cornéen + distance estimée) | ANSI Z80.17, dispositif médical FDA/CE |
| Warby Parker | TrueDepth | Profondeur métrique | MAE 0,51 mm (Cureus 2023) |
| EyeMeasure | TrueDepth | Profondeur métrique | MAE 0,51 mm (Cureus 2023) |
| PDCheck AR | RGB (AR) | landmarks | MAE 1,38 mm (Cureus 2023) |
| Glasses.com (brevet miroir) | RGB | Le téléphone lui-même dans le miroir | non chiffrée |
| Zenni / GlassesUSA (web) | RGB | Carte ISO | ±1 mm |
| Auglio | RGB | Pupille/iris (constante anatomique) | ±1,5 mm dans 91 % des cas |
| MediaPipe Iris (brique) | RGB | Iris 11,7 ± 0,5 mm | 4,3 % d'erreur de distance ⇒ ~±2,7 mm sur PD |
| Snap True Size | TrueDepth (Face ID requis) | Profondeur métrique | non chiffrée |
| Zeiss VISUFIT 1000 | 9 caméras calibrées | Calibration multi-caméras (sans clip) | PD à 0,1 mm |
| Hoya visuReal Master / Move AI | 6 caméras / iPad + accessoire | Calibration / « measurement temple » connu | centrage professionnel |
| Rodenstock ImpressionIST | 2 caméras stéréo | Calibration stéréo | centrage professionnel |
| Topology | TrueDepth | Profondeur métrique | fabrication sans ajustement |
| ARKit (brique) | TrueDepth | Profondeur métrique | ~0,4–1,5 mm selon études |
| ARCore Augmented Faces (brique) | RGB | **Aucune — maillage canonique NON métrique** | n/a |

## 10. Enseignements pour une mesure RGB-only sans carte

1. **Personne ne fait de PD de prescription en RGB pur sans étalon** parmi les gros acteurs : ils utilisent soit une carte (FittingBox, Ditto, Zenni, GlassesUSA), soit la profondeur TrueDepth (Warby, Snap, Topology, EyeMeasure), soit du matériel calibré (Zeiss, Hoya, Rodenstock).
2. Les **trois seules voies « sans rien » brevetées/publiées** sont : (a) **réflexe cornéen + distance estimée par IMU/EXIF** (6over6, US10702149 — la plus aboutie, statut dispositif médical) ; (b) **iris/limbe comme constante anatomique** (US6231188 dès 1998, US10861180, MediaPipe Iris, Auglio) — plafonnée à ~±4 % par la variance du HVID ; (c) **structure-from-motion avec modèle d'œil** (FittingBox US9628697) — élégant mais jamais commercialisé seul, mal conditionné.
3. Le **« mirror trick »** (US9236024) est la façon la plus astucieuse de créer un étalon sans carte : l'appareil photo devient lui-même l'objet de taille connue dans son propre reflet.
4. L'**asymétrie iOS/Android est structurelle** : ARKit donne un visage métrique, ARCore non — d'où le « Face ID required » de Snap et le « iPhone X and above » de Warby Parker.
