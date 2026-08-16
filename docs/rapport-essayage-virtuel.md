# Rapport d'analyse — Essayage virtuel de lunettes (V1 & V2)

> ✅ **Statut : traité.** Les 15 correctifs (B1–B5, S1–S5, T1–T8) et les 7 renforcements de
> garde-fous décrits ici sont **appliqués au `CLAUDE.md`**, avec les trois arbitrages rendus
> par l'humain : seuil proportionnel borné 3–5 mm · rotation de tête seulement en cas de doute ·
> contrat corrigé avant tout code. Table de correspondance au §13 du `CLAUDE.md`.
>
> Une **divergence assumée** avec ce rapport est documentée au §5 du contrat : le masquage du
> décentrement se décide sur l'incertitude propagée, et non sur `relError <= 0.02` — ce seuil
> devenant inapplicable une fois la carte passée à 0,025 par le correctif B4 de ce même rapport.
>
> Ce document reste la référence sur le **pourquoi** de chaque correctif. Le `CLAUDE.md` fait foi
> sur le **quoi**. Il n'est pas mis à jour au fil du projet : c'est un instantané d'analyse.

**Objet :** revue complète du contrat `CLAUDE.md` avant écriture de la moindre ligne de code.
**Question posée :** « Est-ce que tout est codable, en mettant en place des contrôles pour éviter les bugs et les régressions ? »
**Réponse courte :** oui, intégralement — mais 15 défauts du contrat doivent être corrigés d'abord. Quatre d'entre eux faussent la mesure **en silence**, c'est-à-dire exactement le mode d'échec que tout le document cherche à empêcher.

---

## 0. Cadrage — ce que le projet est, et ce qu'il n'est pas

Ce cadrage prime sur toute autre lecture du contrat, y compris sur certaines formulations du `CLAUDE.md` lui-même qui devront être réécrites en conséquence.

### 0.1 Aucune sélection, aucun tri, aucune recommandation

L'application **ne trie rien, ne rejette rien, ne recommande rien, ne classe rien**. Il n'existe ni liste de « montures compatibles », ni score, ni message du type « celle-ci n'est pas pour vous ». Toute monture peut être essayée à tout moment, y compris une qui est manifestement trop grande — c'est précisément là qu'est la valeur : la personne le **voit**.

Conséquence sur le code :

- `core/verdict.ts` est conservé mais **ne décide de rien**. Il ne produit qu'une légende affichée à côté de l'image live (« monture 132 mm · votre visage 138 mm »). Il ne filtre aucun catalogue, ne bloque aucun essayage, n'ordonne aucune monture.
- Le statut `'incertain'` disparaît de l'interface. En cas de doute sur la mesure, on ne rend pas un jugement flou : on demande la carte, une fois, et on continue.
- Les formulations du `CLAUDE.md` §0 et §4 évoquant l'élimination de montures inadaptées sont à réécrire : le critère de succès n'est pas « l'app rend un verdict », c'est **« l'image à l'écran est juste au millimètre »**.

### 0.2 Live et jamais différé

Flux `getUserMedia` → détection sur la frame courante → compositing dans la même frame. La personne voit **sa propre vidéo réelle**, avec une monture **virtuelle** posée dessus. Aucune vidéo de synthèse, aucun rendu en différé, aucun avatar.

Seule exception, déjà prévue au `CLAUDE.md` §4 : la calibration carte fige une frame deux secondes pour que le client ajuste le rectangle. C'est tout.

*(Note : le banc de test `.y4m` décrit au §5 de ce rapport est un outil d'intégration continue. Il n'existe pas dans l'application et n'est jamais présenté à un client.)*

### 0.3 Aucun présupposé de taille

Les montures vont de **80 mm** (enfants) à **160 mm** (adultes à forte carrure). Aucune moyenne, aucune constante de taille en dur, aucune estimation statistique n'entre dans la chaîne de mesure. La monture est connue par ses cotes réelles, mesurées ; le visage est connu par une référence physique réelle (iris ou carte ISO).

Corollaire immédiat, développé en **B5** : la plage de plausibilité `118–165 mm` présente trois fois dans le contrat est elle-même un présupposé de taille — et elle exclut les enfants.

---

## 1. Verdict de faisabilité

