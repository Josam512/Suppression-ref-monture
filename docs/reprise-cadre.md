# Reprise — finir le cadre à remplir (calibration en 3 secondes)

> À coller au début d'une nouvelle session, **avec la vidéo rattachée**.
> Dépôt : `Josam512/Suppression-ref-monture` · branche `claude/virtual-glasses-fitting-9vwyuc`
> État au 2026-08-17 : **177 tests verts**, `tsc --noEmit` strict clean, `npm run build` OK.

---

## 1. Ce qu'il reste à faire — UNE seule chose

**Placer le cadre sur le FRONT, depuis les repères du visage.**

`src/core/cardGuide.ts` → `guideQuad()` centre aujourd'hui le cadre **dans l'image**, donc
sur les yeux. La carte, elle, est posée **en haut du front**. Les deux ne se croisent
jamais, et rien ne peut verrouiller. C'est le seul défaut qui reste, et il est écrit en
tête de la fonction.

Le correctif commence par une ligne : le centre du cadre vient des landmarks, **pas** de
`imageWidth / 2`.

```
centre X  →  médiane du visage (sellion, repère 168)
centre Y  →  milieu entre les sourcils (105 / 334) et la naissance des cheveux (10)
```

Puis refaire tourner la vidéo dessus, et **figer `MIN_GUIDE_EDGE_STEP` depuis les valeurs
mesurées** — jamais en l'ajustant jusqu'à ce qu'un test passe au vert.

---

## 2. Les chiffres DÉJÀ mesurés — ne pas les refaire

| Mesure | Valeur | D'où |
|---|---|---|
| Marche de luminance quand la carte **remplit** le cadre | **34,6** | photo réelle du sujet, zoom 0,77 |
| Marche partout ailleurs | **~10** | même photo |
| Marche avec le cadre **mal placé** (au centre de l'image) | médiane **1,4** sur 179 images | la vidéo |
| Séparation du signal | **facteur 3** | le mécanisme est bon |
| Distance caméra du sujet | **43,1 cm** | `cardDistanceWithFocal`, focale 1,0 × largeur |
| Coins de la carte, photo fixe | (1319,23 · 1061,82) (1831,67 · 1080,22) (1813,98 · 1394,02) (1310,61 · 1368,55) | `refineQuad`, sous-pixel |

La vidéo : **1080×1920, 183 images, 30 ips, 6,1 s**, carte à plat sur le front, sujet qui
avance et recule.

---

## 3. Les trois pièges — tous rencontrés, tous coûteux

### 🔴 Piège n°1 — le contrôle circulaire

`refineQuad` **contraint sa sortie à rester près de sa graine**. Comme la graine est le
cadre, comparer les coins accrochés au cadre **ne peut pas échouer**. Ce contrôle
verrouillait sur une carte deux fois trop petite.

### 🔴 Piège n°2 — « bords mesurés » ne suffit pas

Du grain de peau fournit assez de gradient pour qu'une droite s'y ajuste. Exiger 4 bords
mesurés laissait encore passer une carte à 282 px pour un cadre de 396.

### ✅ Le seul contrôle valide

Lire les pixels **de part et d'autre du cadre, qui est fixe** (`guideEdgeStep`). Aucune
boucle possible : si la carte remplit le cadre, marche franche sur les quatre bords ; si
elle est trop petite, le bord tombe sur du front nu.

### 🔴 Piège n°3 — la détection automatique ne marche pas

Trois tentatives, toutes ratées sur une vraie photo, **ne pas les refaire** :

| Approche | Résultat |
|---|---|
| Rectangles candidats notés au rapport ISO | 36 % d'erreur d'échelle |
| Contours fermés (scanner de document, OpenCV) | **0 candidat** — le contour de la carte n'est pas fermé sur un front éclairé |
| Segments de droite + assemblage (Hough) | 57 % d'erreur |

Cause commune : **la lisière des cheveux est un bord plus franc que la carte**. C'est
pourquoi on renverse l'interaction au lieu de détecter — comme tous les scanners de carte
en production.

---

## 4. Ce que le prochain lot doit livrer

1. `guideQuad` prend les landmarks et place le cadre sur le front. Signature à changer —
   c'est assumé, la fonction n'est branchée nulle part.
2. Refaire tourner la vidéo : le profil temporel doit montrer un **pic net** quand la
   carte remplit le cadre, comme les 34,6 de la photo.
3. Figer `MIN_GUIDE_EDGE_STEP` **entre** le pic et le fond, avec sa date et le nombre
   d'images, en commentaire — même discipline que `FACE_WIDTH_CORRECTION_MM` (§5).
4. Vérifier que `GuideLock` déclenche, et **une seule fois**.
5. Brancher dans `src/ui/CardCalibration.tsx` : cadre dessiné, jauge de remplissage,
   **aucun bouton**, et passage direct à l'essayage au verrouillage.
6. Tests + `npm run smoke` + commit.

---

## 5. Ce qui est DÉJÀ fait et ne doit pas être refait

- **Pose verticale** : `VERTICAL_OFFSET_MM` supprimée, remplacée par `poseAnchorOf`
  (X = sellion, Y = ligne des 4 canthi). Vérifié sur un vrai visage, avant/après dans
  `docs/verification/`.
- **Focale mémorisée** : `core/cameraProfile.ts`, normalisée par la largeur d'image,
  clé `localStorage` séparée de la calibration, plancher systématique à 2 %.
- **Branches** : aboutissent à l'oreille mesurée (repères 162 / 389, identifiés en
  annotant 32 candidats sur une vraie photo).
