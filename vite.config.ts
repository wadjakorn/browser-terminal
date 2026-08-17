import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:7000',
      '/pty': { target: 'ws://127.0.0.1:7000', ws: true },
    },
  },
});
