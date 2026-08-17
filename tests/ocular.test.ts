/**
 * tests/ocular.test.ts — jusqu'où la STATISTIQUE périoculaire peut descendre.
 *
 * La question posée est chiffrée : peut-on passer d'environ 3 % d'erreur
 * d'échelle à ≤ 1–1,5 %, soit ±1–2 mm sur une largeur temporale de 140 mm, en
 * combinant plusieurs dimensions périoculaires avec leur matrice de covariance ?
 *
 * Elle se tranche sans aucun sujet, parce que l'estimateur de Mahalanobis a une
 * borne d'information en forme fermée : `1/√(μᵀΣ⁻¹μ)`. Il suffit d'y injecter
 * les moyennes, écarts-types et corrélations publiés. Ces tests calculent cette
 * borne pour les cinq modèles demandés, et verrouillent les conclusions.
 *
 * ⚠️ Ce que ces tests N'ÉTABLISSENT PAS : aucune MAE, aucun percentile mesuré.
 * Ces chiffres-là exigent des sujets avec mesures physiques de référence, que ce
 * projet ne possède pas. Ce qui est établi ici est une BORNE — donc un résultat
 * négatif solide, et un résultat positif seulement conditionnel.
 */

import { describe, expect, it } from 'vitest';

import {
  covarianceOf,
  HVID,
  HVID_PFL_R,
  INTEROCULAR_R,
  PALPEBRAL_FISSURE,
  scaleBound,
  robustScaleBound,
  scaleFromOcular,
} from '../src/core/ocularPrior.js';

/** Largeur temporale typique, pour convertir les pourcentages en millimètres. */
const TEMPORAL_MM = 140;

const pct = (x: number): number => Math.round(x * 1000) / 10;

