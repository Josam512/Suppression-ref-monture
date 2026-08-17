/**
 * tests/guide.test.ts — le cadre à remplir, et ses deux garde-fous anti-circularité.
 *
 * ⚠️ Ces tests couvrent la LOGIQUE PURE. Le verrouillage automatique de bout en
 * bout n'est PAS validé : il faudrait une vraie vidéo de webcam, et la
 * simulation menée sur photo fixe avançait par pas trop grossiers pour produire
 * trois images consécutives conformes. Voir PROGRESS.md.
 */

import { describe, expect, it } from 'vitest';

import { guideQuad, guideWidthPx } from '../src/core/cardGuide.js';
import {
  GUIDE_TOLERANCE_RATIO,
  GuideLock,
  LOCK_FRAMES,
  MIN_GUIDE_EDGE_STEP,
  REQUIRED_MEASURED_EDGES,
  checkCardInGuide,
} from '../src/core/cardGuideLock.js';
import { CARD_H_MM, CARD_W_MM, type CardQuad } from '../src/core/cardPose.js';
import { BROW_L, BROW_R, EYE_L, EYE_R, HAIRLINE, poseAnchorOf, rollRadOf } from '../src/core/faceMetrics.js';
import { at, dist, midpoint, px, type NormalizedLandmark } from '../src/core/geom.js';
import { H, W, makeFace, type FaceOptions } from './fixtures/landmarks.js';

/** Visage de référence pour ce fichier. */

/**
 * ⚠️ Les dimensions viennent du fixture, jamais d'un couple choisi ici.
 * `makeFace` normalise ses points contre SES W/H ; en normaliser d'autres
 * appliquerait une anisotropie qui déforme le roll — piège rencontré à
 * l'écriture de ce fichier, et qui faisait échouer le test d'inclinaison.
 */
const face = (over: Partial<FaceOptions> = {}): NormalizedLandmark[] =>
  makeFace({ faceWidthPx: 0.42 * W, ...over });

const guide = guideQuad(face(), W, H);

/** Décale les quatre coins d'un quadrilatère. */
const shift = (q: CardQuad, dx: number, dy: number): CardQuad =>
  q.map((p) => ({ x: p.x + dx, y: p.y + dy })) as unknown as CardQuad;

describe('le cadre porte le rapport ISO, donc une carte qui le remplit est à la cote', () => {
  it('son rapport largeur/hauteur est celui de la norme', () => {
    const w = guide[1].x - guide[0].x;
    const h = guide[3].y - guide[0].y;
    expect(w / h).toBeCloseTo(CARD_W_MM / CARD_H_MM, 9);
  });

  it('sa largeur est celle prescrite par l’image', () => {
    expect(dist(guide[0], guide[1])).toBeCloseTo(guideWidthPx(W), 9);
  });
});

/**
 * 🔴 LE garde-fou de ce fichier, et le plus lourd de conséquences.
 *
 * Dimensionner le cadre en fraction du VISAGE rendrait la calibration
 * circulaire : remplir le cadre imposerait `carteEnPx = k × visageEnPx`, donc
 * `largeurVisageMm = CARD_W_MM / k` — la même valeur pour tout le monde. Un
 * enfant et un adulte à forte carrure rendraient le même chiffre, et rien à
 * l'écran ne le signalerait.
 *
 * Le test balaie un DOMAINE de largeurs de visage, jamais un point : c'est la
 * leçon de B2 et S4 (§8.2). Une seule fixture laisserait passer la faute.
 */
describe('la TAILLE du cadre ne doit rien devoir au visage', () => {
  it('elle est identique pour un visage d’enfant et pour une forte carrure', () => {
    const widths = [0.18, 0.24, 0.32, 0.42, 0.55, 0.70].map((r) => r * W);
    const tailles = widths.map((faceWidthPx) => dist(guideQuad(face({ faceWidthPx }), W, H)[0], guideQuad(face({ faceWidthPx }), W, H)[1]));
    for (const t of tailles) expect(t, `largeurs rendues : ${tailles.join(', ')}`).toBeCloseTo(guideWidthPx(W), 9);
  });

  it('…et elle ne dépend pas non plus de l’inclinaison de la tête', () => {
    for (const rollRad of [-0.3, -0.1, 0, 0.1, 0.3]) {
      const q = guideQuad(face({ rollRad }), W, H);
      expect(dist(q[0], q[1]), `roll=${rollRad}`).toBeCloseTo(guideWidthPx(W), 9);
      expect(dist(q[1], q[2]), `roll=${rollRad}`).toBeCloseTo((guideWidthPx(W) * CARD_H_MM) / CARD_W_MM, 9);
    }
  });
});

