import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// DISABLED_PLUGINS 黑名单测试：独立进程（env 在 import server.mjs 前设置）。
const temporary = mkdtempSync(join(tmpdir(), 'polychat-plugins-disabled-'));
process.env.NODE_ENV = 'test';
process.env.DISABLED_PLUGINS = 'health,p2p';
process.env.DB_PATH = join(temporary, 'test.db');
process.env.UPLOAD_DIR = join(temporary, 'uploads');
process.env.AVATAR_DIR = join(temporary, 'avatars');
process.env.FILE_URL_SECRET = 'test-file-secret';
process.env.PLUGINS_CONFIG_PATH = join(temporary, 'plugins.json');

const { server, db } = await import('../server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const api = (path, options = {}) => fetch(`${base}${path}`, { headers: { 'content-type': 'application/json', ...options.headers }, ...options });

test.after(async () => {
  server.close();
  db.close();
  rmSync(temporary, { recursive: true, force: true });
});

test('DISABLED_PLUGINS 黑名单：health 与 p2p 停用，其余插件不受影响', async () => {
  assert.equal((await api('/api/health')).status, 404);
  assert.equal((await api('/api/p2p/config')).status, 404);
  // 未列入黑名单的插件照常注册（未登录返回 401 而非 404）
  assert.equal((await api('/api/admin/announcement')).status, 401);
  assert.equal((await api('/api/push/vapid-public-key')).status, 401);
});
