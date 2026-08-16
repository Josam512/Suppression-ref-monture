# CLAUDE.md — Essayage virtuel de lunettes **2D** avec vérification de taille réelle

> Ce fichier est le contrat du projet. Claude Code doit le lire au début de **chaque** session.
> Toute décision qui contredit ce fichier doit être signalée et validée par l'humain avant d'être codée.

> ⚠️ **Revue en cours.** Une analyse complète de ce contrat a relevé 15 défauts, dont 5 bloquants
> qui faussent la mesure sans le signaler. Voir `docs/rapport-essayage-virtuel.md`.
> Les corrections ne sont **pas** appliquées ci-dessous : ce fichier est conservé tel que rédigé
> par l'humain, en attente d'arbitrage. Ne pas coder à partir de ce document seul.

---

## 0. Objectif en une phrase

Une web app qui superpose en temps réel, sur le flux webcam, **l'image 2D détourée d'une monture réelle** (photo de face + photo de profil, les deux composées simultanément), à **l'échelle millimétrique exacte**, et qui rend un **verdict chiffré** : la monture est-elle sur-taillée, correcte, ou sous-taillée pour ce visage.

### Contexte d'usage : VENTE EN LIGNE

L'utilisateur est un **client à distance, chez lui**. Il n'a **pas** la monture entre les mains, il n'a **pas** d'opticien à côté de lui, il ne dispose d'**aucun instrument de mesure**.

Conséquences directes, non négociables :

- La seule référence de taille disponible sans effort est **biologique** : le diamètre de l'iris (11,7 mm, quasi-constant). Précision 4,3 %. C'est le mode par défaut.
- En cas de résultat limite, on propose un **objet standardisé que tout le monde possède** : une carte bancaire (norme ISO/IEC 7810 ID-1, 85,60 × 53,98 mm). Précision 1–2 %. Posée sur le front **deux secondes**, puis rangée définitivement.
- Aucune saisie de mesure au clavier : le client ne connaît aucune de ses dimensions.
- L'app doit fonctionner sur un ordinateur portable ou un téléphone lambda, avec une webcam médiocre, **sans aucun capteur de profondeur** (voir §4 pour pourquoi cette piste est close).

### Ce qui est HORS PÉRIMÈTRE (ne pas coder, ne pas proposer)

- ❌ Aucune 3D. Pas de `three.js`, pas de WebGL, pas de `.glb`, pas de `.gltf`, pas de reconstruction de maillage.
- ❌ Pas de génération de modèle 3D à partir des photos.
- ❌ Pas de photoréalisme (reflets calculés, ombres portées, matériaux PBR).
- ❌ Pas de backend, pas de base de données, pas d'authentification.

Le rendu est du **compositing de sprites 2D sur `<canvas>`**. C'est tout. Si une tâche semble exiger de la 3D, c'est que la tâche est mal formulée : demander à l'humain.

### Le critère de succès unique

> Un opticien regarde l'écran et dit : « oui, cette monture fait bien 132 mm de large sur un visage de 138 mm, elle est légèrement sous-taillée. »

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

