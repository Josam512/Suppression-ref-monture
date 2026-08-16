/**
 * prep/CalibTool.tsx — LOT 8 : calibration de FACE_WIDTH_CORRECTION_MM.
 *
 * Les landmarks 234/454 sont sur le contour du visage, SOUS les tempes
 * anatomiques. L'écart pèse plus lourd que le seuil de décision lui-même :
 * tant qu'il vaut 0, des montures correctes s'affichent « sous-taillées », de
 * façon cohérente donc invisible.
 *
 * Cet outil applique le protocole du §5 sans le raccourcir :
 *   • plusieurs montures de largeurs nettement différentes ;
 *   • plusieurs visages ;
 *   • MÉDIANE des écarts, pas la valeur qui arrange le cas le plus visible ;
 *   • refus de figer si la dispersion dépasse 3 mm — c'est alors qu'un autre
 *     maillon est faux, et moyenner le symptôme le masquerait.
 *
 * ⚠️ Le pointage des bords est MANUEL. Une détection automatique a été essayée
 * et se trompait d'un côté sur trois photos : elle produisait un chiffre
 * plausible et faux, exactement ce que ce projet combat.
 */

import { useCallback, useRef, useState } from 'react';

import { at, dist, px, type NormalizedLandmark } from '../core/geom.js';
import { FACE_L, FACE_R } from '../core/faceMetrics.js';
import { detectOnImage } from './detectOnImage.js';
import { dispersion, MAX_DISPERSION_MM, median, protocolSatisfied } from './stats.js';

/** Au-delà, la pose n'est plus assez frontale pour mesurer une largeur. */
const MAX_YAW_DEG = 8;

interface Row {
  nom: string;
  monture: string;
  frameWidthMm: number;
  framePx: number;
  landmarkPx: number;
  landmarkMm: number;
  correctionMm: number;
  yawDeg: number;
}

