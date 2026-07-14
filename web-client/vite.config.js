import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [vue()],
  root: resolve(import.meta.dirname),
  build: { outDir: resolve(import.meta.dirname, '../web'), emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': process.env.POLYCHAT_API || 'http://127.0.0.1:3000' } },
});
