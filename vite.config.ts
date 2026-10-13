import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build du renderer uniquement (C4 : pas de plugin Électron).
// Dev : `vite` sert src/renderer sur :5173, le main charge alors l'URL.
// Prod : sortie dans dist/renderer, chargée en fichier par le main.
export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
