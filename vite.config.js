import { defineConfig } from 'vite';

export default defineConfig({
  // The Verovio module embeds a ~7 MB WASM payload; skip dependency pre-bundling for it.
  optimizeDeps: { exclude: ['verovio'] },
  build: { chunkSizeWarningLimit: 9000 },
  // Don't watch the Python venv, the SoundFont, or rendered audio: they're large and not app
  // source (re-rendered media is picked up on the next page load).
  server: { watch: { ignored: ['**/.venv/**', '**/vendor/**', '**/public/media/**'] } },
});
