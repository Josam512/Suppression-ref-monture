# VTO_HANDOFF — Essayage virtuel 2D de lunettes, passation développeur

> **Commit de référence : `92105698cf6f8ea1d35fb9a046e81f524fb8b398`** (bandeau `b13 · 9210569`),
> branche `claude/vto-reliability-master-spec-3l4imj`. CI GitHub verte (jobs `ci` + `soak`,
> run n°8) sur ce commit exact. **Lire `CLAUDE.md` avant toute modification** : c'est le
> contrat du projet (ce document-ci est un guide de lecture, jamais une source qui prime).

---

## 1. Architecture — rôle de chaque dossier/fichier

Quatre moteurs découplés : **A tracking** (visage), **B rendu** (monture sur canvas),
**C métrologie** (mesures mm), **D verdict** (légende chiffrée — jamais un jugement, §0.0.1).
Règle mécanique : aucun fichier `src/` > 300 lignes (garde testée), hook pre-commit
(`.githooks/pre-commit`) = typecheck + 476+ tests + barrages grep.

```
index.html / calib.html / prep.html / diagnostic.html   pages Vite (entrées de build)
src/
  core/            ZONE CRITIQUE, calcul pur, 100 % testée, gelée hors demande explicite
    geom.ts            dist, midpoint, px, smoothstep, CalibrationError
    calibration.ts     iris/carte/monture portée → largeur visage mm (SEUL fichier à lire cal.source)
    faceMetrics.ts     indices landmarks nommés, frameMetrics (livePxPerMm), rollRadOf, poseAnchorOf
    transform.ts       L'UNIQUE affine sprite→écran (spriteAffine, spriteToScreen)
    frameSpec.ts       parseur strict de spec.json, totalFrameWidthMm (alphaBBox, jamais img.width)
    verdict.ts         légende chiffrée (classify par intervalles, seuil proportionnel 3–5 mm)
    renderPose.ts      échelle de POSE provisoire par iris (diagnostiquée, jamais muette)
    pupillary.ts / pdAssembly.ts   PD direct pupille↔pupille + correction distance, bornes 40–80 mm
    temporalWidth.ts / parallax.ts / depthFit.ts   écart temporal MESURÉ par rotation (remplace la constante)
    cardFinder/cardEdges/cardRefinement/cardPose/cardSweep/cardOptics/cardAssembly.ts
                       la carte bancaire = MIRE (détection auto sur le film, coins raffinés,
                       homographie → focale → distance) ; « une carte pointée produit TOUJOURS
                       une calibration »
    autoCalibration/autoCalibrate/autoMeasures/autoSeries/autoStatus/autoTuning.ts
                       moteur de mesure automatique (collecte, convergence, statut affiché)
    cameraProfile.ts   profil de focale par IDENTITÉ d'objectif (deviceId/facing/aspect/zoom)
    scaleStability.ts / irisQuality.ts / ocularScale.ts / crossCheck.ts   portes de stabilité,
                       qualité d'iris, échelle périoculaire, contrôle iris↔carte (signale, ne rejette pas)
    invariants.ts      invariants runtime observés (violations comptées, jamais silencieuses)
    versions.ts        AUTO_METROLOGY_VERSION, FRAME_SPEC_VERSION, CAMERA_PROFILE_VERSION,
                       versions PAR MÉTRIQUE, APP_BUILD_TAG (b13), GIT_SHA (injecté au build)
  tracking/        moteur A — seul module qui touche MediaPipe
    FaceTracker.ts     l'ABSTRACTION : interface {id, strategy, topology, init, detect, dispose},
                       FaceTrackingResult {timestampMs, landmarks, yawRad, rollRad, confidence,
                       backend, yawAgreement?}, TrackerHealth (sonde PROBE_REQUIRED_SUCCESSES=3)
    backends/MediaPipeTracker.ts   LE backend (avec landmarker.ts, seul code à toucher
                       FaceLandmarker/detectForVideo) ; yaw matrice OU landmarks
    faceTopology.ts    points sémantiques NOMMÉS déclarés par le backend (pupilles, sellion,
                       côtés, canthi, oreilles, iris) ; la validation de sortie en dérive
    strategyCatalog.ts CATALOGUE de 10 stratégies {GPU/CPU}×{vidéo/canvas}×{matrices ON/OFF}
                       + marge + seuils réduits — ordre : graph MINIMAL d'abord (gpu-sans-matrice…)
    detectionPlan.ts / planState.ts   machine d'états de la NÉGOCIATION (élimination temporelle,
                       tour circulaire, stable = 5 landmarks CONSÉCUTIFS, tours de renégociation)
    modelLifecycle.ts / inferenceNotes.ts   cycle de vie (UNE Task à la fois, fermer-avant-créer,
                       watchdog, santé par sonde de VISAGES, tempête espacée 250 ms)
    taskWatchdog.ts    création sous échéance, résolution tardive FERMÉE
    frameFeed.ts / frameInput.ts   flux caméra (rVFC→RAF), validité de frame, routage
                       vidéo/canvas/marge, validation de sortie par topologie
    faceLoop.ts / loopTypes.ts   orchestration couches 1-4, stats/santé, erreur intégrale
    yaw.ts             yawFromMatrix (rotation SEULE) et yawFromLandmarks (paire 234/454)
  render/          moteur B — pixels
    composite.ts       drawFrame : setTransform(spriteAffine) + drawImage ; dilatation V2
    temple.ts          branches (sprite profil, charnière, occlusion destination-out)
    overlay.ts         cotes, compteurs, alarmes — le chemin d'échec DESSINE (§1 bug #3)
    recolor.ts / recolorLive.ts / ycc.ts   V2 « 2,5 D » : recoloriage des pixels réels
  ui/              React + état vivant
    TryOn.tsx / useTryOnLoop.ts   branchement caméra→essayage, 3 enveloppes try/catch
                       (tracking/métrologie/rendu), métrologie DÉCIMÉE ~15 Hz APRÈS le rendu
    useCameraLoop.ts   getUserMedia sous échéance unique, onReady (modèle CRÉÉ) puis
                       onTrackerProven (premier VISAGE validé → collectes d'arrière-plan)
    renderScene.ts     paintScene (pose, échelle, saut aperçu→calibré instrumenté), paintLost
    sceneScale.ts      LA décision d'échelle, pure : métrique → pose iris → VISUELLE → null
    visualScale.ts     échelle visuelle de secours (référence de SESSION figée)
    poseFilter.ts      One-Euro de POSE (rendu seul, jamais la métrologie)
    liveState.ts       l'état vivant (cal, sprites, compteurs, visualRefWidthMm…)
    useAutoCalibration.ts   pump() : le pont vers le moteur C (landmarks bruts)
    calibrationStorage/cameraStorage/detectionMemory/personSession/measurementStore/pdCarry.ts
                       persistance versionnée (localStorage), mémoire de stratégie d'appareil
    devHud.ts          HUD ?hud=1 : build/sha, santé backend, négociation, erreurs intégrales
    catalogue.ts / useSprites.ts / assetUrl.ts   fiches montures, chargement, SEUL constructeur
                       d'URL de fichier servi (base /<repo>/ sur Pages)
    freezeFrame.ts / RotationStep / CardCalibration / WornFrameCalibration / MeasuresPanel…
  diag/diagMain.ts  page /diagnostic.html : essaie TOUT le catalogue sur la caméra réelle,
                       tableau Init/Inférence/Landmarks/Erreur intégrale (outil, jamais lié du produit)
  prep/            outils internes hors-ligne (marquage des cotes, bbox alpha, calibration lot 8)
public/
  models/face_landmarker.task   modèle vendorisé (478 pts, iris) — zéro CDN
  frames/<slug>/{front.png, profile.png, spec.json} + index.json   catalogue de montures
  wasm/            NON versionné — recopié de node_modules par scripts/sync-wasm.mjs
scripts/         bancs et chaîne CI : ci.mjs (10 étapes), faults.mjs (S1–S19), chaos.mjs,
                  soak.mjs, journey-no-card.mjs, smoke.mjs, make-face-y4m.mjs, sync-wasm.mjs,
                  build-single-file.mjs (app en UN html)
tests/           47 fichiers vitest (§14) + fixtures (landmarks figés, tête 3D synthétique)
.github/workflows/ci.yml (jobs ci+soak) · pages.yml (déploiement gh-pages)
docs/ARCHITECTURE.md (6 règles produit) · PROGRESS.md (journal complet, lot par lot) · CLAUDE.md
```

