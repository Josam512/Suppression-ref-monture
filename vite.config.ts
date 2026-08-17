import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le projet tourne obligatoirement sur un serveur de dev (secure context),
// jamais en file:// — cf. CLAUDE.md §1 bug #5.
/**
 * `base` — sous quel chemin le site est servi.
 *
 * ⚠️ En développement et au banc, c'est la racine. Sur GitHub Pages, le site vit
 * sous `/<repo>/`, et TOUT chemin de fichier écrit en absolu y rend un 404
 * silencieux. `src/ui/assetUrl.ts` est le seul point de passage ; un test et un
 * barrage du hook le vérifient.
 */
export default defineConfig({
  base: process.env['VITE_BASE'] ?? '/',
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      input: {
        // L'essayage client.
        main: 'index.html',
        // L'outil interne de préparation des montures — jamais montré à un client.
        prep: 'prep.html',
        // Outil de calibration du lot 8 — interne, jamais montré à un client.
        calib: 'calib.html',
      },
    },
  },
});
