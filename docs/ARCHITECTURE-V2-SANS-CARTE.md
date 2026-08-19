# ARCHITECTURE V2 — calibration sans carte

> Rédigé APRÈS `AUDIT-RUNTIME-V2.md` et `ETAT-DE-L-ART-METROLOGIE-FACIALE.md`,
> comme la mission l'exige. Ce document décrit mathématiquement le pipeline
> retenu, sa machine à états, son modèle d'incertitude, et ce qui vient de qui :
> **MESURÉ / DÉDUIT / PRÉDIT / PRIOR / HYPOTHÈSE / NON DÉMONTRÉ**.

---

## 1. Pourquoi CE pipeline

L'état de l'art (§14) est sans ambiguïté : en RGB pur, sans objet externe et
dans un navigateur, la seule ancre d'échelle qui soit à la fois **individuelle,
stable dès 3 ans, indépendante de la morphologie et lisible par MediaPipe** est
la région périoculaire — diamètres d'iris en tête. Les alternatives sérieuses
échouent chacune sur un critère éliminatoire :

- profondeur monoculaire apprise : 5–15 % d'erreur d'échelle, et un prior de
  taille de visage enfoui (circularité interdite au contrat §4) ;
- MICA (~1–2 mm, statistique) : licence non commerciale, hors navigateur,
  biais enfants non caractérisés ;
- priors faciaux (zy-zy, eu-eu) : n'apportent que 10–15 % de réduction de
  variance sur le PD, et sont faux de ~20 % sur les enfants ;
- rotation de tête seule : aucune échelle (théorème de la similitude).

Le pipeline retenu est donc : **iris + fente palpébrale gatée (prior multivarié
avec covariance et borne en pire cas) × agrégation temporelle robuste ×
corrections géométriques déduites (convergence, plan) × focale mesurée quand
elle existe** — et la carte ISO conservée comme mode diagnostic/vérité terrain.

## 2. La machine à états (mission §45 — appliquée à la lettre)

```
                    ┌──────────────────────────────────────────────┐
   caméra ouverte   │  AutoCalibrationEngine (core/autoCalibration) │
   (jamais coupée)  │                                              │
        │           │  collecting ──succès──▶ calibrated ──────────┼──▶ essayage
        ▼           │      │                     ▲    (annoncé :   │    (caméra
   frames 30–60/s ──┼──▶ offer(lm|null, yaw,     │  « calibration  │     toujours
                    │      roll, w, h, nowMs)    │    acquise »)   │     active)
                    │      │                     │                 │
                    │      ├─ timeout, ≥12 utiles┘ (degraded=true) │
                    │      └─ timeout, <12 ──▶ failed(raison       │
                    │                          dominante)──▶ retry │
                    └──────────────────────────────────────────────┘
```

- **État initial** : `collecting`, horloge injectée (moteur pur, testable).
- **Condition de réussite** : `usableFrames ≥ 30` ET `elapsed ≥ 2 s` ET
  erreur-type de la médiane d'échelle ≤ 0,5 % (MAD/√n).
- **Condition d'échec** : `elapsed ≥ 20 s` avec < 12 frames utiles →
  `failed(raison dominante des rejets)`.
- **Dégradation** : `elapsed ≥ 20 s` avec ≥ 12 frames → `calibrated` avec
  `degraded = true`, marge élargie, et c'est DIT.
- **Verrou** : une seule transition ; les frames offertes après coup sont des
  no-ops (testé).
- **Cleanup / séparation caméra-collecte** : `live.auto = null` à la
  conclusion — `calibrationCollecting` s'éteint, `cameraRunning` ne change pas,
  `tryOnRunning` s'allume. Les trois booléens du §6 de la mission existent
  désormais réellement.
- **WHY_NOT_DONE** : `status()` rend à tout instant la première raison
  bloquante (`no-face`, `eyes-too-small`, `turn-to-front`, `straighten-head`,
  `need-more-frames n/30`, `unstable-scale`) — affichée en continu par
  `ui/AutoCalibrationStep.tsx`, vérifiée par le banc navigateur.

## 3. Les formules, étage par étage

### 3.1 Échelle au plan des yeux — `core/ocularScale.ts`

