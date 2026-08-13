import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporary = mkdtempSync(join(tmpdir(), 'polychat-discovery-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = join(temporary, 'test.db');
process.env.UPLOAD_DIR = join(temporary, 'uploads');
process.env.AVATAR_DIR = join(temporary, 'avatars');
process.env.FILE_URL_SECRET = 'test-file-secret';
const { server, db } = await import('../server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const api = (path, options = {}) => fetch(`${base}${path}`, { headers: { 'content-type': 'application/json', ...options.headers }, ...options });

// 注册密码需 8–128 位（server 校验）；brief 里的 'pw' 会被 400 拒绝
const PASSWORD = 'pw12345678';

async function registerUser(username) {
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username, password: PASSWORD }) });
  assert.equal(reg.status, 201);
  return { authorization: `Bearer ${(await reg.json()).token}` };
}

test.after(async () => {
  server.close();
  db.close();
  rmSync(temporary, { recursive: true, force: true });
});

test('lan-discovery 插件注册：/api/plugins 含 lan-discovery', async () => {
  const list = await api('/api/plugins');
  assert.ok((await list.json()).plugins.some(p => p.name === 'lan-discovery'));
});

test('局域网发现端点：登录返回完整字段', async () => {
  const auth = await registerUser('disc_a');
  const r = await api('/api/discovery', { headers: auth });
  assert.equal(r.status, 200);
  const body = await r.json();
  for (const k of ['name', 'version', 'host', 'port', 'rooms', 'online', 'uptime_ms', 'features']) assert.ok(k in body, `缺字段 ${k}`);
  assert.ok(Array.isArray(body.features));
  const anon = await api('/api/discovery');
  assert.equal(anon.status, 401);
});