describe('borne d’information de l’estimateur d’échelle', () => {
  it('1 · HVID seul — la référence de la littérature', () => {
    const bound = scaleBound([HVID.meanMm], [[HVID.sdMm ** 2]]);
    // Exactement le coefficient de variation : 0,40 / 11,95.
    expect(bound).toBeCloseTo(HVID.sdMm / HVID.meanMm, 6);
    expect(pct(bound)).toBeCloseTo(3.3, 1);
    // Sur 140 mm de largeur temporale, cela fait ±4,7 mm.
    expect(bound * TEMPORAL_MM).toBeGreaterThan(4);
  });

  it('2 · HVID gauche + droit — le second œil n’apporte presque RIEN', () => {
    const cov = covarianceOf(
      [HVID.sdMm, HVID.sdMm],
      [
        [1, INTEROCULAR_R],
        [INTEROCULAR_R, 1],
      ],
    );
    const bound = scaleBound([HVID.meanMm, HVID.meanMm], cov);

    // Forme fermée du cas symétrique : CV × √((1+r)/2).
    expect(bound).toBeCloseTo((HVID.sdMm / HVID.meanMm) * Math.sqrt((1 + INTEROCULAR_R) / 2), 6);

    // 🔴 Le gain se chiffre à 1,5 % de l'erreur, pas à 30 %. Deux yeux d'une
    // même personne ne sont pas deux mesures : c'est presque la même, deux fois.
    const gain = 1 - bound / (HVID.sdMm / HVID.meanMm);
    expect(gain).toBeLessThan(0.02);
  });

  it('3 · HVID + fente palpébrale — la seconde variable est deux fois plus dispersée', () => {
    const sd = [HVID.sdMm, PALPEBRAL_FISSURE.sdMm];
    const mu = [HVID.meanMm, PALPEBRAL_FISSURE.meanMm];
    const bound = scaleBound(
      mu,
      covarianceOf(sd, [
        [1, HVID_PFL_R],
        [HVID_PFL_R, 1],
      ]),
    );
    // Reste au-dessus de 3 % : une variable à 6 % de CV ne tire pas vers le bas
    // une variable à 3,3 %.
    expect(pct(bound)).toBeGreaterThan(3);
  });

  it('🔴 la conclusion ne dépend PAS de la corrélation HVID ↔ fente, qui n’est pas sourcée', () => {
    // Ce garde-fou existe parce qu'un seul chiffre du modèle est inventé. On
    // balaie donc tout son domaine plausible : si la conclusion tenait à sa
    // valeur, elle ne vaudrait rien.
    const sd = [HVID.sdMm, PALPEBRAL_FISSURE.sdMm];
    const mu = [HVID.meanMm, PALPEBRAL_FISSURE.meanMm];
    for (const r of [0, 0.2, 0.4, 0.6, 0.8]) {
      const bound = scaleBound(
        mu,
        covarianceOf(sd, [
          [1, r],
          [r, 1],
        ]),
      );
      expect(pct(bound), `r=${r}`).toBeGreaterThan(2.5);
    }
  });

  it('4 · modèle complet à quatre variables — toujours au-dessus de 3 %', () => {
    // HVID gauche/droit + fente gauche/droite, avec la structure de corrélation
    // réelle : très fort entre côtés homologues, modéré entre variables.
    const sd = [HVID.sdMm, HVID.sdMm, PALPEBRAL_FISSURE.sdMm, PALPEBRAL_FISSURE.sdMm];
    const mu = [
      HVID.meanMm,
      HVID.meanMm,
      PALPEBRAL_FISSURE.meanMm,
      PALPEBRAL_FISSURE.meanMm,
    ];
    const r = HVID_PFL_R;
    const bound = scaleBound(
      mu,
      covarianceOf(sd, [
        [1, INTEROCULAR_R, r, r],
        [INTEROCULAR_R, 1, r, r],
        [r, r, 1, INTEROCULAR_R],
        [r, r, INTEROCULAR_R, 1],
      ]),
    );
    expect(pct(bound)).toBeGreaterThan(3);
    // Et donc, sur une tempe de 140 mm : plus de 4 mm.
    expect(bound * TEMPORAL_MM).toBeGreaterThan(4);
  });

  it('🔴 CE QU’IL FAUDRAIT pour atteindre 1,5 % : six variables INDÉPENDANTES aussi bonnes que le HVID', () => {
    // Le calcul à l'envers. Avec k variables de même CV et mutuellement
    // indépendantes, la borne vaut CV/√k. Pour 1,5 % à partir de 3,3 % il
    // faudrait k = 5,5 — c'est-à-dire six dimensions périoculaires aussi peu
    // dispersées que le diamètre cornéen ET sans corrélation entre elles.
    // Aucune n'existe : la seconde meilleure candidate est deux fois pire, et
    // toutes les dimensions d'un même visage sont corrélées entre elles.
    const cv = HVID.sdMm / HVID.meanMm;
    const identite = (k: number): number[][] =>
      Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)));

    for (const k of [1, 2, 4, 6]) {
      const bound = scaleBound(
        Array.from({ length: k }, () => HVID.meanMm),
        covarianceOf(
          Array.from({ length: k }, () => HVID.sdMm),
          identite(k),
        ),
      );
      expect(bound).toBeCloseTo(cv / Math.sqrt(k), 6);
    }

    const k = Math.ceil((cv / 0.015) ** 2);
    expect(k).toBeGreaterThanOrEqual(5);
  });

  it('🔴 et une corrélation de 0,91 avec les proportions faciales pour PRÉDIRE le HVID', () => {
    // Modèle 5 de la liste : prédire le HVID individuel depuis les proportions
    // faciales. Prédire réduit l'écart-type résiduel d'un facteur √(1−R²).
    // Pour passer de 3,3 % à 1,5 %, il faut R² = 1 − (1,5/3,3)² soit R = 0,90.
    const cv = HVID.sdMm / HVID.meanMm;
    const rNeeded = Math.sqrt(1 - (0.015 / cv) ** 2);
    expect(rNeeded).toBeGreaterThan(0.88);

    // Et une corrélation plausible (0,5) ne fait passer que de 3,3 % à 2,9 %.
    const residual = cv * Math.sqrt(1 - 0.5 ** 2);
    expect(pct(residual)).toBeGreaterThan(2.8);
  });
});