**Le correctif (v2, déjà appliqué à l'époque) :**

```javascript
async function detectFaces() {
  if (!isRunning || !detector || !video || !canvas) {
    animationId = requestAnimationFrame(detectFaces);
    return;                                        // ✅ replanifie toujours
  }
  try {
    const faces = await detector.estimateFaces(video, { flipHorizontal: false });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (faces.length > 0) drawGlasses(faces[0]);
  } catch (err) {
    console.error('Detection error:', err);        // ✅ visible
  }
  animationId = requestAnimationFrame(detectFaces);
}
```

**Règle définitive :** la boucle de rendu ne doit **jamais** pouvoir s'arrêter sur une exception, et elle doit afficher à l'écran un compteur d'échecs consécutifs (`détection perdue : 12 frames`). Un échec silencieux est pire qu'un crash.

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
    calibration.ts             ← calibration carte bancaire → mm/px réel
    faceMetrics.ts             ← PD, largeur visage, roll, yaw depuis les landmarks
    frameSpec.ts               ← A, B, pont, largeur totale, px/mm du sprite
    verdict.ts                 ← surtaillé / correct / sous-taillé
  render/
    composite.ts               ← drawImage du sprite de face
    temple.ts                  ← sprite de profil (branche) + occlusion
    overlay.ts                 ← guides de mesure, cotes affichées
  tracking/
    landmarker.ts              ← init MediaPipe, boucle detectForVideo
  prep/                        ← outil hors-ligne de préparation des montures
    DetourTool.tsx             ← détourage fond blanc + marquage des cotes
  ui/
public/
  models/face_landmarker.task
  frames/<slug>/front.png  profile.png  spec.json
tests/
  fixtures/                    ← jeux de landmarks figés, images de référence
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
    throw new CalibrationError(
      `Incohérence de ${(spread * 100).toFixed(1)}% entre A, B et le pont. ` +
      `Photo prise en perspective (pas de face) ou points mal placés. Recommencer.`
    );
  }
  return mean;
}
```

> ⚠️ Ce garde-fou est **obligatoire**. C'est lui qui attrape une photo prise de trois quarts, qui fausserait tout en aval de façon invisible.

On en déduit la mesure qui compte vraiment, **mesurée et non calculée** :

```typescript
// Largeur totale réelle de la monture, bord externe à bord externe.
// PAS 2*A + pont : ce calcul oublie l'épaisseur du cerclage.
export function totalFrameWidthMm(spriteWidthPx: number, spritePxPerMm: number): number {
  return spriteWidthPx / spritePxPerMm;   // ex. 1584 px / 12.0 = 132.0 mm
}
```

On enregistre aussi, en coordonnées sprite : le **centre du pont** (point d'ancrage) et les **centres optiques des deux verres** → servent au diagnostic de décentrement (§5).

Sortie : `public/frames/<slug>/spec.json`.

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

  if (faceWidthMm < 118 || faceWidthMm > 165) {
    throw new CalibrationError(
      `Largeur de visage calculée : ${faceWidthMm.toFixed(1)} mm — hors plage plausible (118–165).`
    );
  }
  return { faceWidthMm, source: 'iris', relError: IRIS_REL_ERROR, measuredAt: Date.now() };
}
```

> ⚠️ **Piège à ne pas se laisser vendre :** moyenner sur 1000 frames n'améliorera PAS la précision au-delà de 4,3 %. Le moyennage élimine le bruit de détection, pas la variabilité biologique — celle-ci est un **biais fixe** propre à cette personne. Un client dont les iris font 11,2 mm sera décalé de 4 % pour toujours. Aucune statistique ne corrige un étalon faux. Ne jamais annoncer une précision meilleure que 4,3 % en mode iris.

**Ce que ça vaut :** ±6 mm sur un visage de 138 mm. Suffisant pour éliminer sans hésiter les montures franchement inadaptées — c'est-à-dire l'essentiel du catalogue. Insuffisant pour trancher les cas serrés, puisque le seuil de décision est à ±4 mm.

---

#### Niveau 2 — Calibration carte (déclenchée uniquement en zone grise)

