# Reprise de session — essayage virtuel de lunettes 2D

> À coller au début d'une nouvelle conversation. Tout ce qui suit est **vérifié**, sauf ce
> qui est explicitement marqué comme non vérifié.
> Dépôt : `Josam512/Suppression-ref-monture` · branche `claude/virtual-fitting-roadmap-analysis-lmfohq`
> Dernière mise à jour : 2026-08-17.

---

## 1. Le projet en dix lignes

Web app qui superpose **en direct**, sur le flux webcam, la **photo 2D détourée d'une
monture réelle**, à l'**échelle millimétrique exacte**, et affiche deux cotes à côté de
l'image : largeur de la monture, largeur du visage. **La personne voit si ça lui va.
L'app ne le lui dit pas.**

- **Contrat complet : `CLAUDE.md`**, à lire au début de chaque session. Il fait foi.
- **Aucune 3D** de rendu : pas de `three.js`, pas de WebGL, pas de maillage, pas de `.glb`.
  Compositing de sprites 2D sur `<canvas>`.
- **Aucun tri, aucune recommandation, aucun filtrage** de catalogue. Toute monture peut
  être essayée, y compris trop grande — c'est là qu'est la valeur.
- **Aucun slider de taille.** C'est la régression n°1 historique ; un barrage du hook la
  bloque physiquement.
- **Aucun présupposé de taille** : ni « visage moyen », ni géométrie métrique 3D de
  MediaPipe, ni IA de profondeur monoculaire. Toutes ces voies sont des constantes en dur
  déguisées.
- Critère de succès unique : *un opticien regarde l'écran et dit « oui, l'image est juste :
  cette monture fait bien 132 mm sur ce visage de 152 »*. Tolérance ±3 %.

**Deux versions.** V1 vente en ligne : étalon = **carte bancaire ISO, obligatoire une fois
au début**, puis rotation de tête. V2 magasin : étalon = la monture portée ; le coloris se
substitue par **recoloriage 2,5 D des pixels réels**, pas par superposition.

Stack imposée : Vite + TypeScript `strict` + React 18 + `@mediapipe/tasks-vision` (modèle
vendorisé) + Vitest. Zéro autre dépendance sans validation humaine.

---

## 2. État réel — ce qui marche et comment c'est prouvé

| Maillon | État | Preuve |
|---|---|---|
| Chaîne géométrique sprite → écran | ✅ | banc navigateur : **131,82 mm** peints pour 132,00 attendus |
| 3 montures réelles préparées | ✅ | 3 cotes indépendantes concordantes à < 3,4 % |
| Carte → focale → **distance mesurée** | ✅ | vérité terrain de synthèse : focale et distance retrouvées à 40/60/90° de champ |
| Accrochage automatique des coins de la carte | ✅ | **0,05 px** sur vérité terrain ; un seul coin juste sur 4 suffit |
| Parallaxe carte↔tempes mesurée | ✅ | 37 vues sur vidéo réelle, ±1 % |
| Écart temporal mesuré | ⚠️ | mesuré, mais **aucune vérité terrain au pied à coulisse** |
| Yaw de MediaPipe | ✅ | audité contre une mesure indépendante prise dans les pixels : **1,013 ± 0,141** sur 70 vues |
| Recoloriage V2 2,5 D | ✅ chaîne | 59/59 images sur photo réelle ; **qualité jamais jugée sur monture noire** |
| Branche (temple) | ⚠️ | longueur à ±20 % |
| `VERTICAL_OFFSET_MM` | ❌ | **non calibrée** — la monture se pose visiblement trop bas |

**Contrôles automatiques :** 139 tests Vitest · `tsc --noEmit` en `strict` · `npm run build`
· `npm run smoke` (23 contrôles navigateur, dont la remesure des pixels peints).

### Chiffres obtenus sur le seul sujet réel disponible

Vidéo portrait 720×1280, téléphone tenu à la main, carte à plat sur le front, rotation
−69° à +62°, 148 images avec visage détecté.