describe('la POSITION du cadre, elle, vient du visage — c’est là qu’est la carte', () => {
  /**
   * 🔴 Le cadre tombe LÀ OÙ IRONT LES LUNETTES, et c'est ce qui supprime le
   * biais de parallaxe B4 : une carte dans le plan du visage n'est plus 54 mm
   * devant les repères qui le mesurent. Il n'y a plus d'écart à corriger.
   */
  it('il est aligné horizontalement sur l’ancrage de la monture', () => {
    const lm = face();
    const centre = midpoint(midpoint(guide[0], guide[2]), midpoint(guide[1], guide[3]));
    expect(centre.x).toBeCloseTo(poseAnchorOf(lm, W, H, rollRadOf(lm, W, H)).x, 6);
  });

  /**
   * 🔴 LE test qui protège la mesure elle-même.
   *
   * Une carte devant les yeux ne fait pas perdre le visage à MediaPipe : le
   * modèle rend quand même 478 points, en INVENTANT ceux qu'il ne voit plus.
   * `faceWidthPx` — la grandeur qui est la mesure — serait alors lue sur des
   * repères hallucinés, sans le moindre signal. Le bord haut du cadre doit donc
   * rester sous la ligne des yeux, et le cadre entier sous la lisière.
   */
  it('il laisse les YEUX visibles : son bord haut tombe sur la ligne des yeux', () => {
    const lm = face();
    const eyeY = (px(at(lm, EYE_L), W, H).y + px(at(lm, EYE_R), W, H).y) / 2;
    const browY = (px(at(lm, BROW_L), W, H).y + px(at(lm, BROW_R), W, H).y) / 2;
    const hairY = px(at(lm, HAIRLINE), W, H).y;

    const bordHaut = Math.min(...guide.map((p) => p.y));
    expect(bordHaut).toBeGreaterThanOrEqual(eyeY - 1); // jamais AU-DESSUS des yeux
    expect(bordHaut).toBeGreaterThan(browY); // ni sur les sourcils
    expect(bordHaut).toBeGreaterThan(hairY); // ni sur les cheveux
  });

  it('…et le décalage vaut exactement une demi-hauteur de carte, sans constante', () => {
    const lm = face();
    const centre = midpoint(midpoint(guide[0], guide[2]), midpoint(guide[1], guide[3]));
    const ancre = poseAnchorOf(lm, W, H, rollRadOf(lm, W, H));
    const demiHauteur = (guideWidthPx(W) * CARD_H_MM) / CARD_W_MM / 2;
    expect(centre.y - ancre.y).toBeCloseTo(demiHauteur, 6);
  });

  it('il suit la tête quand elle se déplace dans l’image', () => {
    // Le défaut d'origine centrait le cadre dans l'IMAGE : il ne bougeait pas.
    const bas = guideQuad(face(), W, H);
    const lm = face();
    const monte = lm.map((p) => ({ x: p.x, y: p.y - 0.1 }));
    const haut = guideQuad(monte, W, H);
    expect(haut[0].y - bas[0].y).toBeCloseTo(-0.1 * H, 6);
  });

  it('il penche avec la tête, comme le fera la monture', () => {
    for (const rollRad of [-0.25, 0.25]) {
      const q = guideQuad(face({ rollRad }), W, H);
      expect(Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x), `roll=${rollRad}`).toBeCloseTo(rollRad, 6);
    }
  });
});

/**
 * 🔴 Les deux garde-fous qui ont coûté deux essais ratés.
 *
 * Il ne suffit PAS que le quadrilatère accroché ressemble au cadre :
 * `refineQuad` contraint déjà sa sortie à rester près de sa graine — qui est le
 * cadre. Sur la photo réelle du sujet, ce contrôle-là verrouillait sur une carte
 * de 282 px pour un cadre de 396.
 */
