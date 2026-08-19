# AUDIT RUNTIME V2 — pourquoi le produit ne « termine » pas ses procédures

> Audit du 2026-08-19, mené sur la branche applicative (`0eb84d0`), **en exécutant
> réellement** : `npm install` → OK ; `npm test` → 189/189 verts ; `npm run typecheck`
> → propre ; benchmark du détecteur de carte exécuté (`scripts/bench-cardfinder.mts`) ;
> banc navigateur `npm run smoke` exécuté.
>
> Ce document répond aux dix points de la PARTIE XI de la mission. Il décrit ce qui
> est **réellement appelé au runtime**, pas ce que `CLAUDE.md` prétend.

---

## 1. Architecture runtime exacte

### 1.1 Le graphe d'appels réel (V1, vente en ligne)

```
main.tsx  (React 18, <StrictMode>)
 └─ App.tsx ──[bouton mode]──▶ TryOn.tsx  (monté UNE fois par session d'essayage)
     ├─ useCameraLoop(videoRef, canvasRef, handlers)      [useEffect, deps stables]
     │    ├─ getUserMedia({video 1280×720})               → MediaStream
     │    ├─ video.play() ; attente onloadedmetadata      → canvas dimensionné
     │    ├─ createLandmarker(onProgress)                 → FaceLandmarker (WASM/GPU)
     │    ├─ handlers.onReady()                           → phase initiale
     │    └─ startLoop(landmarker, video, {onFrame,onLost})
     │         └─ requestAnimationFrame(loop)             ← LA seule boucle du projet
     │              ├─ garde S5 (frame répétée, timestamp monotone)
     │              ├─ detectForVideo(video, ts)          [synchrone]
     │              ├─ visage → onFrame(lm, yaw)  |  sinon → onLost(n)
     │              └─ requestAnimationFrame(loop)        [toujours replanifiée]
     │
     ├─ renderFrame(ctx, lm, yaw)          ← appelé ~30–60×/s par la boucle
     │    ├─ phase 'mesure-carte'  → clearRect, RIEN d'autre        [aucune mesure]
     │    ├─ stepRotation(live,…)  → live.probe?.offer(…)           [collecte]
     │    │    └─ RotationProbe.offer
     │    │         ├─ capture() = getImageData 1280×720 (~3,7 Mo)  [chaque frame]
     │    │         ├─ harvestCard → findCard + refineQuad          [~6 ms/frame mesuré]
     │    │         └─ tranches d'angle (8 slots) + 2 images extrêmes
     │    ├─ stepCrossCheck(live,…) → irisWidthPx ×30 → crossCheckWithIris
     │    ├─ paintScene → frameMetrics → drawFrame/drawRecolored → verdict()
     │    └─ drawOverlay(verdict, échecs, hint)
     │
     └─ useV1Calibration
          ├─ start()  ← bouton « Je filme »   : live.probe = new RotationProbe(…)
          └─ finish() ← bouton « J'ai fini »  : consensusWidthRatio (médiane)
               └─ assembleCardCalibration(card, harvest, storedProfile, now)
                    ├─ cameraFromSweep(quads)   [focale : ≥8 vues, dispersion ≤12 %]
                    ├─ measureDistance(frontal) [distance mesurée]  — sinon profil
                    │   stocké — sinon a priori 780 mm ±17 %, en silence
                    └─ calibrateWithCardMeasured
                         ├─ calibrateWithCard   [médiane × visage, plausibilité 95–175 mm]
                         ├─ refineCard          [parallaxe : ≥4 vues 10–35°, ±≤50 %]
                         └─ measureTemporalWidth [silhouette, si scène + mouvement]
               └─ onCalibrated → persist → setPhase('essayage') + localStorage
                  onFailed    → notice + retour 'mesure-carte'
```

**Constat structurel n°1 :** il n'existe **aucun moteur de calibration avec état
propre**. La « machine à états » est un `useState<Phase>` React dans `TryOn.tsx`,
mutée depuis trois endroits (boutons, boucle de rendu, callbacks). Le moteur, lui,
est une fonction pure appelée une fois (`assembleCardCalibration`). Entre les deux,
un objet mutable `Live` partagé sans discipline de transition.

