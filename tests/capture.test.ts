/**
 * tests/capture.test.ts — la séance filmée, décidée par le client.
 *
 * > « fais juste une vidéo où j'ai la main pour me montrer de face et de profil,
 * > et que JE décide moi quand la vidéo est finie » — arbitrage du 2026-08-18.
 *
 * Deux propriétés à verrouiller, et elles sont de nature différente :
 *
 *   1. **Rien ne s'arrête tout seul.** La récolte continue tant que le client
 *      filme, y compris après que la machine aurait jugé en avoir « assez ».
 *   2. **Rien ne renvoie à la case départ.** Une carte pointée produit toujours
 *      une calibration ; un raffinement manqué élargit la marge et le dit.
 *
 * ⚠️ Ce fichier remplace `tests/guide.test.ts`, supprimé avec le cadre à remplir
 * et son verrouillage automatique. Les trois derniers tests en sont repris tels
 * quels : ils portent sur un seuil MESURÉ sur la séquence réelle du sujet, et
 * cette mesure garde sa valeur même si le cadre, lui, n'existe plus.
 */

import { describe, expect, it } from 'vitest';

import { assembleCardCalibration, type PointedCard } from '../src/core/cardAssembly.js';
import { MIN_GUIDE_EDGE_STEP } from '../src/core/edgeStep.js';
import { CalibrationError } from '../src/core/geom.js';
import { MIN_SWEEP_VIEWS } from '../src/core/cardSweep.js';
import { PROFILE_MAX_AGE_MS, type CameraProfile } from '../src/core/cameraProfile.js';
import type { CardQuad } from '../src/core/cardPose.js';
import type { ImageBuffer } from '../src/core/silhouette.js';
import { MAX_SWEEP_QUADS, RotationProbe } from '../src/ui/rotationProbe.js';
import {
  ADULTE,
  cardCornersPx,
  cardDistanceMm,
  cardWidthPx,
  projectHead,
  type CameraOptions,
} from './fixtures/head3d.js';

const W = 1280;
const H = 720;
const NOW = 1_760_000_000_000;

const cam = (over: Partial<CameraOptions> = {}): CameraOptions => ({
  yawRad: 0,
  distanceMm: 500,
  w: W,
  h: H,
  ...over,
});

/** La carte telle que le client l'a pointée, sur la vue de face. */
function pointed(opts = cam()): PointedCard {
  return {
    cardWidthPx: cardWidthPx(ADULTE, opts),
    quad: cardCornersPx(ADULTE, opts) as unknown as CardQuad,
    lm: projectHead(ADULTE, opts).lm,
    w: W,
    h: H,
  };
}

/**
 * Le balayage tel qu'il se produit réellement : le client tourne la tête et la
 * carte reste en main, donc elle est relevée sur beaucoup d'images.
 */
function sweepQuads(count: number): CardQuad[] {
  return Array.from({ length: count }, (_, i) => {
    // Un aller-retour lent, comme la consigne le demande.
    const yawRad = 0.45 * Math.sin((2 * Math.PI * i) / count);
    return cardCornersPx(ADULTE, cam({ yawRad })) as unknown as CardQuad;
  });
}

describe('une carte pointée produit TOUJOURS une calibration', () => {
  it('même si le client appuie sur « J’ai fini » immédiatement', () => {
    const out = assembleCardCalibration(pointed(), { quads: [], views: null, scene: null }, null, NOW);
    expect(out.cal.faceWidthMm).toBeGreaterThan(0);
    expect(out.cal.relError).toBeGreaterThan(0);
  });

  it('…et elle DIT que la distance n’a pas été mesurée, au lieu de le taire', () => {
    const out = assembleCardCalibration(pointed(), { quads: [], views: null, scene: null }, null, NOW);
    expect(out.notes.join(' ')).toMatch(/distance non mesurée/i);
  });

  it('même quand les repères n’ont pas pu être accrochés sur les bords', () => {
    const card = { ...pointed(), quad: null };
    const out = assembleCardCalibration(card, { quads: [], views: null, scene: null }, null, NOW);
    expect(out.cal.faceWidthMm).toBeGreaterThan(0);
  });

  /**
   * 🔴 Le seul refus qui subsiste, et il est réparable : les repères n'étaient
   * pas sur la carte. Tout le reste — focale, parallaxe, silhouette — est
   * facultatif, et le rester est la garantie qui remplace l'ancien cul-de-sac.
   */
  it('SEUL refus : des repères posés ailleurs que sur la carte', () => {
    const absurde = { ...pointed(), cardWidthPx: 20 }; // 85,6 mm tenant en 20 px
    expect(() =>
      assembleCardCalibration(absurde, { quads: [], views: null, scene: null }, null, NOW),
    ).toThrow(CalibrationError);
  });
});

describe('ce que la séance filmée ajoute, quand elle a eu lieu', () => {
  const harvest = { quads: sweepQuads(60), views: null, scene: null };

  it('la distance est MESURÉE, et annoncée en clair', () => {
    const out = assembleCardCalibration(pointed(), harvest, null, NOW);
    expect(out.notes.join(' ')).toMatch(/distance mesurée sur votre carte/i);
  });

  /**
   * ⚠️ Le test qui compte : pas « une distance sort », mais « la bonne ». Un
   * assemblage qui rendrait n'importe quel nombre passerait le test précédent.
   */
  it('…et elle tombe sur la vérité terrain à mieux que 10 %', () => {
    const out = assembleCardCalibration(pointed(), harvest, null, NOW);
    const vrai = cardDistanceMm(ADULTE, cam());
    const dite = Number(/(\d+) cm/.exec(out.notes.join(' '))?.[1] ?? NaN) * 10;
    expect(Math.abs(dite - vrai) / vrai).toBeLessThan(0.1);
  });

  it('le profil de l’objectif est produit, pour que la séance suivante n’ait plus à le mesurer', () => {
    const out = assembleCardCalibration(pointed(), harvest, null, NOW);
    expect(out.profile).not.toBeNull();
    expect(out.profile?.focalPerWidth).toBeGreaterThan(0);
  });
});