| | |
|---|---|
| **Codable en totalité ?** | Oui. 8 lots V1 + 4 lots V2. |
| **Zone technique inconnue ?** | Aucune. Géométrie pure + compositing canvas 2D. |
| **Volume estimé** | ~2 500–3 500 lignes, dont ~600 de tests. |
| **Risque principal** | Pas la difficulté : la **régression silencieuse**. D'où la priorité absolue au lot 0. |
| **Architecture du contrat** | Solide. La séparation `core/` (pur, testé) ↔ `render/` ↔ `tracking/` est la bonne, et les garde-fous mécaniques du §9.0 sont exactement le bon réflexe. |

L'architecture V2-en-plugin (§11.3 : une fonction, une valeur d'énumération, rien d'autre ne bouge) est la meilleure décision du document. Elle est ce qui empêchera les deux versions de se casser mutuellement — à condition que **B2** soit corrigé, car en l'état le contrat viole sa propre règle.

---

## 2. Défauts bloquants — faussent le résultat sans rien signaler

### B1. `computeSpritePxPerMm` ne compile pas

Après `return mean;` subsistent un `throw` orphelin, une accolade fermante et un second `return mean;` — reliquat de copier-coller entre deux versions du garde-fou (celle à 3 cotes et celle à 2 cotes). À supprimer.

### B2. `classify` branche sur `cal.source`, ce que le §11.4 interdit

```typescript
if (Math.abs(Math.abs(deltaMm) - THRESHOLD_MM) < uncertainty && cal.source === 'iris')
```

Trois problèmes imbriqués :

1. **C'est un branchement sur le mode dans `core/`** — exactement ce que le §11.4 déclare fatal pour l'architecture.
2. **Le mode carte ne renvoie jamais `'incertain'`**, même à Δ = −4,1 mm avec ±2,1 mm de marge. Incohérent.
3. **Le test garde-fou du §11.4 ne passe que par chance.** Avec `SPEC_132` sur un visage de 138 mm : Δ = −6, `relError` = 0,01, u = 1,38 ; `|6−4| = 2 > 1,38` donc les trois sources s'accordent. Changer la fixture pour Δ = −3 (`|3−4| = 1 < 1,38`) et le test échoue : iris → `'incertain'`, carte → `'correcte'`. **Le test censé verrouiller le principe est fixture-dépendant.**
4. Le grep du hook pre-commit ne l'attrape pas : il cherche `source === 'worn-frame'`, pas `source === 'iris'`.

**Correctifs :**
- L'incertitude se calcule **uniquement** depuis `relError`, jamais depuis `source`. Arithmétique d'intervalle :
  ```
  lo = delta − u ; hi = delta + u
  hi < −T          → sous-taillée
  lo > +T          → surtaillée
  lo > −T && hi < +T → correcte
  sinon            → indéterminé (non affiché, cf. §0.1)
  ```
- Même correction au §5 pour le décentrement : le gater sur `relError <= 0.02`, **pas** sur `source === 'card'` — sinon `worn-frame` (plus précis que la carte) s'en trouve exclu sans raison.
- Durcir le grep du hook en `source ===` hors `calibration.ts`.
- Rendre le test garde-fou insensible à la fixture : le faire boucler sur plusieurs valeurs de Δ, dont au moins une dans la zone limite.

### B3. `totalFrameWidthMm` mesure le PNG, pas la monture

`sprite.img.width` inclut **tout pixel transparent en marge**. 20 px de padding sur un sprite à 12 px/mm = **+1,7 mm** injectés dans la grandeur qui est le livrable du projet, sans aucun signe extérieur.

**Correctif :** calculer la **bounding box alpha** dans l'outil de prep, la stocker dans `spec.json`, et ne jamais utiliser `img.width` dans la chaîne de mesure. Ajouter un test sur un sprite volontairement padé.

### B4. La carte sur le front souffre d'un biais de parallaxe non traité

La carte est posée sur le front ; les landmarks 234/454 sont sur le contour du visage, **20 à 35 mm en arrière**. En projection perspective l'échelle varie en 1/z :

```
erreur ≈ Δz / z    →    à 50 cm de la webcam : 4 % à 7 %
                        à 1 m               : 2 % à 3,5 %
```