Vecteur observé par frame (MESURÉ, pixels) : `P = [HVID_G, HVID_D, PFL_G, PFL_D]`.
Prior (PRIOR, mm) : `μ = [11,71 ; 11,71 ; 30,9 ; 30,9]`,
`σ = [0,50 ; 0,50 ; 1,9 ; 1,9]`, corrélations : interoculaire 0,94 (ICC publié),
HVID↔PFL 0,30 ± 0,05 (non sourcée — traitée en pire cas).

Estimateur de Mahalanobis (échelle s en mm/px) :

```
ŝ = (PᵀΣ⁻¹μ) / (PᵀΣ⁻¹P)          Σ = diag(σ)·R·diag(σ)
```

Borne d'information (erreur relative minimale de tout estimateur sur ces
variables) : `1/√(μᵀΣ⁻¹μ)`, prise en **pire cas** sur R ± 0,05
(`robustScaleBound`) : **≈ 3,2 %** à 4 traits, **≈ 4,2 %** iris seuls.

**Gating anti-biais enfant** : la PFL n'entre que si
`|PFL_px·ŝ_iris − 30,9| ≤ 2σ_adulte` — une fente immature (enfants < 8–11 ans)
ou un œil mi-clos retombe sur les iris seuls, plus large mais jamais biaisé.

⚠️ `σ_HVID = 0,50` élargit volontairement le 0,42 intra-population européenne :
les moyennes publiées s'étalent de 11,10 (Japon) à 11,95 mm (Arabie saoudite).
Annoncer 0,42 serait présenter un prior européen comme universel (interdit).

### 3.2 Agrégation temporelle — `core/autoCalibration.ts`

Sur les frames gatées (|yaw| ≤ 8°, |roll| ≤ 15°, iris ≥ 8 px) :
médiane des `ŝ`, dispersion par MAD ; erreur-type relative
`SE = 1,4826·MAD/√n / médiane`. La médiane tue le bruit de détection en 1/√n ;
**elle ne touche pas au biais du prior** — l'incertitude annoncée ne descend
jamais sous la borne de §3.1 (testé).

### 3.3 Distance caméra — DÉDUIT (ou HYPOTHÈSE encadrée)

```
D = f_px × 11,71 / hvid_px
```

`f_px` vient du `CameraProfile` **mesuré** par une séance carte antérieure
(±3–12 %) quand il existe et n'est pas périmé ; sinon d'un champ supposé de 70°
(HYPOTHÈSE, ±30 %, couvrant 57–90°). D n'entre que dans des termes du second
ordre : ±30 % dessus coûtent < 0,1 mm sur le PD et ~±2,7 % sur la correction de
plan — chiffré, pas espéré.

### 3.4 Écart pupillaire — `core/pupillary.ts`

```
PD_near = ‖iris_468 − iris_473‖_px × ŝ                    (MESURÉ × PRIOR)
PD_loin = PD_near × (D + 13,5) / (D + 3,05)               (DÉDUIT — convergence)
PD_G/D  = découpage au pied du sellion PROJETÉ sur la     (MESURÉ)
          droite des pupilles (jamais un mélange d'axes)
σ_PD    = √( σ_prior² + SE² + σ_convergence² )
```

