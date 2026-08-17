/**
 * core/ocularPrior.ts — l'échelle estimée par la STATISTIQUE périoculaire.
 *
 * ## Ce que ce fichier fait, et ce qu'il ne fera jamais
 *
 * Il implémente l'estimateur demandé : `ŝ = argmin_s (sP − μ)ᵀ Σ⁻¹ (sP − μ)`,
 * avec la matrice de covariance COMPLÈTE — donc sans jamais supposer que les
 * deux yeux, ni les différentes dimensions d'un même visage, sont indépendants.
 *
 * Et il calcule surtout la seule chose qui tranche la question posée : la
 * **borne d'information** de cet estimateur. Elle a une forme fermée
 * (`scaleBound` ci-dessous) et elle dit, avant tout essai clinique, ce qu'aucune
 * combinaison de ces variables ne pourra jamais dépasser.
 *
 * 🔴 Il n'entre PAS dans la chaîne de mesure de la V1. La carte y donne une
 * référence physique à 0,1 % ; aucune statistique anatomique n'en approche.
 * Sa place est celle du contrôle de cohérence : détecter une carte mal pointée
 * (`core/crossCheck.ts`), et servir de repli déclaré quand il n'y a pas de carte.
 */

/**
 * Une dimension périoculaire utilisable comme étalon statistique.
 *
 * ⚠️ L'écart pupillaire n'y figure pas, délibérément : sa dispersion
 * interindividuelle est bien plus grande que celle du diamètre cornéen, et il
 * varie avec la vergence du regard. Ni la largeur du nez, ni celle de la
 * bouche, ni celle du visage : ce sont des dimensions de croissance, corrélées
 * entre elles et à la taille du corps — c'est-à-dire tout ce que le §0.0.3
 * interdit de supposer.
 */
export interface OcularFeature {
  key: string;
  /** Moyenne populationnelle, en mm. */
  meanMm: number;
  /** Écart-type interindividuel, en mm. */
  sdMm: number;
  /** D'où viennent ces deux nombres. Jamais de valeur sans provenance. */
  source: string;
}

/**
 * Diamètre cornéen horizontal visible (HVID / white-to-white), un œil.
 *
 * La cornée atteint sa taille adulte vers 3 ans et cesse ensuite de suivre la
 * croissance du crâne : c'est précisément ce qui en fait un bon étalon absolu
 * — sa valeur ne dépend pas de la taille du visage — et un mauvais candidat à
 * la prédiction par les proportions faciales, pour exactement la même raison.
 */
export const HVID: OcularFeature = {
  key: 'hvid',
  meanMm: 11.95,
  sdMm: 0.4,
  source: 'Pentacam AXL, population adulte saoudienne : 11,95 ± 0,39 mm',
};

/**
 * Longueur de fente palpébrale, endocanthion → exocanthion, un œil.
 *
 * Deux fois plus dispersée que le HVID en valeur relative : 6 % contre 3,3 %.
 * C'est ce rapport, et non une préférence, qui décide de son poids.
 */
export const PALPEBRAL_FISSURE: OcularFeature = {
  key: 'pfl',
  meanMm: 30.9,
  sdMm: 1.9,
  source: 'photogrammétrie adulte : 30,91 ± 1,82 mm (H), 29,62 ± 2,21 mm (F)',
};

/**
 * Corrélation interoculaire du diamètre cornéen — la valeur qui décide de
 * l'apport du second œil.
 *
 * Mesurée entre 0,87 et 0,98 selon les études (ICC 0,94–0,98). Deux yeux d'une
 * même personne ne sont pas deux mesures indépendantes : ce sont presque la
 * même mesure faite deux fois.
 */
export const INTEROCULAR_R = 0.94;

/**
 * Corrélation HVID ↔ fente palpébrale, même œil.
 *
 * ⚠️ VALEUR NON SOURCÉE — aucune étude trouvée la publiant. Elle est ici pour
 * que la borne se calcule, et le calcul est fait sur une PLAGE, jamais sur ce
 * seul nombre. Toute conclusion qui dépendrait de sa valeur exacte serait à
 * rejeter ; on vérifiera qu'aucune n'en dépend.
 */
