import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// PolyChat 新版 UI v2：独立构建，产物输出到 web/v2/，由服务端 /v2 路由提供服务。
export default defineConfig({
  root: resolve(import.meta.dirname),
  base: '/v2/',
  build: {
    outDir: resolve(import.meta.dirname, '../web/v2'),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': process.env.POLYCHAT_API || 'http://127.0.0.1:3000',
      '/ws': { target: process.env.POLYCHAT_API || 'http://127.0.0.1:3000', ws: true },
    },
  },
});
