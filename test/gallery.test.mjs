import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporary = mkdtempSync(join(tmpdir(), 'polychat-gallery-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = join(temporary, 'test.db');
process.env.UPLOAD_DIR = join(temporary, 'uploads');
process.env.AVATAR_DIR = join(temporary, 'avatars');
process.env.FILE_URL_SECRET = 'test-file-secret';
const { server, db } = await import('../server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const api = (path, options = {}) => fetch(`${base}${path}`, { headers: { 'content-type': 'application/json', ...options.headers }, ...options });

test.after(async () => {
  server.close();
  db.close();
  rmSync(temporary, { recursive: true, force: true });
});

test('gallery 插件注册：/api/plugins 含 gallery，gallery_images 表存在', async () => {
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'gal_a', password: 'pw' }) });
  const auth = { authorization: `Bearer ${(await reg.json()).token}` };
  const list = await api('/api/plugins', { headers: auth });
  assert.ok((await list.json()).plugins.some(p => p.name === 'gallery'));
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gallery_images'").get();
  assert.ok(t);
});