| Grandeur | Valeur |
|---|---|
| Carte suivie automatiquement | **100 cadres sur 148 images** |
| Focale mesurée | 721 px = 1,00 × largeur d'image (≈ 53° de champ) |
| Distance **mesurée** | **42,1 cm** — contre **78 cm supposés**. L'a priori était faux de 46 % |
| Profondeur carte ↔ tempes | 54,3 mm |
| Biais de parallaxe corrigé | **+12,9 %** (au lieu de 6,8 % avec la distance supposée) |
| Largeur des repères 234/454 | 136,0 mm brute → 153,5 mm corrigée |
| **Écart temporal** | **169,0 mm ± 3,5 mm** (2,1 %) |

> ⚠️ Le recoupement focale ↔ taille apparente de la carte **n'a pas été terminé**. Le
> chiffre de 42,1 cm est plausible (téléphone à bout de bras) mais **non recoupé**. C'est
> la première chose à refaire.

---

## 3. Mes erreurs, et ce qu'elles ont coûté

Elles sont listées parce qu'elles se reproduiraient sans ça. Toutes ont un correctif dans
le dépôt et, quand c'était possible, un test qui les verrouille.

| # | Erreur | Comment elle s'est vue | Correctif |
|---|---|---|---|
| 1 | Ajuster **profondeur ET distance** sur les mêmes images (régresseurs quasi colinéaires) | 14,6 mm puis 43,8 mm pour la même personne, une image d'écart | estimateur **supprimé**, pas désactivé ; distance fixée, puis mesurée sur la carte |
| 2 | Prendre **234/454** comme référence de profondeur | 99 mm quel que soit le point sondé — ces repères **glissent** sur la silhouette, ce ne sont pas des points physiques | référence = **coins externes des yeux** ; 36,8 mm ±1 % |
| 3 | Oublier que le milieu de deux points **projetés** n'est pas la projection de leur milieu | +19 % de profondeur, biais constant que la mesure différentielle n'élimine pas | terme `a²·cosθ·sinθ/D` ajouté |
| 4 | `putImageData` **remplace** les pixels au lieu de les composer | rectangle noir autour de la monture recoloriée — invisible dans l'app (canvas transparent), visible en atelier | composition par `drawImage` sur calque isolé |
| 5 | `onLost` incrémentait le compteur d'échecs **sans dessiner** | détection perdue = canvas figé, panne indiscernable du fonctionnement normal | le chemin d'échec efface et dessine |
| 6 | Règle des 300 lignes **vérifiée par rien** | 7 fichiers l'avaient franchie | barrage `i` du hook + test |
| 7 | Conclure qu'il fallait mettre le sprite à l'échelle du **plan du nez** | raisonnement, avant codage | **faux** : la largeur se réalise aux tenons, au plan des tempes. Aurait dessiné la monture **6 % trop large** en ayant l'air meilleure. Verrouillé par un test |
| 8 | Convention de **demi-pixel** : le pixel `i` a sa valeur en `i+0,5` | les 4 coins raffinés à **0,7 px** de la vérité, stables quelle que soit l'image | un `−0,5` → **0,05 px**, 14× mieux |
| 9 | Rejet d'aberrants **à la médiane**, puis consensus « **le plus de points** » | le pouce du sujet couvre un bord ; il gagne dans les deux cas, coin à 16 px | consensus **contraint par la graine** : la droite compatible avec ce qu'on sait déjà. Un bord totalement masqué est repris du cadre |
| 10 | Constante **12 mm en dur** pour le dernier tronçon | chiffre d'adulte : +50 % sur un visage d'enfant | **proportion** de la largeur du visage |
| 11 | Convertir un problème de mesure en **contraintes de tournage** (« refilmez avec un mur uni ») | reproche direct de l'humain, justifié | les deux vraies causes corrigées : estimateur à un paramètre, détecteur de bord par croissance de région |
| 12 | Laisser la mesure **dans l'atelier** sans la brancher dans l'app | l'app calibrait encore avec les 78 cm faux | branché : `TwoPointMeasure` → quadrilatère → suivi pendant la rotation → focale → distance |

