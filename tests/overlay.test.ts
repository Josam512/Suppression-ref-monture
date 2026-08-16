import { describe, it, expect } from 'vitest';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { drawLandmarks, IRIS_LANDMARK_FIRST, IRIS_LANDMARK_LAST } from '../src/render/overlay';

/** Le modèle vendorisé renvoie 478 points, dont les iris (§1 bug #4). */
const LANDMARK_COUNT = 478;

interface Arc {
  x: number;
  y: number;
  r: number;
}

/** Contexte canvas simulé : on ne veut compter que ce qui est réellement tracé. */
function stubContext(): { ctx: CanvasRenderingContext2D; arcs: Arc[] } {
  const arcs: Arc[] = [];
  const ctx = {
    canvas: { width: 1280, height: 720 },
    save() {},
    restore() {},
    beginPath() {},
    fill() {},
    moveTo() {},
    arc(x: number, y: number, r: number) {
      arcs.push({ x, y, r });
    },
    globalAlpha: 1,
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
  return { ctx, arcs: arcs };
}

/** Grille déterministe : chaque point a des coordonnées distinctes et connues. */
function fakeLandmarks(n: number): NormalizedLandmark[] {
  return Array.from({ length: n }, (_, i) => ({
    x: (i % 32) / 32,
    y: Math.floor(i / 32) / 16,
    z: 0,
    visibility: 1,
  })) as NormalizedLandmark[];
}

describe('render/overlay — les 478 points (critère d’acceptation lot 2)', () => {
  it('trace exactement un point par landmark, aucun oublié, aucun en double', () => {
    const { ctx, arcs } = stubContext();
    drawLandmarks(ctx, fakeLandmarks(LANDMARK_COUNT), 1280, 720);
    expect(arcs).toHaveLength(LANDMARK_COUNT);
  });

  it('distingue les iris du reste du maillage', () => {
    const { ctx, arcs } = stubContext();
    drawLandmarks(ctx, fakeLandmarks(LANDMARK_COUNT), 1280, 720);

    const irisCount = IRIS_LANDMARK_LAST - IRIS_LANDMARK_FIRST + 1;
    const radii = [...new Set(arcs.map((a) => a.r))].sort((a, b) => a - b);
    expect(radii).toHaveLength(2); // maillage + iris, deux tailles distinctes

    const irisRadius = radii[1] as number;
    // Les iris portent l'échelle du §4 : ils doivent rester lisibles à l'œil nu.
    expect(arcs.filter((a) => a.r === irisRadius)).toHaveLength(irisCount);
  });

  it('dénormalise vers les pixels image, pas vers les coordonnées normalisées', () => {
    const { ctx, arcs } = stubContext();
    const lm = [{ x: 0.5, y: 0.25, z: 0, visibility: 1 }] as NormalizedLandmark[];
    drawLandmarks(ctx, lm, 1280, 720);
    expect(arcs[0]).toMatchObject({ x: 640, y: 180 });
  });

  it('ne casse pas si le modèle renvoie moins de points que prévu', () => {
    const { ctx, arcs } = stubContext();
    expect(() => drawLandmarks(ctx, fakeLandmarks(10), 1280, 720)).not.toThrow();
    expect(arcs).toHaveLength(10);
  });

  it('ne trace rien sans landmark, plutôt que de dessiner à l’origine', () => {
    const { ctx, arcs } = stubContext();
    drawLandmarks(ctx, [], 1280, 720);
    expect(arcs).toHaveLength(0);
  });
});
