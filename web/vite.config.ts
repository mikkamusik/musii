import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const api = `http://127.0.0.1:${process.env.PORT || 8787}`;

export default defineConfig({
  root,
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: { '/api': { target: api, changeOrigin: true }, '/media': { target: api, changeOrigin: true } },
  },
});