**Constat structurel n°2 :** la distinction demandée par la mission (§6)
`cameraRunning` / `calibrationCollecting` / `tryOnRunning` **existe implicitement et
n'est nommée nulle part** : `cameraRunning` = « la boucle RAF tourne » (toujours vrai
après init), `calibrationCollecting` = `live.probe !== null`, `tryOnRunning` =
`live.cal !== null && sprites prêts`. Aucun de ces trois booléens n'est un état
observable ; aucun test ne peut les vérifier ; aucun affichage ne les montre.

### 1.2 Ce qui est correct et doit être conservé

- La boucle RAF est **unique**, ne meurt jamais sur exception (garde S5), et
  `stop()` l'arrête proprement au démontage. Aucun `setTimeout`/`setInterval` dans
  tout `src/`.
- Le flux caméra est bien coupé au démontage (`stream.getTracks().forEach(stop)`).
- La caméra **doit** rester allumée après calibration (essayage live) : le code le
  fait. C'est la **collecte** qui doit s'arrêter, et elle s'arrête bien
  (`live.probe = null` dans `finish`/`persist`). La séparation conceptuelle du §6 de
  la mission est donc respectée *de fait* — mais invisible et non testée.

---

## 2. Pourquoi la calibration ne « finit » pas — la cause exacte

Le symptôme rapporté : *« même avec la carte, la caméra continue indéfiniment et le
système n'arrive pas à dire : calibration acquise, c'est terminé »*.

Ce n'est **pas** une boucle qui a oublié sa condition de sortie. C'est la
**superposition de trois causes**, dont la première est une décision de conception.

### Cause A — le produit a explicitement supprimé toute condition de terminaison

Arbitrage du 2026-08-18 (`CLAUDE.md` §14.7) : « c'est le client qui décide quand la
vidéo est finie ». En conséquence :

- `stepRotation` **« ne dit JAMAIS quand s'arrêter »** (commentaire littéral,
  `ui/liveSteps.ts:28`) ; l'ancienne version rendait un booléen `complete`, supprimé.
- `RotationProbe.complete` (le critère « ≥3 tranches par côté + 2 images ») **existe
  toujours, est calculé, est testé… et n'est lu par AUCUN code de production**. Le
  seul consommateur est `tests/capture.test.ts`.
- `RotationStep.tsx` affiche des compteurs « purement informatifs » et un bouton.
  Aucun libellé ne passe jamais à « c'est bon, j'ai ce qu'il me faut ».

**Le système ne dit jamais « calibration acquise » parce qu'il n'a plus le droit de
le dire.** L'arbitrage a été appliqué au-delà de sa lettre : le client devait décider
de *l'arrêt* ; le code lui a aussi retiré le *diagnostic de suffisance*. Un client
qui attend un signal de complétude attend donc indéfiniment devant une caméra
allumée — c'est exactement le comportement observé. La machine sait (`probe.complete`,
`quads().length`, dispersion de focale) mais ne le montre pas.

### Cause B — quand « J'ai fini » échoue, la boucle recommence sans expliquer pourquoi

`finish()` a deux issues : `onCalibrated` → essayage ; `onFailed` → notice + retour
à l'écran carte. Les cas d'échec réels :

1. carte jamais trouvée sur le film (`consensusWidthRatio` → null) → « Je n'ai pas
   réussi à voir votre carte » — sans dire *pourquoi* (jamais localisée ? refusée par
   les bornes de plausibilité ? contraste insuffisant ?) ;
2. largeur hors 95–175 mm → message de cause probable, correct.