Norme **ISO/IEC 7810 ID-1 : 85,60 × 53,98 mm**. Objet universel, gratuit, présent chez tout le monde. Précision : **1–2 %**.

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

  if (faceWidthMm < 118 || faceWidthMm > 165) {
    throw new CalibrationError(
      `Largeur de visage calculée : ${faceWidthMm.toFixed(1)} mm — hors plage plausible (118–165). ` +
      `Le cadre a probablement été mal ajusté sur la carte. Recommencer.`
    );
  }
  return { faceWidthMm, source: 'card', relError: 0.015, measuredAt: Date.now() };
}
```

**Contraintes de validité à faire respecter par l'UI :**

- La carte doit être **dans le même plan que le visage** (posée à plat sur le front, pas tendue vers la caméra), sinon la perspective fausse l'échelle. Message explicite à l'écran.
- Pose de face obligatoire : rejeter si la tête est tournée ou inclinée de plus de 8°.
- **3 mesures sur 3 images successives**, concordantes à moins de 3 % ; sinon redemander. Une calibration ratée contamine silencieusement toute la session.
- Bouton « refaire la calibration » toujours accessible.

---

#### La source de l'échelle doit voyager avec la mesure

```typescript
export interface UserCalibration {
  faceWidthMm: number;
  source: 'iris' | 'card';
  relError: number;        // 0.043 pour l'iris, 0.015 pour la carte
  measuredAt: number;
}
```

**Règle :** `relError` n'est jamais ignorée en aval. Elle pilote la largeur de la zone grise (§5) et le libellé affiché. Une mesure sans son incertitude est une mesure fausse.

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

export function frameMetrics(lm: NormalizedLandmark[], w: number, h: number, cal: UserCalibration) {
  const faceWidthPx = dist(px(lm[FACE_L], w, h), px(lm[FACE_R], w, h));

  // ⭐ LA conversion : largeur mesurée à l'écran ÷ largeur réelle mémorisée.
  // DÉCISION FIGÉE : la calibration (iris OU carte) est faite UNE FOIS, au démarrage.
  // On ne recalcule PAS l'échelle depuis l'iris à chaque image : ce serait plus bruité
  // et cela rendrait les deux modes divergents. Les deux sources suivent le même chemin ici.
  const livePxPerMm = faceWidthPx / cal.faceWidthMm;

  const eL = px(lm[EYE_L], w, h), eR = px(lm[EYE_R], w, h);

  return {
    livePxPerMm,
    rollRad: Math.atan2(eR.y - eL.y, eR.x - eL.x),
    anchor:  px(lm[SELLION], w, h),
  };
}
// ⚠️ NE PAS ajouter `faceWidthMm` au retour : ce serait une simple recopie de la
// calibration, qui ressemble à une mesure sans en être une. La largeur du visage
// se lit sur `cal`, sa seule source légitime.
```

Le facteur de redimensionnement du sprite n'a alors **aucun paramètre libre** :

```typescript
// render/composite.ts
const drawScale = livePxPerMm / spritePxPerMm;
const drawW = sprite.width  * drawScale;
const drawH = sprite.height * drawScale;
```

> **Vérification mentale à refaire à chaque relecture :** si le client avance vers la caméra, `faceWidthPx` augmente, donc `livePxPerMm` augmente, donc `drawScale` augmente, donc la monture grossit exactement dans les mêmes proportions que le visage. **Le rapport monture/visage reste constant, quelle que soit la distance à l'écran.** C'est le test de cohérence du projet en une ligne — et c'est précisément ce que la carte bancaire a rendu possible.

---

## 5. Le verdict de taille

C'est le livrable final visible.

```typescript
// core/verdict.ts
export interface SizeVerdict {
  frameWidthMm: number;
  faceWidthMm: number;
  faceWidthUncertaintyMm: number;      // ± issu de cal.relError
  deltaMm: number;
  status: 'sous-taillee' | 'correcte' | 'surtaillee' | 'incertain';
  decentrementMm: { left: number; right: number };
  source: 'iris' | 'card';
}
```

**Règle 1 — largeur (règle opticien classique) :** la largeur totale de la monture doit correspondre à la largeur du visage aux tempes.

| Δ = largeur_monture − largeur_visage | Verdict |
|---|---|
| Δ < −4 mm | **sous-taillée** (monture trop étroite, joues comprimées, branches qui écartent) |
| −4 ≤ Δ ≤ +4 mm | **correcte** |
| Δ > +4 mm | **surtaillée** (monture qui déborde, glisse sur le nez) |

**Règle 1 bis — la zone grise s'élargit selon la source de mesure.** C'est le mécanisme central de la cascade : le seuil métier est fixe, mais la marge d'erreur ne l'est pas.