describe('l’objectif déjà connu prend le relais quand le balayage n’a rien donné', () => {
  const stored: CameraProfile = {
    focalPerWidth: 0.9,
    relError: 0.05,
    views: 60,
    measuredAt: NOW - 1000,
  };

  it('sans aucune vue, un profil frais donne quand même une distance mesurée', () => {
    const out = assembleCardCalibration(
      pointed(),
      { quads: [], views: null, scene: null },
      stored,
      NOW,
    );
    expect(out.notes.join(' ')).toMatch(/déjà mesuré/i);
  });

  it('un profil périmé ne sert PAS : mieux vaut une marge large qu’une vieille focale', () => {
    const perime = { ...stored, measuredAt: NOW - PROFILE_MAX_AGE_MS - 1 };
    const out = assembleCardCalibration(
      pointed(),
      { quads: [], views: null, scene: null },
      perime,
      NOW,
    );
    expect(out.notes.join(' ')).toMatch(/distance non mesurée/i);
  });
});

describe('la séance ne s’arrête que sur ordre du client', () => {
  const buf: ImageBuffer = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
  const quad = cardCornersPx(ADULTE, cam()) as unknown as CardQuad;

  /** Une sonde qui retrouve toujours la carte, et compte les images vues. */
  function probeOf(): { probe: RotationProbe; seen: () => number } {
    let seen = 0;
    const probe = new RotationProbe(
      () => buf,
      () => {
        seen++;
        return { quad, widthRatio: 0.62 };
      },
    );
    return { probe, seen: () => seen };
  }

  /** Un aller-retour de `n` images, comme la consigne le décrit. */
  function film(probe: RotationProbe, n: number): void {
    for (let i = 0; i < n; i++) {
      probe.offer([], 0.45 * Math.sin((2 * Math.PI * i) / n), 0, W, H);
    }
  }

  /**
   * 🔴 LE bug corrigé. La carte n'était relevée qu'au moment où une tranche
   * d'angle NEUVE se remplissait : huit fois au grand maximum, soit exactement
   * `MIN_SWEEP_VIEWS`. Une seule vue refusée par le solveur faisait passer sous
   * le plancher, et la focale mesurée n'aboutissait à peu près jamais.
   */
  it('la carte est relevée à CHAQUE image, pas seulement aux tranches neuves', () => {
    const { probe } = probeOf();
    film(probe, 120);
    expect(probe.quads().length).toBeGreaterThan(MIN_SWEEP_VIEWS * 5);
  });

  it('la récolte continue APRÈS que la machine aurait jugé en avoir assez', () => {
    const { probe } = probeOf();
    film(probe, 120);
    expect(probe.complete).toBe(true);
    const avant = probe.quads().length;
    film(probe, 120);
    expect(probe.quads().length).toBeGreaterThan(avant);
  });

  it('une image où la carte est perdue n’interrompt rien', () => {
    let n = 0;
    const probe = new RotationProbe(
      () => buf,
      () => (++n % 3 === 0 ? null : { quad, widthRatio: 0.62 }), // une image sur trois décroche
    );
    film(probe, 90);
    expect(probe.quads().length).toBeGreaterThan(MIN_SWEEP_VIEWS);
  });

  it('le plafond mémoire borne le stock sans jamais arrêter la séance', () => {
    const { probe } = probeOf();
    film(probe, MAX_SWEEP_QUADS + 200);
    expect(probe.quads().length).toBe(MAX_SWEEP_QUADS);
  });
});

/**
 * ⚠️ Repris de `tests/guide.test.ts`. Les deux bornes viennent de la séquence
 * webcam réelle du sujet, 179 images, relevées avec la fonction de production
 * elle-même (2026-08-17). Elles ne sont pas des préférences : ce sont des
 * mesures, et elles restent la seule chose que le projet ait établie de non
 * circulaire sur des bords de carte.
 */
describe('le seuil de contraste reste entre le fond et le signal MESURÉS', () => {
  /** Plafond de la marche sur peau nue, sans aucune carte. 179 images. */
  const FOND_MESURE = 7.6;
  /** Médiane de la marche sur une carte accrochée sur ses 4 bords. 9 images. */
  const SIGNAL_MESURE = 27.0;

  it('il est au-dessus du fond, avec une marge réelle', () => {
    expect(MIN_GUIDE_EDGE_STEP).toBeGreaterThan(FOND_MESURE * 1.5);
  });

  it('il est sous le signal, avec la même marge', () => {
    expect(MIN_GUIDE_EDGE_STEP).toBeLessThan(SIGNAL_MESURE / 1.5);
  });

  it('il est posé à la moyenne géométrique des deux — même facteur de part et d’autre', () => {
    const geo = Math.sqrt(FOND_MESURE * SIGNAL_MESURE);
    expect(Math.abs(MIN_GUIDE_EDGE_STEP - geo)).toBeLessThan(1);
  });
});
