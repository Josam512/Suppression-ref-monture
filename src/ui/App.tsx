/**
 * ui/App.tsx — choix de la version, puis essayage.
 *
 * Les deux versions ne sont PAS deux applications : c'est le même moteur de
 * mesure, avec une source d'étalon différente et un contexte d'usage différent.
 * Le mode vit ici, dans l'UI, et nulle part ailleurs — `core/` et `render/` ne
 * savent pas qu'il existe (§11.4). Ce qui descend, ce sont des VALEURS
 * (`overlayPaddingMm`), jamais un mode à tester.
 */

import { useState } from 'react';
import { TryOn, type Mode } from './TryOn.js';

const MODES: Array<{ id: Mode; titre: string; qui: string; etalon: string; precision: string }> = [
  {
    id: 'online',
    titre: 'V1 — Vente en ligne',
    qui: 'Le client, chez lui, sans opticien et sans instrument de mesure.',
    etalon: 'Son iris (11,7 mm), puis une carte bancaire en cas de doute.',
    precision: '4,3 % à l’iris · 2,5 % à la carte',
  },
  {
    id: 'store',
    titre: 'V2 — Mode magasin',
    qui: 'L’opticien, avec le client qui porte déjà une monture du rayon.',
    etalon: 'La monture portée elle-même, dont les cotes sont connues.',
    precision: '2 % — la source la plus précise des trois',
  },
];

export function App(): JSX.Element {
  const [mode, setMode] = useState<Mode | null>(null);

  if (mode !== null) {
    return <TryOn mode={mode} onQuit={() => setMode(null)} />;
  }

  return (
    <main style={{ maxWidth: 900, margin: '0 auto' }}>
      <h1>Essayage virtuel — vérification de taille réelle</h1>
      <p>
        L’application superpose une monture réelle, à l’échelle millimétrique exacte, sur votre
        vidéo. Elle affiche deux chiffres à côté de l’image : la largeur de la monture, la largeur
        de votre visage. <strong>Elle ne trie rien et ne recommande rien</strong> — c’est vous qui
        regardez.
      </p>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {MODES.map((m) => (
          <section
            key={m.id}
            style={{ border: '1px solid #666', borderRadius: 8, padding: 16 }}
          >
            <h2 style={{ marginTop: 0 }}>{m.titre}</h2>
            <p>
              <strong>Pour qui</strong> — {m.qui}
            </p>
            <p>
              <strong>Étalon de taille</strong> — {m.etalon}
            </p>
            <p>
              <strong>Précision</strong> — {m.precision}
            </p>
            <button type="button" onClick={() => setMode(m.id)}>
              Ouvrir {m.titre}
            </button>
          </section>
        ))}
      </div>

      <p style={{ marginTop: 24, opacity: 0.75 }}>
        Les deux versions partagent exactement le même moteur : une fois la largeur du visage
        connue en millimètres, la chaîne de mesure et le rendu sont identiques. Seule change la
        façon d’obtenir cette largeur.
      </p>
    </main>
  );
}
