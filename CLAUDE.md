# CLAUDE.md — Essayage virtuel de lunettes **2D** avec vérification de taille réelle

> Ce fichier est le contrat du projet. Claude Code doit le lire au début de **chaque** session.
> Toute décision qui contredit ce fichier doit être signalée et validée par l'humain avant d'être codée.

> ✅ **Revue appliquée.** L'analyse `docs/rapport-essayage-virtuel.md` avait relevé 15 défauts,
> dont 5 bloquants qui faussaient la mesure sans le signaler. **Les correctifs B1–B5, S1–S5 et
> T1–T8 sont intégrés ci-dessous**, ainsi que les trois arbitrages rendus par l'humain :
>
> | Décision | Arbitrage |
> |---|---|
> | Seuil « ça lui va » | **Proportionnel** : 3 % de la largeur du visage, borné entre 3 et 5 mm (§5) |
> | Rotation de tête en calibration carte | **Seulement en cas de doute**, pas systématique (§4) |
> | Ordre de travail | **Contrat corrigé d'abord, relu par l'humain, puis code** |
>
> Le rapport reste la référence sur le *pourquoi* de chaque correctif ; ce fichier est la
> référence sur le *quoi*. En cas de divergence entre les deux, ce fichier fait foi.

---

## 0. Objectif en une phrase

Une web app qui superpose en temps réel, sur le flux webcam, **l'image 2D détourée d'une monture réelle** (photo de face + photo de profil, les deux composées simultanément), à **l'échelle millimétrique exacte**, et qui **affiche les deux cotes en clair** à côté de l'image : largeur de la monture, largeur du visage.

La personne **voit** si ça lui va. L'app ne le lui dit pas.

### 0.0 Cadrage — ce que le projet est, et ce qu'il n'est pas

**Ce cadrage prime sur toute autre lecture du présent contrat.** Là où une formulation d'une section ultérieure semble le contredire, c'est la formulation qui est fautive.

#### 0.0.1 Aucune sélection, aucun tri, aucune recommandation

L'application **ne trie rien, ne rejette rien, ne recommande rien, ne classe rien**. Il n'existe ni liste de « montures compatibles », ni score, ni message du type « celle-ci n'est pas pour vous ». Toute monture peut être essayée à tout moment, y compris une manifestement trop grande — c'est précisément là qu'est la valeur : la personne le **voit**.

Conséquences directes sur le code :

- `core/verdict.ts` est conservé mais **ne décide de rien**. Il ne produit qu'une **légende** affichée à côté de l'image live : « monture 132 mm · votre visage 138 mm ». Il ne filtre aucun catalogue, ne bloque aucun essayage, n'ordonne aucune monture.
- Le statut `'indetermine'` (ex-`'incertain'`) existe dans le type de retour mais **n'est jamais affiché comme tel**. En cas de doute sur la mesure, on ne rend pas un jugement flou : on demande la carte, **une fois**, et on continue.
- Le nom `verdict` est conservé pour ne pas casser les signatures figées du §7, mais il est trompeur : lire « légende chiffrée », pas « jugement ».

> ⚠️ **Piège de dérive.** « Puisqu'on connaît les deux largeurs, autant masquer les montures trop grandes » est la pente qui transforme ce projet en moteur de recommandation. Elle est barrée mécaniquement par le garde-fou vocabulaire du §9.0.e.

#### 0.0.2 Live, et jamais différé

Flux `getUserMedia` → détection sur la frame courante → compositing dans la même frame. La personne voit **sa propre vidéo réelle**, avec une monture **virtuelle** posée dessus. Aucune vidéo de synthèse, aucun rendu en différé, aucun avatar.

Seule exception, déjà prévue au §4 : la calibration carte fige une frame deux secondes pour que le client ajuste le rectangle. C'est tout.

*(Le banc de test `.y4m` du §8.3 est un outil d'intégration continue. Il n'existe pas dans l'application et n'est jamais présenté à un client.)*

#### 0.0.3 Aucun présupposé de taille

Les montures vont de **80 mm** (enfants) à **160 mm** (adultes à forte carrure). Aucune moyenne, aucune constante de taille en dur, aucune estimation statistique n'entre dans la chaîne de mesure. La monture est connue par ses cotes réelles, mesurées ; le visage est connu par une référence physique réelle (iris ou carte ISO).

Corollaire, appliqué au §4 : la plage de plausibilité est **95–175 mm**, et non 118–165 mm — cette dernière était elle-même un présupposé de taille, et elle excluait les enfants.

### Contexte d'usage : VENTE EN LIGNE

L'utilisateur est un **client à distance, chez lui**. Il n'a **pas** la monture entre les mains, il n'a **pas** d'opticien à côté de lui, il ne dispose d'**aucun instrument de mesure**.

Conséquences directes, non négociables :

- La seule référence de taille disponible sans effort est **biologique** : le diamètre de l'iris (11,7 mm, quasi-constant). Précision 4,3 %. C'est le mode par défaut.
- En cas de résultat limite, on propose un **objet standardisé que tout le monde possède** : une carte bancaire (norme ISO/IEC 7810 ID-1, 85,60 × 53,98 mm). Précision **2,5 %** (cf. correctif B4 au §4). Posée sur le front **deux secondes**, puis rangée définitivement.
- Aucune saisie de mesure au clavier : le client ne connaît aucune de ses dimensions.
- L'app doit fonctionner sur un ordinateur portable ou un téléphone lambda, avec une webcam médiocre, **sans aucun capteur de profondeur** (voir §4 pour pourquoi cette piste est close).

### Ce qui est HORS PÉRIMÈTRE (ne pas coder, ne pas proposer)

- ❌ Aucune 3D. Pas de `three.js`, pas de WebGL, pas de `.glb`, pas de `.gltf`, pas de reconstruction de maillage.
- ❌ Pas de génération de modèle 3D à partir des photos.
- ❌ Pas de photoréalisme (reflets calculés, ombres portées, matériaux PBR).
- ❌ Pas de backend, pas de base de données, pas d'authentification.

Le rendu est du **compositing de sprites 2D sur `<canvas>`**. C'est tout. Si une tâche semble exiger de la 3D, c'est que la tâche est mal formulée : demander à l'humain.

### Le critère de succès unique

> Un opticien regarde l'écran et dit : « oui, **l'image est juste** : cette monture fait bien 132 mm de large sur ce visage de 138 mm, et c'est exactement ce que je vois à l'écran. »