```typescript
// core/verdict.ts
export const THRESHOLD_MM = 4;   // seuil métier, fixe

export function classify(deltaMm: number, cal: UserCalibration): Status {
  const uncertainty = cal.faceWidthMm * cal.relError;   // iris ≈ 5.9 mm | carte ≈ 2.1 mm

  // Si le seuil tombe DANS la barre d'erreur, on ne peut pas trancher. On le dit.
  if (Math.abs(Math.abs(deltaMm) - THRESHOLD_MM) < uncertainty && cal.source === 'iris') {
    return 'incertain';
  }
  if (deltaMm < -THRESHOLD_MM) return 'sous-taillee';
  if (deltaMm >  THRESHOLD_MM) return 'surtaillee';
  return 'correcte';
}
```

`'incertain'` n'est pas un échec : c'est le déclencheur du niveau 2. L'UI affiche alors la proposition de calibration carte, et **elle seule** — jamais un verdict tranché.

**Affichage obligatoire de l'incertitude.** En mode iris : *« Votre visage : environ 138 mm (± 6 mm) »*. En mode carte : *« Votre visage : 138 mm (± 2 mm) »*. Ne jamais afficher un nombre nu qui suggère une précision inexistante.

**Règle 2 — centrage de l'œil dans le verre.** Chaque œil doit tomber au centre horizontal de son verre. Si l'écart dépasse **3 mm**, ce n'est pas la largeur totale qui cloche mais le **pont** (22 mm inadapté à ce nez) : la monture est de la bonne taille mais mal proportionnée pour ce visage. Le diagnostic est différent et doit être affiché différemment.

```typescript
const eyeCenterL = midpoint(px(lm[33], w, h), px(lm[133], w, h));   // coins de l'œil gauche
const decentrementMm = dist(eyeCenterL, lensCenterL_projected) / livePxPerMm;
```

> ⚠️ Le décentrement se joue à 3 mm, en dessous de la barre d'erreur du mode iris (±6 mm). **Ce diagnostic n'est affiché QUE si `source === 'card'`.** En mode iris, il est masqué — pas approximé, masqué.

**Règle 3 — conditions de pose.** Aucun verdict n'est rendu si : yaw > 12°, ou roll > 15°, ou détection perdue depuis > 5 frames, ou aucune échelle disponible. **Ne jamais afficher un verdict à l'air confiant sur une mesure dégradée.**

### Constante à calibrer une fois

Les landmarks 234/454 sont sur le contour du visage, légèrement **sous** les tempes anatomiques :

```typescript
export const FACE_WIDTH_CORRECTION_MM = 0;  // à ajuster empiriquement, puis figer
```

Protocole : l'humain essaie une monture dont il **sait** qu'elle lui va ; on ajuste la constante pour que le verdict tombe sur « correcte » ; on la fige avec sa date en commentaire. Ne jamais la retoucher en douce pour faire passer un test.

---

## 6. Le rendu 2D — face + profil simultanés

Deux sprites, un seul canvas. Le profil sert à la **branche**, qui apparaît progressivement quand la tête tourne.

```typescript
// render/composite.ts
export function drawFrame(ctx, sprites, m: FrameMetrics, yawRad: number) {
  const scale = m.livePxPerMm / sprites.front.pxPerMm;

  // — 1. La face, ancrée sur le sellion, inclinée selon le roll
  ctx.save();
  ctx.translate(m.anchor.x, m.anchor.y + VERTICAL_OFFSET_MM * m.livePxPerMm);
  ctx.rotate(m.rollRad);
  ctx.scale(Math.cos(yawRad), 1);   // raccourci perspectif horizontal — du 2.5D, pas de la 3D
  ctx.drawImage(
    sprites.front.img,
    -sprites.front.bridgeCenter.x * scale,
    -sprites.front.bridgeCenter.y * scale,
    sprites.front.img.width  * scale,
    sprites.front.img.height * scale
  );
  ctx.restore();

  // — 2. La branche, depuis le sprite de profil, révélée par |yaw|
  const templeAlpha = smoothstep(0.10, 0.45, Math.abs(yawRad));
  if (templeAlpha > 0.01) drawTemple(ctx, sprites.profile, m, yawRad, templeAlpha, scale);
}
```

