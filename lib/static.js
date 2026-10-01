import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { json } from './http.js';
import { PUBLIC, KATEX_DIST } from './config.js';
import embeddedAssets from '../embedded-assets.cjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

export function staticFile(res, pathname) {
  // Single-file build: assets live in the embedded map (web/ + KaTeX vendor).
  if (embeddedAssets) {
    const key = pathname === '/' ? '/index.html' : (pathname === '/v2' || pathname === '/v2/' ? '/v2/index.html' : pathname);
    const asset = embeddedAssets[key];
    if (!asset) return json(res, 404, { error: '页面不存在' });
    const cacheControl = key === '/index.html' || key === '/v2/index.html' || key === '/sw.js' ? 'no-cache' : 'public, max-age=31536000, immutable';
    res.writeHead(200, { 'content-type': asset.type, 'cache-control': cacheControl });
    return res.end(Buffer.from(asset.body, 'base64'));
  }
  let vendorFile = null;
  if (pathname === '/vendor/katex.min.css') vendorFile = join(KATEX_DIST, 'katex.min.css');
  else if (pathname === '/vendor/katex.min.js') vendorFile = join(KATEX_DIST, 'katex.min.js');
  else if (/^\/vendor\/fonts\/KaTeX_[A-Za-z0-9_-]+\.(woff2?|ttf)$/.test(pathname)) {
    vendorFile = join(KATEX_DIST, pathname.slice('/vendor/'.length));
  }
  if (vendorFile) {
    try {
      const body = readFileSync(vendorFile);
      res.writeHead(200, { 'content-type': MIME[extname(vendorFile)] || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' });
      return res.end(body);
    } catch { return json(res, 404, { error: '页面不存在' }); }
  }
  const relative = pathname === '/' ? 'index.html' : (pathname === '/v2' || pathname === '/v2/' ? 'v2/index.html' : pathname.slice(1));
  const safe = normalize(relative).replace(/^(\.\.[/\\])+/, '');
  const file = resolve(PUBLIC, safe);
  if (!file.startsWith(`${PUBLIC}/`) || !/^(index\.html|sw\.js|manifest\.json|icon-(?:192|512)\.png|v2\/index\.html|assets\/[A-Za-z0-9._-]+\.(?:js|css|png|woff2?|ttf)|v2\/assets\/[A-Za-z0-9._-]+\.(?:js|css|png|woff2?|ttf))$/.test(safe)) return json(res, 404, { error: '页面不存在' });
  try {
    const body = readFileSync(file);
    const cacheControl = safe === 'index.html' || safe === 'v2/index.html' || safe === 'sw.js' ? 'no-cache' : 'public, max-age=31536000, immutable';
    res.writeHead(200, { 'content-type': MIME[extname(safe)] || 'application/octet-stream', 'cache-control': cacheControl });
    res.end(body);
  } catch { json(res, 404, { error: '页面不存在' }); }
}