Tout le reste (focale, distance, parallaxe, écart temporal) **échoue en silence**
vers des marges élargies — conforme à la garantie « pas de cul-de-sac », mais le
client ne voit la différence qu'en lisant des notes en petit texte. Il n'existe
**aucune ligne `WHY_NOT_DONE`** (mission §9) : quand la séance « tourne » sans
progresser (carte au contraste faible contre les cheveux, yaw jamais ≥10°, roll
> 15° qui invalide toutes les vues), rien à l'écran ne le dit. Les vues sont
rejetées une à une par `isUsableProbeView` (yaw hors 10–35°, roll > 15°) sans
compteur visible du rejet.

### Cause C — l'UI re-rend à pleine cadence pendant la séance (bug réel)

`ui/liveSteps.ts:52` :

```ts
if (!moved && cardViews % SWEEP_REPORT_EVERY !== 0) return null;
```

Dès que la tête est immobile **et** que `cardViews` est un multiple de 5, la
condition laisse passer : `stepRotation` renvoie un rapport **à chaque frame**, donc
`setPhase({...objet neuf})` **30 à 60 fois par seconde**. Trois situations y tombent
en permanence :

- la carte n'est pas trouvée du tout → `cardViews = 0`, et `0 % 5 === 0` → re-rendu
  React à chaque frame pendant toute la séance ;
- le plafond mémoire est atteint → `cardViews` figé à `MAX_SWEEP_QUADS = 400` → idem ;
- toute pause du suivi sur un multiple de 5.

Sur un téléphone bas de gamme, ce re-rendu permanent concurrence la détection au
moment précis où la séance a besoin du processeur — la séance paraît « mouliner sans
avancer ». C'est l'inverse exact de l'intention du commentaire au-dessus de la ligne.
*(Le coût du détecteur lui-même n'est pas en cause : `findCard`+`refineQuad` mesurés
à ~6 ms/frame en Node sur 1280×720.)*

### Reproduction en conditions réelles (navigateur piloté, caméra factice)

Trois comportements ont été **reproduits en exécutant l'application** (Chromium +
`--use-fake-device-for-media-stream`, sonde `scripts/audit-probe.mjs`) :

1. **Sur un clone frais, l'application ne démarre pas du tout** : `npm run smoke`
   (le banc « 30 contrôles verts » du dossier) échoue avec 4 contrôles rouges puis
   un timeout de 30 s sur le bouton « Je filme ». Cause : le banc lance `npx vite`
   directement, ce qui **contourne le hook `predev` qui synchronise le WASM
   MediaPipe** vers `public/wasm/`. Le runtime 404 sur ses propres fichiers WASM.
2. **L'échec d'init s'affiche « Erreur : [object Event] »** — l'échec du chargement
   WASM remonte un `Event`, pas une `Error`, et `String(err)` produit un message
   vide de sens. L'état `error` est **terminal** : aucun bouton réessayer, page
   morte. Un client dont le réseau a hoqueté sur 11 Mo de modèle voit ça.
3. **La boucle infinie du parcours carte, de bout en bout** : séance filmée sans
   visage détectable → compteurs figés à « 0° à gauche · 0° à droite · 0 vue de
   votre carte » **sans aucune explication de la cause** (visage non détecté ? carte
   non trouvée ? angle insuffisant ?) → « J'ai fini » → retour silencieux à l'écran
   carte → l'utilisateur recommence, indéfiniment, la caméra tournant en continu.
   C'est mot pour mot le symptôme rapporté dans la mission.

### Réponse à la Question A de la mission

> « Pourquoi le produit actuel ne termine-t-il pas correctement ses procédures ? »

Parce que la terminaison a été **déléguée à l'utilisateur sans lui donner le
diagnostic de suffisance** (cause A), que les échecs de fin de séance renvoient au
départ **sans raison actionnable** (cause B), et qu'un défaut de throttling rend la
séance **coûteuse et peu réactive** précisément quand rien ne progresse (cause C).
Aucune Promise pendante, aucune boucle zombie, aucune condition impossible n'ont été
trouvées : les 189 tests sont verts et le moteur *sait* conclure — c'est le contrat
d'interface entre le moteur et l'humain qui est cassé.

---