**Le fil rouge de toutes :** chacune produisait un résultat *plausible*, stable, sans rien
signaler. C'est le mode d'échec que ce projet combat, et c'est pourquoi le dépôt préfère
**refuser** plutôt que rendre un chiffre douteux.

---

## 4. Décisions figées (ne pas les rouvrir sans raison)

- **La largeur rendue du sprite est au plan des TEMPES**, jamais à celui du pont.
  `core/framePlane.ts` porte le raisonnement. Un test rougit si on y touche.
- **Aucun branchement sur `cal.source`** hors `calibration.ts`. Barrage du hook. La seule
  question légitime porte sur la **précision** (`relError`), jamais sur l'origine.
- **La présence d'une donnée décide, jamais un mode.** Distance mesurée ou non, monture
  portée connue ou non : le code ne demande pas *pourquoi* elle manque.
- **Une seule vue de carte ne suffit pas** pour la focale (±20 à 25 %) : il faut le
  balayage (±4 % sur 50 vues). Verrouillé par un test qui exige que la dispersion mono-vue
  reste **au-dessus** de 15 %.
- **Aucune étape n'est bloquante.** Tout échec élargit la marge affichée ; personne n'est
  empêché d'essayer des lunettes (§0.0.2).
- La matrice de MediaPipe ne sert **qu'à la rotation** — jamais translation ni échelle,
  qui sont dans le repère du visage canonique.
- `core/cardPose.ts` **est** un solveur de pose, ce que le §4 réservait à un feu vert
  humain. Il l'a donné (§14.5). Ce qui reste interdit n'a pas bougé : aucun maillage,
  aucun rendu 3D, aucune bibliothèque de géométrie.

---

## 5. Ce qui manque pour vendre

**Verdict : pas vendable aujourd'hui.** Quatre points, dans l'ordre.

1. **`VERTICAL_OFFSET_MM` non calibrée.** La monture se pose visiblement trop bas sur un
   vrai visage — c'est la première chose que voit un client, avant même la question de la
   taille. Exige l'œil d'un opticien sur ≥ 3 montures × ≥ 2 visages, protocole au §5 du
   contrat (médiane, dispersion < 3 mm, sinon on ne fige pas). **Un agent ne peut pas le
   faire.**
2. **Aucun client n'a jamais fait le parcours en vrai.** Tout est vérifié sur vérité
   terrain de synthèse et sur une vidéo traitée hors ligne. Inconnu : l'accrochage sur
   webcam en direct, le remplissage des tranches de rotation, la compréhension des
   consignes.
3. **L'écart temporal n'a aucune vérité terrain.** 169 mm mesurés sur un sujet ; aucun pied
   à coulisse. Si c'est faux de 5 mm, chaque légende l'est aussi, sans que rien ne le dise.
4. **Longueur de branche à ±20 %**, visible dès que la tête tourne.

Les points 1 à 3 se règlent en **une séance de trente minutes** : un opticien, un pied à
coulisse, 2–3 personnes, l'application ouverte. Aucune quantité de code ne remplace cette
séance.

**Proposition faite, non encore construite :** un *outil de séance de calibration* — une
page qui enregistre chaque parcours, confronte la mesure de l'app à la valeur au pied à
coulisse, imprime le tableau des écarts et leur dispersion, et applique le protocole du §5
(y compris son refus automatique si la dispersion est trop large).

### Autres chantiers ouverts, moindres

- Recoupement de la distance de 42,1 cm (voir §2) — **à refaire en premier**.
- Écart canthus↔sellion mesuré à 35,6 mm là où l'anatomie donne 15–20. Le yaw est innocenté
  par l'audit. Hypothèse restante : MediaPipe régularise ses repères vers son maillage
  canonique sous rotation. Non tranchable sans mesure physique.
- V2 : contrôle « aucun liseré sur monture noire » jamais fait (exige deux vraies photos et
  un vrai client).
- Tracking de la carte : démarre à la première image de la vidéo au lieu de partir de
  l'image frontale et de balayer dans les deux sens. Perd des vues inutilement.

---

## 6. Règles de travail — non négociables

