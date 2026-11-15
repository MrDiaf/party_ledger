import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:3000' },
  },
});
