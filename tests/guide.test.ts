/**
 * tests/guide.test.ts — le cadre à remplir, et ses deux garde-fous anti-circularité.
 *
 * ⚠️ Ces tests couvrent la LOGIQUE PURE. Le verrouillage automatique de bout en
 * bout n'est PAS validé : il faudrait une vraie vidéo de webcam, et la
 * simulation menée sur photo fixe avançait par pas trop grossiers pour produire
 * trois images consécutives conformes. Voir PROGRESS.md.
 */

import { describe, expect, it } from 'vitest';

import {
  GUIDE_TOLERANCE_RATIO,
  GuideLock,
  LOCK_FRAMES,
  MIN_GUIDE_EDGE_STEP,
  REQUIRED_MEASURED_EDGES,
  checkCardInGuide,
  guideQuad,
  guideWidthPx,
} from '../src/core/cardGuide.js';
import { CARD_H_MM, CARD_W_MM, type CardQuad } from '../src/core/cardPose.js';

const W = 720;
const H = 1280;
const guide = guideQuad(W, H);

/** Décale les quatre coins d'un quadrilatère. */
const shift = (q: CardQuad, dx: number, dy: number): CardQuad =>
  q.map((p) => ({ x: p.x + dx, y: p.y + dy })) as unknown as CardQuad;

describe('le cadre porte le rapport ISO, donc une carte qui le remplit est à la cote', () => {
  it('son rapport largeur/hauteur est celui de la norme', () => {
    const w = guide[1].x - guide[0].x;
    const h = guide[3].y - guide[0].y;
    expect(w / h).toBeCloseTo(CARD_W_MM / CARD_H_MM, 9);
  });

  it('il est centré, et sa largeur suit celle de l’image', () => {
    expect((guide[0].x + guide[1].x) / 2).toBeCloseTo(W / 2, 9);
    expect((guide[0].y + guide[3].y) / 2).toBeCloseTo(H / 2, 9);
    expect(guide[1].x - guide[0].x).toBeCloseTo(guideWidthPx(W), 9);
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
