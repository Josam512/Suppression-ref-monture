import { describe, it, expect, vi } from 'vitest';
import { createVideoDetector, loadModelBuffer } from '../src/tracking/landmarker';
import type { VideoLandmarker } from '../src/tracking/landmarker';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';

const EMPTY_RESULT = { faceLandmarks: [] } as unknown as FaceLandmarkerResult;

/** Faux landmarker qui enregistre les timestamps reçus et refuse la non-monotonie. */
function stubLandmarker() {
  const timestamps: number[] = [];
  const landmarker: VideoLandmarker = {
    detectForVideo(_video, timestampMs) {
      const last = timestamps[timestamps.length - 1];
      if (last !== undefined && timestampMs <= last) {
        // Reproduit le comportement réel de @mediapipe/tasks-vision.
        throw new Error('timestamp non strictement croissant');
      }
      timestamps.push(timestampMs);
      return EMPTY_RESULT;
    },
  };
  return { landmarker, timestamps };
}

const video = (currentTime: number) => ({ currentTime }) as HTMLVideoElement;

describe('tracking/landmarker — garde de monotonie (rapport S5)', () => {
  it('analyse une frame neuve', () => {
    const { landmarker, timestamps } = stubLandmarker();
    const d = createVideoDetector(landmarker);
    expect(d.detect(video(0.1), 1000)).not.toBeNull();
    expect(timestamps).toEqual([1000]);
  });

  it('ignore une frame vidéo déjà analysée, sans appeler le modèle', () => {
    const { landmarker, timestamps } = stubLandmarker();
    const d = createVideoDetector(landmarker);
    d.detect(video(0.1), 1000);

    // Même currentTime : la webcam n'a pas produit d'image neuve.
    expect(d.detect(video(0.1), 1016)).toBeNull();
    expect(timestamps).toEqual([1000]);
  });

  it("ne lève JAMAIS sur une horloge qui stagne — c'est ce qui tuait la boucle", () => {
    const { landmarker, timestamps } = stubLandmarker();
    const d = createVideoDetector(landmarker);

    // Trois frames vidéo distinctes, mais performance.now() figé.
    expect(() => {
      d.detect(video(0.1), 1000);
      d.detect(video(0.2), 1000);
      d.detect(video(0.3), 1000);
    }).not.toThrow();

    expect(timestamps).toEqual([1000, 1001, 1002]);
  });

  it('ne lève jamais sur une horloge qui recule', () => {
    const { landmarker, timestamps } = stubLandmarker();
    const d = createVideoDetector(landmarker);

    expect(() => {
      d.detect(video(0.1), 5000);
      d.detect(video(0.2), 200);
    }).not.toThrow();

    expect(timestamps[1]).toBeGreaterThan(timestamps[0] as number);
  });
});

describe('tracking/landmarker — chargement du modèle avec progression (§1 bug #4)', () => {
  function streamingResponse(chunks: Uint8Array[], contentLength: string | null): Response {
    let i = 0;
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k === 'content-length' ? contentLength : null) },
      body: {
        getReader: () => ({
          read: async () =>
            i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
        }),
      },
    } as unknown as Response;
  }

  it('reconstitue le fichier à l’identique', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const fetchImpl = vi.fn().mockResolvedValue(streamingResponse(chunks, '5'));

    const out = await loadModelBuffer('/models/x.task', undefined, fetchImpl as unknown as typeof fetch);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it('rapporte un pourcentage réel, croissant, qui finit à 1', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const fetchImpl = vi.fn().mockResolvedValue(streamingResponse(chunks, '5'));
    const ratios: (number | null)[] = [];

    await loadModelBuffer(
      '/models/x.task',
      (p) => ratios.push(p.ratio),
      fetchImpl as unknown as typeof fetch,
    );

    expect(ratios).toEqual([0.6, 1]);
  });

  it('signale une progression inconnue plutôt que d’inventer un pourcentage', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamingResponse([new Uint8Array([1])], null));
    const ratios: (number | null)[] = [];

    await loadModelBuffer(
      '/models/x.task',
      (p) => ratios.push(p.ratio),
      fetchImpl as unknown as typeof fetch,
    );

    expect(ratios).toEqual([null]);
  });

  it('explique quoi faire quand le modèle vendorisé est absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);

    await expect(
      loadModelBuffer('/models/x.task', undefined, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/vendoris/i);
  });
});