## 3. La caméra vs la collecte — ce qui devait s'arrêter

Réponse ferme à la question 3 du livrable final :

- **La caméra doit rester active** après calibration : l'essayage est un flux live
  (§0.0.2 du contrat). L'éteindre serait un contresens produit.
- **La collecte devait s'arrêter — et elle s'arrête** (`live.probe = null` dans
  `finish()` et `persist()`). Vérifié : après `persist`, `stepRotation` court-circuite
  sur `probe === null` ; plus aucun `getImageData`, plus aucun `findCard` ne tourne
  pendant l'essayage. Le seul résidu est le contre-contrôle iris (30 frames puis
  terminé).
- Ce qui manque : ces états ne sont **ni nommés, ni observables, ni annoncés**. Le
  client qui vient de calibrer voit le panneau changer, mais aucun message du type
  « calibration terminée — largeur de visage 138 ± 4 mm » n'est mis en avant : les
  notes arrivent en liste de `<p>` sous la vidéo, mêlées aux avertissements.

---

## 4. La machine à états actuelle, cartographiée

### 4.1 Les états (type `Phase`, `ui/CalibrationPanel.tsx`)

```
loading(ratio) → [onReady] ┬→ essayage            (si localStorage a une calibration)
                           ├→ mesure-carte         (V1 sans calibration)
                           └→ mesure-monture(gel)   (V2 magasin)
error(message)             ← onError (terminal : aucune sortie prévue !)

mesure-carte  → [« Je filme », onCardReady]     → mesure-rotation(degrés, vues)
mesure-rotation → [« J'ai fini », finish→OK]     → essayage
                → [finish→échec, onFailed]        → mesure-carte   (boucle possible ∞)
essayage      → [« Refaire la calibration »]     → mesure-carte | mesure-monture
mesure-monture → [validation 2 points]           → essayage
```

### 4.2 Défauts relevés sur cette machine

