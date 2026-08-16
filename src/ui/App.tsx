import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera } from './Camera';
import { createFaceLandmarker, createVideoDetector } from '../tracking/landmarker';
import type { VideoDetector } from '../tracking/landmarker';
import { drawLandmarks } from '../render/overlay';

/**
 * Lot 2 — détection des 478 points en overlay.
 *
 * Rappel de cadrage (rapport §0.1) : cette application ne trie rien, ne rejette
 * rien, ne recommande rien. Le livrable est l'image live, juste au millimètre.
 */

type ModelState =
  | { phase: 'loading'; percent: number | null }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };

export function App() {
  const [model, setModel] = useState<ModelState>({ phase: 'loading', percent: null });
  const detectorRef = useRef<VideoDetector | null>(null);
  const lastResultRef = useRef<{ faces: number }>({ faces: 0 });

  useEffect(() => {
    let cancelled = false;

    createFaceLandmarker((p) => {
      if (!cancelled) {
        setModel({ phase: 'loading', percent: p.ratio === null ? null : p.ratio * 100 });
      }
    })
      .then((landmarker) => {
        if (cancelled) return;
        detectorRef.current = createVideoDetector(landmarker);
        setModel({ phase: 'ready' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setModel({ phase: 'error', message });
        console.error('Chargement du FaceLandmarker impossible :', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const onFrame = useCallback((ctx: CanvasRenderingContext2D, video: HTMLVideoElement) => {
    const detector = detectorRef.current;
    if (!detector) return false;

    const result = detector.detect(video, performance.now());

    // `null` = frame vidéo déjà analysée, rien de neuf. Ce n'est PAS une perte
    // de détection : on redessine le dernier état connu sans incrémenter le
    // compteur d'échecs.
    if (result === null) return lastResultRef.current.faces > 0;

    const landmarks = result.faceLandmarks[0];
    lastResultRef.current.faces = result.faceLandmarks.length;
    if (!landmarks) return false;

    drawLandmarks(ctx, landmarks, ctx.canvas.width, ctx.canvas.height);
    return true;
  }, []);

  return (
    <main className="app">
      <header className="app__header">
        <h1>Essayage virtuel — taille réelle</h1>
        <p className="app__subtitle">
          Lot 2 : 478 points détectés en direct, iris compris. La monture arrive au lot 5.
        </p>
      </header>

      {model.phase === 'loading' && (
        <div className="status status--loading" role="status">
          <span className="status__dot" />
          {model.percent === null
            ? 'Chargement du modèle…'
            : `Chargement du modèle — ${model.percent.toFixed(0)} %`}
          <span className="progress">
            <span className="progress__bar" style={{ width: `${model.percent ?? 0}%` }} />
          </span>
        </div>
      )}

      {model.phase === 'error' && (
        <div className="status status--error" role="alert">
          <span className="status__dot" />
          {model.message}
        </div>
      )}

      <Camera onFrame={onFrame} />

      <footer className="app__footer">
        <p>
          Les points verts sont les iris. Ce sont eux qui portent l&apos;échelle : leur
          diamètre est une quasi-constante biologique, et c&apos;est la seule référence de
          taille disponible sans effort (§4).
        </p>
        <p>
          Aucun réglage de taille n&apos;est proposé, et il n&apos;y en aura jamais :
          l&apos;échelle est <strong>calculée</strong>, jamais saisie (§1 bug #1).
        </p>
      </footer>
    </main>
  );
}
