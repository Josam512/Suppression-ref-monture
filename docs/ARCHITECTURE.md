# Architecture — la règle de non-interférence

Quatre moteurs, découplés. Une panne de C ou D ne doit **jamais** empêcher A ou B de fonctionner.

```
A. Acquisition/Tracking   caméra → frames → FaceLandmarker → landmarks → pose
B. Rendu immédiat         landmarks + front.png → monture visible et collée au visage
C. Métrologie             iris → échelle → PD → demi-PD → largeur visage → largeur temporale
D. Diagnostic/Verdict     incertitudes → légende chiffrée → messages UI
```

## La règle, en six lignes

> **Tracking produit des poses.**
> **Rendering consomme des poses.**
> **Metrology observe les mêmes landmarks mais ne contrôle pas le rendering.**
> **PD, face width et temporal width sont des mesures indépendantes.**
> **Fit verdict ne modifie aucune mesure ni aucun rendu.**
> **Persistence ne contrôle jamais la validité de la session live.**
> **Une fonction de diagnostic n'entre jamais dans le chemin produit.**

Conséquences concrètes, toutes testées :

- pas de PD → la monture suit quand même le visage ;
- largeur temporale absente → la monture reste ;
- sprite de profil non chargé ou cassé → le frontal reste ;
- verdict impossible → le frontal reste ;
- calibration non convergée → aperçu provisoire toujours visible (« aperçu — taille en cours de mesure ») ;
- localStorage en panne → la session live continue, rien ne lève ;
- erreur de rendu d'une frame → le tracking continue à la frame suivante ;
- iris momentanément douteux → `faceTracked` reste vrai, seule `irisMetricQuality` tombe ;
- une métrique ne « sert de passage obligé » à aucune autre : le PD ne dépend pas du temporal,
  le frontal ne dépend pas du PD, le verdict ne pilote pas la taille, le profil ne pilote pas
  l'existence du frontal, la persistance ne pilote pas la session, et la sonde FaceDetector
  ne pilote pas FaceLandmarker (elle n'est plus dans le chemin produit).

## Cartographie des modules

| Moteur | Modules |
|---|---|
| A | `tracking/frameFeed.ts` (couches 1-2, watchdog), `tracking/landmarker.ts` (cache modèle), `tracking/faceLoop.ts` (orchestration, validation frontière, swap transactionnel), `tracking/detectionPlan.ts` (machine d'état temporelle) |
| B | `core/renderPose.ts` (échelle de pose, sans validation anatomique), `ui/poseFilter.ts` (One-Euro, rendu seul), `core/transform.ts`, `render/*`, `ui/renderScene.ts` |
| C | `core/autoCalibration.ts` (collecte, générations), `core/autoAssembly.ts` (assemblages séparés PD / échelle visage), `ui/measurementStore.ts` (états par métrique, survivants), `core/pupillary.ts`, `core/ocularScale.ts`, `core/temporalWidth.ts` |
| D | `core/verdict.ts` (légende, jamais une décision), `render/overlay.ts`, HUD `?hud=1` |

Les horloges sont des **durées** (ms), jamais des comptes de frames — le même code doit se
comporter pareil à 15 et à 60 fps. Les seuils de maintien, de montée de stratégie et de
tentative sont exprimés en millisecondes.

`essayage.html` (page autonome, `npm run single`) est un artefact de **démonstration** : le
produit servi reste le build Vite. Les deux sont testés par la CI (`npm run ci`), parce que
c'est l'artefact autonome que le téléphone ouvre.