describe('l’estimateur lui-même', () => {
  it('retrouve l’échelle exacte d’un sujet parfaitement moyen', () => {
    // Un sujet dont toutes les dimensions valent la moyenne : l'estimateur
    // doit rendre l'échelle vraie au bit près, quelle que soit la covariance.
    const mmPerPx = 0.05;
    const mu = [HVID.meanMm, PALPEBRAL_FISSURE.meanMm];
    const pixels = mu.map((m) => m / mmPerPx);
    const cov = covarianceOf(
      [HVID.sdMm, PALPEBRAL_FISSURE.sdMm],
      [
        [1, HVID_PFL_R],
        [HVID_PFL_R, 1],
      ],
    );
    expect(scaleFromOcular(pixels, mu, cov).mmPerPx).toBeCloseTo(mmPerPx, 9);
  });

  it('🔴 pondère par la covariance, pas par le nombre de variables', () => {
    // Un sujet dont le HVID est moyen mais la fente 2 SD au-dessus. Un simple
    // moyennage suivrait la fente ; l'estimateur, lui, doit rester proche du
    // HVID, qui est deux fois moins dispersé.
    const mmPerPx = 0.05;
    const mu = [HVID.meanMm, PALPEBRAL_FISSURE.meanMm];
    const cov = covarianceOf(
      [HVID.sdMm, PALPEBRAL_FISSURE.sdMm],
      [
        [1, 0],
        [0, 1],
      ],
    );
    const pixels = [
      HVID.meanMm / mmPerPx,
      (PALPEBRAL_FISSURE.meanMm + 2 * PALPEBRAL_FISSURE.sdMm) / mmPerPx,
    ];

    const gls = scaleFromOcular(pixels, mu, cov).mmPerPx;
    const naif = (mu[0]! / pixels[0]! + mu[1]! / pixels[1]!) / 2;

    const errGls = Math.abs(gls - mmPerPx);
    const errNaif = Math.abs(naif - mmPerPx);
    expect(errGls).toBeLessThan(errNaif);
  });
});

/**
 * ⭐ Le conditionnement de Σ ne doit JAMAIS pouvoir fabriquer de l'information.
 *
 * Défaut trouvé en auditant la borne : à corrélation élevée, Σ⁻¹ extrait un
 * contraste de variance quasi nulle et la borne s'effondre sous les 1,4 % —
 * mieux que la carte, alors qu'aucune information n'a été ajoutée. C'est le
 * mode d'échec du dépôt : plausible, stable, faux, silencieux.
 */
describe('la borne ne se laisse pas fabriquer par le conditionnement', () => {
  const quatuor = (r: number): { mean: number[]; sd: number[]; corr: number[][] } => ({
    mean: [HVID.meanMm, HVID.meanMm, PALPEBRAL_FISSURE.meanMm, PALPEBRAL_FISSURE.meanMm],
    sd: [HVID.sdMm, HVID.sdMm, PALPEBRAL_FISSURE.sdMm, PALPEBRAL_FISSURE.sdMm],
    corr: [
      [1, INTEROCULAR_R, r, r],
      [INTEROCULAR_R, 1, r, r],
      [r, r, 1, INTEROCULAR_R],
      [r, r, INTEROCULAR_R, 1],
    ],
  });

  it('la borne NAÏVE s’effondre à corrélation élevée — le défaut, documenté', () => {
    const q = quatuor(0.95);
    // On verrouille le défaut lui-même : si un jour il disparaît, il faut le
    // savoir, parce que c'est ce qui justifie l'existence de robustScaleBound.
    expect(scaleBound(q.mean, covarianceOf(q.sd, q.corr))).toBeLessThan(0.02);
  });

  it('GARDE-FOU : la borne DÉFENDABLE refuse ce même cas', () => {
    const q = quatuor(0.95);
    expect(robustScaleBound(q.mean, q.sd, q.corr)).toBe(Infinity);
  });

  it('sur le domaine défendable, elle ne descend pas sous 4 mm — la carte gagne', () => {
    // Balayage, pas un point : c'est la règle du §11.4 sur les garde-fous.
    //
    // ⚠️ Le seuil est en MILLIMÈTRES, pas en pourcents, et c'est délibéré. Une
    // première rédaction affirmait « au-dessus de 3 % » : mesure faite, la borne
    // vaut 2,99 % à corrélation nulle. C'est le test qui était faux, pas le
    // code — et le pourcentage n'était de toute façon pas la grandeur qui
    // tranche. Ce qui décide, c'est l'écart en millimètres face au seuil de
    // lecture de 3 à 5 mm du §5 : 4,2 mm au mieux, la carte reste requise.
    for (const r of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
      const q = quatuor(r);
      const b = robustScaleBound(q.mean, q.sd, q.corr);
      expect(b, `r=${r}`).toBeGreaterThan(0.029);
      expect(b * TEMPORAL_MM, `r=${r}`).toBeGreaterThan(4);
    }
  });

  it('elle est toujours PIRE ou égale à la borne naïve : c’est un pire cas', () => {
    for (const r of [0, 0.2, 0.4, 0.6]) {
      const q = quatuor(r);
      expect(robustScaleBound(q.mean, q.sd, q.corr)).toBeGreaterThanOrEqual(
        scaleBound(q.mean, covarianceOf(q.sd, q.corr)) - 1e-12,
      );
    }
  });
});