| # | Défaut | Gravité |
|---|---|---|
| E1 | `error` est un **état terminal sans issue** : ni bouton réessayer, ni retour. Caméra refusée une fois = page morte jusqu'au rechargement. | 🟠 |
| E2 | Les transitions sont émises depuis **trois origines concurrentes** (boutons, boucle RAF via `setPhase` dans `renderFrame`, callbacks async d'init). Aucun garde-fou n'empêche une transition illégale ; la protection réelle est l'implicite `probe === null`. | 🟠 |
| E3 | `setPhase` est appelé **depuis la boucle de rendu** (stepRotation) — un flux de données inversé : le moteur pousse dans React à cadence vidéo au lieu que React observe un état à sa cadence. C'est la racine de la cause C. | 🔴 |
| E4 | Aucun état `calibration_processing` : `finish()` est synchrone (des dizaines de solveurs d'homographie sur ≤400 quads) et **bloque le thread UI** pendant l'assemblage — sur mobile, plusieurs centaines de ms de gel sans feedback. | 🟡 |
| E5 | Une seule transition vers `essayage` par `persist` — pas de double-émission constatée. ✅ | — |
| E6 | La règle de la mission §45 (« toute opération finie possède état initial / actif / succès / échec / cleanup / transition ») n'est vérifiée par **aucun test** : rien ne teste `Phase` ni ses transitions. `tests/capture.test.ts` teste la *probe*, pas la machine. | 🔴 |

---

## 5. Conditions de sortie actuelles — la définition exacte de « calibration réussie »

Réponse au §8 de la mission. Pour qu'une calibration existe (statut minimal), il faut
et il suffit :

| Condition | Seuil | Nécessaire physiquement ? | Atteignable ? | Si absente |
|---|---|---|---|---|
| ≥1 vue de carte localisée sur le film | `consensusWidthRatio ≠ null` | oui (c'est l'étalon) | oui, sauf carte à faible contraste | **échec dur**, retour case départ |
| Largeur visage ∈ [95 ; 175] mm | plausibilité | oui (détecteur de panne) | oui | échec dur, message causal |

Tout le reste est **facultatif par contrat** et dégrade en silence :

| Raffinement | Conditions réelles empilées | Si échec |
|---|---|---|
| Focale mesurée | `card.quad ≠ null` (refineQuad a pris sur la vue frontale) **ET** ≥8 vues acceptées par le solveur **ET** dispersion ≤12 % | distance = profil stocké, sinon **780 mm supposés ±17 %** — silencieux |
| Distance mesurée | focale OK **ET** `cardDistanceWithFocal` ne lève pas | idem |
| Parallaxe corrigée | ≥4 vues avec yaw ∈ [10° ; 35°] et roll ≤ 15° **ET** incertitude profondeur ≤ 50 % | facteur = 1, marge 2,5 % — note en petit texte |
| Écart temporal | scène (2 images extrêmes) **ET** silhouette accrochée | constante/rien — note |

**Le cas « optionnel sur le papier, obligatoire en pratique » demandé par la mission
existe, et il est double :**

1. **La qualité entière du produit repose sur les raffinements « facultatifs ».**
   Sans eux, `relError` reste 2,5 % *plus* un biais de parallaxe non corrigé de
   3–7 % : la légende chiffrée est alors quasi toujours `indetermine` et la promesse
   « la carte donne tout » n'est pas tenue. Le client, lui, n'a aucun moyen de savoir
   dans quel monde il est tombé : les deux mondes s'appellent pareil (« calibré »).
2. **`refineQuad` sur la vue frontale est un point de passage obligé caché** : si
   l'accrochage sous-pixel échoue sur cette image-là, `quad` reste la graine du
   détecteur — un rectangle ISO parfait — et le chemin focale/distance entier
   devient inaccessible quel que soit le nombre de vues récoltées. Une seule image
   (la plus frontale) porte donc à elle seule l'accès à trois raffinements.

Ces empilements sont exactement le mécanisme par lequel « le circuit n'était JAMAIS
atteint en production » (bug historique §4.3 du dossier d'analyse) peut se
reproduire : plusieurs conditions en série, chacune raisonnable, dont le produit des
probabilités s'effondre — sans témoin.

---

## 6. Bugs async / React / RAF trouvés

| # | Bug | Fichier | Détail |
|---|---|---|---|
| A1 | 🔴 Re-rendu React à cadence vidéo | `ui/liveSteps.ts:52` | cf. cause C §2. `cardViews % 5 === 0` inclut 0 (carte jamais vue) et 400 (plafond). |
| A2 | 🟠 `FaceLandmarker` jamais `close()` | `ui/useCameraLoop.ts` | Ni au démontage, ni en StrictMode (double-montage dev : deux instances WASM/GPU créées, une orpheline). Fuite mémoire GPU à chaque entrée/sortie d'essayage. `grep "\.close()" src` → zéro ligne. |
| A3 | 🟠 Promise potentiellement pendante à l'init | `ui/useCameraLoop.ts:55` | `await new Promise(r => { video.onloadedmetadata = r })` : si les métadonnées n'arrivent jamais (piste coupée, permission retirée), la promesse ne se résout jamais → phase `loading` éternelle, **sans timeout ni raison affichée** — un « processus qui ne se termine pas » de plus. |
| A4 | 🟡 `video.onloadedmetadata` écrase tout handler antérieur | idem | Assignation directe au lieu d'`addEventListener` ; bénin ici mais fragile. |
| A5 | 🟡 Gel synchrone à l'assemblage | `useV1Calibration.finish` | Jusqu'à 400 homographies + silhouette sur le thread UI, sans état `processing`. |
| A6 | 🟡 `renderFrame` recréé à chaque rendu | `TryOn.tsx:164` | Deps `[finishCalibration, v1]` instables (`v1.finish` dépend d'un objet littéral recréé à chaque rendu). Sans conséquence car lu via ref — mais c'est le motif « stale closure évitée par accident ». |
| A7 | 🟡 Clés React = texte des notices | `TryOn.tsx:270` | Deux notices identiques (cross-check répété après recalibration) = clés dupliquées. |
| A8 | ✅ Pas de double boucle RAF | `startLoop` | `stop()` coupe la replanification ; un remontage ne crée pas deux boucles vivantes. Conforme. Mais **aucun test ne le verrouille** (exigé par la mission, PARTIE XIII). |

---

## 7. Code mort — écrit, documenté, testé, jamais atteint

Méthode : graphe d'imports transitifs depuis les points d'entrée runtime
(`ui/`, `render/`, `tracking/`), confronté aux imports des tests.

| Module | Export | Testé ? | Appelé au runtime ? | Depuis où |
|---|---|---|---|---|
| `core/ocularPrior.ts` (252 l.) | tout | ✅ `tests/ocular.test.ts` (265 l.) | **NON — mort à 100 %** | personne |
| `core/edgeStep.ts` | `MIN_GUIDE_EDGE_STEP`, `guideEdgeStep` | ✅ | **NON** (assumé « atelier ») | tests + atelier |
| `ui/rotationProbe.ts` | `complete` | ✅ | **NON** — calculé, jamais lu | tests seulement |
| `ui/rotationProbe.ts` | `ratio()`, `reset()` | partiel | **NON** | personne |
| `core/calibration.ts` | `assertIrisUsable`, `GlassesDetectedError` | ✅ | **NON** — la détection de lunettes portées n'existe nulle part ; la consigne S2 n'est qu'un texte à l'écran | personne |
| `core/calibration.ts` | `scaleFromIris` | ✅ | **NON** (seul `calibrateWithIris` vit, via `crossCheck`) | — |
| `core/temporalRefusals.ts` | selon exports | ✅ | transitif via `temporalWidth` — vivant | — |

**Le plus significatif est `ocularPrior.ts`** : 252 lignes + 265 lignes de tests d'un
prior oculaire — précisément la brique centrale d'une V2 sans carte — déjà écrites,
vertes, et **jamais branchées**. Le projet a déjà, en dormance, le début de la
solution que la mission demande. *(Il a aussi, en dormance, le même mode d'échec que
la mire de calibration du §4.3 : du code juste, testé, mort.)*

À l'inverse, la **détection de lunettes portées (correctif S2)** est promise par le
contrat (« si une monture est détectée devant les yeux, on refuse de calibrer sur
l'iris ») : l'erreur existe, le garde n'est appelé nulle part, aucun détecteur
n'existe. Le contre-contrôle iris tourne donc **aussi à travers des verres
correcteurs**, ce qui peut produire un faux avertissement « refaites la
calibration » chez tout myope fort — un mensonge du contrôle qualité.

---

## 8. Tests trompeurs ou insuffisants

1. **`tests/capture.test.ts` teste la probe, pas le produit.** « La récolte continue
   après que la machine aurait jugé en avoir assez » est vérifié sur `RotationProbe`
   isolée — il prouve la conformité à l'arbitrage, pas que l'utilisateur *peut*
   terminer. Aucun test n'exerce : `Phase` et ses transitions, l'issue des deux
   boutons, la non-réentrée de `finish()`, l'unicité de la transition vers
   `essayage`, le nettoyage au démontage. Le « câblage des boutons n'a pas de filet »
   est écrit dans le dossier — c'est précisément là que vivent les bugs constatés.
2. **`probe.complete` est testé comme s'il servait** (`expect(probe.complete).toBe(true)`),
   ce qui donne l'illusion qu'une complétude existe dans le produit. Vert par
   construction *et* décoratif : le symbole n'a aucun consommateur runtime.
3. **Aucun test de non-régression sur la cadence** : rien n'attrape A1 (setPhase par
   frame). Un test « stepRotation ne publie pas deux frames de suite sans
   changement » aurait rougi immédiatement.
4. **`tests/ocular.test.ts` : 265 lignes vertes sur du code mort** — le cas d'école
   « un test unitaire vert ne prouve pas que le code intervient » (§10 de la mission),
   déjà documenté par le projet lui-même et pourtant reproduit.
5. Le banc navigateur (30 contrôles) vérifie le rendu et le refus de geler sans
   repères — il ne parcourt pas la séance filmée (le flux CI est une mire sans
   visage ni carte, limitation documentée et réelle).

---

## 9. Incohérences UI ↔ moteur

| # | Incohérence |
|---|---|
| U1 | Le moteur **calcule** une complétude (`probe.complete`, tranches, dispersion focale) ; l'UI affirme qu'« il n'y a rien à atteindre ». Les deux sont sincères ; ensemble ils produisent le symptôme n°1 : personne ne dit jamais « c'est terminé ». |
| U2 | L'UI promet « Moins vous aurez tourné la tête, plus la marge sera large — c'est tout ce que ça change ». Faux dans un cas : **ne pas montrer la carte du tout** ne « change pas la marge », ça renvoie à la case départ. |
| U3 | La consigne « une vingtaine de degrés de chaque côté suffisent » ne correspond pas aux bornes du moteur : les vues ne comptent qu'entre **10° et 35°** de yaw et **roll ≤ 15°** — un client qui tourne à 8° pense obéir et ne remplit rien ; rien ne l'en informe. |
| U4 | Le panneau de phase et les `notices` racontent la calibration en deux endroits découplés ; le résultat final (« votre visage : 138 ± 4 mm ») n'est jamais mis en avant comme un événement de succès. |
| U5 | Consigne « Retirez vos lunettes » : simple texte ; le moteur ne vérifie rien (S2 non implémenté) alors que le contrat le présente comme un refus actif. |

---

## 10. Correctifs nécessaires AVANT même la V2

Par ordre de priorité, tous indépendants de la stratégie de mesure retenue :

1. **Un moteur de calibration à états explicites**, hors React, avec la règle de la
   mission §45 : `idle → collecting → processing → calibrated | failed(reason)` ;
   React n'est plus qu'un observateur (abonnement), plus jamais une cible de push
   par frame. `cameraRunning`, `calibrationCollecting`, `tryOnRunning` deviennent
   trois booléens réels et testables.
2. **`WHY_NOT_DONE` / diagnostic de suffisance** : à chaque instant de la collecte,
   le moteur publie la première raison bloquante (« carte non vue », « 3/8 vues de
   focale », « yaw max atteint 6° — tournez davantage », « dispersion focale
   14 % > 12 % »). L'UI peut alors dire honnêtement « j'ai ce qu'il me faut » sans
   reprendre la décision d'arrêt au client — le bouton reste le sien.
3. **Corriger le throttling** de `stepRotation` (A1) : publier sur *changement de
   valeur affichée* uniquement.
4. **Réparer l'état `error`** (E1) : bouton réessayer + cause.
5. **Timeout + raison sur l'init caméra** (A3).
6. **`landmarker.close()`** au démontage (A2).
7. **Brancher ou supprimer** le code mort : `ocularPrior` (à brancher — c'est la V2),
   `assertIrisUsable` (à brancher ou dé-documenter), `probe.complete/ratio/reset`.
8. **Tests de la PARTIE XIII** : completion, no-infinite-collecting, failure-reason,
   transition unique, cleanup sans double boucle — sur le *moteur*, pas sur la probe.

---

### Annexe — mesures faites pendant l'audit

| Mesure | Valeur | Outil |
|---|---|---|
| Tests unitaires | 189/189 verts, 2,4 s | `npm test` |
| Typecheck strict | propre | `npm run typecheck` |
| `findCard` | ~3,2 ms/image (1280×720, Node) | `scripts/bench-cardfinder.mts` |
| `refineQuad` | ~2,7 ms/image | idem |
| Budget frame séance filmée | ~6 ms + getImageData + MediaPipe ≈ 25–35 ms → ~30 fps théoriques | idem |
| Boucles/timers dans `src/` | 1 seule RAF, 0 setTimeout/setInterval | grep |
| `FaceLandmarker.close()` | 0 occurrence | grep |