Le critère n'est **pas** « l'app rend un bon verdict » (elle n'en rend aucun, §0.0.1). Il est : **l'image à l'écran est juste au millimètre**.

**La fidélité de la taille prime sur la beauté du rendu.** Un rendu moche mais métrologiquement juste = succès. Un rendu superbe dont la taille est approximative = échec total. Tolérance visée sur la largeur : **±3 %**.

---

## 1. Ce qui foirait dans les tentatives précédentes

Cinq bugs, du plus grave au moins grave. Le bug #1 est le seul qui compte vraiment.

### Bug #1 — 🔴 CRITIQUE : le slider de taille

**Le code fautif :**

```html
<div class="slider-container">
  <label for="scaleSlider">
    Ajuster la taille des lunettes
    <span class="value-display" id="scaleValue">1.0x</span>
  </label>
  <input type="range" id="scaleSlider" min="0.5" max="2.0" step="0.05" value="1.0">
</div>
```

```javascript
const scale = parseFloat(document.getElementById('scaleSlider').value);
const glassesWidth = faceWidth * 0.9 * scale;   // ❌ tout est faux ici
```

**Pourquoi c'est fatal :** ce code fait exactement l'inverse du besoin. Il laisse l'utilisateur **régler la taille à la main jusqu'à ce que ça ait l'air bien**. Or la question posée est « est-ce que cette monture est à ma taille ? ». Si l'utilisateur peut ajuster l'échelle, la réponse est toujours « oui » et l'app ne sert à rien. Et `faceWidth * 0.9` est une constante inventée : elle n'a aucun rapport avec les 44 / 39 / 22 mm de la monture.

**Le correctif :** l'échelle n'est **jamais** un paramètre d'entrée. Elle est **calculée** (§4). Aucun slider de taille dans l'interface. Un `fineTuneMm` de ±3 mm peut exister uniquement en mode debug, désactivé par défaut, et il doit afficher « correction manuelle : +1,5 mm — le verdict n'est plus fiable ».

---

### Bug #2 — 🔴 La monture dessinée à la main en Canvas 2D

**Le code fautif :**

```javascript
function drawGlasses(face) {
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(leftEyeX, eyeY, glassesWidth / 4, glassesHeight / 2, 0, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(rightEyeX, eyeY, glassesWidth / 4, glassesHeight / 2, 0, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(leftEyeX + glassesWidth / 4, eyeY);
  ctx.lineTo(rightEyeX - glassesWidth / 4, eyeY);   // ❌ le "pont"
  ctx.stroke();
}
```

**Pourquoi c'est fatal :** deux ellipses et un trait ne sont pas une monture. La forme réelle (papillon, carrée, pantos), la couleur, le bicolore noir/doré, l'épaisseur variable du cerclage — tout est perdu. Et `glassesWidth / 4` comme demi-largeur de verre n'a aucun lien avec la cote A = 44 mm.

**Le correctif :** on ne **dessine jamais** la monture. On affiche le **pixel de la photo réelle**, détourée en PNG avec canal alpha, via `ctx.drawImage()`. La photo est la source de vérité de la forme. C'est aussi ce qui rend le 2D légitime : en 2D, la photo *est* le modèle.

---

### Bug #3 — 🟠 La boucle de détection qui meurt en silence

**Le code fautif (v1) :**

```javascript
async function detectFaces() {
  if (!isRunning) return;                          // ❌ sort sans replanifier
  const faces = await detector.estimateFaces(video, { flipHorizontal: false });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (faces.length > 0) drawGlasses(faces[0]);
  animationId = requestAnimationFrame(detectFaces); // ❌ jamais atteint si throw
}
```

**Pourquoi ça foire :** aucun `try/catch`. La première exception de `estimateFaces` (fréquente tant que la vidéo n'a pas encore de frame décodée) tue la boucle définitivement. Symptôme observé : « la caméra s'ouvre, le statut dit *Essayage en cours*, mais rien ne s'affiche », **sans erreur rouge en console** car la promesse rejetée est avalée. C'est très exactement ce que tu as vécu.

**Le correctif — ⚠️ corrigé S5 : le code v2 de l'époque visait l'ancienne API tfjs.**

`@mediapipe/tasks-vision` n'expose pas `estimateFaces`. Il expose `detectForVideo(video, timestampMs)`, qui est **synchrone** (pas de `await`) et qui **lève une exception si le timestamp n'est pas strictement croissant**. Or une frame se répète dès que la webcam est plus lente que l'écran, ou que l'onglet passe en arrière-plan. Un `try/catch` seul ne suffit donc pas : la boucle passerait son temps à catcher et le compteur d'échecs saturerait **sans cause réelle**, ce qui est exactement le faux signal qu'on cherche à éviter.

Il faut une **garde de monotonie AVANT l'appel** :

```typescript
// tracking/landmarker.ts
let lastVideoTime = -1;
let lastTimestampMs = -1;
let consecutiveFailures = 0;

function loop(): void {
  if (!isRunning) { requestAnimationFrame(loop); return; }   // ✅ replanifie toujours

  if (!landmarker || !video || video.readyState < 2) {
    requestAnimationFrame(loop);
    return;
  }

  // ⭐ Garde S5 — frame répétée : on ne redétecte pas, et ce n'est PAS un échec.
  if (video.currentTime === lastVideoTime) {
    requestAnimationFrame(loop);
    return;
  }
  lastVideoTime = video.currentTime;

  // ⭐ Garde S5 — timestamp strictement croissant, exigé par tasks-vision.
  const ts = Math.max(performance.now(), lastTimestampMs + 1);
  lastTimestampMs = ts;

  try {
    const res = landmarker.detectForVideo(video, ts);        // synchrone, pas d'await
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (res.faceLandmarks.length > 0) {
      consecutiveFailures = 0;
      drawFrame(ctx, sprites, frameMetrics(res.faceLandmarks[0], w, h, cal));
    } else {
      consecutiveFailures++;
    }
  } catch (err) {
    consecutiveFailures++;
    console.error('Detection error:', err);                  // ✅ visible
  }

  requestAnimationFrame(loop);                               // ✅ atteint dans tous les cas
}
```

**Règle définitive :** la boucle de rendu ne doit **jamais** pouvoir s'arrêter sur une exception, et elle doit afficher à l'écran un compteur d'échecs consécutifs (`détection perdue : 12 frames`). Un échec silencieux est pire qu'un crash — mais un compteur qui monte alors que rien ne va mal est presque aussi nuisible : il apprend à ignorer l'alarme. **Une frame répétée n'incrémente pas le compteur.**

> 🔴 **Corollaire découvert au banc navigateur (§8.3), et non à la relecture : le chemin d'échec
> doit DESSINER.** Une première implémentation incrémentait bien le compteur dans `onLost`, mais ne
> repeignait le canvas que dans `onFrame` — c'est-à-dire uniquement quand un visage **était**
> détecté. Résultat : détection perdue ⇒ canvas vide ou figé sur la dernière image, et le compteur
> exigé ci-dessus n'apparaissait **jamais**. La panne était strictement indiscernable d'un
> fonctionnement normal : le bug #3 reconstitué à l'identique, sous une autre forme.
>
> Le contrat exige donc explicitement : **`onLost` efface le canvas et dessine l'overlay d'échec.**
> Aucune relecture de code n'avait attrapé ça — il a fallu ouvrir un navigateur sans visage devant
> la caméra. C'est la raison d'être du banc du §8.3.

---

### Bug #4 — 🟠 TensorFlow.js + Facemesh chargés depuis un CDN

**Le code fautif :**

```html
<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs"></script>
<script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/face-landmarks-detection"></script>
```

**Pourquoi ça foire :** 10–20 Mo à télécharger avant la première frame, sans barre de progression. En cas de latence, l'app reste bloquée sur « Chargement des modèles d'IA... » indéfiniment, et il est impossible de distinguer « ça charge » de « c'est mort ».

**Le correctif :** `@mediapipe/tasks-vision` (FaceLandmarker), installé en dépendance npm, fichier de modèle `face_landmarker.task` **vendorisé dans `public/models/`**. Zéro CDN au runtime, chargement affiché en pourcentage réel. Bénéfice décisif : ce modèle renvoie **478 points dont les iris** (indices 468–477), que Facemesh ne donnait pas — et les iris sont notre référence de mesure (§4).

---

### Bug #5 — 🟡 Artifact React, puis fichier ouvert en `file://`

**Symptôme rencontré :** `Impossible d'accéder à la caméra: Permission denied`, sans que le navigateur demande l'autorisation.

**Cause :** l'iframe sandboxée d'un artifact n'a pas `allow="camera"`. Et un fichier ouvert en `file://` n'est pas un *secure context* : `navigator.mediaDevices` y est indisponible ou dégradé selon le navigateur.

**Le correctif :** le projet tourne obligatoirement sur un serveur de dev (`vite dev` → `http://localhost:5173`, qui est un secure context). Ne **jamais** livrer un `.html` à double-cliquer.

---

## 2. Ce qui marchait — à conserver

- ✅ `getUserMedia({ video: { facingMode: 'user', width: {ideal: 1280}, height: {ideal: 720} } })` — monter la résolution : 640×480 était trop juste pour localiser les iris proprement.
- ✅ Le pattern `video.onloadedmetadata` → dimensionner le canvas → **puis seulement** démarrer la boucle.
- ✅ Le canvas superposé à la vidéo en CSS absolu, aux mêmes dimensions.
- ✅ Le bandeau de statut à trois états (`loading` / `ready` / `error`). À garder et enrichir.
- ✅ L'affichage permanent des cotes (44 / 39 / 22 / 145 mm) — mais désormais comme **entrées vérifiées**, plus comme décoration.

---

## 3. Architecture cible

### Stack imposée

```
Vite + TypeScript (strict) + React 18
@mediapipe/tasks-vision   → FaceLandmarker, modèle vendorisé
Canvas 2D API             → tout le rendu
Vitest                    → tests unitaires (la géométrie se teste sans navigateur)
Zéro autre dépendance sans validation explicite de l'humain.
```

### Arborescence

```
src/
  core/                        ← ZONE CRITIQUE, 100 % testée, aucune dépendance UI
    geom.ts                    ← dist, midpoint, px, smoothstep, CalibrationError
    units.ts                   ← conversions mm ↔ px, les 3 échelles
    calibration.ts             ← iris / carte / monture portée → largeur de visage en mm
                                 ⚠️ SEUL fichier autorisé à lire `cal.source` (§11.4)
    faceMetrics.ts             ← largeur visage, roll, yaw depuis les landmarks
    transform.ts               ← ⭐ T3 : L'UNIQUE affine sprite → écran (voir §6.1)
    frameSpec.ts               ← A, B, pont, largeur totale, px/mm du sprite, bbox alpha
    verdict.ts                 ← légende chiffrée (PAS un jugement, cf. §0.0.1)
  render/
    composite.ts               ← drawImage du sprite de face (consomme transform.ts)
    temple.ts                  ← sprite de profil (branche) + occlusion
    overlay.ts                 ← guides de mesure, cotes affichées
  tracking/
    landmarker.ts              ← init MediaPipe, boucle detectForVideo
  prep/                        ← outil hors-ligne de préparation des montures
    DetourTool.tsx             ← marquage des cotes + bbox alpha (cf. §4 B3)
  ui/
public/
  models/face_landmarker.task
  frames/<slug>/front.png  profile.png  spec.json
tests/
  fixtures/
    landmarks.ts               ← jeux de landmarks figés
    builders.ts                ← ⭐ T5 : helpers makeCal() / callVerdict() (voir §8.2)
.githooks/
  pre-commit                   ← ⭐ T7 : garde-fous mécaniques, ZÉRO dépendance (§9.0)
```

**Règle de taille :** aucun fichier > 300 lignes. Si un fichier dépasse, il se scinde. Le monolithe HTML de 800 lignes était la cause racine de « ça marche, puis ça recasse ».

---

## 4. LE CŒUR DU PROJET — la chaîne des trois échelles

C'est la partie qui n'existait pas avant. **Tout le reste est cosmétique.**

Le problème : un canvas ne connaît que des pixels. Pour dire « cette monture fait 132 mm sur un visage de 138 mm », il faut **trois** conversions mm↔px, distinctes, à ne jamais confondre.

### Échelle 1 — Le sprite de la monture : `spritePxPerMm`

Obtenue **une fois par monture**, dans l'outil de préparation. L'humain clique 6 points sur la photo de face :

| Points | Ce qu'on clique | Cote réelle connue |
|---|---|---|
| P1, P2 | bord nasal ↔ bord temporal du **verre gauche**, à mi-hauteur | **A = 44 mm** |
| P3, P4 | les deux bords intérieurs du **pont** | **Pont = 22 mm** |
| P5, P6 | haut ↔ bas du verre gauche, à mi-largeur | **B = 39 mm** |

```typescript
// core/frameSpec.ts
export function computeSpritePxPerMm(marks: FrontMarks, spec: FrameSpecMm): number {
  const values = [
    dist(marks.p1, marks.p2) / spec.aMm,
    dist(marks.p3, marks.p4) / spec.pontMm,
  ];
  if (spec.bMm != null) values.push(dist(marks.p5!, marks.p6!) / spec.bMm);

  const mean   = values.reduce((a, b) => a + b) / values.length;
  const spread = (Math.max(...values) - Math.min(...values)) / mean;

  // Mesures indépendantes du MÊME facteur d'échelle : elles doivent concorder.
  // ⚠️ Sans B (cas V2, cf. §11.5) il ne reste que 2 mesures : la redondance baisse,
  // donc le seuil DOIT se durcir de 4 % à 2,5 %. Ne jamais garder 4 % avec 2 points.
  const threshold = values.length === 3 ? 0.04 : 0.025;
  if (spread > threshold) {
    throw new CalibrationError(
      `Incohérence de ${(spread * 100).toFixed(1)}% entre les ${values.length} cotes de contrôle. ` +
      `Photo prise en perspective (pas de face) ou points mal placés. Recommencer.`
    );
  }
  return mean;
}
```

> ✅ **Correctif B1 appliqué.** La version précédente de ce bloc contenait, **après** le `return mean;`,
> un `throw` orphelin, une accolade fermante et un second `return mean;` — reliquat de copier-coller
> entre la variante à 3 cotes et la variante à 2 cotes du garde-fou. **Le fichier ne compilait pas.**
> Ne pas réintroduire de second `return` : il n'y a qu'un seul point de sortie nominal.

> ⚠️ Ce garde-fou est **obligatoire**. C'est lui qui attrape une photo prise de trois quarts, qui fausserait tout en aval de façon invisible.

On en déduit la mesure qui compte vraiment, **mesurée et non calculée** :

#### 🔴 Correctif B3 — mesurer la MONTURE, pas le fichier PNG

```typescript
// ❌ INTERDIT — c'était le code précédent :
// export function totalFrameWidthMm(spriteWidthPx: number, spritePxPerMm: number): number {
//   return spriteWidthPx / spritePxPerMm;
// }
```

`sprite.img.width` est la largeur du **fichier**, marges transparentes comprises. Un détourage qui laisse 20 px de padding alpha sur un sprite à 12 px/mm injecte **+1,7 mm** dans la grandeur qui est le livrable du projet — sans le moindre signe extérieur, et sans qu'aucun test existant ne s'en aperçoive.

La largeur se lit donc sur la **bounding box du canal alpha**, calculée une fois dans l'outil de prep et **stockée dans `spec.json`** :

```typescript
// prep/ — calculé UNE FOIS, à l'export du sprite.
export interface AlphaBBox { x: number; y: number; w: number; h: number }   // en px sprite

/** Plus petit rectangle contenant tout pixel d'alpha > seuil. */
export function computeAlphaBBox(img: ImageData, alphaThreshold = 8): AlphaBBox;

// core/frameSpec.ts — la largeur réelle vient de la bbox, JAMAIS de img.width.
export function totalFrameWidthMm(spec: FrameSpec): number {
  return spec.alphaBBox.w / spec.spritePxPerMm;   // ex. 1584 px / 12.0 = 132.0 mm
}
```

> ⚠️ **Règle absolue :** `img.width` et `img.height` ne doivent apparaître **nulle part** dans la chaîne
> de mesure. Ils ne servent qu'au `drawImage` de rendu. Un `grep 'img.width' src/core` doit
> renvoyer **zéro ligne** — c'est un des barrages du hook (§9.0.g).

> ⚠️ Le rendu doit lui aussi ancrer sur la bbox, pas sur le coin du fichier : sinon un sprite padé
> est correctement **dimensionné** mais **décalé** à l'écran. Voir `core/transform.ts` (§6.1).

On enregistre aussi, en coordonnées sprite : le **centre du pont** (point d'ancrage), les **centres optiques des deux verres** (diagnostic de décentrement, §5) et la **charnière** sur le sprite de profil (§6).

Sortie : `public/frames/<slug>/spec.json` — schéma complet au §12.

---

### Échelle 2 — Le visage réel : `userFaceWidthMm` (cascade à deux niveaux)

**C'est l'étape qui rend tout le reste possible.**

#### Le problème, à énoncer une fois pour toutes

Une caméra projette trois dimensions sur deux : l'échelle absolue fait partie de ce qui est perdu. Formellement :

```
taille_en_pixels = taille_réelle_mm × focale / distance
```

Une équation, **deux inconnues**. Un visage étroit près de l'objectif et un visage large plus loin donnent des images identiques. Aucun algorithme ne récupère une information absente du signal — ce n'est pas un manque de technologie, c'est une propriété de la projection perspective.

Il faut donc **réinjecter une longueur connue**. Deux sources possibles, et deux seulement.

> ❌ **Interdits absolus**, car tous équivalents à une constante en dur déguisée :
> - `const FACE_WIDTH_MM = 140` (largeur de visage adulte : 125–155 mm → ±10 % d'erreur).
> - Le module « géométrie faciale métrique 3D » de MediaPipe : il ramène **tout visage aux dimensions du modèle canonique**. L'échelle n'est réaliste qu'« à une constante près ». C'est le visage moyen habillé en mathématiques, donc plus trompeur qu'une constante écrite en clair.
> - Les IA de profondeur monoculaire (MiDaS, Depth Anything, Metric3D) : elles ont appris la taille typique des visages. Même circularité, enfouie dans un réseau et donc invérifiable.
> - Toute estimation de distance dérivée d'une taille supposée, puis réutilisée pour calculer une taille. **Circulaire.**

---

#### Niveau 1 — Mesure automatique par l'iris (par défaut, zéro friction)

Le diamètre horizontal de l'iris humain est une quasi-constante biologique : **11,7 ± 0,5 mm** sur une très large population, indépendamment de l'âge, du sexe et de la morphologie. Chaque client porte donc deux étalons calibrés sur son propre visage. MediaPipe FaceLandmarker fournit les contours d'iris (points 468–477) — c'est la raison d'être du modèle à 478 points.

```typescript
// core/calibration.ts
export const IRIS_DIAMETER_MM = 11.7;   // Google Research, MediaPipe Iris (±0.5 mm)
export const IRIS_REL_ERROR   = 0.043;  // 4,3 % — plancher biologique, non réductible

/** Échelle automatique. Moyenner les DEUX yeux sur ~30 frames pour tuer le bruit de détection. */
export function scaleFromIris(irisWidthPx: number): number {
  return irisWidthPx / IRIS_DIAMETER_MM;   // px par mm
}

/**
 * Pont obligatoire vers UserCalibration. NE PAS improviser une autre voie.
 * L'échelle iris est convertie UNE FOIS en largeur de visage, exactement comme
 * le fait la carte. Ensuite les deux modes suivent le même chemin en aval.
 */
export function calibrateWithIris(
  irisWidthPx: number, lm: NormalizedLandmark[], w: number, h: number
): UserCalibration {
  const pxPerMm = scaleFromIris(irisWidthPx);
  const faceWidthMm = dist(px(lm[FACE_L], w, h), px(lm[FACE_R], w, h)) / pxPerMm;

  assertPlausibleFaceWidth(faceWidthMm, 'iris');
  return { faceWidthMm, source: 'iris', relError: IRIS_REL_ERROR, measuredAt: Date.now() };
}
```

#### 🔴 Correctif B5 — la plage de plausibilité excluait les enfants

Les trois fonctions de calibration rejetaient tout visage hors `118–165 mm`. Or un visage d'enfant de 6 ans mesure **110–120 mm** aux tempes, et **105–115 mm** à 4 ans : une calibration parfaitement correcte levait une erreur incompréhensible — et ce, **précisément pour la clientèle des montures à 80 mm**. C'était aussi, en soi, le présupposé de taille moyenne que le §0.0.3 interdit.

Le contrôle est unique, partagé par les trois sources, et sa plage est élargie :

```typescript
// core/calibration.ts — UNE seule définition, utilisée par iris, carte ET monture portée.
export const FACE_WIDTH_MIN_MM = 95;    // enfant de ~3 ans, marge basse
export const FACE_WIDTH_MAX_MM = 175;   // adulte à très forte carrure, marge haute

export function assertPlausibleFaceWidth(mm: number, source: CalSource): void {
  if (mm >= FACE_WIDTH_MIN_MM && mm <= FACE_WIDTH_MAX_MM) return;

  // Le message nomme la CAUSE PROBABLE, pas le symptôme : « hors plage » n'aide personne.
  const cause = {
    iris:         `La mesure automatique des yeux a probablement échoué. ` +
                  `Si vous portez des lunettes, retirez-les et recommencez.`,
    card:         `Le cadre a probablement été mal ajusté sur les bords de la carte. ` +
                  `Recommencez en suivant bien le contour.`,
    'worn-frame': `La monture de référence sélectionnée ne correspond probablement pas ` +
                  `à celle qui est portée, ou ses bords ont été mal pointés.`,
  }[source];

  throw new CalibrationError(`Mesure obtenue : ${mm.toFixed(1)} mm. ${cause}`);
}
```

> ⚠️ Cette plage est un **détecteur de panne**, pas un critère d'éligibilité. Elle n'existe que pour
> attraper une calibration ratée. Elle ne doit **jamais** servir à refuser un client (§0.0.1).

#### 🟠 Correctif S2 — ne jamais mesurer l'iris à travers des verres correcteurs

Un myope à −6 D voit son iris **minifié d'environ 10 %** par ses propres verres ; un hypermétrope, grossi d'autant. C'est **2 à 3 fois le plancher biologique de 4,3 %** présenté ci-dessus comme indépassable — et c'est totalement invisible : l'iris reste net, rond, parfaitement détecté. La mesure est fausse et paraît excellente.

**Règle :** si le client porte des lunettes, on **ne tente pas l'iris du tout**.

1. Avant la calibration iris, consigne explicite à l'écran : **« Retirez vos lunettes pour la mesure. »**
2. Si une monture est détectée devant les yeux malgré la consigne, on **refuse de calibrer sur l'iris** et on passe **directement** à la carte (§ Niveau 2) — sans négocier, sans dégrader silencieusement la précision.
3. La détection de monture portée n'a pas besoin d'être fine : un contraste marqué sur la zone des paupières supérieures suffit. En cas de doute, on demande la carte. **Le doute coûte deux secondes ; une mesure fausse coûte un retour produit.**

C'est précisément le cas d'usage qui justifie que la carte existe.

> ⚠️ **Piège à ne pas se laisser vendre :** moyenner sur 1000 frames n'améliorera PAS la précision au-delà de 4,3 %. Le moyennage élimine le bruit de détection, pas la variabilité biologique — celle-ci est un **biais fixe** propre à cette personne. Un client dont les iris font 11,2 mm sera décalé de 4 % pour toujours. Aucune statistique ne corrige un étalon faux. Ne jamais annoncer une précision meilleure que 4,3 % en mode iris.

**Ce que ça vaut :** ±6 mm sur un visage de 138 mm. Suffisant pour que l'image à l'écran soit visuellement juste dans l'immense majorité des cas. Insuffisant pour afficher une légende chiffrée au millimètre près, puisque le seuil de lecture vaut 3 à 5 mm selon le visage (§5).

> ⚠️ Formulation à ne pas réintroduire : « suffisant pour **éliminer** les montures inadaptées ».
> L'app n'élimine rien (§0.0.1). L'incertitude iris ne restreint pas le catalogue, elle
> restreint **ce qu'on ose écrire dans la légende**.

---

#### Niveau 2 — Calibration carte (déclenchée uniquement en zone grise)

Norme **ISO/IEC 7810 ID-1 : 85,60 × 53,98 mm**. Objet universel, gratuit, présent chez tout le monde. Précision annoncée : **2,5 %** — voir le correctif B4 ci-dessous, qui explique pourquoi ce n'est pas 1–2 %.

**Ne pas l'imposer à l'entrée.** Elle se propose uniquement quand le résultat iris tombe dans la zone d'incertitude, avec une raison explicite :

> *« Cette monture est à la limite de votre taille. Deux secondes avec une carte bancaire et je vous donne une réponse ferme — ça vous évitera peut-être un retour. »*

**Procédure — 2 secondes, une seule fois, puis la carte disparaît :**

1. « Posez une carte bancaire à plat sur votre front, bord horizontal, et regardez droit devant vous. »
2. L'app fige une image. Un rectangle redimensionnable apparaît ; le client l'ajuste sur les bords de la carte. *(Ajustement manuel, pas de détection automatique : plus robuste sur webcam médiocre, et le client voit ce qu'il fait.)*
3. L'app calcule et **mémorise en `localStorage`** la largeur du visage en mm.
4. **« Merci, vous pouvez ranger votre carte. »** Plus jamais nécessaire, ni pour cette monture ni pour les suivantes.

```typescript
export const CARD_WIDTH_MM = 85.60;   // norme ISO/IEC 7810 ID-1

/**
 * La carte ne sert PAS à mesurer la carte : elle sert à mesurer le VISAGE.
 * Une fois le visage connu en mm, il devient sa propre règle graduée
 * et la carte peut être retirée définitivement.
 */
export function calibrateWithCard(
  cardWidthPx: number, lm: NormalizedLandmark[], w: number, h: number
): UserCalibration {
  const mmPerPx = CARD_WIDTH_MM / cardWidthPx;
  const faceWidthMm = dist(px(lm[FACE_L], w, h), px(lm[FACE_R], w, h)) * mmPerPx;

  assertPlausibleFaceWidth(faceWidthMm, 'card');
  return { faceWidthMm, source: 'card', relError: CARD_REL_ERROR, measuredAt: Date.now() };
}
```

#### 🔴 Correctif B4 — le biais de parallaxe de la carte sur le front

**Le problème.** La carte est posée sur le **front**. Les landmarks 234/454 servant à mesurer le visage sont sur le **contour**, 20 à 35 mm **en arrière** du plan de la carte. En projection perspective, l'échelle varie en `1/z` :

```
erreur ≈ Δz / z    →    à 50 cm de la webcam : 4 % à 7 %
                        à 1 m               : 2 % à 3,5 %
```

**Pourquoi c'est grave.** C'est un **biais systématique, pas du bruit.** Les « 3 mesures concordantes à moins de 3 % » exigées ci-dessous ne le détectent donc **pas** : elles le confirment, puisque les trois mesures partagent exactement le même biais. En l'état, la carte annoncée à 1–2 % pouvait être **moins fiable que l'iris qu'elle est censée corriger** — le pire mode d'échec possible pour ce projet.

**Les parades, cumulables, dans cet ordre :**

```typescript
// core/calibration.ts
export const CARD_REL_ERROR       = 0.025;  // ⚠️ 2,5 % — PAS 0.015, tant que B4 n'est pas mesuré.
export const CARD_MIN_DISTANCE_MM = 600;    // en deçà, la parallaxe devient dominante
```

1. **Distance minimale imposée (≥ 60 cm).** Contrôlable directement : la carte occupe trop de pixels ⇒ le client est trop près ⇒ message « reculez un peu ». Gratuit, et divise le biais par deux.
2. **Mesure de la profondeur par rotation de la tête — ⚠️ SEULEMENT EN CAS DE DOUTE.** *(arbitrage humain, cf. en-tête)* Deux vues suffisent à **mesurer** l'écart de profondeur au lieu de le supposer, donc à l'annuler. On ne l'impose **pas** à tout le monde : la friction tuerait le taux de complétion pour un gain nul dans le cas nominal. Elle se déclenche uniquement si les 3 mesures successives divergent de plus de 3 %, ou si la largeur obtenue tombe dans les 10 % extrêmes de la plage plausible.
3. **À défaut**, une constante `PARALLAX_OFFSET_MM` calibrée une fois par l'humain, avec sa date — même discipline que `FACE_WIDTH_CORRECTION_MM` (§5).
4. **Tant que rien de tout cela n'est mesuré : `CARD_REL_ERROR = 0.025`.** Ne jamais annoncer une précision qu'on n'a pas vérifiée soi-même.

> 🔴 **Cadrage impératif sur la rotation de tête.** Elle ne réintroduit **aucune 3D**. On ne
> reconstruit aucun maillage, on n'affiche rien en 3D, `three.js` reste interdit (§0). On extrait
> **deux scalaires** — un écart de profondeur et la largeur réelle au plan des tempes — depuis deux
> images. Le rendu reste du sprite 2D sur canvas.
>
> Cette phrase est dans le contrat pour une raison précise : la mesure multi-vues est la porte
> d'entrée la plus plausible pour de la 3D introduite « logiquement », lot après lot. Si une tâche
> future invoque cette section pour justifier un maillage, un solveur de pose 3D ou une lib de
> géométrie projective, **elle contredit le contrat** : s'arrêter et demander à l'humain.

**Contraintes de validité à faire respecter par l'UI :**

- La carte doit être **dans le même plan que le visage** (posée à plat sur le front, pas tendue vers la caméra), sinon la perspective fausse l'échelle. Message explicite à l'écran.
- Pose de face obligatoire : rejeter si la tête est tournée ou inclinée de plus de 8°.
- **Distance ≥ 60 cm** (`CARD_MIN_DISTANCE_MM`), estimée depuis la taille de la carte en pixels — parade n°1 de B4.
- **3 mesures sur 3 images successives**, concordantes à moins de 3 % ; sinon redemander. Une calibration ratée contamine silencieusement toute la session.
- Bouton « refaire la calibration » toujours accessible.

> ⚠️ **Ce que le contrôle des 3 mesures ne fait PAS.** Il attrape le **bruit** (main qui tremble,
> cadre mal ajusté). Il n'attrape **aucun biais systématique** — ni la parallaxe (B4), ni une carte
> légèrement inclinée de façon constante. Trois mesures concordantes ne prouvent que la
> **répétabilité**, jamais la **justesse**. Ne jamais présenter cette concordance comme une preuve
> de précision, ni à l'écran, ni dans un commentaire de code.

---

#### La source de l'échelle doit voyager avec la mesure

```typescript
export interface UserCalibration {
  faceWidthMm: number;
  source: CalSource;       // 'iris' | 'card'  (+ 'worn-frame' en V2, §11.3)
  relError: number;        // iris 0.043 | carte 0.025 (B4) | monture portée 0.02 (T8)
  measuredAt: number;
}
```

**Règle 1 :** `relError` n'est jamais ignorée en aval. Elle pilote la largeur de la zone grise (§5) et le libellé affiché. Une mesure sans son incertitude est une mesure fausse.

**Règle 2 — 🔴 la plus importante du fichier, corrigée en B2 :** `source` est un champ **de traçabilité et d'affichage**, jamais un champ de **décision**. Aucun calcul, nulle part, ne branche dessus.

```typescript
// ❌ INTERDIT, partout hors calibration.ts :
if (cal.source === 'iris')  { /* ... */ }
if (cal.source === 'card')  { /* ... */ }

// ✅ La seule question légitime porte sur la PRÉCISION, jamais sur son ORIGINE :
if (cal.relError <= 0.02)   { /* ... */ }
```

**Pourquoi cette règle, et pas une simple préférence de style :** deux sources de même précision doivent produire exactement le même résultat. Brancher sur `source` fait diverger les modes, et c'est ce qui rendra chaque correctif d'un mode capable de casser l'autre (§11.4). Barrage mécanique au §9.0.f.

---

#### Pourquoi la carte plutôt que du matériel

Question qui reviendra forcément — trancher une fois :

| Piste | Verdict |
|---|---|
| Capteur de profondeur (TrueDepth iOS, ARCore Android) | Inaccessible en web sur iPhone ; **inexistant sur PC Windows**, qui est le poste d'achat principal. Imposerait 3 bases de code sans couvrir le cas principal. |
| WebXR Depth Sensing | Conçu pour scanner l'environnement avec la caméra **arrière**, pas pour mesurer son propre visage. Absent de Safari. |
| Autofocus (`getCapabilities().focusDistance`) | Webcams de portable à focale fixe : renvoient un objet vide. Granularité en centimètres même quand disponible. |
| Mouvement + accéléromètre | Seule voie logiquement valide, mais suppose de bouger l'appareil — impossible sur un portable posé sur un bureau — et la dérive dépasse 4 mm. |

La carte fonctionne à l'identique sur Windows, Mac, Android et iPhone, dans n'importe quel navigateur, sans permission ni matériel, avec **une seule base de code et 100 % de couverture**. Ce n'est pas un pis-aller : c'est objectivement l'option la plus universelle et la plus précise disponible.

---

### Échelle 3 — Chaque frame : `livePxPerMm`

La carte a disparu, mais le visage est maintenant connu en mm. Il suffit de mesurer sa largeur en pixels sur l'image courante pour retrouver l'échelle, image par image.

```typescript
// core/faceMetrics.ts
// MediaPipe FaceLandmarker renvoie 478 points.
export const FACE_L = 234, FACE_R = 454;   // contour externe, niveau tempes/joues
export const EYE_L  = 33,  EYE_R  = 263;   // coins externes des yeux → inclinaison
export const SELLION = 168;                // creux du nez, entre les yeux → ancrage

export const MAX_YAW_FOR_SCALE_RAD = 0.70;   // ~40° — au-delà, cos(yaw) devient instable

export interface FrameMetrics {
  livePxPerMm: number;
  rollRad: number;
  yawRad: number;          // ⭐ T2 : était consommé par drawFrame et par le §5 sans jamais être renvoyé
  anchor: Pt;
}

export function frameMetrics(
  lm: NormalizedLandmark[], w: number, h: number,
  cal: UserCalibration, yawRad: number,
): FrameMetrics {
  const faceWidthPxRaw = dist(px(lm[FACE_L], w, h), px(lm[FACE_R], w, h));

  // ⭐ Correctif S1, moitié 1/2 — DÉ-projeter avant de convertir.
  // 234/454 sont deux points d'un segment quasi frontal : quand la tête tourne de `yaw`,
  // leur écartement apparent est déjà réduit d'un facteur cos(yaw). Si on ne le compense
  // pas ici, `livePxPerMm` chute avec le yaw et le sprite rétrécit sans raison physique.
  const cosYaw = Math.cos(Math.min(Math.abs(yawRad), MAX_YAW_FOR_SCALE_RAD));
  const faceWidthPxFrontal = faceWidthPxRaw / cosYaw;

  // ⭐ LA conversion : largeur frontale à l'écran ÷ largeur réelle mémorisée.
  // DÉCISION FIGÉE : la calibration est faite UNE FOIS, au démarrage. On ne recalcule PAS
  // l'échelle depuis l'iris à chaque image : ce serait plus bruité, et cela rendrait les
  // sources divergentes. Les trois sources suivent le même chemin à partir d'ici.
  // Cette échelle est ISOTROPE : elle vaut pour les X comme pour les Y.
  const livePxPerMm = faceWidthPxFrontal / cal.faceWidthMm;

  const eL = px(lm[EYE_L], w, h), eR = px(lm[EYE_R], w, h);

  return {
    livePxPerMm,
    rollRad: Math.atan2(eR.y - eL.y, eR.x - eL.x),
    yawRad,
    anchor:  px(lm[SELLION], w, h),
  };
}
// ⚠️ NE PAS ajouter `faceWidthMm` au retour : ce serait une simple recopie de la
// calibration, qui ressemble à une mesure sans en être une. La largeur du visage
// se lit sur `cal`, sa seule source légitime.
```

#### D'où vient `yawRad` — et la limite à ne pas franchir

`yawRad` est fourni par MediaPipe, via `outputFacialTransformationMatrixes: true`, dont on extrait **la rotation, et rien d'autre**.

```typescript
// tracking/landmarker.ts — la SEULE lecture autorisée de cette matrice.
// On en tire trois angles. On n'en tire JAMAIS ni translation, ni échelle.
export function yawFromMatrix(m: Float32Array): number;
```

> 🔴 **Interdit absolu.** La composante de **translation** et l'**échelle** de cette matrice sont
> exprimées dans le repère du **modèle canonique** de MediaPipe : les utiliser reviendrait
> exactement au « visage moyen habillé en mathématiques » banni au § Échelle 2. La **rotation**,
> elle, ne dépend pas de la taille du visage — c'est pourquoi elle seule est admise.
> Barrage au §9.0.g.

*(Justification d'ingénierie : un estimateur de yaw bricolé en 2D — asymétrie du sellion entre les deux bords du visage — dépend du rapport entre la profondeur du nez et la largeur du visage, c'est-à-dire d'une morphologie supposée. Ce serait un présupposé de taille déguisé, interdit au §0.0.3. La matrice de rotation évite ce piège.)*

Le facteur de redimensionnement du sprite n'a alors **aucun paramètre libre** :

```typescript
// core/transform.ts — et NULLE PART ailleurs (T3, voir §6.1).
const drawScale = livePxPerMm / spritePxPerMm;      // isotrope, sans paramètre libre
```

> ⚠️ Ne pas dériver les dimensions de dessin de `sprite.img.width` / `.height` : ce sont les
> dimensions du **fichier**, marges transparentes comprises (B3). Tout passe par
> `spec.alphaBBox` et l'affine unique de `core/transform.ts`.

> **Vérification mentale à refaire à chaque relecture :** si le client avance vers la caméra, `faceWidthPx` augmente, donc `livePxPerMm` augmente, donc `drawScale` augmente, donc la monture grossit exactement dans les mêmes proportions que le visage. **Le rapport monture/visage reste constant, quelle que soit la distance à l'écran.** C'est le test de cohérence du projet en une ligne — et c'est précisément ce que la carte bancaire a rendu possible.

---

## 5. La légende chiffrée (ex-« verdict »)

C'est le livrable final visible — **à côté** de l'image, jamais à la place. Rappel du §0.0.1 : ce module **ne décide de rien**. Il ne filtre aucun catalogue, ne bloque aucun essayage, ne recommande rien. Il met des chiffres justes sous une image juste.

```typescript
// core/verdict.ts
export type Status = 'sous-taillee' | 'correcte' | 'surtaillee' | 'indetermine';

export interface SizeVerdict {
  frameWidthMm: number;
  faceWidthMm: number;
  faceWidthUncertaintyMm: number;      // ± issu de cal.relError
  deltaMm: number;
  thresholdMm: number;                 // le seuil effectif de CE visage (voir Règle 1)
  status: Status;                      // usage INTERNE + libellé ; jamais un tri (§0.0.1)
  decentrementMm: { left: number; right: number } | null;
  source: CalSource;                   // traçabilité et affichage SEULEMENT (§4, règle 2)
}
```

**Règle 1 — largeur (règle opticien classique) :** la largeur totale de la monture doit correspondre à la largeur du visage aux tempes.

**⚖️ Arbitrage humain : le seuil est PROPORTIONNEL, borné.** Un seuil fixe de 4 mm est un chiffre d'adulte : sur un visage de 105 mm il est proportionnellement deux fois plus sévère que sur un visage de 145 mm — soit exactement le présupposé de taille interdit au §0.0.3. Il devient donc 3 % de la largeur du visage, **borné entre 3 et 5 mm** pour ne jamais descendre sous la précision de la mesure elle-même (±2,1 mm au mieux) ni offrir une tolérance absurde sur une forte carrure.

```typescript
// core/verdict.ts
export const THRESHOLD_RATIO  = 0.03;   // 3 % de la largeur du visage
export const THRESHOLD_MIN_MM = 3;      // plancher : sous la précision de mesure, ça n'a plus de sens
export const THRESHOLD_MAX_MM = 5;      // plafond : au-delà, la tolérance ne veut plus rien dire

/** Seuil effectif pour CE visage. Jamais de constante de seuil en dur ailleurs. */
export function thresholdFor(faceWidthMm: number): number {
  return Math.min(THRESHOLD_MAX_MM, Math.max(THRESHOLD_MIN_MM, faceWidthMm * THRESHOLD_RATIO));
}
```

| Visage | Seuil effectif | Commentaire |
|---|---|---|
| 105 mm (enfant) | 3,2 mm | proportionné, au lieu des 4 mm d'adulte |
| 138 mm (adulte médian) | 4,1 mm | ≈ l'ancien 4 mm : aucun changement en pratique |
| 145 mm | 4,4 mm | |
| 167 mm+ | 5,0 mm | plafonné |

**Règle 1 bis — 🔴 correctif B2 : l'incertitude se calcule depuis `relError`, JAMAIS depuis `source`.**

L'ancienne version branchait sur `cal.source === 'iris'`, ce qui produisait trois défauts d'un coup : un branchement sur le mode dans `core/` (interdit §11.4) ; un mode carte incapable de renvoyer `'indetermine'` même à Δ = −4,1 mm avec ±2,1 mm de marge ; et un test garde-fou qui ne passait **que par chance**, parce que la fixture choisie tombait hors de la zone limite.

Le remplacement est de l'**arithmétique d'intervalle** — sans aucune connaissance de l'origine de la mesure :

```typescript
// core/verdict.ts
export function classify(deltaMm: number, cal: UserCalibration): Status {
  const t  = thresholdFor(cal.faceWidthMm);
  const u  = cal.faceWidthMm * cal.relError;   // iris ≈ 5.9 mm | carte ≈ 3.5 mm | portée ≈ 2.8 mm
  const lo = deltaMm - u;
  const hi = deltaMm + u;

  // On ne conclut QUE si l'intervalle entier tombe du même côté du seuil.
  if (hi < -t)            return 'sous-taillee';
  if (lo >  t)            return 'surtaillee';
  if (lo > -t && hi < t)  return 'correcte';
  return 'indetermine';                        // l'intervalle chevauche un seuil
}
```

> 🔴 **Conséquence mesurée, à ne PAS « réparer ».** Une fois B2, B4 et T8 appliqués ensemble,
> conclure exige `|Δ| > t + u`. Avec une carte sur un visage de 138 mm : `4,14 + 3,45 = 7,59 mm`.
> **L'exemple emblématique du contrat — « 132 mm sur 138 mm, légèrement sous-taillée » — devient
> donc `'indetermine'`.** Ce n'est pas une régression : c'est la précision réelle de la mesure,
> qui était jusque-là masquée par un `classify` qui ne regardait l'incertitude que pour l'iris.
>
> La tentation sera d'abaisser `relError` ou d'élargir le seuil pour « retrouver » l'ancien
> comportement. Ce serait annuler B4 et revenir au mode d'échec que tout ce document combat :
> **afficher une conclusion que la mesure ne porte pas.** Le produit ne s'en trouve pas affaibli —
> l'image reste juste, les deux chiffres restent affichés avec leurs marges, et c'est la personne
> qui regarde (§0.0.1). Un test verrouille ce comportement.

**Ce que `'indetermine'` déclenche — et ce qu'il n'affiche pas.** Ce n'est pas un échec, et ce n'est **pas un libellé montré au client** (§0.0.1) : on n'affiche jamais un jugement flou. Il déclenche, **une seule fois**, la proposition de calibration carte. Si la carte a déjà été faite, on n'insiste pas : on affiche les deux chiffres avec leurs marges et **on laisse la personne regarder l'image**, qui reste juste dans tous les cas.

**Affichage obligatoire de l'incertitude.** En mode iris : *« Votre visage : environ 138 mm (± 6 mm) »*. En mode carte : *« Votre visage : 138 mm (± 3 mm) »*. Ne jamais afficher un nombre nu qui suggère une précision inexistante.

**Règle 2 — centrage de l'œil dans le verre.** Chaque œil doit tomber au centre horizontal de son verre. Si l'écart dépasse **3 mm**, ce n'est pas la largeur totale qui est en cause mais le **pont** (22 mm inadapté à ce nez) : la monture est de la bonne taille mais mal proportionnée pour ce visage. C'est une information différente, affichée différemment.

```typescript
export const DECENTREMENT_THRESHOLD_MM = 3;

// Le centre optique du verre vient du sprite : il DOIT être projeté à l'écran par
// l'affine unique de core/transform.ts (T3). Ne jamais recalculer la transformée ici.
const eyeCenterL   = midpoint(px(lm[33], w, h), px(lm[133], w, h));   // coins de l'œil gauche
const lensCenterL  = spriteToScreen(spec.lensCenterL, m);             // ⭐ core/transform.ts
const decentrementMm = dist(eyeCenterL, lensCenterL) / m.livePxPerMm;
```

**🔴 Correctif B2 (2/2) — le masquage se décide sur la PRÉCISION, pas sur la source.**

L'ancienne règle était `n'afficher QUE si source === 'card'`. Outre le branchement interdit, elle excluait sans raison `'worn-frame'`, **plus précis que la carte**.

⚠️ **Divergence assumée avec le rapport d'analyse.** Le rapport proposait de remplacer ce test par `relError <= 0.02`. Ce seuil est devenu inapplicable une fois B4 appliqué : la carte passe à `relError = 0.025` et serait donc masquée elle aussi — le correctif tuerait silencieusement la fonctionnalité qu'il prétend sauver. Pire, comparer `relError` (une erreur d'échelle relative) au seuil de 3 mm (un écart absolu) était déjà l'erreur de raisonnement de la version d'origine : ±6 mm sur la **largeur du visage** ne signifie pas ±6 mm sur un **décentrement**.

On propage donc l'incertitude jusqu'à la grandeur réellement affichée :

```typescript
/**
 * Le décentrement est un petit écart mesuré à ~30 mm du point d'ancrage. Une erreur
 * d'échelle de r % ne le décale que de r % × 30 mm — et non de r % × largeur du visage.
 * C'est CETTE grandeur-là qu'il faut comparer au seuil de 3 mm.
 */
export function decentrementUncertaintyMm(spec: FrameSpec, cal: UserCalibration): number {
  const lever = Math.abs(spec.lensCenterL.x - spec.bridgeCenter.x) / spec.spritePxPerMm;  // ≈ 30 mm
  return lever * cal.relError;   // iris ≈ 1.3 mm | carte ≈ 0.75 mm | portée ≈ 0.6 mm
}

// Affiché seulement si la mesure peut réellement trancher le seuil de 3 mm.
const u = decentrementUncertaintyMm(spec, cal);
const decentrementMm = (u < DECENTREMENT_THRESHOLD_MM / 2) ? measured : null;
```

Le diagnostic est donc **masqué s'il n'est pas concluant, pas approximé** — mais pour une raison mesurée, et non parce que la mesure vient de l'iris.

> 🔴 **Deuxième conséquence mesurée.** Sur une monture courante (centre optique à ~30 mm du pont),
> l'incertitude vaut **1,29 mm en mode iris**, très en dessous de la demi-tolérance de 1,5 mm.
> **Le décentrement est donc désormais AFFICHÉ en mode iris**, contrairement à ce que prescrivait
> la version d'origine. Elle le masquait au motif que « le décentrement se joue à 3 mm, en dessous
> de la barre d'erreur de ±6 mm » — mais ces ±6 mm portent sur la **largeur du visage**, pas sur un
> écart mesuré à 30 mm de l'ancrage. On masquait une information exploitable sur la foi d'une
> comparaison entre deux grandeurs sans rapport.
>
> Le masquage n'est pas mort pour autant : sur une monture à long levier (~40 mm), l'iris passe à
> 1,72 mm et le décentrement redevient non concluant. Deux tests couvrent les deux côtés du seuil.

**Règle 3 — conditions de pose.** Aucune légende chiffrée n'est affichée si : yaw > 12°, ou roll > 15°, ou détection perdue depuis > 5 frames, ou aucune échelle disponible. **Ne jamais afficher un chiffre à l'air confiant sur une mesure dégradée.**

> ⚠️ La règle 3 gèle **la légende**, jamais **l'image**. La monture reste dessinée à l'écran quoi
> qu'il arrive : c'est le cœur du produit (§0.0.2). On masque des chiffres, on n'interrompt jamais
> l'essayage.

### 🟠 Correctif S3 — la constante qui porte tout le biais

Les landmarks 234/454 sont sur le contour du visage, **sous** les tempes anatomiques. L'écart réel est de l'ordre de **5 à 10 mm** — c'est-à-dire **davantage que le seuil de décision lui-même** (3 à 5 mm). Tant que cette constante vaut 0, toute la lecture est décalée d'un cran entier : des montures correctes s'affichent « sous-taillées », et l'erreur est parfaitement invisible parce que cohérente d'un essai à l'autre.

```typescript
// core/verdict.ts
// ⚠️ VALEUR NON ENCORE CALIBRÉE. Tant qu'elle vaut 0, la légende chiffrée est
// systématiquement décalée. Ne pas livrer au client avant d'avoir exécuté le protocole.
export const FACE_WIDTH_CORRECTION_MM = 0;   // calibrée le : —  | sur N montures : 0
```

**Protocole de calibration — ⚠️ le protocole d'origine était trop fragile.** Ajuster la constante sur *une seule* monture « dont on sait qu'elle va bien » revient à faire passer un unique point par une droite : on absorbe dans cette constante toutes les erreurs des autres maillons (parallaxe B4, padding alpha B3, biais d'iris S2). Pour une constante qui pèse plus lourd que le seuil, c'est insuffisant.

1. Réunir **au moins 3 montures de largeurs totales nettement différentes** (par ex. ~125, ~135, ~145 mm), cotes mesurées au réglet.
2. Les essayer **sur plusieurs visages** si possible — au minimum deux morphologies distinctes.
3. Pour chaque essai, consigner : monture, largeur réelle, largeur de visage mesurée, source de calibration, écart observé.
4. Retenir la **médiane** des écarts, pas la valeur qui arrange le cas le plus visible.
5. Figer la constante avec **sa date, le nombre d'essais et leur dispersion** en commentaire, et reporter le tout dans `PROGRESS.md`.
6. Si la dispersion entre montures dépasse 3 mm, **ne pas figer** : c'est le signe qu'un autre maillon est faux (B3 ou B4 en premier suspect). Chercher la cause au lieu de moyenner le symptôme.

> 🔴 **Ne jamais la retoucher en douce pour faire passer un test.** Cette constante est le point du
> projet où il est le plus tentant, et le plus destructeur, d'« ajuster jusqu'à ce que ça tombe
> juste » : elle peut absorber n'importe quelle erreur en amont et rendre le système faux tout en
> ayant l'air correct. Toute modification passe par le protocole ci-dessus et par un commit dédié.

---

## 6. Le rendu 2D — face + profil simultanés

Deux sprites, un seul canvas. Le profil sert à la **branche**, qui apparaît progressivement quand la tête tourne.

### 6.1 ⭐ T3 — `core/transform.ts` : l'affine unique

Le décentrement (§5) doit projeter le centre optique du verre depuis le repère sprite vers l'écran. Le rendu (§6.2) fait exactement la même projection. **Si `render/` et `verdict.ts` calculent chacun la leur, elles divergeront à la première modification** — et le symptôme sera un décentrement faux alors que l'image paraît correcte.

Une seule transformée, dans `core/`, consommée par les deux :

```typescript
// core/transform.ts — LA seule définition de la géométrie sprite → écran.
export interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }

/**
 * Repère sprite (px, origine au coin du fichier) → repère écran (px).
 * Ancrage sur le centre du pont, rotation de roll, écrasement horizontal de yaw.
 */
export function spriteAffine(spec: FrameSpec, m: FrameMetrics): Affine;

/** Applique l'affine à un point du sprite. Utilisée par le rendu ET par le décentrement. */
export function spriteToScreen(p: Pt, spec: FrameSpec, m: FrameMetrics): Pt;
```

> ⚠️ **Correction relevée à l'implémentation.** Une première rédaction de cette section déclarait
> `spriteToScreen(p, m)` sans `spec`, alors que l'affine a besoin de `spritePxPerMm` et de
> `bridgeCenter`, qui vivent tous deux dans le spec. La signature à deux paramètres était
> inapplicable.

> ⚠️ `render/composite.ts` **n'a pas le droit** de composer sa propre matrice à coups de
> `translate/rotate/scale` : il applique `spriteAffine()` via `ctx.setTransform(...)`. Un
> `grep 'ctx.scale\|ctx.rotate' src/render` doit renvoyer **zéro ligne** (barrage §9.0.g).

### 6.2 Le compositing

```typescript
// render/composite.ts
export function drawFrame(ctx: CanvasRenderingContext2D, sprites: Sprites, m: FrameMetrics): void {
  // ⚠️ yawRad se lit sur `m` (T2). Ne PAS le repasser en paramètre : deux sources
  // pour la même grandeur, c'est la garantie qu'elles finiront par diverger.
  const t = spriteAffine(sprites.front.spec, m);   // ⭐ core/transform.ts, §6.1

  ctx.save();
  ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  ctx.drawImage(sprites.front.img, 0, 0);          // toute la géométrie est dans l'affine
  ctx.restore();

  // — La branche, depuis le sprite de profil, révélée par |yaw|
  const templeAlpha = smoothstep(0.10, 0.45, Math.abs(m.yawRad));
  if (templeAlpha > 0.01) drawTemple(ctx, sprites.profile, m, templeAlpha);
}
```

#### 🟠 Correctif S1 (2/2) — le yaw était appliqué DEUX fois

L'ancien code faisait `ctx.scale(Math.cos(yawRad), 1)` sur une échelle `livePxPerMm` **qui contenait déjà** le raccourci perspectif : `faceWidthPx`, mesuré entre 234 et 454, diminue en `cos(yaw)` dès que la tête tourne. On obtenait donc **cos² au lieu de cos** :

| Yaw | Largeur attendue | Ancien code | Erreur |
|---|---|---|---|
| 12° (limite de la règle 3) | −2,2 % | −4,4 % | ×2 |
| 30° (nécessaire pour révéler la branche, lot 7) | −13 % | **−25 %** | monture visiblement trop étroite |

Effet secondaire tout aussi faux : `ctx.scale(cos, 1)` réduisait aussi la **hauteur** du sprite via le `scale` global, alors qu'un yaw ne raccourcit **rien** verticalement.

**Le correctif tient en deux moitiés, à ne jamais séparer :**

1. **Dans `frameMetrics` (§4)** : `faceWidthPx / cos(yaw)` → `livePxPerMm` redevient une échelle **isotrope**, indépendante de la rotation.
2. **Dans `spriteAffine` (§6.1)** : le `cos(yaw)` est appliqué **une seule fois, horizontalement seulement**, comme composante `a` de l'affine. La composante `d` (verticale) ne le porte jamais.

```typescript
// core/transform.ts — extrait de spriteAffine()
const s   = m.livePxPerMm / spec.spritePxPerMm;   // isotrope (S1, moitié 1/2)
const sx  = s * Math.cos(m.yawRad);               // ⭐ le cos, UNE seule fois, sur X
const sy  = s;                                    // ⭐ jamais sur Y
```

> **Test de non-régression obligatoire (§8) :** à yaw = 0° et yaw = 30°, la **hauteur rendue** du
> sprite doit être **identique** au pixel près. C'est la signature du bug, et le seul moyen de
> l'attraper sans œil humain.

- La branche est ancrée à la **charnière** (marquée dans l'outil de prep sur le sprite de profil) et sa longueur est calibrée sur les **145 mm**.
- **Occlusion :** la branche doit passer *derrière* la tête. Construire un `Path2D` du contour du visage (landmarks de l'ovale facial), puis `ctx.globalCompositeOperation = 'destination-out'` sur la portion intérieure. Une branche qui flotte par-dessus la joue trahit immédiatement le trucage.
- **Miroir :** la vidéo est affichée en miroir (naturel pour l'utilisateur). Le miroir s'applique **une seule fois**, au niveau du conteneur CSS. Les calculs de `core/` travaillent toujours en coordonnées non miroitées. Ne jamais mélanger les deux — source classique du bug « les lunettes partent du mauvais côté ».

### 6.3 ⭐ T1 — `VERTICAL_OFFSET_MM` : comment la monture se pose sur le nez

Cette constante était **utilisée dans `drawFrame` sans être définie nulle part**, ni spécifiée. C'est le genre de trou qui se remplit tout seul, mal, par un nombre inventé au moment où le rendu « ne tombe pas bien ».

**Ce qu'elle représente :** l'ancrage horizontal est le **sellion** (landmark 168, le creux entre les yeux). Mais une monture ne se pose pas *au* sellion : ses plaquettes portent légèrement **plus bas** sur l'arête du nez. `VERTICAL_OFFSET_MM` est cet écart, compté en millimètres réels vers le bas, converti en pixels par `livePxPerMm` — **jamais en pixels en dur**, sinon il change avec la distance à la caméra.

```typescript
// core/transform.ts
// Décalage vertical du centre du pont sous le sellion, en mm réels.
// ⚠️ VALEUR PROVISOIRE — même discipline que FACE_WIDTH_CORRECTION_MM (§5) :
// se calibre sur plusieurs montures et plusieurs visages, puis se fige avec sa date.
export const VERTICAL_OFFSET_MM = 3;   // calibrée le : —  | sur N montures : 0
```

**Pourquoi c'est en `core/` et non en `render/` :** cette valeur déplace le sprite, donc elle déplace les centres optiques projetés, donc elle change le **décentrement** mesuré au §5. Ce n'est pas un réglage cosmétique, c'est un maillon de la chaîne de mesure.

> ⚠️ **Ce n'est pas un slider déguisé** (§1 bug #1). C'est une constante d'anatomie, identique pour
> toutes les montures et tous les clients, figée après calibration. Si un lot futur propose de la
> rendre réglable par l'utilisateur — même « juste pour ajuster la hauteur » — c'est le slider de
> taille qui revient par la fenêtre : refuser et demander à l'humain.

---

## 7. Contrats d'API — signatures FIGÉES

> Ces signatures sont le contrat entre les modules. **Claude Code les implémente exactement telles quelles.**
> Toute modification d'une signature listée ici exige l'accord explicite de l'humain, y compris un simple ajout de paramètre optionnel. C'est ce qui empêche la dérive silencieuse d'un lot à l'autre.

### Utilitaires partagés — `src/core/geom.ts`

À écrire **une fois**, en premier, et à importer partout. Ne jamais les réimplémenter localement.

```typescript
export interface Pt { x: number; y: number }

export const dist     = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);
export const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Landmark MediaPipe normalisé (0..1) → pixels image. */
export const px = (l: NormalizedLandmark, w: number, h: number): Pt => ({ x: l.x * w, y: l.y * h });

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class CalibrationError extends Error {
  constructor(message: string) { super(message); this.name = 'CalibrationError'; }
}
```

### La fonction terminale — `core/verdict.ts`

C'est elle que les tests appellent. Elle n'existait pas dans les versions précédentes du brief : c'était le trou principal.

```typescript
/**
 * Assemble tout. SEUL point d'entrée du verdict — l'UI n'appelle rien d'autre.
 * @returns null si aucune calibration, ou si la pose est hors tolérance (règle 3).
 *          Un null n'est PAS une erreur : c'est « je ne peux pas répondre », et
 *          l'UI doit l'afficher comme tel, jamais le remplacer par une valeur par défaut.
 */
export function verdict(
  lm: NormalizedLandmark[],
  cal: UserCalibration | null,
  spec: FrameSpec,
  w: number,
  h: number,
  yawRad: number,          // ⭐ T9 — voir ci-dessous
): SizeVerdict | null;
```

> ⭐ **T9 — trou de contrat relevé à l'implémentation.** La signature figée comptait 5 paramètres,
> sans `yawRad`. Or la **règle 3 refuse justement de répondre au-delà de 12° de yaw**, et le
> décentrement exige de projeter les centres optiques, ce qui suppose l'affine, donc le yaw. La
> signature à 5 paramètres rendait la règle 3 littéralement inimplémentable. Le paramètre est
> ajouté en dernière position ; `w` et `h` restent avant lui pour ne pas déplacer l'existant.

```typescript
export interface SizeVerdict {
  frameWidthMm: number;                        // spec.alphaBBox.w / spritePxPerMm  (B3)
  faceWidthMm: number;                         // depuis cal, corrigée (voir ci-dessous)
  faceWidthUncertaintyMm: number;              // faceWidthMm × cal.relError
  deltaMm: number;                             // frameWidthMm − faceWidthMm
  thresholdMm: number;                         // thresholdFor(faceWidthMm)          (§5)
  status: Status;                              // 'indetermine' remplace 'incertain'
  decentrementMm: { left: number; right: number } | null;   // null si non concluant (§5)
  source: CalSource;                           // traçabilité/affichage SEULEMENT
}
```

> ⚠️ `decentrementMm` est `null` quand l'incertitude propagée dépasse la demi-tolérance (§5,
> correctif B2) — **jamais** « null si `source === 'iris'` », qui était l'ancienne formulation et
> un branchement sur le mode.

### La constante de correction — où elle s'applique, une seule fois

`FACE_WIDTH_CORRECTION_MM` était déclarée sans jamais être utilisée. Une constante morte finit toujours soit supprimée « au nettoyage », soit appliquée deux fois. Son point d'application est donc figé ici, et **nulle part ailleurs** :

```typescript
// core/verdict.ts — DANS verdict(), et à cet endroit seulement.
const faceWidthMm = cal.faceWidthMm + FACE_WIDTH_CORRECTION_MM;
```

Elle ne s'applique **ni** dans `calibrateWithIris`, **ni** dans `calibrateWithCard`, **ni** dans `frameMetrics`. Un `grep FACE_WIDTH_CORRECTION_MM` doit renvoyer exactement deux lignes dans tout le projet : sa déclaration et cet usage. C'est un test à faire à la main après chaque lot.

---

## 8. Tests obligatoires — le vrai antidote à la casse

Toute la géométrie de `core/` est **du calcul pur**. Elle se teste sans webcam, sans navigateur, en millisecondes. C'est ce qui empêche une correction d'aujourd'hui de casser un acquis d'hier.

### 8.1 ⭐ T5 — les helpers de fixtures, à écrire EN PREMIER

Les tests d'origine appelaient `verdict(LANDMARKS_138, CAL, SPEC_132)` — **trois arguments pour une signature figée qui en exige cinq** — et déréférençaient un retour `| null` sans `!`, ce qui ne typecheckera jamais en `strict`. Écrire 17 tests sur cette base, c'est 17 corrections à faire ensuite.

```typescript
// tests/fixtures/builders.ts
export const W = 1280, H = 720;

/** UserCalibration complet à partir de ce qui varie réellement dans le test. */
export function makeCal(over: Partial<UserCalibration> = {}): UserCalibration {
  return { faceWidthMm: 138, source: 'card', relError: 0.025, measuredAt: 0, ...over };
}

/** Appelle verdict() avec la signature COMPLÈTE et garantit un retour non-null. */
export function callVerdict(lm: NormalizedLandmark[], cal: UserCalibration, spec: FrameSpec): SizeVerdict {
  const v = verdict(lm, cal, spec, W, H);
  if (v === null) throw new Error('verdict() a renvoyé null alors que le test en attend un');
  return v;
}
```

### 8.2 La suite

```typescript
// tests/scale.test.ts
describe('chaîne des échelles', () => {
  it('sprite : 3 mesures concordantes → px/mm', () => {
    expect(computeSpritePxPerMm(MARKS_FIXTURE, { aMm: 44, bMm: 39, pontMm: 22 }))
      .toBeCloseTo(12.0, 1);
  });

  it('sprite : photo de trois quarts → rejetée', () => {
    expect(() => computeSpritePxPerMm(MARKS_SKEWED, SPEC)).toThrow(CalibrationError);
  });

  // ⭐ B3 — le padding transparent ne doit RIEN changer à la largeur en mm.
  it('B3 : un sprite padé et un sprite recadré donnent la même largeur en mm', () => {
    expect(totalFrameWidthMm(SPEC_132_PADDED)).toBeCloseTo(totalFrameWidthMm(SPEC_132_TIGHT), 2);
  });

  it('carte de 300 px de large → visage mesuré à 138 mm', () => {
    expect(calibrateWithCard(300, LANDMARKS_CAL, W, H).faceWidthMm).toBeCloseTo(138.0, 1);
  });

  it('iris de 42 px → échelle de 3.59 px/mm', () => {
    expect(scaleFromIris(42)).toBeCloseTo(3.59, 2);
  });

  // ⭐ B5 — un enfant n'est pas une panne.
  it('B5 : un visage d\'enfant de 110 mm est accepté', () => {
    expect(() => assertPlausibleFaceWidth(110, 'card')).not.toThrow();
  });

  it('B5 : une mesure aberrante de 60 mm est rejetée avec une cause nommée', () => {
    expect(() => assertPlausibleFaceWidth(60, 'card')).toThrow(/carte/i);
  });

  // ⭐ Seuil proportionnel borné (arbitrage humain, §5).
  it('le seuil suit le visage, entre 3 et 5 mm', () => {
    expect(thresholdFor(105)).toBeCloseTo(3.15, 2);
    expect(thresholdFor(138)).toBeCloseTo(4.14, 2);
    expect(thresholdFor(80)).toBe(THRESHOLD_MIN_MM);    // plancher
    expect(thresholdFor(200)).toBe(THRESHOLD_MAX_MM);   // plafond
  });

  it('CASCADE : écart franc → tranché même en mode iris', () => {
    expect(classify(-18, makeCal({ source: 'iris', relError: 0.043 }))).toBe('sous-taillee');
  });

  it('CASCADE : cas limite en mode iris → indéterminé, aucun chiffre tranché', () => {
    expect(classify(-5, makeCal({ source: 'iris', relError: 0.043 }))).toBe('indetermine');
  });

  // 🔴 B2 — LE test que l'ancienne version ne passait que par chance.
  // Il boucle sur plusieurs Δ, dont plusieurs DANS la zone limite : une seule
  // fixture bien choisie ne peut plus masquer un branchement sur `source`.
  it('GARDE-FOU B2 : classify ignore `source`, à relError égal, pour TOUT delta', () => {
    for (const delta of [-8, -5, -4.1, -3, -1, 0, 1, 3, 4.1, 5, 8]) {
      const statuses = (['iris', 'card', 'worn-frame'] as const).map(
        (source) => classify(delta, makeCal({ source, relError: 0.02 })),
      );
      expect(new Set(statuses).size, `divergence à delta=${delta}`).toBe(1);
    }
  });

  // 🔴 S4 — L'ancienne version comparait deux valeurs recopiées depuis spec et cal :
  // elle ne pouvait PAS échouer, même chaîne d'échelle entièrement cassée.
  // On teste désormais la grandeur qui varie réellement avec la distance.
  it('INVARIANT : la distance à la caméra ne change pas le rapport monture/visage', () => {
    const ratio = (lm: NormalizedLandmark[]) => {
      const m = frameMetrics(lm, W, H, makeCal(), 0);
      return renderedFrameWidthPx(SPEC_132, m) / faceWidthPx(lm, W, H);
    };
    expect(ratio(LANDMARKS_50CM)).toBeCloseTo(ratio(LANDMARKS_100CM), 3);
  });

  // 🔴 S1 — signature du yaw appliqué deux fois : la hauteur bougeait.
  it('INVARIANT : un yaw ne change PAS la hauteur rendue du sprite', () => {
    const h = (yaw: number) => renderedFrameHeightPx(SPEC_132, frameMetrics(LANDMARKS_138, W, H, makeCal(), yaw));
    expect(h(Math.PI / 6)).toBeCloseTo(h(0), 3);          // 30° vs 0°
  });

  it('INVARIANT : monture 132 mm sur visage 138 mm → sous-taillée', () => {
    expect(callVerdict(LANDMARKS_138, makeCal(), SPEC_132).status).toBe('sous-taillee');
  });

  it('le décentrement est masqué quand il n\'est pas concluant', () => {
    const v = callVerdict(LANDMARKS_138, makeCal({ source: 'iris', relError: 0.043 }), SPEC_132);
    expect(v.decentrementMm).toBeNull();
  });

  it('pas de calibration → aucune légende rendue', () => {
    expect(verdict(LANDMARKS_138, null, SPEC_132, W, H)).toBeNull();
  });
});
```

**Les trois tests marqués `INVARIANT` et le `GARDE-FOU B2` sont sacrés.** Ils encodent le sens physique du projet. S'ils passent au rouge, on ne les ajuste pas : on répare le code.

> 🔴 **Leçon de S4, à retenir pour tout test futur.** Un test « sacré » qui compare deux grandeurs
> **recopiées depuis les entrées** ne teste rien : il est vert par construction, et sa présence
> rassure à tort. Avant de déclarer un test sacré, se poser la question : *quelle ligne de code
> puis-je casser pour le faire rougir ?* Si la réponse est « aucune », le test est décoratif.

### 8.3 Banc de test navigateur, sans caméra (CI)

Chromium est préinstallé dans l'environnement de développement et accepte l'injection d'une vidéo dans `getUserMedia` :

```bash
chromium --use-fake-device-for-media-stream \
         --use-file-for-fake-video-capture=tests/fixtures/face.y4m
```

La boucle de rendu, l'intégration MediaPipe et le compositing deviennent donc testables en intégration continue, sans mobiliser un humain, et garantissent qu'un lot n'a pas cassé le rendu du lot précédent.

> ⚠️ **Cet outil n'existe qu'en CI. Il ne fait pas partie de l'application et n'est jamais présenté
> à un client** (§0.0.2). Aucun chemin de code de `src/` ne doit pouvoir lire un `.y4m`.

#### La preuve métrologique du rendu — `tests/render-proof.html`

Vitest teste la géométrie en calcul pur. Il ne répond pas à la seule question qui compte
vraiment : **les pixels réellement peints mesurent-ils bien 132 mm ?** Le banc compose donc le
sprite avec le vrai `drawFrame`, sur un vrai canvas, puis **remesure la bounding box des pixels
peints et la reconvertit en millimètres**. Il ferme la boucle `spec.json → affine → drawImage →
pixels → millimètres`.

Huit contrôles, tous exécutés par `npm run smoke` :

| Contrôle | Ce qu'il attrape |
|---|---|
| largeur peinte reconvertie en mm | l'erreur globale de la chaîne |
| le padding alpha n'élargit pas la monture | B3 — 1624 px de fichier pour 1584 px de monture |
| centre peint ↔ centre du pont projeté | B3, second volet : un sprite padé mais **décalé** |
| décalage vertical sous le sellion | T1 — `VERTICAL_OFFSET_MM` réellement appliqué en mm |
| hauteur peinte à 20° vs 0° | S1 — le yaw ne raccourcit rien verticalement |
| largeur à 20° / largeur à 0° = cos(yaw) | S1 — le cos appliqué **une** fois, pas deux |
| dilatation V2 de chaque côté | §11.6 — la dilatation vaut bien 1,5 mm réels |
| la dilatation reste centrée | un halo asymétrique déplacerait la monture |

> ⚠️ Le sprite du banc est un **rectangle de synthèse aux cotes connues**. Ce n'est pas une
> monture et il ne prétend pas l'être : il sert d'étalon pour vérifier la chaîne géométrique. La
> forme réelle vient toujours d'une photo (§1 bug #2). Un rectangle est même **préférable** ici :
> ses bords sont exactement à la cote, donc l'écart mesuré est imputable à la chaîne, pas au
> détourage.

---

## 9. Règles de travail pour Claude Code — protocole anti-casse

### 9.0 Garde-fous mécaniques — à installer AVANT toute autre ligne de code

Les règles écrites ci-dessous dépendent de la bonne volonté de l'agent. Ces quatre-là n'en dépendent pas : elles bloquent physiquement. C'est le lot 0, non négociable.

**a. Le hook pre-commit — ⭐ T7 : `.githooks/pre-commit`, sans husky.**

Le contrat imposait husky, ce qui contredisait sa propre règle 9.1-8 (« aucune dépendance sans validation »). `git config core.hooksPath .githooks` fait **strictement la même chose avec zéro dépendance** — et le hook est versionné, donc relisible dans le diff.

```bash
git config core.hooksPath .githooks && chmod +x .githooks/pre-commit
```

```bash
#!/bin/sh
# .githooks/pre-commit — garde-fous mécaniques. Aucune dépendance.
set -u
fail() { echo "❌ $1"; exit 1; }

npm run typecheck || fail "typecheck"
npm test          || fail "tests"

# — b. Un test ne doit jamais être supprimé ni neutralisé pour faire passer un commit.
grep -rn "\.skip\|\.todo\|xit(\|xdescribe(" tests/ && fail "Test désactivé détecté"

# — c. Le slider de taille est la régression n°1 de ce projet. Barrage définitif.
grep -rni "scaleslider\|sizeslider\|adjustscale" src/ && fail "Slider de taille interdit (§1 bug #1)"

# — d. Aucune 3D.
grep -rn "from 'three'\|@react-three\|\.glb\|\.gltf" src/ && fail "Dépendance 3D interdite (§0)"

# — e. ⭐ NOUVEAU : aucun vocabulaire de sélection. L'app ne trie rien (§0.0.1).
grep -rniE "\b(recommend|compatible|suggest|filterFrames|rejectFrame|bestMatch|montures_compatibles)" src/ \
  && fail "Vocabulaire de sélection interdit (§0.0.1) — l'app ne trie ni ne recommande rien"

# — f. ⭐ B2 DURCI : aucun branchement sur la source hors calibration.ts.
#     L'ancien barrage ne cherchait que `source === 'worn-frame'` et laissait passer
#     `source === 'iris'`, qui était précisément le bug B2 présent dans le contrat.
grep -rn "source ===\|source!==\|source !==\|mode ===\|isStore\|isMagasin" src/core src/render \
  --exclude=calibration.ts && fail "Branchement sur la source/le mode interdit (§4 règle 2, §11.4)"

# — g. ⭐ NOUVEAU : la mesure ne lit jamais les dimensions du FICHIER (B3),
#     le rendu ne recompose jamais sa propre matrice (T3),
#     et la matrice MediaPipe ne sert qu'à la rotation (§4).
grep -rn "img\.width\|img\.height\|\.naturalWidth" src/core && fail "Dimensions du fichier dans la mesure (B3)"
grep -rn "ctx\.scale\|ctx\.rotate\|ctx\.translate" src/render && fail "Transformée recomposée hors core/transform.ts (T3)"
grep -rn "facialTransformationMatrixes" src/core src/render && fail "Matrice MediaPipe hors tracking/ (§4)"

# — h. ⭐ NOUVEAU : aucune constante de taille en dur (§0.0.3).
#     Tout littéral entre 80 et 200 hors constante exportée est suspect.
grep -rnE "=[[:space:]]*1[0-9]{2}(\.[0-9]+)?[[:space:]]*;" src/core --include=*.ts \
  | grep -v "export const" \
  && fail "Constante de taille en dur (§0.0.3) — l'exporter et la documenter"

# ⚠️ INDISPENSABLE. Sans ce exit 0, le code de retour du hook serait celui du
# DERNIER grep — lequel vaut 1 quand il ne trouve rien, c'est-à-dire quand tout
# va bien. Le hook refuserait alors tous les commits sains, et la réaction
# naturelle serait de le désinstaller.
exit 0
```

Un commit qui échoue au hook n'existe pas. L'agent ne peut pas passer outre sans que tu le voies dans le diff du hook lui-même — **surveille ce fichier à chaque relecture.**

**b. Le compteur de tests.** `tests/meta.test.ts` :

```typescript
// Se met à jour UNIQUEMENT en même temps qu'on ajoute un test, jamais pour réparer.
// ⭐ T6 : la §8 en liste désormais 17. L'ancienne valeur (12) ne correspondait à rien.
const EXPECTED_MIN_TESTS = 17;   // lot 3 : 8 | lot 5 : 13 | lot 6 : 17 | lot 7 : 19
```

Un agent bloqué a tendance à supprimer le test gênant plutôt que le bug. Ce compteur rend la suppression visible immédiatement.

**c. Le tag git par lot.** Après validation humaine de chaque lot :

```bash
git tag -a lot-3-ok -m "iris + carte validés manuellement le <date>"
```

Retour arrière garanti en une commande : `git reset --hard lot-3-ok`. C'est ce qui n'existait pas avant et qui rendait chaque régression définitive.

**d. Le `git diff --stat` avant chaque commit.** Si un lot censé toucher 2 fichiers en modifie 9, arrêter et relire. Un diff qui déborde est le signe avant-coureur d'un refactor spontané — la cause la plus fréquente des régressions.

### 9.1 Règles de conduite

1. **Plan d'abord.** Sur toute tâche touchant plus d'un fichier : passer en plan mode, exposer le plan, attendre validation. Pas de code avant accord.
2. **Un commit git par lot** (§10), avec les tests au vert. Jamais deux lots dans un commit.
3. **`npm test` avant chaque commit.** Un test rouge = on ne commit pas.
4. **`src/core/` est gelé après validation d'un lot.** Un fichier de `core/` déjà validé ne se modifie que sur demande explicite de l'humain — jamais « au passage », jamais « pour nettoyer ».
5. **Interdiction absolue de modifier un test pour le faire passer.** Si un test échoue, ou le code est faux, ou le test est faux — et dans le second cas on le signale et on demande.
6. **Aucune constante magique.** Tout nombre littéral est soit une norme citée en commentaire (85.60 = ISO 7810), soit un index MediaPipe nommé, soit une constante exportée et documentée. `* 0.9` est banni.
7. **Pas de refactor spontané.** Pas de renommage, pas de « je simplifie », pas d'extraction de fonction non demandée.
8. **Aucune nouvelle dépendance sans validation.** Et jamais `three`, `@react-three/*`, ni aucune lib 3D.
9. **Après chaque lot, écrire dans `PROGRESS.md`** : ce qui marche, ce qui reste, la valeur des constantes calibrées.
10. **En cas de doute sur le périmètre → poser la question, ne pas deviner.**

### 9.2 Quand ça casse quand même — la procédure

Ça arrivera. L'objectif n'est pas le zéro régression, c'est que chaque régression coûte dix minutes au lieu d'une soirée.

1. **Ne pas demander à l'agent de réparer dans la foulée.** C'est le réflexe qui a produit les fichiers de 800 lignes : chaque correctif empilé sur un état déjà cassé.
2. `git reset --hard lot-N-ok` → retour au dernier état validé par toi.
3. `git diff lot-N-ok..HEAD@{1}` → lire ce qui avait changé. Le bug y est presque toujours visible en une lecture.
4. Relancer le lot **avec une contrainte supplémentaire écrite dans le prompt**, tirée de ce que tu viens de lire.
5. Si le même lot casse deux fois de suite : le lot est trop gros. Le couper en deux.

**Signal d'alerte à connaître :** si l'agent dit « je simplifie », « je refactorise au passage », « j'ai aussi corrigé », ou modifie un fichier de `core/` non demandé → interrompre immédiatement et revenir au tag. Ces phrases précèdent presque toujours une régression.

---

## 10. Ordre d'exécution — 9 lots, chacun vérifiable

| # | Lot | Critère d'acceptation |
|---|---|---|
| 0 | **Garde-fous §9.0** : `.githooks/pre-commit` (T7, **sans husky**), `core.hooksPath`, meta.test.ts, premier tag git | Un commit avec un test désactivé est refusé — **le vérifier en essayant**, ainsi que les barrages e, f, g et h |
| 1 | Squelette Vite + TS + Vitest, `core/geom.ts`, webcam sur `localhost` | La vidéo s'affiche, `npm test` passe sur geom.ts |
| 2 | `tracking/landmarker.ts`, modèle vendorisé, **garde de monotonie S5** | 478 points en overlay, ≥ 25 fps ; onglet mis en arrière-plan puis ramené → la boucle repart, compteur d'échecs à 0 |
| 3a | `core/units.ts` + échelle iris + **refus si lunettes portées (S2)** + tests | Largeur de visage en mm avec sa marge (± 6 mm), stable à ±3 % quand on avance/recule ; avec lunettes → bascule carte, pas de mesure iris |
| 3b | `core/calibration.ts` : carte + **contrôle de distance B4** + `assertPlausibleFaceWidth` (B5) + tests | Carte → même largeur qu'en 3a mais à ± 3 mm ; carte retirée, mesure conservée ; à 40 cm → « reculez » ; visage d'enfant simulé à 110 mm → **accepté** |
| 4 | `prep/DetourTool.tsx` : marquage des cotes + **bbox alpha (B3)** | `spec.json` complet (§12) généré, photo en perspective rejetée, sprite padé et sprite recadré → même largeur en mm |
| 5 | ⭐ `core/transform.ts` (T3) + `render/composite.ts` + **correctif S1** | Sprite de face à l'échelle, **sans aucun slider** ; tête tournée à 30° → la monture ne rétrécit pas et sa hauteur ne bouge pas |
| 6 | `core/verdict.ts` : seuil proportionnel borné, `classify` par intervalles (B2), légende | Deux chiffres affichés avec leurs marges ; cas limite → proposition de carte, **jamais de libellé flou** (§0.0.1) |
| 7 | `render/temple.ts` : branche + occlusion | La branche apparaît en tournant la tête et passe derrière la joue |
| 8 | **Calibration humaine** de `FACE_WIDTH_CORRECTION_MM` (S3) et `VERTICAL_OFFSET_MM` (T1) | Protocole du §5 exécuté sur ≥ 3 montures ; valeurs figées avec date et dispersion dans `PROGRESS.md` |

> ⚠️ **Le lot 8 n'est pas optionnel et ne peut pas être fait par l'agent.** Tant qu'il n'est pas
> exécuté, les deux constantes valent une valeur provisoire et **la légende chiffrée est décalée**.
> Ne pas livrer à un client avant.

**Ne pas démarrer le lot N+1 tant que le lot N n'est pas validé par l'humain.** C'est la règle qui remplace l'ancien mode « un gros fichier, on verra bien ».

### Note pour le lot 4 — réutiliser l'outillage Python déjà présent

Ce dépôt contient déjà `app.py` et `batch_clean.py` : une chaîne Streamlit/OpenCV qui traite des photos de montures sur fond blanc **en préservant le canal alpha et la résolution**. C'est exactement le travail de détourage que `prep/DetourTool.tsx` aurait à refaire.

**Arbitrage proposé au moment du lot 4 :** faire le détourage fond blanc → PNG transparent avec l'outil Python existant, et réduire `DetourTool.tsx` au **marquage des 6 points de cote et au calcul de la bbox alpha** (B3). Moins de code TypeScript à écrire, à tester et à maintenir — et un outil déjà éprouvé sur les vraies photos.

À trancher par l'humain le moment venu ; ne pas le décider en cours de lot.

---

## 11. V2 — Mode magasin : coloris absents du stock

> **Statut : à n'implémenter qu'après validation complète des lots 0 à 7 de la V1.**
> Si la V1 n'est pas figée et taguée, ne pas commencer. La V2 est bâtie dessus, pas à côté.

### 11.1 Le scénario

Le client essaie **physiquement** une monture présente en magasin. Il veut voir le **même modèle dans un coloris non stocké**.

**Entrées, par coloris absent :**

| Entrée | Précision |
|---|---|
| `front.png` | Photo de la **monture seule**, fond blanc, appareil perpendiculaire. Pas un visage. |
| `profile.png` | Idem, branche entièrement dépliée et à plat. |
| A + pont (mm) | Identiques au modèle de référence — c'est le même modèle. |

**Entrée du côté magasin, saisie une seule fois :** les cotes de la monture **physiquement portée**. Elle n'est jamais photographiée : elle sert d'étalon vivant dans le flux vidéo, à la place de la carte bancaire de la V1.

**Optimisation de production — pré-positionnement des marques.** Le marquage des cotes sur chaque photo est le vrai coût de la V2, pas la prise de vue. Comme tous les coloris partagent la même géométrie, les 4 à 6 points tombent quasiment aux mêmes coordonnées :

```typescript
// prep/DetourTool.tsx
/**
 * Initialise les marques d'un nouveau coloris depuis le modèle de référence,
 * en les remettant à l'échelle des dimensions de la nouvelle image.
 * L'opérateur n'a plus qu'à corriger de quelques pixels au lieu de tout re-cliquer.
 */
export function seedMarksFromReference(ref: FrontMarks, refImg: Size, newImg: Size): FrontMarks;
```

⚠️ Les marques pré-positionnées restent **soumises au même contrôle de cohérence** (§4). Ne jamais les accepter sans validation : un raccourci de saisie ne doit pas devenir un contournement du garde-fou.

### 11.2 Pourquoi c'est le cas FACILE — et pourquoi ça change tout

Deux problèmes de la V1 disparaissent d'un coup :

| Problème V1 | En magasin |
|---|---|
| Échelle du visage inconnue | **Résolu** : la monture portée est un étalon de taille connue, visible, quasiment dans le plan du visage. Précision **2 %** (T8 — pas 1 %, cf. §11.3). |
| Lecture sur/sous-taillé | **Déjà répondue** : le client le sent physiquement. Ce n'est plus la question. |

> ⚠️ **La question posée change de nature.** En V1 : « est-ce à ma taille ? » (métrologie). En V2 : « ce coloris me va-t-il ? » (esthétique). Ne PAS supprimer le moteur de verdict pour autant — il reste utile pour valider que le coloris affiché est bien à la même échelle que la monture réelle, ce qui est le contrôle de non-régression du mode magasin.

### 11.3 Architecture — la V2 est un PLUGIN, pas un fork

**Règle d'or, non négociable :** la V2 ajoute **une seule fonction** et **une seule valeur d'énumération**. Rien d'autre ne change dans `core/`.

```typescript
// core/calibration.ts — la seule modification du cœur
export type CalSource = 'iris' | 'card' | 'worn-frame';   // ← +1 valeur

/**
 * Mode magasin : la monture PORTÉE sert d'étalon.
 * Même signature de sortie que les deux autres → tout l'aval est inchangé.
 */
export function calibrateWithWornFrame(
  wornFrameWidthPx: number,       // largeur mesurée à l'écran de la monture portée
  wornFrameSpec: FrameSpec,       // ses cotes réelles, connues du magasin
  lm: NormalizedLandmark[], w: number, h: number,
): UserCalibration {
  const pxPerMm = wornFrameWidthPx / wornFrameSpec.totalWidthMm;   // T4 : cote RÉELLE, cf. §12
  const faceWidthMm = dist(px(lm[FACE_L], w, h), px(lm[FACE_R], w, h)) / pxPerMm;

  assertPlausibleFaceWidth(faceWidthMm, 'worn-frame');             // B5
  return { faceWidthMm, source: 'worn-frame', relError: WORN_FRAME_REL_ERROR, measuredAt: Date.now() };
}
```

#### ⭐ Correctif T8 — `relError` de la monture portée : 0,02, pas 0,01

1 % supposait deux clics d'opticien justes à **4 px près sur 400**, sur un bord d'acétate flou et arrondi — **plus** le même biais de profondeur que la carte (B4) : la monture portée est en avant des tempes, exactement comme la carte est en avant du contour.

```typescript
export const WORN_FRAME_REL_ERROR = 0.02;   // 2 clics d'opticien + biais de profondeur (cf. B4)
```

Elle reste la source la plus précise des trois — c'est le point de la V2 — mais annoncée à sa valeur réelle.

**C'est tout.** `frameMetrics`, `classify`, `verdict`, `drawFrame` : **aucune modification**. Ils reçoivent un `UserCalibration` et ne savent pas d'où il vient. C'est exactement ce qui empêche les deux versions de se marcher dessus.

### 11.4 🔴 Garde-fou n°1 — INTERDICTION de brancher sur le mode

C'est le risque de casse principal des deux versions. Un `if (mode === 'magasin')` dans `core/` ou `render/` et l'architecture est morte : chaque correctif d'un mode cassera l'autre.

Le barrage est déjà installé au **§9.0.f**, dans sa version **durcie par B2** : il cherche `source ===` en général, et non plus seulement `source === 'worn-frame'`.

> 🔴 **Pourquoi le durcissement était indispensable.** L'ancien barrage ne listait que
> `source === 'worn-frame'`. Or le contrat contenait lui-même, dans `classify`, un
> `cal.source === 'iris'` — c'est-à-dire que **le garde-fou laissait passer la violation
> effectivement présente dans le document qu'il était censé protéger.** Un barrage qui énumère
> les cas fautifs connus ne barre que le passé ; il faut barrer la **forme**, pas les instances.

Test qui verrouille le principe — **rendu insensible à la fixture (correctif B2)** :

```typescript
it('GARDE-FOU §11.4 : les 3 sources suivent le même chemin en aval', () => {
  // ⚠️ Boucler sur plusieurs Δ est ESSENTIEL, dont plusieurs DANS la zone limite.
  // L'ancienne version testait un seul Δ = −6 avec u = 1,38 : les trois sources
  // s'accordaient par construction, et le test passait même avec le branchement
  // sur `source` bien présent. Il vérifiait la fixture, pas le principe.
  for (const delta of [-8, -5, -4.1, -3, -1, 0, 1, 3, 4.1, 5, 8]) {
    const vs = (['iris', 'card', 'worn-frame'] as const).map((source) =>
      callVerdict(landmarksForDelta(delta), makeCal({ source, relError: 0.02 }), SPEC_132),
    );
    expect(new Set(vs.map((v) => v.status)).size, `statuts divergents à delta=${delta}`).toBe(1);
    expect(vs[2].deltaMm).toBeCloseTo(vs[0].deltaMm, 3);
  }
});
```

> **Règle générale à retenir de B2 et S4 :** un test garde-fou dont le résultat dépend du choix
> d'une fixture n'est pas un garde-fou. Chaque fois qu'un test verrouille un *principe*, il doit
> balayer un domaine — jamais un point.

### 11.5 🔴 Garde-fou n°2 — le coloris doit être le MÊME modèle

Un coloris est le même modèle : sa forme, ses cotes et sa silhouette sont **identiques** à la monture de référence. C'est vérifiable automatiquement, et ça attrape l'erreur la plus probable en magasin — une photo mal rangée, un coloris associé au mauvais modèle.

```typescript
// core/frameSpec.ts
export const COLORWAY_TOLERANCE = 0.03;   // 3 % — variations de fabrication admises

/** Rejette un coloris dont les proportions ne correspondent pas au modèle de référence. */
export function assertSameModel(ref: FrameSpec, colorway: FrameSpec): void {
  const checks = [
    ['A',       colorway.aMm    / ref.aMm],
    ['pont',    colorway.pontMm / ref.pontMm],
    ['rapport', (colorway.aMm / colorway.pontMm) / (ref.aMm / ref.pontMm)],
  ] as const;

  for (const [name, ratio] of checks) {
    if (Math.abs(ratio - 1) > COLORWAY_TOLERANCE) {
      throw new CalibrationError(
        `Coloris "${colorway.slug}" : écart de ${((ratio - 1) * 100).toFixed(1)}% sur ${name} ` +
        `par rapport au modèle "${ref.slug}". Photo ou cotes rattachées au mauvais modèle.`
      );
    }
  }
}
```

> **Note sur les cotes fournies.** Tu annonces A + pont seulement. Le contrôle de cohérence de la §4 en utilisait trois (A, B, pont) : avec deux, il reste fonctionnel mais moins sensible aux photos en perspective. **Recommandation : relever aussi B**, c'est trente secondes au réglet et ça restaure le troisième point de contrôle. Si B est absent, `computeSpritePxPerMm` doit basculer sur 2 mesures et **durcir le seuil de 4 % à 2,5 %** pour compenser la perte de redondance.

### 11.6 🟠 Garde-fou n°3 — la monture réelle sous la virtuelle

Le piège pratique qui fera échouer la V2 si on l'ignore : **le client porte déjà une monture**. Le sprite virtuel se superpose à une monture physique qui, elle, ne disparaît pas.

Ce qui sauve la situation : c'est **le même modèle**, donc la silhouette est identique au pixel près. Le sprite recouvre exactement la monture réelle. Mais deux cas cassent :

| Cas | Symptôme | Parade |
|---|---|---|
| Monture réelle **foncée**, coloris virtuel **clair** | Le noir transparaît sur les bords, aspect sale | Le magasin garde en rayon **le coloris le plus clair** du modèle comme monture de référence |
| Léger décalage de pose | Liseré double sur le contour | Dilater le sprite de **1,5 mm** (`padding` d'alpha) pour couvrir la marge d'erreur |

```typescript
// render/composite.ts — actif UNIQUEMENT via un paramètre passé par l'appelant.
// PAS de test de mode ici : c'est l'UI qui décide et transmet la valeur (cf. §11.4).
export const OVERLAY_PADDING_MM = 1.5;
```

**Contrôle d'acceptation obligatoire du lot V2-2 :** essayer un coloris clair sur la monture noire du magasin. Si un liseré sombre apparaît, la parade n'est pas suffisante — ne pas passer au lot suivant.

### 11.7 Lots V2

| # | Lot | Critère d'acceptation |
|---|---|---|
| V2-0 | `assertSameModel` + tests | ✅ Un coloris rattaché au mauvais modèle est rejeté avec un message clair |
| V2-1 | `calibrateWithWornFrame` + garde-fou §11.4 | ✅ Les 3 sources donnent le même verdict à calibration égale |
| V2-2 | Sélecteur de coloris + `OVERLAY_PADDING_MM` | ⚠️ Code écrit et dilatation mesurée au banc (1,5 mm de chaque côté, centrée). **Le contrôle « aucun liseré sur monture noire » reste ouvert** : il exige deux vraies photos et un vrai client. |
| V2-3 | Détection assistée de la monture portée | ✅ L'opticien pointe 2 points sur les bords externes → calibration à 2 % |

> ⚠️ **La dilatation `OVERLAY_PADDING_MM` épaissit la silhouette, elle n'agrandit pas la monture.**
> Un agrandissement par l'échelle rendrait la monture plus large qu'elle n'est et casserait le
> critère de succès du projet. Le halo est donc construit par redessins décalés, à rayon constant
> en millimètres réels, symétriques — trois propriétés verrouillées par des tests, et vérifiées
> sur les pixels peints au banc du §8.3.

> Pour V2-3, **ne pas tenter la détection automatique de monture au premier jet.** Deux clics d'un opticien professionnel sont plus fiables, plus rapides à coder, et testables. L'automatisation viendra après, si le besoin se confirme.

---

## 12. Données de la monture de test

### ⭐ T4 — le schéma complet de `spec.json`

L'ancien schéma listait 7 champs. Or `calibrateWithWornFrame` exigeait `totalWidthMm`, le rendu exigeait `spritePxPerMm` et `bridgeCenter`, le décentrement exigeait les centres optiques, la branche exigeait la charnière, et B3 exige la bbox alpha — **aucun de ces six champs n'était au schéma**. Un `spec.json` conforme à l'ancien schéma faisait planter la moitié du projet.

```json
{
  "slug": "test-01",

  "aMm": 44,
  "bMm": 39,
  "pontMm": 22,
  "brancheMm": 145,
  "totalWidthMm": 132.0,

  "front": "front.png",
  "profile": "profile.png",

  "spritePxPerMm": 12.0,
  "alphaBBox":     { "x": 20, "y": 18, "w": 1584, "h": 512 },
  "bridgeCenter":  { "x": 812, "y": 274 },
  "lensCenterL":   { "x": 452, "y": 286 },
  "lensCenterR":   { "x": 1172, "y": 286 },
  "hingeProfile":  { "x": 96,  "y": 130 },

  "calibratedAt": "2026-08-16"
}
```

| Champ | Rôle | Ajouté par |
|---|---|---|
| `totalWidthMm` | Largeur réelle bord à bord. **Mesurée** (`alphaBBox.w / spritePxPerMm`), jamais `2×A + pont` | T4 |
| `spritePxPerMm` | Échelle 1 (§4), issue du contrôle à 3 cotes | T4 |
| `alphaBBox` | Bounding box du canal alpha, en px sprite. **Seule** source de la largeur | B3 |
| `bridgeCenter` | Point d'ancrage du sprite de face | T4 |
| `lensCenterL/R` | Centres optiques → décentrement (§5) | T4 |
| `hingeProfile` | Charnière sur le sprite de profil → ancrage de la branche (§6) | T4 |

> ⚠️ **Validation obligatoire au chargement.** Un `spec.json` auquel il manque un champ doit lever
> une `CalibrationError` nommant le champ absent — **jamais** être complété par une valeur par
> défaut. Un `bridgeCenter` défaillant qui vaut `{0,0}` décale toute la monture sans rien signaler ;
> c'est très exactement le mode d'échec que ce contrat combat.

Prise de vue exigée pour toute nouvelle monture : **fond blanc uni**, appareil **perpendiculaire** au plan de la monture (le contrôle de cohérence à 4 % rejettera toute perspective), monture posée à plat pour la face, branche entièrement dépliée et à plat pour le profil.

---

## 13. Journal des correctifs appliqués

Table de correspondance entre l'analyse (`docs/rapport-essayage-virtuel.md`) et ce contrat. À tenir à jour si un correctif est révisé.

| Réf | Défaut | Où c'est traité |
|---|---|---|
| **B1** | `computeSpritePxPerMm` ne compilait pas | §4, Échelle 1 |
| **B2** | `classify` branchait sur `cal.source` ; test garde-fou fixture-dépendant | §4 règle 2 · §5 règle 1 bis et règle 2 · §8.2 · §9.0.f · §11.4 |
| **B3** | La largeur mesurait le PNG, marges comprises | §4 Échelle 1 · §9.0.g · §12 |
| **B4** | Parallaxe de la carte sur le front, non traitée | §4 Niveau 2 |
| **B5** | Plage 118–165 mm excluant les enfants | §0.0.3 · §4 (`assertPlausibleFaceWidth`) |
| **S1** | Yaw appliqué deux fois (cos²) | §4 `frameMetrics` · §6.2 |
| **S2** | Iris mesuré à travers des verres correcteurs | §4 Niveau 1 |
| **S3** | `FACE_WIDTH_CORRECTION_MM` calibrée sur un seul point | §5 · lot 8 |
| **S4** | Le test « sacré » ne pouvait pas échouer | §8.2 |
| **S5** | Correctif écrit pour l'ancienne API tfjs | §1 bug #3 |
| **T1** | `VERTICAL_OFFSET_MM` jamais défini | §6.3 |
| **T2** | `yawRad` jamais renvoyé par `frameMetrics` | §4 Échelle 3 |
| **T3** | Transformée sprite→écran dupliquée | §6.1 |
| **T4** | Schéma `spec.json` incomplet | §12 |
| **T5** | Tests appelant `verdict()` à 3 arguments sur 5 | §8.1 |
| **T6** | `EXPECTED_MIN_TESTS` incohérent | §9.0.b |
| **T7** | husky contredisait la règle 9.1-8 | §9.0.a |
| **T8** | `relError` de `worn-frame` trop optimiste | §11.3 |
| **T9** | `verdict()` figé à 5 paramètres, sans le yaw qu'exige la règle 3 | §7 |

### Relevé pendant l'implémentation (ce que la relecture n'avait pas vu)

| Constat | Comment il a été trouvé | Où |
|---|---|---|
| `onLost` incrémentait le compteur d'échecs sans jamais le **dessiner** : détection perdue = canvas vide, panne indiscernable du fonctionnement normal | Banc navigateur, caméra sans visage | §1 bug #3 |
| `spriteToScreen(p, m)` était inapplicable : l'affine a besoin du `spec` | Compilation | §6.1 |
| Le hook renvoyait le code du dernier `grep` — donc 1 quand tout allait bien | Exécution du hook sur un dépôt sain | §9.0.a |
| « 132 mm sur 138 mm → sous-taillée » devient `'indetermine'` une fois B2+B4+T8 réunis | Tests | §5 règle 1 bis |
| Le décentrement est en réalité **exploitable en mode iris** ; l'ancienne interdiction reposait sur une comparaison entre deux grandeurs sans rapport | Tests | §5 règle 2 |
| Le barrage B2 refusait un commentaire citant le nom du champ interdit — c'est le commentaire qui a été réécrit, pas le barrage | Suite de tests | `core/frameSpec.ts` |
| La règle des 300 lignes du §3 n'était vérifiée par **rien** : sept fichiers l'avaient franchie ou l'approchaient | Relecture, après coup | §9.0.i, barrage ajouté |
| Le milieu de deux points **projetés** n'est pas la projection de leur milieu : non corrigé, ce terme ajoutait 19 % à la profondeur mesurée | Tête de test en perspective exacte | §4, `core/parallax.ts` |
| `putImageData` **remplace** les pixels au lieu de les composer : le recoloriage V2 découpait un rectangle noir autour de la monture. Invisible dans l'application, où le canvas est transparent au-dessus du `<video>` — visible dès qu'on dessine la vidéo dans le même canvas. **Le même mode d'échec que `destination-out`, une deuxième fois** | Outil d'atelier, sur une vraie photo | `render/recolorLive.ts` |

## 14. ⭐ Arbitrages humains du 2026-08-17 — et ce qu'ils changent

> Trois décisions prises par l'humain, qui contredisent ou complètent des passages
> antérieurs. Conformément à l'en-tête, **elles priment**, et les sections concernées
> sont annotées.

### 14.1 V1 — la carte est OBLIGATOIRE, une fois, au démarrage

> « pour la v1 on dira carte obligatoire une fois au début et tu te débrouilles pour la
> mesure de l'écart temporal, quitte à lui demander de tourner sa tête à droite et à gauche »

Le §4 présentait l'iris comme le niveau 1 par défaut et la carte comme un recours en zone
grise. Ce n'est plus le cas en V1 : **la carte est le premier écran**, une seule fois, et
la mesure est mémorisée pour tous les essayages suivants.

L'iris n'est pas supprimé pour autant — il devient le **contrôle de cohérence**
(`core/crossCheck.ts`) : il relit la carte et signale un écart de plus de 12 %, qui trahit
un cadre mal posé sur les bords. Il ne corrige rien et ne rejette rien.

### 14.2 V1 — l'écart temporal est MESURÉ, plus jamais deviné

La rotation de tête, que le §4 réservait « seulement en cas de doute », devient l'étape
qui suit immédiatement la carte. Elle rend mesurables deux grandeurs jusqu'ici supposées :

| Grandeur | Avant | Maintenant |
|---|---|---|
| Parallaxe carte ↔ tempes (B4) | supposée nulle, 3 à 7 % de biais **systématique** | mesurée (`core/parallax.ts`), il n'en reste que le résidu |
| Écart temporal | `FACE_WIDTH_CORRECTION_MM`, constante jamais calibrée | mesuré dans les pixels (`core/temporalWidth.ts`), client par client |

`UserCalibration` gagne donc deux champs, **ajoutés au contrat sur cet arbitrage** :
`temporalWidthMm` et `temporalRelError`. Quand ils sont présents, ils supplantent la
constante ; quand la mesure échoue — fond chargé, cheveux sur les tempes, rotation
refusée — la constante reprend la main et **le refus est dit en clair**.

> ⚠️ La rotation reste **facultative** dans l'IHM. Bloquer un client qui n'y arrive pas
> serait lui interdire de voir l'image, ce que le §0.0.2 refuse. Elle est proposée, sa
> valeur est expliquée, et son absence élargit la marge affichée — rien de plus.

### 14.3 V2 — le coloris se substitue par RECOLORIAGE, pas par superposition

> « pour la v2 en magasin, tu auras une vidéo réelle du rendu avec une monture. alors tu
> peux te débrouiller à faire au moins du 2.5d avec juste une autre texture de couleur à
> partir d'une photo »

Renversement complet de la §11.6. On ne pose plus un sprite **par-dessus** la monture
physiquement portée : on repeint **ses propres pixels** (`render/recolor.ts`).

- La **géométrie** vient du réel : pose, perspective, galbe, occlusion, flou de bougé.
- La **lumière** vient du réel : ombre du sourcil, reflet qui glisse quand la tête bouge.
- Seule la **matière** est substituée — chrominance et niveau de luminance, pris sur la
  photo produit du coloris voulu, à la position homologue de la silhouette.

C'est ce que la demande appelle « 2,5 D », et cela **n'introduit aucune 3D** : pas de
maillage, pas de WebGL, une boucle sur les pixels d'un rectangle. Le §0 est intact.

Conséquence directe : **le liseré du §11.6 disparaît**, puisqu'il n'y a plus deux montures
superposées mais une seule dont on change la couleur. `OVERLAY_PADDING_MM` reste en place
pour le mode superposition, qui demeure le repli quand le recoloriage ne retrouve pas la
monture dans l'image.

> ⚠️ Le choix entre les deux rendus ne se fait **pas** sur un mode (§11.4). Il se fait sur
> la présence d'une donnée : connaît-on la monture réellement portée ? En vente en ligne,
> non — et le code n'a pas besoin de savoir pourquoi.

### 14.4 V1 — dans quel plan chaque grandeur rendue vit (`core/framePlane.ts`)

> « on s'en fout de la profondeur des yeux. des lunettes sont posées sur le nez pas yeux »

Exact — et la conclusion qu'on en tire spontanément est fausse. Une monture n'est pas
plate : son plan avant est **mesuré** à ~48 mm devant les repères 234/454, mais sa
**largeur** se réalise à ses **tenons**, plaqués sur les côtés de la tête. Mettre tout
le sprite à l'échelle du pont le dessinerait **6 % trop large** (8 mm sur 132) — le
critère de succès du §0 tomberait, et l'image aurait l'air meilleure.

| Grandeur | Plan | Constante |
|---|---|---|
| Largeur rendue du sprite | tempes / tenons | *aucune* — `livePxPerMm` brut |
| `VERTICAL_OFFSET_MM` (§6.3) | pont | `BRIDGE_AHEAD_MM = 48 ± 10` |
| Décentrement (§5, règle 2) | pont | idem |
| Résidu tenons ↔ repères 234/454 | — | `ENDPIECE_AHEAD_MM = 8 ± 6`, **non corrigé** |

> 🔴 **Interdit :** multiplier l'échelle du sprite par un facteur de plan. Le résidu des
> tenons vaut 1 % avec 75 % d'incertitude — au-delà de la barre des 50 % que le projet
> s'est lui-même fixée (`MAX_DEPTH_REL_ERROR`), corriger déplace l'erreur. Verrouillé par
> l'invariant « la distance ne change pas le rapport monture/visage », qui affirme
> désormais aussi que ce rapport n'est **pas** celui du plan du pont.

**Audit associé.** Le yaw de MediaPipe porte toute la profondeur au premier ordre. Il a
été confronté à une mesure indépendante prise dans les pixels — un yaw ne raccourcit que
les longueurs horizontales, jamais les verticales — sur la vidéo du sujet réel :
**1,013 ± 0,141 sur 70 vues**. Il est juste. L'outil vit dans l'atelier
(`tests/v1-on-video.ts`) et n'a pas le droit de remonter dans `src/` : le §4 interdit un
estimateur de yaw 2D dans l'application, et il a raison — c'est un contrôle, pas une source.

### 14.5 V1 — la carte n'est pas une règle, c'est une MIRE (`core/cardPose.ts`)

> « du moment que la personne a mis une photo de carte bancaire devant toi, tu connais
> les mesures de la carte, il n'y a plus rien d'autre à demander. Tu connais la distance
> à laquelle il est et tu connais son écart temporal. »

Arbitrage retenu, et il lève explicitement la réserve du §4 sur les solveurs de pose :
un rectangle de dimensions normalisées vu en perspective **est** une mire de calibration.
Ses quatre coins donnent une homographie ; l'homographie donne la focale, donc la
distance en millimètres. Deux grandeurs jusqu'ici *supposées* deviennent mesurées.

Ce qui reste interdit ne bouge pas : aucun maillage, aucun rendu 3D, aucune bibliothèque
de géométrie. On extrait des scalaires par de l'algèbre linéaire écrite en clair (§0).

**Ce que ça exige de l'IHM :** le cadre ajusté par le client doit rendre ses **quatre
sommets**, pas deux bords — c'est déjà ce que le §4 décrit (« un rectangle
redimensionnable »).

**Ce que ça vaut, mesuré et non espéré.** La focale sort d'un effet perspectif du second
ordre : sur 85 mm vus à 78 cm, le raccourci d'un bord à l'autre fait un ou deux pixels.

| Vues | Bruit de pointage | Dispersion sur la distance |
|---|---|---|
| 1 | ±0,5 px | **±20 à 25 %** — pire que l'a priori qu'elle remplace |
| 50 (le balayage) | ±0,5 px | **±4 à 8 %**, sans biais |

> 🔴 **Une seule vue est insuffisante, et c'est verrouillé par un test.** Remplacer un
> a priori honnête (780 mm ± 17 %) par une mesure plus bruitée mais qui *ressemble* à une
> mesure est le mode d'échec que tout ce document combat. La carte ne remplace la
> constante que **moyennée sur le balayage** — et le bruit de pointage, lui, se moyenne,
> contrairement au biais de parallaxe.

**État d'exécution :** lots 0 à 7 implémentés, 139 tests au vert, typecheck `strict` clean, banc navigateur vert (23 contrôles), barrages du hook vérifiés en tentant de les contourner. **Lot 8 (calibration humaine) non fait — il ne peut pas l'être par un agent, mais la V1 n'en dépend plus tant que la mesure de l'écart temporal aboutit.**

**Arbitrages humains intégrés :** seuil proportionnel borné 3–5 mm (§5) · rotation de tête seulement en cas de doute (§4), **puis systématique en V1 (§14.2)** · contrat corrigé avant tout code · carte obligatoire en V1 (§14.1) · recoloriage 2,5 D en V2 (§14.3).

**Divergence assumée avec le rapport :** le masquage du décentrement se décide sur l'incertitude **propagée** jusqu'au décentrement, et non sur `relError <= 0.02` comme le suggérait le rapport — ce seuil serait devenu inapplicable une fois la carte passée à 0,025 par B4. Justification complète au §5, règle 2.
