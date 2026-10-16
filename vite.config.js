import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'build', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' }
});