C'est un **biais systématique, pas du bruit** : les « 3 mesures concordantes à moins de 3 % » du §4 ne le détectent pas, elles le confirment. Le contrat annonce 1–2 % pour la carte ; en l'état elle peut être **moins fiable que l'iris** qu'elle est censée corriger.

**Correctifs, cumulables :**
1. **Rotation de la tête** (~25° à droite ou à gauche) pendant la calibration : deux vues suffisent à **mesurer** l'écart de profondeur au lieu de le supposer, donc à l'annuler. C'est le correctif propre, et il est peu coûteux.
2. Imposer une distance minimale (≥ 60 cm), contrôlable via la taille de la carte en pixels.
3. À défaut, une constante `PARALLAX_OFFSET_MM` calibrée une fois.
4. Tant que non corrigé : `relError = 0.025` pour la carte, pas 0,015. **Ne jamais annoncer une précision qu'on n'a pas mesurée.**

> **Précision importante sur la rotation de tête :** elle ne réintroduit **aucune 3D**. On ne reconstruit aucun maillage, on n'affiche rien en 3D, `three.js` reste interdit. On extrait deux scalaires — un écart de profondeur et la largeur réelle au plan des tempes — depuis deux images. Le rendu reste du sprite 2D sur canvas. Ce cadrage doit être écrit explicitement dans le contrat pour que la mesure multi-vues ne serve pas de porte d'entrée à de la 3D plus tard.

### B5. La plage de plausibilité `118–165 mm` exclut les enfants

Présente **trois fois** (iris, carte, worn-frame) :

```typescript
if (faceWidthMm < 118 || faceWidthMm > 165) throw new CalibrationError(...)
```

Un visage d'enfant de 6 ans mesure 110–120 mm aux tempes ; à 4 ans, 105–115 mm. **Une calibration parfaitement correcte lèverait une erreur incompréhensible** — et ce, précisément pour la clientèle des montures à 80 mm.

C'est aussi, en soi, un présupposé de taille moyenne : exactement ce que le §0.3 interdit.

**Correctifs :** élargir à **95–175 mm**, et rédiger un message d'erreur qui explique la cause probable au lieu de dire « hors plage ». Vérifier au passage qu'aucune autre constante du projet n'encode implicitement un visage d'adulte.

---

## 3. Défauts sérieux

### S1. Le yaw est appliqué deux fois dans `drawFrame`

`faceWidthPx` (landmarks 234/454) diminue déjà en cos(yaw) quand la tête tourne. `livePxPerMm` — et donc `drawScale` — intègrent donc déjà le raccourci perspectif. Le `ctx.scale(Math.cos(yawRad), 1)` l'applique **une seconde fois** : on obtient cos² au lieu de cos.

- À 12° (limite de tolérance du verdict) : −4,4 % de largeur au lieu de −2,2 %.
- À 30° (nécessaire pour révéler la branche, lot 7) : **cos²(30°) = 0,75, soit une monture dessinée 25 % trop étroite.**

Effet secondaire : la **hauteur** du sprite est indûment réduite, alors que les dimensions verticales ne se raccourcissent pas sous un yaw.

**Correctif :** diviser `faceWidthPx` par cos(yaw) pour obtenir une échelle **isotrope**, puis appliquer le cos **horizontalement seulement**. Test dédié : à yaw = 0 et yaw = 30°, la hauteur rendue du sprite doit être identique.

### S2. L'iris mesuré à travers les lunettes correctrices du client

Un myope à −6 D voit son iris **minifié d'environ 10 %** par ses propres verres ; un hypermétrope, grossi d'autant. C'est **2 à 3 fois le plancher biologique de 4,3 %** que le contrat présente comme indépassable — et c'est parfaitement invisible.

**Correctif :** si le client porte des lunettes, **on ne tente pas l'iris du tout**. Consigne explicite « retirez vos lunettes », et si une monture est détectée devant les yeux, refus de calibrer avec passage direct à la carte. C'est le « doute » qui justifie de demander la carte sans négocier.

### S3. `FACE_WIDTH_CORRECTION_MM = 0` porte tout le biais du verdict

