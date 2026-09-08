import { defineConfig } from 'vite';

export default defineConfig({
  // Serve from the repo root so ../config.js imports resolve correctly
  root: '.',
  server: {
    fs: { allow: ['..'] },
    open: '/renderer/index.html',
    proxy: {
      '/health': 'http://127.0.0.1:5003',
      '/run': 'http://127.0.0.1:5003',
      '/status': 'http://127.0.0.1:5003',
      '/cancel': 'http://127.0.0.1:5003',
    },
  },
  build: {
    rollupOptions: {
      input: 'renderer/index.html',
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
