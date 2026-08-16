import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le projet tourne obligatoirement sur un serveur de dev (secure context),
// jamais en file:// — cf. CLAUDE.md §1 bug #5.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      input: {
        // L'essayage client.
        main: 'index.html',
        // L'outil interne de préparation des montures — jamais montré à un client.
        prep: 'prep.html',
      },
    },
  },
});
