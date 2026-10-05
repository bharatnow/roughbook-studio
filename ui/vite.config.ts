import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The local UI, built into dist/ui and served by `roughbook start`. Everything it needs is
// bundled: no fonts, scripts or styles come from anywhere else.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  plugins: [react(), tailwindcss()],
  // @roughbook/ui brings no React of its own; one copy, the studio's.
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    outDir: fileURLToPath(new URL('../dist/ui', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500
  },
  logLevel: 'warn'
});
