# Tableau de conformité — guide maître de fiabilisation (80 pts) + complément (47 pts)

Audit du 2026-08-21 sur `claude/virtual-try-on-no-card-434axf` @ b51644c (309 tests verts).
Colonnes : **État** = constaté avant travaux · **Action** = ce que la présente branche fait.
Statuts : ✅ déjà conforme · 🔴 bug confirmé · 🟠 risque/partiel · ⚪ non applicable (hors périmètre V1 courant).

## Guide maître (1–80)

| # | Point | Fichier(s) | État | Action | Tests | Interférence |
|---|---|---|---|---|---|---|
| 1 | 4 moteurs découplés (A tracking / B rendu / C métrologie / D verdict) | toute la chaîne | 🔴 C bloque B (`cal===null`→pas de rendu via `calibrateAuto` provisoire), une exception C ou B tue A (rVFC) | règle de non-interférence dans ARCHITECTURE.md ; try/catch séparés ; `renderPose` sans métrologie | journey + chaos | pivot de tout le reste |
| 2 | Monture dès les premiers landmarks | TryOn, renderScene, catalogue | 🔴 prérequis : catalogue entier + front+profil + iris OK | catalogue lazy 1re monture, sprites séparés, échelle de pose tolérante | journey étape 5 | avec 3–5 |
| 3 | Aperçu sans `calibrateAuto()` | provisionalScale.ts | 🔴 fabrique une fausse calibration complète (PD 40–80, faceWidth 95–175 rejettent la frame → monture invisible) | `core/renderPose.ts` : échelle de pose seule, aucune validation anatomique ; maintien dernière échelle si iris douteux | renderpose.test | ne pas réutiliser pour la légende |
| 4 | FRONT et PROFIL indépendants | useSprites.ts | 🔴 `Promise.all` : profil KO → face KO | états `front`/`profile` séparés, timeout par image | sprites.test | renderScene lit les deux séparément |
| 5 | Catalogue jamais bloquant | catalogue.ts | 🔴 `Promise.all` fatal ; pas de 1re monture prioritaire | index → défaut d'abord → reste en `allSettled`, entrée invalide isolée | catalogue.test | FramePicker affiche les erreurs par fiche |
| 6 | 1 seule Task lourde en production | faceLoop, faceProbe | 🔴 sonde FaceDetector dans la boucle produit | sonde retirée du chemin produit (élimination temporelle suffit) ; reste dispo pour l'atelier | detection.test adapté | plan simplifié |
| 7 | Précharge + cache modèle | landmarker, useCameraLoop | 🔴 re-fetch 3–4 Mo à chaque swap ; modèle après caméra | cache octets+fileset en mémoire, `preloadLandmarkerAssets()` parallèle à getUserMedia | detection.test | — |
| 8 | Watchdog création MediaPipe | faceLoop | 🔴 `createFromOptions` pendu = swap éternel | `Promise.race` + timeout, états creating/ready/timed-out/failed | detection.test | avec 9 |
| 9 | Swap transactionnel | faceLoop | 🟠 close-old-then-create ; échec → retente mais fenêtre morte | create-new-d'abord → close old ; échec/timeout → l'ancien reste vivant | detection.test | — |
| 10 | recoverableWarning ≠ fatalError | faceLoop, useCameraLoop, TryOn | 🔴 `onError`→`phase=error` même si CPU continue | canal `onWarning` (bandeau) vs `onError` (aucune stratégie ne tient) | smoke | — |
| 11 | Fallback initial rapide | detectionPlan | 🔴 120 frames/marche ≈ 8 s×3 | montée par élimination en **ms** (2 500 ms/marche en acquisition initiale) | detectionplan.test | avec 12 |
| 12 | Durées, pas frames | detectionPlan, TryOn hold | 🔴 120/30 frames ; hold 5 frames | seuils en ms partout (plan, hold) | detectionplan.test | avec 49 |
| 13 | rVFC ne meurt jamais | frameFeed | 🔴 `emit()` lève → plus de tick | try/catch/finally, erreur comptée+nommée, tick toujours réarmé | framefeed.test + banc render-throw | pivot |
| 14 | Watchdog du flux de frames | frameFeed | 🔴 absent | sentinelle ~1 s : caméra live+readyState≥2 sans frame → diag `rvfc-stalled` + repli RAF | framefeed.test + banc | — |
| 15 | Grand canvas sans `willReadFrequently` | frameFeed | 🔴 forcé CPU pour un sampler 16×16 | sampler 16×16 séparé (lit la vidéo), grand canvas sans option | — (perf) | — |
| 16 | Validation landmarks à la frontière | faceLoop | 🔴 aucune (length/finitude non vérifiées avant `at(473)`) | `validateLandmarks` : ≥478, indices critiques finis → frame `invalid-landmarks` locale | detection.test | avec compl.12 |
| 17 | try/catch séparés tracking/métrologie/rendu | TryOn.renderFrame | 🔴 tout dans le même flux, une exception remonte au feed | 3 enveloppes indépendantes + compteurs d'erreurs | banc drawImage-throw | avec 13 |
| 18 | Horloge de tentative | autoCalibration | 🔴 `evaluate()` sort si `firstUsefulMs===null` → 0 bonne frame = mesure éternelle | 3 horloges : `sessionStartedAt`/`attemptStartedAt`/`firstUsefulAt` ; timeout sur `attemptStartedAt` | autocal.test | avec 19–20 |
| 19 | Retry = fenêtre propre | autoCalibration | 🔴 échantillons conservés entre tentatives (40 cm mêlés à 60 cm) | reset atomique de tous les tampons + `generation++` à chaque tentative | autocal.test | ne PAS jeter les métriques déjà **publiées** (20) |
| 20 | Jamais supprimer une mesure validée par une autre | useAutoCalibration | 🔴 `calibrateAuto` lève (faceWidth) → PD perdu | `MeasurementStore` : PD publié survit aux échecs faceWidth | measures.test | avec 21/26 |
| 21 | PD sous-système indépendant | autoCalibrate, liveState | 🔴 tout-ou-rien dans `calibrateAuto` | assemblage scindé `assemblePd`/`assembleFaceScale`, états `pd.total`/`pd.halves` séparés | pd.test | — |
| 22 | PD total = distance pupille-pupille | autoCalibration | 🔴 `pdSum = rightPx+leftPx` (somme des projections sellion) | accumuler `pdPx × mmPerPx` directement | pupillary.test | halves inchangées |
| 23 | Sellion : gardes sur t | pupillary | 🔴 aucune garde (t hors [0,1] → pseudo demi-PD) | `t` retourné + rejet demi-PD si hors [0,15 ; 0,85] ; frame garde PD total | pupillary.test | avec compl.14 |
| 24 | MIN_SPLIT_FRAMES appliqué | autoCalibrate | ✅ appliqué à l'assemblage | test de sortie explicite ajouté (compl.15) | halfpd.test | — |
| 25 | Jamais PD/2 | pupillary | ✅ mesures individuelles | test conservé | halfpd.test | — |
| 26 | PD indépendant de faceWidth | autoCalibrate + finishAuto | 🔴 un `throw` faceWidth jette le PD (et réciproquement) | assemblage scindé + store (20–21) | pd.test | — |
| 27 | PD visible en permanence | TryOn/panneau | 🔴 seulement notices éphémères | panneau mesures permanent (état PD/OD/OG/largeur depuis le store) | banc | avec compl.28 |
| 28 | Calibration existante n'empêche pas un PD manquant | TryOn.onReady | 🔴 `cal!==null → essayage`, jamais de collecte | tests de capacités : `hasPD` faux → `startAuto()` en tâche de fond, rendu conservé | storage.test + banc | avec 57–58 |
| 29 | Estimateur iris verrouillé | ocularScale/engine | 🔴 bascule HVID↔HVID+PFL frame par frame | double accumulation, choix UNE fois à la conclusion (majorité) | autocal.test | — |
| 30 | Iris = métrologie, pas tracking | renderScene/provisional | 🔴 iris douteux → `null` → pas de monture | `faceTracked` vs `irisMetricQuality` ; pose maintenue sur dernière échelle | renderpose.test | avec 3 |
| 31 | Critères PD ≠ critères face scale | engine | 🟠 mêmes gates pour tout | gates par métrique (PD n'exige pas 234/454 sains ; faceEye échantillonné séparément) | autocal.test | — |
| 32 | Stats au-delà de MAD | autoMeasures | 🔴 médiane+MAD seulement | + n, taux d'outliers, P10/P90, dérive 1re/2e moitié | stats.test | note si dérive |
| 33 | Silhouette liée à son époque/échelle | useAutoCalibration | 🟠 frontale d'une génération pouvait nourrir la suivante | captures étiquetées `generation`, purge au reset (compl.20–21) | autocal.test | — |
| 34 | Temporal jamais bloquant | autoCalibrate | ✅ `unavailable` géré | conservé | temporal-auto.test | — |
| 35 | Temporal raffiné après essayage | useAutoCalibration | 🔴 collecte close à la calibration | raffinement d'arrière-plan si `temporalWidthMm` absent (ne touche QUE temporal*) | autocal.test | interdit de toucher échelle/PD (46) |
| 36 | Plans nommés (eye/temple/frameFront) | autoCalibrate, framePlane | 🟠 sémantique correcte mais noms génériques (`livePxPerMm`) | conversions nommées `eyeToTemplePlane` FROM→TO documentées ; pas de nouveau plan frontal sans mesure (compl.7) | plane.test | — |
| 37 | Correction de profondeur UNE fois | autoCalibrate→frameMetrics | ✅ une seule application (assemblage) | test anti-double | plane.test | — |
| 38 | 780 mm en dur seulement en dernier recours | framePlane, verdict | 🔴 `planeScale` fige 780 mm alors que la distance est mesurée | `UserCalibration.distanceMm` (mesurée) transmise à `planeScaleAt` | verdict.test | migration storage |
| 39 | Profil focale lié à l'objectif | cameraProfile | 🔴 aucun `deviceId`/facing/aspect | identité caméra optionnelle + refus de fusion si différente | cameraprofile.test | avec 40 |
| 40 | Profil rejeté si ancien/incohérent | cameraProfile | 🟠 âge+plage OK, identité absente | `isProfileUsable` vérifie l'identité quand connue | cameraprofile.test | — |
| 41 | Vrai ratio de pixels vidéo | useCameraLoop, frameFeed | 🟠 OK au démarrage, pas de suivi de changement | re-dimensionnement suivi à chaque frame (frameFeed) + canvas ajusté | banc | — |
| 42 | Preuve pixels (orientation Android) | frameFeed | ✅ snapshots canvas + validité | conservé | framefeed.test | — |
| 43 | Miroir en un seul endroit | index.html CSS | ✅ `scaleX(-1)` conteneur, calculs non miroités | test OD/OG (compl.17) | pupillary.test | — |
| 44 | Padding : X/Y remappés, Z interdit | faceLoop/detectionPlan | 🟠 X/Y dé-mappés ; Z non transformé, non consommé en prod | `coordinateSpace` étiqueté ; garde : aucun usage prod de `z` en stratégie paddée | detection.test | avec 45 |
| 45 | Nose-contact hors production | experimental/ | ✅ non importé par src/ui | garde grep dans le hook | hook | — |
| 46 | Hauteur : pose stable, futur contact isolé | transform | ✅ `poseAnchorOf` sans paramètre libre | conservé | pose.test | — |
| 47 | Filtre temporel de pose (rendu seul) | — | 🔴 absent (landmarks bruts → monture) | `ui/poseFilter.ts` (One-Euro : x, y, scale, roll, yaw), jamais dans la métrologie | posefilter.test | avec 48 + compl.32 |
| 48 | Lissage doux + reset à la reprise | poseFilter | 🔴 n/a | One-Euro (latence faible), reset après perte longue | posefilter.test | — |
| 49 | Hold par temps | TryOn | 🔴 5 frames | `RENDER_HOLD_MS = 180` | banc | avec 12 |
| 50 | Branches non étirées | transform.templeAffine | ✅ longueur physique, oreille = direction | conservé | plane/pose tests | — |
| 51 | templeRectifiedMm ≠ longueur physique | transform.templeLengthMm | 🔴 `templeRectifiedMm ?? brancheMm` comme longueur rendue (147→137,1 ; 145→174,5 constatés) | `physicalTempleLengthMm` = `brancheMm` (rendu) ; `profileReferenceLengthMm` (ex-rectified) = calibration du sprite seulement | framedims.test | migration spec.json (compl.30) |
| 52 | Occlusion préserve la racine de branche | temple.ts | 🔴 destination-out efface le tenon | zone protégée (~8 mm) autour du tenon exclue du masque | banc visuel | — |
| 53 | Verdict exige largeur fiable | verdict.classify | ✅ arithmétique d'intervalle → `indetermine` | conservé | verdict.test | — |
| 54 | Verdict ne modifie jamais la taille | verdict/renderScene | ✅ verdict observe seulement | test explicite ajouté (78) | nonadaptation.test | — |
| 55 | spec.json strict | frameSpec.parseFrameSpec | 🟠 champs requis OK ; >0, bbox>0, ancres dans l'image, profil non validés | validation renforcée ; fiche invalide = entrée isolée (5) | framespec.test | — |
| 56 | Aucun NaN/Infinity au Canvas | renderScene/composite | 🔴 aucun garde | `Number.isFinite` sur échelle/ancre avant tout `drawImage`, skip nommé | renderpose.test | — |
| 57 | Calibration=personne, focale=caméra | storages | ✅ clés séparées | conservé + versions (58) | storage.test | — |
| 58 | Version par algorithme réel | calibrationStorage | 🔴 clé `v1` figée, aucun champ de version | `AUTO_METROLOGY_VERSION` embarquée, invalidation ciblée à la relecture | storage.test | avec compl.43–44 |
| 59 | resetTestSession explicite | main/bancs | 🔴 `?v=` ne purge rien | `?resetSession=1` purge les clés app avant montage (outil de banc) | bancs | — |
| 60 | localStorage jamais fatal | calibrationStorage | 🔴 `saveCalibration` sans try/catch (levait DANS la boucle de rendu) | try/catch lecture+écriture partout | storage.test + banc localStorage-KO | — |
| 61 | Page autonome ≠ produit final | docs | ✅ documenté (build-single-file) | note ARCHITECTURE.md | — | — |
| 62 | CI teste l'artefact autonome exact | scripts | 🔴 `npm run single` jamais testé | `scripts/smoke-single.mjs` : sert `essayage.html` et déroule les contrôles clés | CI | avec compl.40 |
| 63 | Colorways embarqués | build-single-file.mjs | 🔴 seuls les modèles principaux suivis | boucle sur `colorways` de l'index | test build | — |
| 64 | Fetch/images : timeout + isolation | catalogue, useSprites, landmarker | 🔴 aucun timeout | `fetchWithTimeout` + AbortController ; un échec n'entraîne que sa ressource | catalogue.test | — |
| 65 | Race `loadedmetadata` | useCameraLoop | 🔴 readyState==1 → événement déjà passé → blocage 15 s | attente par condition (poll+événement) `videoWidth>0 && readyState≥2` | camera.test | avec compl.25 |
| 66 | Stream fantôme après cleanup | useCameraLoop | 🔴 `return` sans `stop()` des tracks | tracks stoppées si résolution post-dispose | camera.test | — |
| 67 | StrictMode idempotent | useCameraLoop | 🟠 monté sous StrictMode, fantôme 66 en risque | 66 + banc mount/unmount/mount | banc | — |
| 68 | État UI = moteur réel | liveSteps/failedStatusOf | 🔴 `collecting` publié avec `auto===null` | états dérivés du store, invariant dev `collecting ⇒ auto≠null` | invariants.test | avec 69 |
| 69 | Après retries : `retrying`/`measurement-unavailable`, jamais faux `collecting` | useAutoCalibration | 🔴 confirmé | nouveaux états publiés ; le rendu continue | autocal.test | — |
| 70 | Diagnostics : erreurs conservées | faceLoop etc. | 🟠 deux `catch` muets corrigés, `console.error` restant | journal de diagnostics (code, message, stratégie, ts, étape) exposé au HUD | — | — |
| 71 | Causes différenciées | renderScene/HUD | 🔴 beaucoup sous « visage non détecté » | HUD `?hud=1` : caméra/frame/création/inférence/0-visage/landmarks/iris/PD/faceWidth/sprites/rendu | banc HUD | — |
| 72 | PD observable même rendu cassé | HUD | 🔴 absent | HUD : FPS, compteurs, iris L/R, eyeScale, PD near/far, OD/OG, splitFrames, faceWidth, sprites, render | banc | — |
| 73 | Rendu observable même sans calibration | HUD | 🔴 absent | HUD : mode provisional/final, sprites, pose, échelle, dernier rendu | banc | — |
| 74 | CI : chemins de PANNE | scripts | 🔴 inexistant | `scripts/faults.mjs` : matrice d'injection (routes 404/timeout, drawImage-throw, rVFC coupé, storage KO, GPU off, frame noire, vieux storage…) | CI | — |
| 75 | Test fondamental parcours complet | scripts/journey | 🔴 journey actuel périmé (« Ouvrir V1 » n'existe plus) et partiel | `journey-no-card.mjs` réécrit : monture AVANT calibration → PD fond → calibré → tracking continue → rien ne retire la monture | CI | — |
| 76 | Panne totale mais session vivante | scripts/faults | 🔴 absent | scénarios dédiés dans la matrice | CI | — |
| 77 | Aucun état mort | chaos | 🔴 absent | assertions permanentes pendant le chaos (compteurs avancent, jamais `collecting` sans moteur) | CI | — |
| 78 | Cohérence physique entre mesures | tests purs | 🟠 partiel (S1/S4 existants) | tests : PD±2 mm→rendu±2 mm ; faceWidth n'altère pas PD ; verdict n'altère pas scale ; cos une fois ; eye→temple une fois | coherence.test | — |
| 79 | Changement de distance | tests purs (head3d) | 🟠 invariant 50/100 cm existant | étendu 40/50/60 cm : PD, taille physique, faceWidth stables ; transition aperçu→final bornée | coherence.test | — |
| 80 | Tailles de montures préservées | nonadaptation.test | ✅ existant | étendu 120/134/145/155 | nonadaptation.test | — |

## Complément (1–47)

| # | Point | État | Action |
|---|---|---|---|
| c1 | `rejectedFramesAny` ≠ somme des gates | 🔴 `status()` compare `sum(gates)` à n | compteur par-frame dédié, seul utilisé pour les décisions |
| c2 | Diagnostic dominant non biaisé par l'ordre | 🟠 gates comptés séparément, priorité `else if` implicite | tous les gates violés conservés + priorité explicite documentée + HUD multi-causes |
| c3 | `failedStatusOf` typé | 🔴 tout → `eyes-too-small` | codes `pd-out-of-range`, `face-width-out-of-range`, `invalid-distance`, `insufficient-half-pd`, `metric-assembly-error`, `internal-error` (via `CalibrationError.code`) |
| c4 | Clé de publication React complète | 🔴 `state|usableFrames|why` | + attempts, lastAttemptFailure, primaryReject, generation, états PD |
| c5 | Aperçu et final : même optique caméra | 🔴 provisional passait `profile=null` | `renderPose` n'utilise plus la distance ; l'aperçu n'a plus de chemin optique divergent (l'échelle de pose est au plan des yeux, corrigée plan via distance mesurée quand elle existe — même formule des deux côtés) |
| c6 | Transition provisional→final instrumentée | 🔴 rien | log + `live.scaleJump` {provisionalPxPerMm, finalPxPerMm, ratio, distanceMm, ts} affiché HUD ; jamais masqué par easing |
| c7 | Pas de « correction » aveugle de l'échelle frontale | ✅ rien ne la modifie | instrumentation HUD (largeur attendue/rendue) pour le protocole 40/50/60 ; AUCUN facteur ajouté |
| c8 | Sémantique de plan explicite | 🟠 | noms/`eyeToTemplePlane` + tests anti-double correction |
| c9 | Z paddé interdit en production | 🟠 | flag `coordinateSpace` + garde (voir 44) |
| c10 | Compteurs par étage | 🔴 absent | cameraFrames, snapshots, inferenceAttempts/Success, landmarkFrames, renderedFrames, metricFrames |
| c11 | Heartbeats par sous-système | 🔴 absent | camera/frameFeed/landmarker/render/metrology — HUD |
| c12 | length ≥ 478 avant tout aval | 🔴 | `validateLandmarks` (voir 16) |
| c13 | Cohérence OD+OG ≈ PD total | 🔴 absent | contrôle à l'assemblage : sinon halves invalidées, total conservé, note sellion |
| c14 | t de projection enregistré/vérifié | 🔴 | `pupilPixelsOf` renvoie `t` ; bornes anatomiques (voir 23) |
| c15 | Test de sortie MIN_SPLIT_FRAMES | 🟠 | test 30 frames larges / 1–7 strictes → pd présent, halves absents ; 8 → présents |
| c16 | Stats PD total / halves séparées | ✅ tableaux distincts | conservé + SE distincts (déjà) |
| c17 | Convention OD/OG sous miroir | ✅ code vérifié | test géométrie asymétrique ajouté |
| c18 | Seuil iris : ne plus retoucher | ✅ formule documentée | instrumentation HUD (L, R, discrepancy, yaw) ; seuil inchangé |
| c19 | Timeout acquisition ≠ convergence | 🔴 cas B (visage, 0 frame métrique) sans horloge | 3 états × (horloge, diagnostic, reprise) — voir 18 |
| c20 | Reset atomique | 🔴 | tout est purgé ensemble + génération (voir 19) |
| c21 | Captures liées à une génération | 🔴 | `attemptId` sur frontale/profils ; assemblage ne mêle jamais deux générations |
| c22 | temporalMeasured ≠ estimé | ✅ champs distincts | conservé |
| c23 | Focale liée à la géométrie d'image | 🔴 | deviceId+facingMode+aspect stockés, incompatibilité = refus (voir 39–40) |
| c24 | Jamais fusionner deux appareils | 🔴 | test stored A + fresh B → fresh seul |
| c25 | Timeout caméra complet | 🔴 partiel | budget global getUserMedia→play→dimensions ; init modèle : timeout séparé |
| c26 | Cleanup à CHAQUE étape async | 🟠 | dispose vérifié après chaque await + tests |
| c27 | Assets annulables + races de sélection | 🟠 token présent | AbortController + test de course A/B |
| c28 | Changement de monture ne perd pas les mesures | 🔴 `setNotices([])` seul état | panneau mesures branché sur le store (persistant) ; notices restent éphémères |
| c29 | Sprites porteurs d'identité specId | ✅ paire chargée du même spec | garde : le renderer refuse une paire incohérente |
| c30 | Renommage templeRectifiedMm | 🔴 | `profileReferenceLengthMm` (lecture legacy conservée) ; le renderer n'utilise QUE `brancheMm` |
| c31 | Tests visuels du masque d'occlusion | 🔴 | banc : yaw 0/10/20/30° — racine visible, pas de trou |
| c32 | Smoothing jamais dans les samples | 🔴 risque nouveau (47) | le filtre vit dans `ui/poseFilter`, la métrologie lit `lm` bruts — test |
| c33 | Ne pas maquiller une métrique instable | ✅ principe | le filtre ne s'applique qu'au rendu ; saut aperçu→final instrumenté (c6), pas lissé |
| c34 | cos(yaw) exactement une fois | 🟠 | test analytique 0/10/20/30° |
| c35 | Fort yaw : échelle stabilisée | 🔴 au-delà du clamp, l'échelle suit 234/454 | gel de l'entrée échelle du filtre au-delà de `MAX_YAW_FOR_SCALE_RAD` |
| c36 | Session continue après calibration | ✅+test | banc : calibré → 500 frames → monture suit |
| c37 | Session longue | 🔴 | chaos ~2 min : compteurs, mémoire Task, scheduler |
| c38 | Identité de build affichée | 🟠 tampon sans SHA | HUD : SHA commit (injecté au build), versions algo/MediaPipe, stratégie active |
| c39 | CI reproductible d'un clone propre | 🔴 photo source absente du dépôt | `docs/verification/essayage-severine.jpg` restaurée (SHA-256 `224d5b7f…`), fixtures régénérables |
| c40 | CI passe par `npm run single` | 🔴 | chaîne `npm run ci` : typecheck→unit→build→single→smoke-single→journey→faults |
| c41 | Hash des modèles | 🔴 | SHA-256 modèle+wasm vérifiés au banc, affichés HUD |
| c42 | Matrice cache/localStorage | 🔴 | scénarios faults : vierge, calibration vieille version, profil autre appareil, storage KO/corrompu |
| c43 | Versions séparées | 🔴 | `core/versions.ts` : APP_BUILD, AUTO_METROLOGY, FRAME_SPEC, CAMERA_PROFILE |
| c44 | Migration des objets stockés | 🔴 | `parseStoredCalibration` : valide, migre ce qui est sûr, invalide le reste seulement |
| c45 | Invariants runtime dev | 🔴 | `core/invariants.ts` (actif hors production) : collecting⇒moteur, halves⇒splitFrames≥8, scale finie… |
| c46 | Chaos test | 🔴 | `scripts/chaos.mjs` : injections aléatoires, invariant « récupère ou dit précisément » |
| c47 | Définition de « ça marche » | — | = le journey 75 + faults 76–77 verts, sur build vite ET artefact autonome |

## Ordre des commits (une étape verte avant la suivante)

1. **Survivabilité** — frameFeed (13/14/15), landmarker cache+preload (7), faceLoop watchdog+swap transactionnel+warning/fatal (6/8/9/10), useCameraLoop (65/66/c25), storage try/catch (60).
2. **Tracking** — validation landmarks (16/c12), plan temporel sans sonde (6/11/12), diagnostics/compteurs (70/c10).
3. **Rendu immédiat** — renderPose (3/30/56), poseFilter (47/48/49/c32/c35), useSprites scindé (4/64/c27), catalogue lazy (5), renderScene/TryOn try/catch séparés (17), transition instrumentée (c5/c6).
4. **PD indépendant** — pupillary t (23/c14), engine (18/19/22/29/31/32/c1/c19/c20/c21), store + assemblage scindé (20/21/26), statuts typés (c3), clé React (c4), cohérence halves (c13), panneau mesures (27/c28).
5. **Échelles physiques** — distanceMm dans cal + planeScaleAt (38), cameraProfile identité (39/40/c23/c24), plans nommés (36/c8).
6. **Temporal** — raffinement post-essayage (35).
7. **Rendu avancé** — occlusion racine (52), temple naming (51/c30), verrous hook.
8. **Persistence/catalogue** — versions+migration (58/c43/c44), spec strict (55), resetTestSession (59), colorways single (63), capacités (28), états 68/69.
9. **CI/chaos** — HUD (71–73, c6/c10/c11/c38/c41), journey réécrit (75), smoke-single (62/c40), faults (74/76/77/c42), chaos (c46), tests cohérence (78–80, c15/c17/c34), invariants (c45), meta.

## État livré (2026-08-21, fin de refonte) — écarts résiduels ASSUMÉS

Tout le reste du tableau est implémenté et testé (`npm run ci` : typecheck →
361 tests unitaires → build → single → smoke → smoke-single → journey →
faults S1–S10 → chaos 100 s). Restent, dits plutôt que tus :

- **74 (matrice)** : couverts en banc — localStorage KO, front/profil 404,
  spec corrompue, tempête drawImage, rVFC mort, ancienne version d'algo,
  profil d'un autre appareil, frames noires, échelle GPU→CPU. Couverts en
  CALCUL PUR (unit) : 0/400 landmarks, gates, retry, fenêtres propres,
  timeouts. NON exercés en banc : échec de création GPU forcé (le conteneur
  crée toujours), swap KO transactionnel (logique dans `modelLifecycle`,
  exercée indirectement par les transitions S9), changement de caméra à
  chaud, frame figée. À couvrir quand un appareil réel le permettra.
- **72 (HUD)** : compteurs par étage, heartbeats, iris L/R + écart, échelle
  de pose, saut aperçu→calibré, PD/OD/OG/temporal/distance de la calibration.
  Les MÉDIANES INTERMÉDIAIRES de la collecte (PD near live) ne sont pas
  affichées — l'état par métrique du panneau les remplace.
- **c41** : SHA-256 du modèle FaceLandmarker affiché au HUD ; le WASM n'est
  pas hashé (il est vendorisé par `sync-wasm` depuis node_modules, même
  version que le paquet npm verrouillé par le lockfile).
- **c31** : l'occlusion est vérifiée au banc à 20° (racine protégée, cœur
  occlus) — pas encore la série 0/10/30°.
- **7/c7 (échelle frontale)** : AUCUNE correction appliquée, conformément au
  complément — l'instrumentation (HUD + render-proof) est en place pour le
  protocole 40/50/60 cm sur monture connue avant toute décision.
