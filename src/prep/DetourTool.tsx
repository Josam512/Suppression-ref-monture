/**
 * prep/DetourTool.tsx — outil HORS LIGNE de préparation des montures (lot 4).
 *
 * Ne fait PAS partie de l'application client. Il produit `spec.json`.
 *
 * ⚠️ Le détourage fond blanc → PNG transparent n'est pas refait ici : la chaîne
 * Python déjà présente dans ce dépôt (`app.py`, `batch_clean.py`) le fait en
 * préservant l'alpha et la résolution. Cet outil se limite au MARQUAGE des
 * cotes et au calcul de la bbox alpha (correctif B3).
 */

import { useMemo, useRef, useState } from 'react';

import { CalibrationError, type Pt } from '../core/geom.js';
import { computeSpritePxPerMm, type FrontMarks } from '../core/frameSpec.js';
import { computeAlphaBBox } from './alphaBBox.js';

/** Ordre de saisie. Les 6 premiers servent au contrôle de cohérence (§4). */
const STEPS = [
  'P1 — bord nasal du verre gauche',
  'P2 — bord temporal du verre gauche',
  'P3 — bord intérieur gauche du pont',
  'P4 — bord intérieur droit du pont',
  'P5 — haut du verre gauche',
  'P6 — bas du verre gauche',
  'Centre du pont (point d’ancrage)',
  'Centre optique du verre gauche',
  'Centre optique du verre droit',
  'Tenon GAUCHE — départ visuel de la branche gauche',
  'Tenon DROIT — départ visuel de la branche droite',
] as const;

export function DetourTool(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  const [slug, setSlug] = useState('test-01');
  const [aMm, setAMm] = useState(44);
  const [bMm, setBMm] = useState(39);
  const [pontMm, setPontMm] = useState(22);
  const [brancheMm, setBrancheMm] = useState(145);
  const [hinge, setHinge] = useState<Pt>({ x: 0, y: 0 });

  const bbox = useMemo(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (img === null || canvas === null || ctx == null) return null;
    try {
      return computeAlphaBBox(ctx.getImageData(0, 0, canvas.width, canvas.height));
    } catch {
      return null;
    }
  }, [img]);

  const result = useMemo(() => {
    if (img === null || bbox === null || pts.length < STEPS.length) return null;
    const [p1, p2, p3, p4, p5, p6, bridge, lensL, lensR, rootL, rootR] = pts;
    if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6 || !bridge || !lensL || !lensR) return null;
    if (!rootL || !rootR) return null;

    const marks: FrontMarks = { p1, p2, p3, p4, p5, p6 };
    try {
      const spritePxPerMm = computeSpritePxPerMm(marks, { aMm, bMm, pontMm });
      return {
        spec: {
          slug,
          aMm,
          bMm,
          pontMm,
          brancheMm,
          totalWidthMm: bbox.w / spritePxPerMm,
          front: 'front.png',
          profile: 'profile.png',
          spritePxPerMm,
          alphaBBox: bbox,
          bridgeCenter: bridge,
          lensCenterL: lensL,
          lensCenterR: lensR,
          hingeProfile: hinge,
          // Tenons sur la photo de FACE : départ de la branche (2026-08-19).
          templeRootL: rootL,
          templeRootR: rootR,
          calibratedAt: new Date().toISOString().slice(0, 10),
        },
        error: null as string | null,
      };
    } catch (err) {
      return {
        spec: null,
        error: err instanceof CalibrationError ? err.message : String(err),
      };
    }
  }, [img, bbox, pts, slug, aMm, bMm, pontMm, brancheMm, hinge]);

  function onPick(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (pts.length >= STEPS.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = e.currentTarget.width / rect.width;
    const scaleY = e.currentTarget.height / rect.height;
    setPts([
      ...pts,
      { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY },
    ]);
  }

  function onLoad(file: File): void {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (canvas === null || ctx == null) return;
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      setImg(image);
      setPts([]);
      URL.revokeObjectURL(url);
    };
    image.src = url;
  }

  return (
    <main style={{ maxWidth: 1100 }}>
      <h1>Préparation d'une monture</h1>
      <p>
        Charger le PNG <strong>déjà détouré</strong> (fond transparent) produit par la chaîne
        Python du dépôt, puis pointer les repères dans l'ordre indiqué.
      </p>

      <input
        type="file"
        accept="image/png"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file !== undefined) onLoad(file);
        }}
      />

      <fieldset>
        <legend>Cotes réelles, mesurées au réglet</legend>
        <label>
          slug <input value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>{' '}
        <label>
          A <input type="number" value={aMm} onChange={(e) => setAMm(Number(e.target.value))} />
        </label>{' '}
        <label>
          B <input type="number" value={bMm} onChange={(e) => setBMm(Number(e.target.value))} />
        </label>{' '}
        <label>
          pont{' '}
          <input type="number" value={pontMm} onChange={(e) => setPontMm(Number(e.target.value))} />
        </label>{' '}
        <label>
          branche{' '}
          <input
            type="number"
            value={brancheMm}
            onChange={(e) => setBrancheMm(Number(e.target.value))}
          />
        </label>
      </fieldset>

      <p>
        {pts.length < STEPS.length ? (
          <strong>
            Cliquez : {STEPS[pts.length]} ({pts.length + 1}/{STEPS.length})
          </strong>
        ) : (
          <>Tous les repères sont posés.</>
        )}{' '}
        <button type="button" onClick={() => setPts(pts.slice(0, -1))} disabled={pts.length === 0}>
          Annuler le dernier
        </button>
      </p>

      <canvas
        ref={canvasRef}
        onClick={onPick}
        style={{ maxWidth: '100%', border: '1px solid #555', background: '#fff' }}
      />

      {bbox !== null && (
        <p>
          Bounding box alpha : {bbox.w} × {bbox.h} px à ({bbox.x}, {bbox.y}). Les marges
          transparentes sont exclues de la mesure (correctif B3).
        </p>
      )}

      <fieldset>
        <legend>Charnière, sur le sprite de PROFIL</legend>
        <label>
          x{' '}
          <input
            type="number"
            value={hinge.x}
            onChange={(e) => setHinge({ ...hinge, x: Number(e.target.value) })}
          />
        </label>{' '}
        <label>
          y{' '}
          <input
            type="number"
            value={hinge.y}
            onChange={(e) => setHinge({ ...hinge, y: Number(e.target.value) })}
          />
        </label>
      </fieldset>

      {result?.error != null && <p style={{ color: '#ff6b6b' }}>⚠️ {result.error}</p>}

      {result?.spec != null && (
        <>
          <p>
            Échelle : {result.spec.spritePxPerMm.toFixed(2)} px/mm — largeur totale mesurée :{' '}
            <strong>{result.spec.totalWidthMm.toFixed(1)} mm</strong>
          </p>
          <textarea
            readOnly
            rows={20}
            style={{ width: '100%', fontFamily: 'monospace' }}
            value={JSON.stringify(result.spec, null, 2)}
          />
          <p>
            À enregistrer sous <code>public/frames/{slug}/spec.json</code>, à côté de{' '}
            <code>front.png</code> et <code>profile.png</code>.
          </p>
        </>
      )}
    </main>
  );
}
