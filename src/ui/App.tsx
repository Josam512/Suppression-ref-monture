import { Camera } from './Camera';

/**
 * Lot 1 — squelette. Aucune monture, aucune mesure, aucun verdict : seulement
 * la vidéo réelle et le canvas superposé, prêts pour le lot 2.
 *
 * Rappel de cadrage (rapport §0.1) : cette application ne trie rien, ne rejette
 * rien, ne recommande rien. Le livrable est l'image live, juste au millimètre.
 */
export function App() {
  return (
    <main className="app">
      <header className="app__header">
        <h1>Essayage virtuel — taille réelle</h1>
        <p className="app__subtitle">
          Lot 1 : flux webcam et canvas superposé. La monture arrive au lot 5.
        </p>
      </header>

      <Camera />

      <footer className="app__footer">
        <p>
          Aucun réglage de taille n&apos;est proposé, et il n&apos;y en aura jamais :
          l&apos;échelle est <strong>calculée</strong>, jamais saisie (§1 bug #1).
        </p>
      </footer>
    </main>
  );
}
