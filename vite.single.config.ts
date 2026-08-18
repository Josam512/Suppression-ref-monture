import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build de la PAGE AUTONOME : un seul fichier JavaScript, sans import dynamique.
 *
 * ⚠️ Ce n'est pas le build de production — celui-là reste `vite.config.ts`, qui
 * découpe en morceaux et laisse un serveur livrer les fichiers lourds. Ici on
 * vise l'inverse : tout dans un fichier, parce qu'il n'y a pas de serveur.
 */
export default defineConfig({
  plugins: [react()],
  // ⚠️ Sans cela, le bundle React garde ses tests `process.env.NODE_ENV` et la
  // page meurt sur « process is not defined » : il n'y a pas de bundler pour
  // les résoudre au chargement.
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist-single',
    emptyOutDir: true,
    target: 'es2022',
    lib: { entry: 'src/main.tsx', formats: ['iife'], name: 'Essayage', fileName: () => 'app.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