export function CalibTool(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [lm, setLm] = useState<NormalizedLandmark[] | null>(null);
  const [yawDeg, setYawDeg] = useState(0);
  const [nom, setNom] = useState('');
  const [monture, setMonture] = useState('');
  const [frameWidthMm, setFrameWidthMm] = useState(120);
  const [edges, setEdges] = useState<[number, number]>([0, 0]);
  const [drag, setDrag] = useState<0 | 1 | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState('Chargez une photo de face, monture portée.');

  const landmarkPx =
    lm === null || img === null
      ? 0
      : dist(px(at(lm, FACE_L), img.width, img.height), px(at(lm, FACE_R), img.width, img.height));

  const draw = useCallback(
    (image: HTMLImageElement, marks: NormalizedLandmark[] | null, e: [number, number]) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas === null || ctx == null) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      ctx.drawImage(image, 0, 0);

      const w = canvas.width;
      const h = canvas.height;
      const lw = Math.max(3, w / 400);

      if (marks !== null) {
        const L = px(at(marks, FACE_L), w, h);
        const R = px(at(marks, FACE_R), w, h);
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(L.x, L.y);
        ctx.lineTo(R.x, R.y);
        ctx.stroke();
        ctx.fillStyle = '#ff3b30';
        for (const p of [L, R]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, lw * 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.strokeStyle = '#0a84ff';
      ctx.lineWidth = lw;
      for (const x of e) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    },
    [],
  );

  async function onFile(file: File): Promise<void> {
    setStatus('Détection en cours…');
    const url = URL.createObjectURL(file);
    const image = new Image();
    await new Promise<void>((ok) => {
      image.onload = () => ok();
      image.src = url;
    });
    URL.revokeObjectURL(url);

    const det = await detectOnImage(image);
    const e: [number, number] = [image.naturalWidth * 0.35, image.naturalWidth * 0.65];

    setImg(image);
    setEdges(e);
    setNom(file.name.replace(/\.[^.]+$/, ''));

    if (det === null) {
      setLm(null);
      setStatus('Aucun visage détecté sur cette photo.');
    } else {
      setLm(det.landmarks);
      const deg = (det.yawRad * 180) / Math.PI;
      setYawDeg(deg);
      setStatus(
        Math.abs(deg) > MAX_YAW_DEG
          ? `Tête tournée de ${deg.toFixed(1)}° — au-delà de ${MAX_YAW_DEG}°, la largeur apparente est raccourcie. Photo à écarter.`
          : `Visage détecté, yaw ${deg.toFixed(1)}°. Amenez les deux traits bleus sur les bords EXTERNES de la monture.`,
      );
    }
    draw(image, det?.landmarks ?? null, e);
  }

  function pointerX(ev: React.PointerEvent<HTMLCanvasElement>): number {
    const r = ev.currentTarget.getBoundingClientRect();
    return ((ev.clientX - r.left) / r.width) * ev.currentTarget.width;
  }

  const framePx = Math.abs(edges[1] - edges[0]);
  const pxPerMm = framePx / frameWidthMm;
  const landmarkMm = pxPerMm > 0 ? landmarkPx / pxPerMm : 0;
  const correctionMm = frameWidthMm - landmarkMm;

  const corrections = rows.map((r) => r.correctionMm);
  const med = median(corrections);
  const disp = dispersion(corrections);
  const montures = new Set(rows.map((r) => r.monture)).size;
  const visages = new Set(rows.map((r) => r.nom.replace(/[-_ ]?\d+$/, ''))).size;

  const protocoleOk = protocolSatisfied({
    essais: rows.length,
    montures,
    visages,
    dispersionMm: disp,
  });

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto' }}>
      <h1>Lot 8 — calibration de la correction de largeur</h1>
      <p>
        Pour chaque photo : un visage <strong>de face</strong>, portant une monture dont la largeur
        totale bord à bord a été mesurée au réglet. On compare cette largeur réelle à ce que lisent
        les repères 234/454.
      </p>

      <input
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f !== undefined) void onFile(f);
        }}
      />
      <p>{status}</p>

      <canvas
        ref={canvasRef}
        style={{ maxWidth: '100%', border: '1px solid #888', touchAction: 'none' }}
        onPointerDown={(e) => {
          const x = pointerX(e);
          setDrag(Math.abs(x - edges[0]) < Math.abs(x - edges[1]) ? 0 : 1);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag === null || img === null) return;
          const next: [number, number] = [...edges];
          next[drag] = pointerX(e);
          setEdges(next);
          draw(img, lm, next);
        }}
        onPointerUp={() => setDrag(null)}
      />

      <fieldset>
        <legend>Cette photo</legend>
        <label>
          personne <input value={nom} onChange={(e) => setNom(e.target.value)} />
        </label>{' '}
        <label>
          monture <input value={monture} onChange={(e) => setMonture(e.target.value)} />
        </label>{' '}
        <label>
          largeur totale réelle (mm){' '}
          <input
            type="number"
            step="0.5"
            value={frameWidthMm}
            onChange={(e) => setFrameWidthMm(Number(e.target.value))}
          />
        </label>
      </fieldset>

      {lm !== null && framePx > 0 && (
        <p>
          monture {framePx.toFixed(0)} px pour {frameWidthMm} mm → {pxPerMm.toFixed(3)} px/mm ·
          repères 234/454 : {landmarkPx.toFixed(0)} px = <strong>{landmarkMm.toFixed(1)} mm</strong>{' '}
          · écart <strong>{correctionMm >= 0 ? '+' : ''}{correctionMm.toFixed(1)} mm</strong>
        </p>
      )}

      <button
        type="button"
        disabled={lm === null || framePx <= 0 || Math.abs(yawDeg) > MAX_YAW_DEG}
        onClick={() =>
          setRows([
            ...rows,
            { nom, monture, frameWidthMm, framePx, landmarkPx, landmarkMm, correctionMm, yawDeg },
          ])
        }
      >
        Ajouter cet essai
      </button>

      {rows.length > 0 && (
        <>
          <h2>Essais ({rows.length})</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {['personne', 'monture', 'réelle', 'lue', 'écart', 'yaw'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #888' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.nom}</td>
                  <td>{r.monture}</td>
                  <td>{r.frameWidthMm.toFixed(1)} mm</td>
                  <td>{r.landmarkMm.toFixed(1)} mm</td>
                  <td>
                    {r.correctionMm >= 0 ? '+' : ''}
                    {r.correctionMm.toFixed(1)} mm
                  </td>
                  <td>{r.yawDeg.toFixed(1)}°</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p>
            Médiane : <strong>{med.toFixed(1)} mm</strong> · dispersion {disp.toFixed(1)} mm ·{' '}
            {montures} monture(s), {visages} visage(s)
          </p>

          {disp > MAX_DISPERSION_MM ? (
            <p style={{ color: '#c0392b' }}>
              <strong>Ne pas figer.</strong> La dispersion dépasse {MAX_DISPERSION_MM} mm : le signe
              qu'un autre maillon est faux — padding alpha, parallaxe, ou pointage. Chercher la
              cause plutôt que moyenner le symptôme.
            </p>
          ) : protocoleOk ? (
            <p style={{ color: '#27ae60' }}>
              Protocole satisfait. Reporter dans <code>core/verdict.ts</code> :
              <br />
              <code>
                export const FACE_WIDTH_CORRECTION_MM = {med.toFixed(1)}; // calibrée le{' '}
                {new Date().toISOString().slice(0, 10)} | {rows.length} essais, dispersion{' '}
                {disp.toFixed(1)} mm
              </code>
            </p>
          ) : (
            <p>
              Protocole incomplet : il faut au moins 3 essais, 3 montures de largeurs nettement
              différentes et 2 visages distincts.
            </p>
          )}
        </>
      )}
    </main>
  );
}