- **`focalSpread`** : était calculé et consommé par rien ; garde-fou ajouté, la chaîne
  rendait « 134 cm » avec 89 % de désaccord interne.
- **Parallaxe** : le « reculez, il faut 60 cm » est supprimé — un problème de mesure ne se
  convertit pas en contrainte imposée au client. Le biais est chiffré, rien ne bloque.
- **Carte Vitale** acceptée (ISO 7810 ID-1, identique), recommandée en premier : aucun
  numéro de paiement dessus.

---

## 6. Règles à ne pas enfreindre

1. **Ne jamais ajuster une constante pour faire passer un test.** Si un test échoue, ou le
   code est faux, ou le test est faux — et dans le second cas, on le signale.
2. **Un test garde-fou doit balayer un domaine, jamais un point.**
3. **Ne jamais convertir un problème de mesure en contrainte de tournage** (« refilmez »,
   « reculez », « mettez un fond uni »). C'est l'erreur n°11 du journal.
4. `npm test` + `npm run smoke` avant chaque commit. Le hook `.githooks/pre-commit` bloque
   physiquement — l'installer avec `npm run hooks:install`.

---

## 7. ⚠️ La vidéo n'est PAS dans le dépôt, et c'est délibéré

Elle montre le **dos de la carte**, panneau de signature compris — donc potentiellement le
cryptogramme. Elle n'a pas sa place dans un dépôt Git.

**Il ne faut PAS la refilmer** : le même fichier suffit, il est sur le téléphone.
Le rattacher tel quel à la nouvelle session.

Chaîne de traitement à refaire côté agent (OpenCV s'installe avec
`pip install opencv-python-headless`, il est déjà au `requirements.txt`) :

```bash
# 1. extraire les images en RGBA brut, 540x960
python3 -c "
import cv2, numpy as np, json
c=cv2.VideoCapture('<video>'); W,H=540,960
out=open('frames.rgba','wb'); n=0
while True:
    ok,f=c.read()
    if not ok: break
    f=cv2.resize(f,(W,H),interpolation=cv2.INTER_AREA)
    out.write(np.dstack([f[:,:,2],f[:,:,1],f[:,:,0],np.full((H,W),255,np.uint8)]).tobytes()); n+=1
out.close(); json.dump({'W':W,'H':H,'n':n},open('frames.json','w')); print(n)"

# 2. faire tourner le VRAI code dessus (vite-node), jamais une reimplementation
```

⚠️ Les scripts d'atelier lancent `npx vite` directement et **court-circuitent `predev`** :
faire `npm run sync:wasm` avant, sinon MediaPipe rend un 404 sur `/wasm/`.
