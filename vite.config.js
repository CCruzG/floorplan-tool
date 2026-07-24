import { defineConfig } from 'vite';

export default defineConfig({
  // Serve from the repo root so ../config.js imports resolve correctly
  root: '.',
  build: {
    rollupOptions: {
      input: 'renderer/index.html',
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    open: '/renderer/index.html',
  },
});
