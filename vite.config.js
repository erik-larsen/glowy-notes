import { defineConfig } from 'vite';

export default defineConfig({
  // The Verovio module embeds a ~7 MB WASM payload; skip dependency pre-bundling for it.
  optimizeDeps: { exclude: ['verovio'] },
  build: { chunkSizeWarningLimit: 9000 },
});