describe('un contrôle circulaire ne verrouille plus', () => {
  it('quadrilatère parfait mais bords NON mesurés → refusé', () => {
    for (let measured = 0; measured < REQUIRED_MEASURED_EDGES; measured++) {
      expect(checkCardInGuide(guide, guide, measured, 3 * MIN_GUIDE_EDGE_STEP).ok, `${measured}/4`).toBe(false);
    }
  });

  it('quatre bords mesurés mais AUCUN contraste au bord du cadre → refusé', () => {
    // Du grain de peau suffit à ajuster une droite : « mesuré » ne veut pas dire
    // « c'est la carte ». Seule la marche de luminance le dit.
    expect(checkCardInGuide(guide, guide, 4, MIN_GUIDE_EDGE_STEP - 0.1).ok).toBe(false);
  });

  it('les deux conditions réunies → accepté', () => {
    expect(checkCardInGuide(guide, guide, 4, MIN_GUIDE_EDGE_STEP).ok).toBe(true);
  });

  it('la jauge ne monte à fond que si les DEUX conditions le sont', () => {
    expect(checkCardInGuide(guide, guide, 2, 3 * MIN_GUIDE_EDGE_STEP).fill).toBeLessThan(1);
    expect(checkCardInGuide(guide, guide, 4, MIN_GUIDE_EDGE_STEP / 2).fill).toBeLessThan(1);
    expect(checkCardInGuide(guide, guide, 4, 3 * MIN_GUIDE_EDGE_STEP).fill).toBeCloseTo(1, 9);
  });
});

describe('c’est le PIRE coin qui décide, jamais la moyenne', () => {
  const tolPx = GUIDE_TOLERANCE_RATIO * guideWidthPx(W);

  it('un décalage global sous la tolérance passe', () => {
    expect(checkCardInGuide(shift(guide, tolPx * 0.5, 0), guide, 4, 3 * MIN_GUIDE_EDGE_STEP).ok).toBe(true);
  });

  it('un décalage global au-delà est refusé', () => {
    expect(checkCardInGuide(shift(guide, tolPx * 1.5, 0), guide, 4, 3 * MIN_GUIDE_EDGE_STEP).ok).toBe(false);
  });

  it('trois coins parfaits et UN seul de travers → refusé', () => {
    // La moyenne le sauverait : trois zéros et un grand écart font une petite
    // moyenne. C'est pourtant une carte de travers.
    const tordu = [guide[0], guide[1], { x: guide[2].x + 4 * tolPx, y: guide[2].y }, guide[3]] as unknown as CardQuad;
    expect(checkCardInGuide(tordu, guide, 4, 3 * MIN_GUIDE_EDGE_STEP).ok).toBe(false);
  });
});

/**
 * 🔴 Le seuil de contraste est FIGÉ SUR MESURE, et ce test l'y maintient.
 *
 * Les deux bornes viennent de la séquence webcam réelle du sujet, 179 images,
 * relevées avec la fonction de production elle-même (`tests/guide-on-video.ts`,
 * 2026-08-17). Elles ne sont pas des préférences : ce sont des mesures.
 *
 * Sans ce test, `MIN_GUIDE_EDGE_STEP` est le paramètre le plus facile à pousser
 * dans un sens ou dans l'autre pour « faire marcher » un cas particulier — vers
 * le bas on verrouille sur du front nu, vers le haut le client n'y arrive jamais.
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

describe('le verrou exige une pose TENUE, même très brièvement', () => {
  it('il faut LOCK_FRAMES images consécutives, et il ne se déclenche qu’une fois', () => {
    const lock = new GuideLock();
    for (let i = 0; i < LOCK_FRAMES - 1; i++) expect(lock.push(true)).toBe(false);
    expect(lock.push(true)).toBe(true);
    expect(lock.push(true)).toBe(false); // déjà verrouillé : plus de front montant
  });

  it('une seule image non conforme remet le compteur à zéro', () => {
    const lock = new GuideLock();
    for (let i = 0; i < LOCK_FRAMES - 1; i++) lock.push(true);
    expect(lock.push(false)).toBe(false);
    expect(lock.progress).toBe(0);
    // On ne cumule pas des instants épars : il faut repartir de zéro.
    for (let i = 0; i < LOCK_FRAMES - 1; i++) expect(lock.push(true)).toBe(false);
    expect(lock.push(true)).toBe(true);
  });

  it('LOCK_FRAMES reste imperceptible : moins d’un dixième de seconde à 30 i/s', () => {
    expect(LOCK_FRAMES / 30).toBeLessThanOrEqual(0.1);
    // …mais jamais nul : une seule image suffirait à un reflet de passage.
    expect(LOCK_FRAMES).toBeGreaterThan(1);
  });
});
