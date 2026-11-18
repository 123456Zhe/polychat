import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname, '../web');

// v1 与 v2 共享 web/ 作为输出根目录：v1 占 web/ 本身，v2 占 web/v2/。
// 不能用 emptyOutDir: true——Vite 会清空整个 web/，连带删掉 web/v2/，
// 之后 /v2 全部 404，直到有人重新跑 web:build:v2。
// 改为只清 v1 自己的输出范围：web/ 下除 v2/ 之外的所有内容。
function cleanV1OutDir() {
  return {
    name: 'clean-v1-out-dir',
    // 只在 build 时生效：dev 模式下 buildStart 也会跑，不加 apply 会把 web/ 的构建产物删掉
    apply: 'build',
    buildStart() {
      if (!existsSync(outDir)) return;
      for (const name of readdirSync(outDir)) {
        if (name === 'v2') continue;
        rmSync(resolve(outDir, name), { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [vue(), cleanV1OutDir()],
  root: resolve(import.meta.dirname),
  build: { outDir, emptyOutDir: false },
  server: {
    port: 5173,
    proxy: {
      '/api': process.env.POLYCHAT_API || 'http://127.0.0.1:3000',
      '/ws': { target: process.env.POLYCHAT_API || 'http://127.0.0.1:3000', ws: true },
    },
  },
});
