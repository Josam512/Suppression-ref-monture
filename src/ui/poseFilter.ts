/**
 * ui/poseFilter.ts — le filtre temporel de POSE (guide, points 47–49).
 *
 * ## Frontière absolue (complément 32)
 *
 * Ce filtre ne s'applique qu'aux grandeurs de RENDU : x, y, échelle, roll,
 * yaw. La métrologie lit les landmarks BRUTS — un filtre visuel qui entrerait
 * dans les samples introduirait un biais temporel dans le PD et la largeur.
 * C'est pourquoi il vit dans `ui/`, pas dans `core/`.
 *
 * ## One-Euro
 *
 * Filtre de Casiez et al. (CHI 2012) : passe-bas dont la fréquence de coupure
 * MONTE avec la vitesse. Immobile → coupure basse → le tremblement disparaît ;
 * en mouvement → coupure haute → latence quasi nulle, la monture ne « flotte »
 * pas derrière la tête (point 48).
 *
 * ## Reprise après perte (point 48) et fort yaw (complément 35)
 *
 * Une perte plus longue que `RESET_AFTER_MS` réinitialise le filtre : sinon la
 * monture GLISSERAIT depuis son ancienne position vers la nouvelle. Et
 * au-delà du yaw exploitable, l'appelant cesse de nourrir l'échelle : le
 * filtre TIENT la dernière valeur sûre au lieu de laisser 234/454 la faire
 * respirer.
 */

/** Perte au-delà de laquelle le filtre repart à neuf (durée, pas frames). */
export const RESET_AFTER_MS = 300;

/** Réglages One-Euro — communs aux cinq grandeurs, homogènes au geste de tête. */
export const ONE_EURO_MIN_CUTOFF_HZ = 1.2;
export const ONE_EURO_BETA = 0.012;
export const ONE_EURO_D_CUTOFF_HZ = 1.0;

class OneEuro {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrevMs: number | null = null;

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrevMs = null;
  }

  /** Dernière sortie, ou null si jamais nourri depuis le reset. */
  last(): number | null {
    return this.xPrev;
  }

  filter(x: number, tMs: number): number {
    if (this.xPrev === null || this.tPrevMs === null || tMs <= this.tPrevMs) {
      this.xPrev = x;
      this.tPrevMs = tMs;
      this.dxPrev = 0;
      return x;
    }
    const dt = (tMs - this.tPrevMs) / 1000;
    this.tPrevMs = tMs;

    const alphaFor = (cutoffHz: number): number => {
      const tau = 1 / (2 * Math.PI * cutoffHz);
      return 1 / (1 + tau / dt);
    };

    const dx = (x - this.xPrev) / dt;
    const aD = alphaFor(ONE_EURO_D_CUTOFF_HZ);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxHat;

    const cutoff = ONE_EURO_MIN_CUTOFF_HZ + ONE_EURO_BETA * Math.abs(dxHat);
    const a = alphaFor(cutoff);
    const out = a * x + (1 - a) * this.xPrev;
    this.xPrev = out;
    return out;
  }
}

export interface RawPose {
  x: number;
  y: number;
  rollRad: number;
  yawRad: number;
  /** Échelle de CETTE frame, ou null → le filtre tient la dernière connue. */
  scalePxPerMm: number | null;
}

export interface FilteredPose {
  x: number;
  y: number;
  rollRad: number;
  yawRad: number;
  scalePxPerMm: number;
}

export class PoseFilter {
  private readonly fx = new OneEuro();
  private readonly fy = new OneEuro();
  private readonly fRoll = new OneEuro();
  private readonly fYaw = new OneEuro();
  private readonly fScale = new OneEuro();
  private lastFedMs: number | null = null;

  /** À appeler quand la détection est perdue : arme le reset temporel. */
  noteLossAt(nowMs: number): void {
    if (this.lastFedMs !== null && nowMs - this.lastFedMs > RESET_AFTER_MS) this.resetAll();
  }

  private resetAll(): void {
    this.fx.reset();
    this.fy.reset();
    this.fRoll.reset();
    this.fYaw.reset();
    this.fScale.reset();
    this.lastFedMs = null;
  }

  /** L'échelle courante du filtre — ce que le rendu utilisera si la frame n'en apporte pas. */
  heldScale(): number | null {
    return this.fScale.last();
  }

  /**
   * Filtre la pose de la frame. Rend `null` tant qu'AUCUNE échelle n'a jamais
   * été vue : sans échelle, il n'y a rien d'honnête à dessiner.
   */
  apply(raw: RawPose, nowMs: number): FilteredPose | null {
    if (this.lastFedMs !== null && nowMs - this.lastFedMs > RESET_AFTER_MS) this.resetAll();
    this.lastFedMs = nowMs;

    const scale =
      raw.scalePxPerMm !== null && Number.isFinite(raw.scalePxPerMm) && raw.scalePxPerMm > 0
        ? this.fScale.filter(raw.scalePxPerMm, nowMs)
        : this.fScale.last();
    if (scale === null) return null;

    return {
      x: this.fx.filter(raw.x, nowMs),
      y: this.fy.filter(raw.y, nowMs),
      rollRad: this.fRoll.filter(raw.rollRad, nowMs),
      yawRad: this.fYaw.filter(raw.yawRad, nowMs),
      scalePxPerMm: scale,
    };
  }
}
