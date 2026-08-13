#!/usr/bin/env node
// Build the PolyChat server as a single self-contained artifact.
//
//   1. esbuild bundles server.mjs + modules/onebot + ws + web-push into ONE
//      CommonJS file, with the web UI (web/) and KaTeX vendor files embedded
//      as an in-memory asset map (see the virtualAssets plugin below).
//   2. Node SEA (Single Executable Application) turns that bundle into a
//      standalone binary that needs no Node.js installation on the target host.
//
// Outputs:
//   dist/polychat-server.cjs   — single-file JS server (debug/CI; needs Node ≥22.5)
//   dist/polychat-server       — standalone executable (platform-specific,
//                                produced from the *same* Node that runs this script)
//
// The SEA binary embeds the exact Node.js runtime used at build time, so build
// it on the same platform (and ideally the same major Node version) as the
// deployment target.

import { execFileSync } from 'node:child_process';
import { copyFileSync, chmodSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER_ENTRY = join(ROOT, 'server.mjs');
const WEB_DIR = join(ROOT, 'web');
const KATEX_DIST = join(ROOT, 'node_modules', 'katex', 'dist');
const BUILD_DIR = join(ROOT, 'build');
const DIST_DIR = join(ROOT, 'dist');
const BUNDLE_FILE = join(BUILD_DIR, 'server.cjs');
const SEA_CONFIG = join(BUILD_DIR, 'sea-config.json');
const SEA_BLOB = join(BUILD_DIR, 'sea-prep.blob');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};
const typeOf = file => MIME[extname(file)] || 'application/octet-stream';

// ---- 1. Collect embedded static assets (mirrors server.mjs staticFile) ----
function collectAssets() {
  const assets = {};

  // web/ — every file is served as /<relative> (index.html is also '/').
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else {
        const urlPath = '/' + relative(WEB_DIR, file).replace(/\\/g, '/');
        assets[urlPath] = { type: typeOf(file), body: readFileSync(file).toString('base64') };
      }
    }
  };
  walk(WEB_DIR);

  // KaTeX vendor routes (used by the Android client's markdown renderer).
  for (const name of ['katex.min.css', 'katex.min.js']) {
    const file = join(KATEX_DIST, name);
    assets['/vendor/' + name] = { type: typeOf(file), body: readFileSync(file).toString('base64') };
  }
  for (const name of readdirSync(join(KATEX_DIST, 'fonts'))) {
    if (/^KaTeX_[A-Za-z0-9_-]+\.(woff2?|ttf)$/.test(name)) {
      const file = join(KATEX_DIST, 'fonts', name);
      assets['/vendor/fonts/' + name] = { type: typeOf(file), body: readFileSync(file).toString('base64') };
    }
  }
  return assets;
}

// ---- 2. esbuild bundle with embedded asset map injected ----
async function bundle(assets) {
  const assetSource = 'export default ' + JSON.stringify(assets) + ';\n';
  const virtualAssets = {
    name: 'embedded-assets',
    setup(build) {
      build.onResolve({ filter: /^\.\/embedded-assets\.cjs$/ }, () => ({ path: 'embedded-assets', namespace: 'assets' }));
      build.onLoad({ filter: /.*/, namespace: 'assets' }, () => ({ contents: assetSource, loader: 'js' }));
    },
  };
  await build({
    entryPoints: [SERVER_ENTRY],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: BUNDLE_FILE,
    plugins: [virtualAssets],
    logLevel: 'info',
    // server.mjs guards `import.meta.url` with `typeof __dirname`, so the empty
    // CJS shim esbuild emits for it is never evaluated at runtime.
    logOverride: { 'empty-import-meta': 'silent' },
  });
}

// ---- 3. SEA: preparation blob -> copy node binary -> postject inject ----
async function makeBinary() {
  const isWin = process.platform === 'win32';
  const outName = isWin ? 'polychat-server.exe' : 'polychat-server';
  const outFile = join(DIST_DIR, outName);

  writeFileSync(SEA_CONFIG, JSON.stringify({
    main: BUNDLE_FILE,
    output: SEA_BLOB,
    disableExperimentalSEAWarning: true,
  }, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG], { stdio: 'inherit' });

  // The base binary must be a real Node executable; process.execPath is the
  // Node this script runs under (must be ≥22.5 for node:sqlite).
  mkdirSync(DIST_DIR, { recursive: true });
  copyFileSync(process.execPath, outFile);

  const { inject } = await import('postject');
  await inject(outFile, 'NODE_SEA_BLOB', readFileSync(SEA_BLOB), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  });
  if (!isWin) chmodSync(outFile, 0o755);
  return outFile;
}

rmSync(BUILD_DIR, { recursive: true, force: true });
rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(BUILD_DIR, { recursive: true });
mkdirSync(DIST_DIR, { recursive: true });

const assets = collectAssets();
const assetsMb = Math.round(JSON.stringify(assets).length / 1024 / 1024 * 10) / 10;
console.log(`Embedding ${Object.keys(assets).length} static assets (~${assetsMb} MB base64)`);

await bundle(assets);

// Keep the bundled JS around too — handy for debugging and CI smoke tests.
copyFileSync(BUNDLE_FILE, join(DIST_DIR, 'polychat-server.cjs'));

const binary = await makeBinary();
const size = Math.round(statSync(binary).size / 1024 / 1024);
console.log(`\nDone. Single-file server built:\n  ${binary}  (${size} MB, standalone — needs no Node on the target host)`);
console.log(`  ${join(DIST_DIR, 'polychat-server.cjs')}  (bundled JS — needs Node ≥22.5)`);
