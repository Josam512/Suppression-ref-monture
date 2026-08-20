// TEMPORAIRE : build IIFE du banc HUD (mêmes réglages que vite.single.config.ts).
import { defineConfig } from 'vite';
export default defineConfig({
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist-single',
    emptyOutDir: false,
    target: 'es2022',
    lib: { entry: 'gate-entry.tmp.ts', formats: ['iife'], name: 'GateHud', fileName: () => 'gate.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