export const HVID_PFL_R = 0.3;

/**
 * Borne d'information de l'estimateur de Mahalanobis, en erreur RELATIVE.
 *
 * ## D'où elle sort
 *
 * L'estimateur `ŝ = argmin_s (sP − μ)ᵀΣ⁻¹(sP − μ)` a la forme fermée
 * `ŝ = (PᵀΣ⁻¹μ) ÷ (PᵀΣ⁻¹P)`. En écrivant les vraies dimensions du sujet
 * `X = μ + e` avec `e ~ N(0, Σ)`, un développement au premier ordre donne
 *
 *     ŝ ÷ s₀ ≈ 1 − (eᵀΣ⁻¹μ) ÷ (μᵀΣ⁻¹μ)   d'où   Var(ŝ ÷ s₀) = 1 ÷ (μᵀΣ⁻¹μ)
 *
 * L'erreur relative d'échelle vaut donc exactement **1/√(μᵀΣ⁻¹μ)**. C'est une
 * borne : aucune pondération de ces mêmes variables ne fera mieux, puisque
 * c'est l'information de Fisher du problème.
 *
 * ## Ce que ça permet de trancher sans aucun essai clinique
 *
 * Il suffit d'y injecter les moyennes et la covariance publiées pour savoir
 * si 1–1,5 % est atteignable. Une variable très corrélée aux autres n'ajoute
 * presque rien : c'est la matrice, pas le nombre de variables, qui décide.
 */
export function scaleBound(meanMm: readonly number[], covariance: readonly number[][]): number {
  const inv = invert(covariance);
  let q = 0;
  for (let i = 0; i < meanMm.length; i++) {
    for (let j = 0; j < meanMm.length; j++) {
      q += (meanMm[i] ?? 0) * (inv[i]?.[j] ?? 0) * (meanMm[j] ?? 0);
    }
  }
  return q > 0 ? 1 / Math.sqrt(q) : Infinity;
}

/**
 * Estimateur d'échelle en mm par pixel.
 *
 * @param pixels dimensions observées, en pixels, dans le MÊME ordre que `meanMm`.
 * @returns l'échelle et l'erreur relative que cette combinaison peut atteindre.
 */
export function scaleFromOcular(
  pixels: readonly number[],
  meanMm: readonly number[],
  covariance: readonly number[][],
): { mmPerPx: number; relError: number } {
  const inv = invert(covariance);
  let pm = 0;
  let pp = 0;
  for (let i = 0; i < pixels.length; i++) {
    for (let j = 0; j < pixels.length; j++) {
      const c = inv[i]?.[j] ?? 0;
      pm += (pixels[i] ?? 0) * c * (meanMm[j] ?? 0);
      pp += (pixels[i] ?? 0) * c * (pixels[j] ?? 0);
    }
  }
  return {
    mmPerPx: pp > 0 ? pm / pp : NaN,
    relError: scaleBound(meanMm, covariance),
  };
}

/** Matrice de covariance depuis des écarts-types et une matrice de corrélation. */
export function covarianceOf(
  sd: readonly number[],
  correlation: readonly number[][],
): number[][] {
  return sd.map((si, i) => sd.map((sj, j) => si * sj * (correlation[i]?.[j] ?? 0)));
}

/** Inversion de Gauss-Jordan. Les matrices en jeu font 2 à 6 lignes. */
function invert(m: readonly number[][]): number[][] {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r]?.[col] ?? 0) > Math.abs(a[pivot]?.[col] ?? 0)) pivot = r;
    }
    const pr = a[pivot];
    const cr = a[col];
    if (pr === undefined || cr === undefined) return [];
    a[pivot] = cr;
    a[col] = pr;

    const row = a[col];
    if (row === undefined) return [];
    const p = row[col] ?? 0;
    if (Math.abs(p) < 1e-15) return [];
    for (let j = 0; j < 2 * n; j++) row[j] = (row[j] ?? 0) / p;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const other = a[r];
      if (other === undefined) continue;
      const f = other[col] ?? 0;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) other[j] = (other[j] ?? 0) - f * (row[j] ?? 0);
    }
  }
  return a.map((row) => row.slice(n));
}