1. **Plan d'abord** sur toute tâche touchant plus d'un fichier.
2. **Un commit par lot**, tests au vert. `npm test` avant chaque commit.
3. **`src/core/` est gelé** après validation d'un lot : on n'y touche que sur demande
   explicite, jamais « au passage ».
4. **Interdiction de modifier un test pour le faire passer.** Si un test échoue, ou le code
   est faux, ou le test est faux — et dans le second cas on le signale et on demande.
5. **Aucune constante magique.** Tout littéral est une norme citée, un index MediaPipe
   nommé, ou une constante exportée et documentée.
6. **Pas de refactor spontané.** Les phrases « je simplifie », « j'ai aussi corrigé »
   précèdent presque toujours une régression.
7. **Aucune dépendance nouvelle sans validation.**
8. `git diff --stat` avant chaque commit : un lot censé toucher 2 fichiers qui en modifie 9
   est un signal d'alarme.
9. Après chaque lot, écrire dans `PROGRESS.md`.
10. **Un test garde-fou qui dépend du choix d'une fixture n'est pas un garde-fou** : il doit
    balayer un domaine, jamais un point. Avant de déclarer un test « sacré » : *quelle ligne
    puis-je casser pour le faire rougir ?* Si aucune, le test est décoratif.

Le hook `.githooks/pre-commit` bloque physiquement : test désactivé, slider de taille,
dépendance 3D, vocabulaire de sélection, branchement sur la source, `img.width` dans la
mesure, transformée recomposée hors `core/transform.ts`, constante de taille en dur,
fichier > 300 lignes. **Surveiller ce fichier dans chaque diff.**

---

## 7. Où est quoi

```
src/core/            ← ZONE CRITIQUE, 100 % testée, aucune dépendance UI
  geom.ts              dist, midpoint, px, smoothstep, CalibrationError
  calibration.ts       iris / carte / monture portée → UserCalibration
                       SEUL fichier autorisé à lire `cal.source`
  cardPose.ts        ⭐ la carte comme MIRE : homographie → focale → distance
  cardEdges.ts       ⭐ accrochage des 4 coins sur les vrais bords (0,05 px)
  cardSweep.ts       ⭐ focale médiane sur tout le balayage + refus motivés
  cardRefinement.ts    orchestration : parallaxe + écart temporal
  parallax.ts          sonde de profondeur par rotation
  depthFit.ts          Theil–Sen sur les vues (l'ajustement à 2 paramètres est SUPPRIMÉ)
  framePlane.ts      ⭐ dans quel plan vit chaque grandeur rendue
  faceMetrics.ts       livePxPerMm, roll, yaw, ancre
  transform.ts         L'UNIQUE affine sprite → écran
  frameSpec.ts         cotes, bbox alpha, px/mm du sprite
  verdict.ts           légende chiffrée (ne décide de rien)
  silhouette.ts / headGrowth.ts / temporalWidth.ts   bords de tête
  ocularPrior.ts       estimateur multivarié HVID (plancher ~3,2 % : la carte reste requise)
src/render/          composite, temple, recolor (2,5 D), overlay
src/tracking/        landmarker.ts (seule lecture de la matrice MediaPipe)
src/ui/              parcours V1 et V2
tests/               139 tests + fixtures à vérité terrain (head3d.ts)
tests/v1-on-video.ts ATELIER : chaîne complète sur une vraie vidéo (hors application)
docs/                rapport d'analyse, échelle anatomique, ce fichier
```

## 8. Commandes

```bash
npm test           # 139 tests, < 3 s
npm run typecheck  # tsc --noEmit, strict
npm run build
npm run smoke      # 23 contrôles navigateur, dont la remesure des pixels peints
node scripts/v1-on-video.mjs <video.webm> <sortie>                         # relevé
node scripts/v1-on-video.mjs <video.webm> <sortie> --card x1,y1,x2,y2 \
     --t <secondes> --quad x1,y1,x2,y2,x3,y3,x4,y4                        # chaîne complète
```

⚠️ Chromium ne décode ni HEVC ni H.264 dans cet environnement : transcoder les vidéos en
**VP9/WebM** (`imageio-ffmpeg` est installable par pip).