- La branche est ancrée à la **charnière** (marquée dans l'outil de prep sur le sprite de profil) et sa longueur est calibrée sur les **145 mm**.
- **Occlusion :** la branche doit passer *derrière* la tête. Construire un `Path2D` du contour du visage (landmarks de l'ovale facial), puis `ctx.globalCompositeOperation = 'destination-out'` sur la portion intérieure. Une branche qui flotte par-dessus la joue trahit immédiatement le trucage.
- **Miroir :** la vidéo est affichée en miroir (naturel pour l'utilisateur). Le miroir s'applique **une seule fois**, au niveau du conteneur CSS. Les calculs de `core/` travaillent toujours en coordonnées non miroitées. Ne jamais mélanger les deux — source classique du bug « les lunettes partent du mauvais côté ».

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
): SizeVerdict | null;
```

```typescript
export interface SizeVerdict {
  frameWidthMm: number;                        // depuis spec, mesurée sur le sprite
  faceWidthMm: number;                         // depuis cal, corrigée (voir ci-dessous)
  faceWidthUncertaintyMm: number;              // faceWidthMm × cal.relError
  deltaMm: number;                             // frameWidthMm − faceWidthMm
  status: 'sous-taillee' | 'correcte' | 'surtaillee' | 'incertain';
  decentrementMm: { left: number; right: number } | null;   // null si source === 'iris'
  source: 'iris' | 'card';
}
```

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

  it('carte de 300 px de large → visage mesuré à 138 mm', () => {
    expect(calibrateWithCard(300, LANDMARKS_CAL, 1280, 720).faceWidthMm).toBeCloseTo(138.0, 1);
  });

  it('iris de 42 px → échelle de 3.59 px/mm', () => {
    expect(scaleFromIris(42)).toBeCloseTo(3.59, 2);
  });

  it('CASCADE : cas limite en mode iris → incertain, pas de verdict tranché', () => {
    const cal = { faceWidthMm: 138, source: 'iris', relError: 0.043, measuredAt: 0 };
    expect(classify(-5, cal)).toBe('incertain');   // 5 mm : dans la barre d'erreur de ±5.9
  });

  it('CASCADE : même cas avec la carte → verdict ferme', () => {
    const cal = { faceWidthMm: 138, source: 'card', relError: 0.015, measuredAt: 0 };
    expect(classify(-5, cal)).toBe('sous-taillee');
  });

  it('CASCADE : écart franc → tranché même en mode iris', () => {
    const cal = { faceWidthMm: 138, source: 'iris', relError: 0.043, measuredAt: 0 };
    expect(classify(-18, cal)).toBe('sous-taillee');
  });

  it('le décentrement est masqué en mode iris', () => {
    expect(verdict(LANDMARKS_138, CAL_IRIS, SPEC_132).decentrementMm).toBeNull();
  });

  it('INVARIANT : la distance à la caméra ne change pas le rapport monture/visage', () => {
    const proche = verdict(LANDMARKS_50CM,  CAL, SPEC);
    const loin   = verdict(LANDMARKS_100CM, CAL, SPEC);
    expect(proche.frameWidthMm).toBeCloseTo(loin.frameWidthMm, 1);
    expect(proche.status).toBe(loin.status);
  });

  it('INVARIANT : monture 132 mm sur visage 138 mm → sous-taillée', () => {
    expect(verdict(LANDMARKS_138, CAL, SPEC_132).status).toBe('sous-taillee');
  });

  it('pas de calibration → aucun verdict rendu', () => {
    expect(verdict(LANDMARKS_138, null, SPEC_132)).toBeNull();
  });
});
```

**Les deux tests marqués `INVARIANT` sont sacrés.** Ils encodent le sens physique du projet. S'ils passent au rouge, on ne les ajuste pas : on répare le code.

---

## 9. Règles de travail pour Claude Code — protocole anti-casse

### 9.0 Garde-fous mécaniques — à installer AVANT toute autre ligne de code

Les règles écrites ci-dessous dépendent de la bonne volonté de l'agent. Ces quatre-là n'en dépendent pas : elles bloquent physiquement. C'est le lot 0, non négociable.

**a. Le hook pre-commit.** `.husky/pre-commit` :

```bash
#!/bin/sh
npm run typecheck || exit 1
npm test         || exit 1
# Un test ne doit jamais être supprimé ni neutralisé pour faire passer un commit.
grep -rn "\.skip\|\.todo\|xit(\|xdescribe(" tests/ && { echo "❌ Test désactivé détecté"; exit 1; }
# Le slider de taille est la régression n°1 de ce projet. Barrage définitif.
grep -rni "scaleslider\|sizeslider\|adjustscale" src/ && { echo "❌ Slider de taille interdit (§1 bug #1)"; exit 1; }
# Aucune 3D.
grep -rn "from 'three'\|@react-three" src/ && { echo "❌ Dépendance 3D interdite"; exit 1; }
# V2 : aucun branchement sur le mode hors calibration.ts (voir §11.4).
grep -rn "mode ===\|isStore\|isMagasin\|source === 'worn-frame'" src/core src/render \
  --exclude=calibration.ts && { echo "❌ Branchement sur le mode interdit (§11.4)"; exit 1; }
```

Un commit qui échoue au hook n'existe pas. L'agent ne peut pas passer outre sans que tu le voies dans le diff du hook lui-même — surveille ce fichier.

**b. Le compteur de tests.** `tests/meta.test.ts` :

```typescript
// Se met à jour UNIQUEMENT en même temps qu'on ajoute un test, jamais pour réparer.
const EXPECTED_MIN_TESTS = 12;   // lot 3 : 12 | lot 5 : 18 | lot 6 : 24
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

## 10. Ordre d'exécution — 7 lots, chacun vérifiable

| # | Lot | Critère d'acceptation |
|---|---|---|
| 0 | **Garde-fous §9.0** : husky, hook pre-commit, meta.test.ts, premier tag git | Un commit avec un test désactivé est refusé par le hook — **le vérifier en essayant** |
| 1 | Squelette Vite + TS + Vitest, `core/geom.ts`, webcam sur `localhost` | La vidéo s'affiche, `npm test` passe sur geom.ts |
| 2 | `tracking/landmarker.ts`, modèle vendorisé | 478 points dessinés en overlay, ≥ 25 fps, chargement en % |
| 3a | `core/units.ts` + échelle iris + tests | Largeur de visage affichée en mm avec sa marge (± 6 mm), stable à ±3 % quand on avance/recule |
| 3b | `core/calibration.ts` : carte + tests | Carte sur le front → même largeur qu'en 3a, mais à ± 2 mm ; carte retirée, mesure conservée |
| 4 | `prep/DetourTool.tsx` : détourage fond blanc + 6 points | `spec.json` généré, photo en perspective rejetée |
| 5 | `core/faceMetrics.ts` + `render/composite.ts` | Sprite de face à l'échelle, **sans aucun slider** |
| 6 | `core/verdict.ts` + cascade + affichage | Verdict chiffré avec sa marge ; cas limite → `incertain` + proposition de carte |
| 7 | `render/temple.ts` : branche + occlusion | La branche apparaît en tournant la tête et passe derrière la joue |

**Ne pas démarrer le lot N+1 tant que le lot N n'est pas validé par l'humain.** C'est la règle qui remplace l'ancien mode « un gros fichier, on verra bien ».

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
| Échelle du visage inconnue | **Résolu** : la monture portée est un étalon de taille connue, visible, exactement dans le plan du visage. Précision ~1 %. |
| Verdict sur/sous-taillé | **Déjà répondu** : le client le sent physiquement. Ce n'est plus la question. |

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
  const pxPerMm = wornFrameWidthPx / wornFrameSpec.totalWidthMm;
  const faceWidthMm = dist(px(lm[FACE_L], w, h), px(lm[FACE_R], w, h)) / pxPerMm;

  if (faceWidthMm < 118 || faceWidthMm > 165) {
    throw new CalibrationError(
      `Largeur de visage : ${faceWidthMm.toFixed(1)} mm — hors plage. ` +
      `Mauvaise référence de monture sélectionnée, ou détection de la monture ratée.`
    );
  }
  return { faceWidthMm, source: 'worn-frame', relError: 0.01, measuredAt: Date.now() };
}
```

**C'est tout.** `frameMetrics`, `classify`, `verdict`, `drawFrame` : **aucune modification**. Ils reçoivent un `UserCalibration` et ne savent pas d'où il vient. C'est exactement ce qui empêche les deux versions de se marcher dessus.

### 11.4 🔴 Garde-fou n°1 — INTERDICTION de brancher sur le mode

C'est le risque de casse principal des deux versions. Un `if (mode === 'magasin')` dans `core/` ou `render/` et l'architecture est morte : chaque correctif d'un mode cassera l'autre.

À ajouter au hook pre-commit (§9.0) :

```bash
# Aucun branchement sur le mode ailleurs que dans calibration.ts
grep -rn "mode ===\|isStore\|isMagasin\|source === 'worn-frame'" src/core src/render \
  --exclude=calibration.ts && { echo "❌ Branchement sur le mode hors calibration.ts (§11.4)"; exit 1; }
```

Test qui verrouille le principe :

```typescript
it('GARDE-FOU : les 3 sources suivent le même chemin en aval', () => {
  const base = { faceWidthMm: 138, relError: 0.01, measuredAt: 0 };
  const vIris  = verdict(LM, { ...base, source: 'iris' },       SPEC_132, 1280, 720);
  const vCard  = verdict(LM, { ...base, source: 'card' },       SPEC_132, 1280, 720);
  const vWorn  = verdict(LM, { ...base, source: 'worn-frame' }, SPEC_132, 1280, 720);

  // À relError et faceWidthMm identiques, le verdict DOIT être identique.
  // S'il diverge, c'est qu'un branchement sur le mode s'est glissé quelque part.
  expect(vCard!.status).toBe(vIris!.status);
  expect(vWorn!.status).toBe(vIris!.status);
  expect(vWorn!.deltaMm).toBeCloseTo(vIris!.deltaMm, 3);
});
```

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
| V2-0 | `assertSameModel` + tests | Un coloris rattaché au mauvais modèle est rejeté avec un message clair |
| V2-1 | `calibrateWithWornFrame` + garde-fou §11.4 | Les 3 sources donnent le même verdict à calibration égale |
| V2-2 | Sélecteur de coloris + `OVERLAY_PADDING_MM` | Coloris clair sur monture noire : aucun liseré visible |
| V2-3 | Détection assistée de la monture portée | L'opticien clique 2 points sur les bords externes → calibration |

> Pour V2-3, **ne pas tenter la détection automatique de monture au premier jet.** Deux clics d'un opticien professionnel sont plus fiables, plus rapides à coder, et testables. L'automatisation viendra après, si le besoin se confirme.

---

## 12. Données de la monture de test

```json
{
  "slug": "test-01",
  "aMm": 44,
  "bMm": 39,
  "pontMm": 22,
  "brancheMm": 145,
  "front": "front.png",
  "profile": "profile.png"
}
```

Prise de vue exigée pour toute nouvelle monture : **fond blanc uni**, appareil **perpendiculaire** au plan de la monture (le contrôle de cohérence à 4 % rejettera toute perspective), monture posée à plat pour la face, branche entièrement dépliée et à plat pour le profil.