## 2. Flux de données exact

```
getUserMedia (1280×720 ideal, facingMode user, échéance unique 15 s)
  → frameFeed (rVFC, repli RAF si le flux cale) → FrameSnapshot + validité (noire/uniforme/vide)
  → detectionInput (stratégie : <video> direct | canvas | canvas letterboxé padFraction)
  → MediaPipeTracker.detect(input, ts strictement croissant par génération de Task)
      = FaceLandmarker.detectForVideo → 478 landmarks + yaw (matrice si la stratégie en produit,
        sinon yawFromLandmarks) → FaceTrackingResult
  → validation frontière (landmarksInvalidReason CONTRE la topologie du backend)
  → faceLoop : santé (noteValidFace → sonde), négociation (planStep), unpad éventuel
  → useTryOnLoop.renderFrame :
      1. RENDU (enveloppe try/catch) : paintScene
         - pose : roll (canthi), ancre (X sellion, Y ligne des yeux), yaw
         - échelle : resolveSceneScale (cal → frameMetrics.livePxPerMm |
                     pose iris renderPoseScaleDiagnosed | VISUELLE facePx/visualRefWidthMm | null)
         - One-Euro poseFilter → garde NaN → FrameMetrics {livePxPerMm, rollRad, yawRad, poseAnchor, ear}
         - drawScale = livePxPerMm / spec.spritePxPerMm → spriteAffine → drawImage(front.png)
         - branches (temple.ts) + occlusion + verdict (LÉGENDE seulement, après renderedFrames++)
      2. MÉTROLOGIE (enveloppe séparée, décimée 66 ms) : pump(landmarks BRUTS)
         → moteur auto (iris, carte filmée, rotation → temporal/parallaxe/focale/distance)
         → UserCalibration {faceWidthMm, source, relError, pdMm?, temporalWidthMm?…}
         → persistance versionnée. Le renderer ne lit JAMAIS ce store en direct : il lit live.cal.
```
Détection perdue → onLost : hold ≤ 180 ms (repeindre la dernière pose), puis alarme dessinée
avec la CAUSE (invalid-input / model-pending / inference-error / invalid-landmarks / no-face).

