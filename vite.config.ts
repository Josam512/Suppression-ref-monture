import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Le projet tourne OBLIGATOIREMENT sur un serveur de dev (§1 bug #5).
 *
 * `http://localhost` est un *secure context* : `navigator.mediaDevices` y est
 * disponible. Un fichier ouvert en `file://` ne l'est pas — c'est la cause du
 * « Permission denied » sans que le navigateur demande l'autorisation.
 * Ne JAMAIS livrer un .html à double-cliquer.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
  },
});