Points forts : iris et pupilles sont coplanaires au premier ordre → le rapport
PD/iris est **invariant à la distance** (testé : 35 cm vs 70 cm → même PD).
La correction de convergence (13,5 mm = cornée→centre de rotation, 3,05 mm =
cornée→pupille d'entrée, optique de Gullstrand) vaut +2,1 mm à 30 cm, +1,1 mm à
60 cm — un biais systématique que la plupart des apps RGB ignorent.
HYPOTHÈSE déclarée : le client fixe (à peu près) la caméra.

### 3.5 Largeur du visage au plan des tempes — `core/autoCalibrate.ts`

Les repères 234/454 vivent ~45 mm derrière le plan des yeux ; l'échelle varie
en 1/z :

```
W_234↔454 = W_px × ŝ × (1 + δz/D)      δz = 45 ± 12 mm    (HYPOTHÈSE dérivée
σ_W       = √( σ_prior² + SE² + [ (δz/D)·√((σδz/δz)² + (σD/D)²) ]² )
```

δz est dérivé de `CARD_TO_TEMPLE_DEPTH_MM = 57 ± 8` (MESURÉ sur sujet réel via
la carte, ce dépôt) moins le recul cornée↔plan du front (~12 ± 9, anatomie).
Sans cette correction, la largeur serait sous-estimée de ~9 % à 50 cm — c'est le
biais B4 de la carte, que la V1 iris laissait entier. Testé sur vérité terrain
synthétique : erreur < 3 % là où l'ancien chemin en faisait ~9.

**Étape suivante (définie, non câblée)** : quand le client tourne la tête, la
machinerie existante `temporalWidth` (silhouette + masque de mouvement) devient
utilisable avec l'échelle iris — la largeur temporale passe alors de
DÉDUIT+HYPOTHÈSE à MESURÉ, et `temporalWidthMm` supplante la correction de plan
comme en V1-carte. La rotation reste facultative : elle resserre, elle ne
conditionne jamais la fin de la calibration.

### 3.6 Plausibilité — détecteurs de panne, jamais critères d'éligibilité

`W ∈ [95 ; 175] mm` (inchangé, B5) ; `PD ∈ [40 ; 80] mm` (enfant de 3 ans →
adulte hors norme). Hors plage → `CalibrationError` avec cause probable — le
seul cas où recommencer répare.

## 4. Ce qui vient d'où (récapitulatif exigé)

| Terme | Provenance |
|---|---|
| pixels d'iris, de fentes, de pupilles, de contour | MESURÉ sur le client |
| moyennes/SD/corrélations périoculaires | PRIOR anthropométrique (sourcé, annexes 01–02) |
| échelle ŝ | MESURÉ × PRIOR (borne en pire cas) |
| correction de convergence | DÉDUIT (géométrie oculaire classique) |
| distance D | DÉDUIT (iris + focale mesurée) ou HYPOTHÈSE (champ 70° ± 30 %) |
| correction de plan yeux→tempes | HYPOTHÈSE dérivée d'une mesure de ce dépôt (45 ± 12 mm) |
| incertitudes affichées | propagation de tout ce qui précède, PAR CLIENT |
| précision réelle sur sujets | NON DÉMONTRÉ — protocole défini (état de l'art §16) |

## 5. Précision : théorique vs annoncée vs démontrée

- **Théorique (borne du prior)** : 3,2–4,2 % d'échelle → PD ±2,0–2,6 mm (1σ),
  largeur ±4,5–7,5 mm selon focale connue ou non.
- **Annoncée au client** : l'incertitude PROPRE à sa séance (σ ci-dessus),
  jamais tronquée, jamais sous la borne — ex. « 63,1 mm ± 2,7 mm ».
- **Démontrée** : sur vérité terrain synthétique uniquement (tests) : PD < 1 mm
  en scène idéale, invariance à la distance, anti-biais enfant. Sur sujets
  réels : RIEN ENCORE — c'est écrit, et le protocole est prêt.
- **≤ 1 mm n'est pas promis** : hors de portée du RGB pur sans référence
  (état de l'art §3.2). La carte diagnostic reste le chemin vers ~1–2 mm.

## 6. Ce que la V2 ne change PAS

- La chaîne aval entière (frameMetrics → transform → render → verdict) : elle
  reçoit un `UserCalibration` et ne sait pas d'où il vient (§11.4 intact —
  aucun branchement sur `source`, barrages inchangés).
- Le mode diagnostic carte : parcours 2026-08-18 conservé tel quel (séance
  filmée, arrêt par le client, assemblage sans cul-de-sac) ; son
  `CameraProfile` nourrit la V2.
- Le mode magasin (monture portée) : inchangé.
- Les interdits : aucun slider, aucune 3D, aucun tri, aucune constante de
  taille de visage — l'étalon est oculaire, pas facial, précisément parce que
  c'est le seul qui ne présuppose pas la taille du visage.

## 7. Fichiers

| Fichier | Rôle | Lignes |
|---|---|---|
| `core/ocularScale.ts` | échelle périoculaire (prior multivarié + gating) | ~185 |
| `core/pupillary.ts` | PD, demi-écarts, convergence, distance | ~120 |
| `core/autoCalibration.ts` | machine à états, WHY_NOT_DONE, agrégation | ~270 |
| `core/autoCalibrate.ts` | assemblage → UserCalibration (+ PD), notes | ~135 |
| `ui/useAutoCalibration.ts` | câblage IHM (start / pump / annonce de fin) | ~95 |
| `ui/AutoCalibrationStep.tsx` | affichage WHY_NOT_DONE, échec, boutons | ~75 |
| `core/ocularPrior.ts` | (existant, dormant → branché) Mahalanobis + bornes | 252 |
| tests | `autocal`, `ocularscale`, `livesteps` (+ fixtures iris) | 24 tests |