## 3. Les six règles produit (docs/ARCHITECTURE.md — texte de référence là-bas)

1. Le tracking ne dépend pas de la métrologie.
2. Le rendu ne dépend pas de la métrologie (aucune ligne ne lit pd/halfPd/temporal/verdict-gate).
3. La métrologie peut échouer entièrement sans rien casser (enveloppes ; « PD : non disponible »).
4. Le backend de tracking est remplaçable (hors `backends/`, personne n'importe FaceLandmarker).
5. Aucun modèle/délégué n'est supposé universel : catalogue négocié par ÉLIMINATION réelle,
   jamais de règle `if <appareil>`.
6. Une stratégie n'est saine que si elle PRODUIT des landmarks : sonde = 3 visages VALIDÉS
   (une inférence vide ne compte pas), stable = 5 frames validées CONSÉCUTIVES ; catalogue
   épuisé → tours de renégociation périodiques tant que rien n'a été prouvé dans la session.

## 4. Métadonnées de monture — format réel (`public/frames/<slug>/spec.json`)

Champs mesurés AU RÉGLET puis marqués dans l'outil de prep (validation stricte au chargement :
champ manquant = CalibrationError nommant le champ, jamais une valeur par défaut) :

| Champ | Sens | Exemple (ecaille-claire) |
|---|---|---|
| `aMm` | cote A (largeur d'un verre) | 47.0 |
| `bMm` | cote B (hauteur de verre) — optionnelle, durcit le contrôle de cohérence | 43.0 |
| `pontMm` | DBL / pont (bords intérieurs des verres) | 22.0 |
| `totalWidthMm` | largeur TOTALE bord à bord — **mesurée** = alphaBBox.w / spritePxPerMm, jamais 2A+DBL | 136.0 |
| `brancheMm` | longueur de branche | 145.0 |
| `spritePxPerMm` | échelle 1 du sprite (contrôle 2-3 cotes, cohérence ≤ 2,5–4 %) | 6.7868 |
| `alphaBBox` | bbox du canal alpha {x,y,w,h} px sprite — SEULE source de la largeur (B3) | {0,0,923,320} |
| `bridgeCenter` | ancre : centre du pont (px sprite) | {455, 66.5} |
| `lensCenterL/R` | centres optiques (décentrement §5) | {225, 159.5} / {685, 158} |
| `hingeProfile` | charnière sur le sprite de PROFIL (ancre des branches) | {0, 186.5} |
| `profileViewAngleDeg` / `profilePxPerMm` / `templeRectifiedMm` | géométrie du sprite de profil (FRAME_SPEC_VERSION 2 : longueur de référence rectifiée) | 29.46 / 4.8605 / 174.5 |
| `front` / `profile` | fichiers PNG détourés (canal alpha = la FORME ; on ne dessine jamais) | front.png / profile.png |
| `calibratedAt` | date de marquage | 2026-08-16 |

**Tenons** : pas de champ — leur avance (~8 mm) est un résidu documenté NON corrigé
(`ENDPIECE_AHEAD_MM`, §14.4 CLAUDE.md : corriger déplacerait l'erreur). **Masques/textures** :
il n'y en a PAS — la silhouette EST le canal alpha du PNG ; le mode V2 recolore les pixels
réels de la vidéo (`render/recolor*.ts`), il ne plaque pas de texture. `index.json` liste les slugs.

## 5. Formules

- **Pose sur le nez** (`poseAnchorOf`, sans paramètre libre — §14.6) : X = sellion (168) ;
  Y = ligne des yeux (moyenne des 4 canthi 33/133/263/362 — jamais les iris, qui bougent avec
  le regard). Convention déclarée : plaquettes réglées pour centres optiques à hauteur de pupille.
- **Échelle visuelle de secours** (`visualScale.ts`) : `pxPerMm = facePx / visualRefWidthMm`,
  facePx = dist(px(234), px(454)) ; `visualRefWidthMm` = **référence de SESSION figée** (largeur
  totale de la PREMIÈRE monture affichée), jamais la monture en cours — une 150 mm reste 25 %
  plus large qu'une 120 mm. Jamais persistée, jamais vue par la métrologie, légende gelée.
- **Pixels ↔ mm, les 3 échelles** (§4 CLAUDE.md) :
  1. sprite : `spritePxPerMm` (marquage, contrôle multi-cotes) ;
  2. visage : `cal.faceWidthMm` (iris 11,7 mm ±4,3 % / carte ISO 85,60 mm ±2,5 % /
     monture portée ±2 %) ;
  3. frame : `livePxPerMm = (faceWidthPx / cos(min(|yaw|, 0.70))) / cal.faceWidthMm` —
     dé-projection AVANT conversion (S1), échelle isotrope.
  Rendu : `drawScale = livePxPerMm / spritePxPerMm` — aucun paramètre libre.
- **PD** : direct pupille↔pupille (468↔473) en px / échelle de la frame ; conversion
  près→loin `PD_loin = PD_mesuré × (D + 13,5) / (D + 3,05)` (D = distance caméra en cm,
  `pupillary.ts`) ; bornes de plausibilité 40–80 mm (`pdAssembly.ts`). **Demi-PD** :
  pupille↔sellion par côté, collectées de face (|yaw| ≤ MAX_SPLIT_YAW_RAD), asymétrie conservée.
- **Largeur temporale** : MESURÉE client par client depuis les deux vues tournées de la séance
  filmée (`temporalWidth.ts` + `parallax.ts`) ; remplace la constante `FACE_WIDTH_CORRECTION_MM`
  (encore 0, jamais calibrée) ; échec ⇒ constante + refus DIT + marge élargie.
- **Distance caméra** : la carte est une MIRE — 4 coins raffinés sur les pixels → homographie →
  focale (`cardPose.ts`, moyennée sur le BALAYAGE : 1 vue = ±20-25 %, 50+ vues = ±4-8 %) →
  `distance = focalePx × largeurRéelle / largeurPx`. Profil de focale persistant par identité
  d'objectif (`cameraProfile.ts`).
- **Rotations** : roll = atan2 sur la ligne des yeux ; yaw = matrice de pose (rotation SEULE,
  `atan2(r02, r22)`) OU landmarks `θ = atan2(z454−z234, hypot(Δx,Δy))` (X0 s'annule — validé
  < 1,5° à 0/10/20/30°, `tests/yawvalidation.test.ts`) ; le cos(yaw) s'applique UNE fois,
  horizontalement, dans `spriteAffine` (composante a ; jamais la verticale — S1).
- **Occlusion** : Path2D de l'ovale du visage + `destination-out` sur la portion intérieure
  des branches (elles passent DERRIÈRE la joue).

## 6. Où la largeur physique de la monture entre dans le rendu

1. **`core/transform.ts` → `spriteAffine`** — l'UNIQUE matrice : `s = livePxPerMm /
   spec.spritePxPerMm`, ancrée sur `spec.bridgeCenter` et la bbox alpha ; c'est là que les mm
   de la monture deviennent des pixels d'écran. Personne d'autre ne compose de transformée.
2. **`core/frameSpec.ts` → `totalFrameWidthMm`** = `alphaBBox.w / spritePxPerMm` — la largeur
   AFFICHÉE dans la légende et comparée au visage (verdict).
3. **`ui/renderScene.ts`** — `visualRefWidthMm ??= front.spec.totalWidthMm` : la largeur de la
   PREMIÈRE monture fige la référence de l'échelle visuelle de secours (session).
4. La dilatation V2 (`OVERLAY_PADDING_MM = 1.5`) épaissit la silhouette en mm réels sans
   changer la largeur (halo par redessins décalés, vérifié au banc sur pixels peints).

## 7. Les branches (temples) selon la vue

- **Face (|yaw| < ~6°)** : invisibles — `templeAlpha = smoothstep(0.10, 0.45, |yaw|)` ≈ 0.
- **Trois-quarts** : révélation progressive par le smoothstep ; le sprite de profil est ancré à
  la charnière (`hingeProfile`), sa longueur calibrée par `templeRectifiedMm` (la photo de
  profil est rectifiée par `profileViewAngleDeg`/`profilePxPerMm`) ; occlusion derrière la joue.
- **Profil marqué** : branche pleinement opaque du côté visible ; la légende chiffrée est GELÉE
  au-delà de 12° de yaw (règle 3), l'échelle n'est plus réestimée au-delà de 0,70 rad — le
  filtre TIENT la dernière valeur sûre (pas de « respiration »). L'image, elle, ne disparaît jamais.
- Série verrouillée par tests : `yawseries` (0→40°, hauteur constante, cos une fois),
  `tests/recolor` et bancs S3 (profil 404 ⇒ face seule, absence DITE).

## 8. Stabilisation, confiance, fallback, lissage

- **One-Euro** sur la pose du rendu SEUL (`poseFilter.ts`) — la métrologie lit les landmarks bruts.
- **Hold de micro-perte** : ≤ 180 ms (`RENDER_HOLD_MS`), dernière pose repeinte, puis alarme.
- **Échelle** : hiérarchie métrique → pose iris (refus DIAGNOSTIQUÉ : plancher de quantification
  3 px, discordance d'iris…) → visuelle de secours → attente EXPLIQUÉE (A6, jamais un canvas muet).
  Transition aperçu→calibré INSTRUMENTÉE (`live.scaleJump`, ratio loggé), pas lissée en douce.
- **Santé backend** : idle→initializing→probing(n/3 VISAGES)→healthy | degraded(tempête) |
  failed — publiée dans `__VTO_HEALTH__` et au HUD. `confidence` vaut 1 (FaceLandmarker VIDEO
  n'expose pas de score — documenté, jamais présenté comme mesuré).
- **Négociation** : 3 erreurs consécutives (jamais prouvée) → stratégie suivante ; prouvée →
  10 erreurs → recréation → 10 → suivante ; catalogue épuisé → tentatives espacées 250 ms +
  NOUVEAU TOUR après 20 s (tempête) / 30 s (silence, seulement si rien n'a jamais été prouvé).
  Stratégie stable (5 consécutives) → mémorisée par appareil (`essayage.detection.v1`).
- **Watchdogs** : création de Task (15 s, résolution tardive fermée), chaîne caméra (15 s,
  échéance unique), flux (bascule rVFC→RAF comptée), invariants observés (≤ 1 Task vivante).

## 9. Feature flags et outils internes

Pas de framework de flags — des URL et des pages dédiées :
- `?hud=1` : HUD de diagnostic superposé (build·sha, santé, négociation, erreurs intégrales).
- `?resetSession=1` : purge la mémoire de stratégie d'appareil (bancs déterministes).
- `/diagnostic.html` : ladder EXHAUSTIF du catalogue sur la caméra réelle (outil d'appareil,
  déployé, jamais lié depuis le produit).
- `/prep.html` : marquage des cotes + bbox alpha des montures (retiré du déploiement).
- `/calib.html` : outil de calibration du lot 8 (retiré du déploiement).
- Mode `store` (V2 magasin) : monture portée comme étalon + recoloriage 2,5 D — choix par
  PRÉSENCE DE DONNÉE, jamais par un `if (mode)` dans core/render (§11.4).
- `npm run single` : toute l'app dans UN fichier HTML (~10 Mo) à envoyer tel quel.
- `__VTO_HEALTH__` (window) : télémétrie passive lue par les bancs.

## 10. Commandes

```bash
npm ci                    # installation reproductible (package-lock)
npm run hooks:install     # ACTIVER le hook pre-commit (core.hooksPath) — à faire au premier clone
npm run dev               # serveur Vite http://localhost:5173 (secure context obligatoire)
npm run typecheck         # tsc strict, zéro émission
npm test                  # vitest (486 tests)
npm run build             # typecheck + vite build → dist/ (prebuild recopie le wasm)
npm run preview           # sert dist/
npm run ci                # LA chaîne complète (10 étapes : sync-wasm, typecheck, tests, build,
                          #  single, smoke, journey, faults S1–S19, chaos…) ~8 min
npm run faults|chaos|soak|journey|smoke   # bancs individuels (Chromium + fake video .y4m)
npm run single            # app autonome en un HTML
```
Environnement : Node 20, Chromium requis pour les bancs (`npx playwright install --with-deps
chromium`). Les fixtures `.y4m` sont générées à la demande (`scripts/make-face-y4m.mjs`).

## 11. CI et déploiement — secrets/config

- **`.github/workflows/ci.yml`** : sur push/PR de cette branche — job `ci` (npm ci → playwright
  install → `npm run ci`) + job `soak` (6 min d'endurance) en parallèle. **Aucun secret requis.**
- **`.github/workflows/pages.yml`** : ⚠️ particularités à connaître :
  - seul un workflow porté par la branche PAR DÉFAUT peut déployer → une COPIE de pages.yml vit
    sur `main`, mais on **dispatche toujours sur le ref de la branche de travail** (sa copie à
    elle) — la copie de `main` référence une APP_BRANCH périmée ;
  - Pages est en mode « branche » : publier = pousser `dist/` sur `gh-pages` (le job le fait
    avec le `GITHUB_TOKEN` automatique — **aucun secret à configurer**) ;
  - `VITE_BASE=/<repo>/` obligatoire (assetUrl.ts est le seul constructeur d'URL servie) ;
  - `.nojekyll` indispensable (sinon Jekyll avale le wasm) ; `prep/calib.html` retirés,
    `diagnostic.html` conservé délibérément.
- **Preview provisoire** : dispatcher pages.yml sur le ref de la branche → 
  `https://<owner>.github.io/<repo>/` ; ou `npm run dev` ; ou envoyer le fichier de `npm run single`.

## 12. Les six commits du ré-audit (2026-08-23, `529b39d..9210569`)

1. `529b39d` — **(bloquant)** échelle visuelle : référence de SESSION figée, plus jamais la
   monture en cours (le rapport de tailles entre montures est préservé).
2. `2d9ebd7` — santé par VISAGES validés (noteValidFace), whenProven (métrologie d'arrière-plan
   au premier visage), stabilité CONSÉCUTIVE, prudence réservée aux stratégies PROUVÉES,
   tours de renégociation (tempête 20 s / silence 30 s) ; `inferenceNotes.ts` extrait.
3. `ceab706` — rendu D'ABORD, métrologie ensuite, décimée ~15 Hz (frames ET pertes).
4. `29d7946` — banc de validation du yaw par landmarks (perspective exacte, 0/10/20/30°).
5. `c5dde39` — topologie canonique (`faceTopology.ts`) : points nommés déclarés par le backend,
   validation de sortie dérivée, test de remplaçabilité (maillage 68 pts).
6. `9210569` — `b13 · <sha>` au bandeau, règle 6 durcie dans ARCHITECTURE.md, journal PROGRESS.

## 13. Limites, bugs connus, zones sensibles

**Limites assumées (documentées, ne pas « réparer » sans lire le contrat)**
- Second moteur de tracking ABSENT : les 10 stratégies sont 10 configurations de MediaPipe
  Tasks Web. La topologie rend le branchement possible ; l'ajout (TF.js/WebNN) = nouvelle
  dépendance ⇒ validation humaine obligatoire (CLAUDE.md §9.1-8).
- Rendu/métrologie indexent encore les constantes MediaPipe de `core/faceMetrics.ts`
  (migration vers les accesseurs nommés = lot suivant, avec le second moteur).
- `FACE_WIDTH_CORRECTION_MM = 0` (jamais calibrée) — supplantée par l'écart temporal MESURÉ
  quand la séance aboutit ; sinon la légende reste décalée et la marge le dit.
- Précisions plancher : iris 4,3 % (biologique, AUCUN moyennage ne l'améliore), carte 2,5 %
  (parallaxe B4), « 132 sur 138 » rend `indetermine` — c'est VOULU (B2+B4+T8).
- Constat de banc S19 : la métrologie CONVERGE même yeux occlus (MediaPipe INFÈRE des iris
  plausibles sous un bandeau) — à confronter au réel avec de vraies lunettes portées.
- Validation matérielle Samsung du catalogue encore À FAIRE (c'est le but de /diagnostic.html).
- `confidence: 1` est une constante documentée, pas une mesure.

**Zones sensibles — NE PAS CASSER**
- Les tests INVARIANT et GARDE-FOU sont sacrés : s'ils rougissent on répare le CODE.
- Jamais de division de l'échelle visuelle par la monture en cours (ré-audit, pt 3).
- Timestamps `detectForVideo` STRICTEMENT croissants par génération de Task ; UNE seule Task
  vivante (fermer avant créer) — invariant observé à chaque frame.
- `cal.source` ne se lit QUE dans calibration.ts (barrage grep) ; aucune constante de taille
  de visage en dur (§0.0.3) ; aucun slider de taille (§1 bug #1) ; aucune 3D (§0).
- `img.width` interdit dans la chaîne de mesure (B3 : tout passe par alphaBBox).
- Signatures du §7 (CLAUDE.md) FIGÉES — toute modification exige l'accord humain.
- Le hook pre-commit et `tests/meta.test.ts` (plancher 476) rendent les contournements visibles.
- Fichiers `src/` ≤ 300 lignes (garde `split('\n').length`, donc 299 lignes réelles + finale).

## 14. Inventaire des tests et scénarios de référence

**47 fichiers vitest (486 tests)** — par thème :
- Échelles/géométrie : `scale` (sprite, B3, B5, seuils), `plane`, `framedims`, `transform`
  via `pose`/`yawseries` (hauteur constante sous yaw, cos une fois), `scenescale`,
  `visualscale` (référence de session), `firstscale` (refus diagnostiqué).
- Verdict/légende : `verdict`, `guards` (B2 balayé sur un domaine, 300 lignes, vocabulaire),
  `nonadaptation` (la calibration ignore la monture bit à bit), `coherence`.
- Calibration/carte : `capture` (une carte pointée produit TOUJOURS une calibration),
  `cardedges`, `cardfinder` (lisière plus contrastée que la carte), `cardpose` (focale),
  `calib`, `camera` (profil par identité), `autocal`, `autogates`, `ocular`, `ocularscale`,
  `irisQuality` via `stability` (4 portes).
- PD/temporal : `pdindependence` (PD direct), `halfpd` (asymétrie conservée), `pdcarry`,
  `pupillary` via `fit`, `temporal`, `temporal-auto`, `temporalepoch` (échelle de LA frame),
  `fronttemporal`, `nosecontact` (repos = nez observé).
- Tracking/négociation : `detection` (élimination temporelle, preuve consécutive, tours),
  `lifecycle` (une Task, watchdog, sonde par visages, whenProven, tour de tempête),
  `detectionmemory`, `topology`, `yawfallback`, `yawvalidation` (0/10/20/30°), `deadline`.
- Rendu : `posefilter`, `recolor` (V2 2,5 D), `livesteps`.
- Persistance : `storage` (versions/migration), `persistence` (versions par métrique).
- Méta : `meta` (plancher statique de `it(`).
Fixtures : `tests/fixtures/landmarks.ts` (jeux figés), `head3d.ts` (tête synthétique en
perspective EXACTE — vérité terrain opposable), `builders.ts`, `scene.ts` ; `.y4m` générés
(`face`, `face-shades` bandeau sur les yeux, `black`).

**Bancs navigateur (Chromium, fake video)** — `npm run ci` les enchaîne :
- `smoke` : preuve MÉTROLOGIQUE du rendu (pixels peints re-mesurés en mm, 8 contrôles).
- `journey` : parcours complet Cas A (sans carte) / Cas B (focale héritée) — PD concordants.
- `faults` : matrice S1–S19 — S1 localStorage KO · S2 front 404 · S3 profil 404 · S4 spec
  corrompu · S5 tempête d'exceptions de rendu · S6 rVFC muet · S7 calibration d'ancienne
  version · S8 frames noires · S9 échelle montée par élimination (silence GPU) · S10 profil
  focale d'un autre appareil · S11 getUserMedia pendu · S12 play() pendu · S13 WebGL absent
  (tempête, survie, sortie carte) · S14 sprite tardif d'une autre monture · S15 client A→B ·
  S16 profil caméra incompatible · S17 stratégie mémorisée re-prouvée · S18 mémoire fantôme →
  nominal · S19 lunettes AVANT la métrologie (yeux occlus, rendu sans calibration).
- `chaos` : sabotages aléatoires 100 s — « la session récupère ou dit pourquoi ».
- `soak` : endurance 6 min (heartbeat, mémoire, une Task, PD immuable).

---
*Généré pour la passation au commit `9210569`. Le journal détaillé (pourquoi chaque décision)
est dans `PROGRESS.md` ; le contrat opposable est `CLAUDE.md`.*