Les landmarks 234/454 sont sous les tempes anatomiques ; l'écart réel est de l'ordre de **5 à 10 mm**, soit davantage que le seuil de décision de 4 mm. Tant qu'elle n'est pas calibrée, **toute la lecture est décalée d'un cran**.

Le protocole du §5 (« une monture dont on sait qu'elle va bien ») est trop fragile pour une constante aussi lourde.

**Correctif :** calibrer sur **au moins 3 montures de largeurs différentes**, sur plusieurs visages si possible, et consigner chaque valeur mesurée dans `PROGRESS.md` avec sa date. La règle « ne jamais la retoucher pour faire passer un test » est à conserver telle quelle.

### S4. Le test `INVARIANT : la distance à la caméra…` ne teste rien

```typescript
expect(proche.frameWidthMm).toBeCloseTo(loin.frameWidthMm, 1);
```

`frameWidthMm` vient de `spec` et `faceWidthMm` vient de `cal` : **ni l'un ni l'autre ne dépend des landmarks**. Le test ne peut pas échouer, même si toute la chaîne d'échelle est cassée. Il est pourtant déclaré « sacré ».

**Correctif :** le faire porter sur la grandeur qui varie réellement — le rapport **largeur monture rendue (px) / largeur visage (px)** doit être constant entre `LANDMARKS_50CM` et `LANDMARKS_100CM`. C'est le seul test qui vérifie la promesse centrale du projet.

### S5. Le correctif du §1 bug #3 est écrit pour l'ancienne API tfjs

`@mediapipe/tasks-vision` expose `detectForVideo(video, timestampMs)`, **synchrone**, et qui **lève une exception si le timestamp n'est pas strictement croissant** — ce qui survient dès qu'une frame est répétée (webcam lente, onglet en arrière-plan).

La règle « la boucle ne meurt jamais » reste valable, mais le `try/catch` seul ne suffit pas : sans garde de monotonie, la boucle passe son temps à catcher et le compteur d'échecs sature sans cause réelle.

**Correctif :** garde de monotonie sur le timestamp + saut de frame si `video.currentTime` n'a pas changé, **avant** l'appel.

---

## 4. Trous de contrat — à combler avant la première ligne de code

| # | Élément | Problème |
|---|---|---|
| T1 | `VERTICAL_OFFSET_MM` | Utilisé dans `drawFrame`, jamais défini ni spécifié. Comment la monture se pose-t-elle verticalement sur le nez ? |
| T2 | `yawRad` | Passé à `drawFrame` et utilisé au §5 règle 3, mais `frameMetrics` ne le renvoie pas. |
| T3 | `lensCenterL_projected` | Le décentrement exige de projeter le centre optique sprite → écran. Si `render/` et `verdict.ts` calculent chacun leur transformée, elles divergeront à la première modification. → une seule `core/transform.ts` renvoyant l'affine, consommée par les deux. |
| T4 | `FrameSpec.totalWidthMm` | Requis par `calibrateWithWornFrame`, absent du schéma `spec.json` du §12 — comme `spritePxPerMm`, `bridgeCenter`, les centres optiques, la charnière et la bbox alpha (B3). Le §12 est à étendre. |
| T5 | Signature de `verdict()` | Les tests l'appellent à 3 arguments, la signature figée en exige 5. Ils déréférencent aussi un retour `\| null` sans `!` : ne typecheckera pas en `strict`. → un helper de fixtures. |
| T6 | `EXPECTED_MIN_TESTS = 12` | Le §8 n'en liste que 11. |
| T7 | `husky` | Contredit le §9.1 règle 8 (aucune dépendance sans validation). `git config core.hooksPath .githooks` fait strictement la même chose avec **zéro dépendance** — plus cohérent avec l'esprit du projet. |
| T8 | `relError` de `worn-frame` = 0,01 | Suppose 2 clics d'opticien précis à 1 % (≈ 4 px sur 400) sur un bord flou, **plus** le même biais de profondeur que B4. `0.02` est réaliste. |

---

## 5. Ce qui est vérifiable automatiquement, et ce qui exige un humain

### Vérifiable par moi, à chaque commit

- Typecheck TS `strict`, suite Vitest complète.
- Le hook pre-commit lui-même — **y compris en tentant de le contourner**, ce que le critère d'acceptation du lot 0 exige explicitement.
- Tous les invariants géométriques de `core/` : chaîne des trois échelles, rejet des photos en perspective, indépendance à la distance caméra (une fois S4 corrigé), identité des trois sources de calibration en aval (une fois B2 corrigé).
- **Banc de test navigateur sans caméra :** Chromium est préinstallé dans l'environnement et accepte `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<fichier.y4m>`, ce qui injecte une vidéo dans `getUserMedia`. La boucle de rendu, l'intégration MediaPipe et le compositing deviennent donc testables en intégration continue. **Cet outil n'existe qu'en CI ; il ne fait pas partie de l'application** (cf. §0.2).

### Non vérifiable sans toi

- Le rendu réel sur un vrai visage devant une vraie webcam.
- La calibration de `FACE_WIDTH_CORRECTION_MM` (S3) et de la correction de parallaxe (B4).
- Le critère d'acceptation V2-2 : coloris clair sur monture noire, absence de liseré.
- La validation de chaque lot avant passage au suivant (§10), qui reste humaine par construction.

---

## 6. Renforcements de garde-fous proposés

En complément du §9.0, qui est déjà le bon dispositif :

1. **Barrage sur le vocabulaire de sélection** dans `src/` : `filter`, `recommend`, `compatible`, `rejeter`, `suggest`. Même logique que le barrage anti-slider — rendre la dérive du §0.1 mécaniquement impossible plutôt que déconseillée.
2. **Barrage sur `source ===`** hors `calibration.ts` (corrige la faille de B2).
3. **Barrage sur les constantes de taille en dur** : toute occurrence d'un littéral entre 80 et 200 hors constante exportée et documentée est signalée (garde-fou du §0.3).
4. **`core.hooksPath` au lieu de husky** (T7) : mêmes barrages, zéro dépendance.
5. **Test de non-régression du padding alpha** (B3) : un sprite volontairement padé doit donner la même largeur en mm qu'un sprite recadré.
6. **Test d'isotropie sous yaw** (S1) : hauteur rendue identique à 0° et 30°.
7. **Le banc `.y4m` en CI** : garantit qu'un lot n'a pas cassé la boucle de rendu du lot précédent, sans mobiliser un humain.

---

## 7. Décisions en attente

1. **Seuil de « ça lui va » :** 4 mm fixe, ou ~3 % de la largeur du visage ? `THRESHOLD_MM = 4` est un chiffre d'adulte : sur un visage de 105 mm, 4 mm est proportionnellement deux fois plus sévère que sur 145 mm. Choix d'opticien, non tranché ici.
2. **Rotation de la tête pendant la calibration carte** (B4) : systématique pour tout le monde, ou seulement en cas de première mesure douteuse ?
3. **Ordre de travail :** correction du `CLAUDE.md` d'abord avec relecture humaine, ou code direct avec relecture du diff ?

---

## 8. État du dépôt au moment de ce rapport

Le dépôt `Josam512/Suppression-ref-monture` contient un projet **distinct** de l'essayage virtuel :

| Fichier | Rôle |
|---|---|
| `app.py` | Streamlit — effacement des marquages (références, CE, logos) sur photos de montures, par pinceau ou détection assistée + inpaint OpenCV. Préserve alpha et résolution. |
| `batch_clean.py` | Traitement par lots (backend easyocr ou EAST). |
| `Dockerfile`, `requirements*.txt` | Environnement Python. |

**Aucun code d'essayage virtuel n'existe encore.** Dernier commit fonctionnel : 12/07/2026.

Observation utile pour le **lot 4** (`prep/DetourTool.tsx`) : la chaîne Python existante traite déjà des photos de montures sur fond blanc avec préservation du canal alpha. Le détourage fond blanc → PNG transparent peut être fait par cet outil plutôt que réimplémenté en TypeScript ; le `DetourTool` se réduirait alors au **marquage des points de cote et au calcul de la bbox alpha** (B3). À arbitrer au moment du lot 4.

---

*Rapport établi avant tout développement. Aucun code n'a été écrit à ce stade : les corrections B1–B5 et S1–S5 doivent être arbitrées d'abord, faute de quoi l'application afficherait des mesures fausses sans le signaler.*
