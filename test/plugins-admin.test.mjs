import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import AdmZip from 'adm-zip';

// WebUI 插件管理测试：从 URL 热安装 / 启停 / 卸载（外部插件）、内置插件不可卸载。
const temporary = mkdtempSync(join(tmpdir(), 'polychat-plugins-admin-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = join(temporary, 'test.db');
process.env.UPLOAD_DIR = join(temporary, 'uploads');
process.env.AVATAR_DIR = join(temporary, 'avatars');
process.env.FILE_URL_SECRET = 'test-file-secret';
const configPath = join(temporary, 'plugins.json');
process.env.PLUGINS_CONFIG_PATH = configPath;
const pluginsDir = join(temporary, 'plugins');   // 外部插件安装目录（隔离真实 plugins/）
process.env.PLUGINS_DIR = pluginsDir;

// 造一个待安装的插件 zip：polychat-plugin-demo，注册 GET /api/demo 路由
const demoZip = new AdmZip();
demoZip.addFile('demo/package.json', Buffer.from(JSON.stringify({ name: 'polychat-plugin-demo', version: '1.0.0', type: 'module', main: 'index.js' })));
demoZip.addFile('demo/index.js', Buffer.from(`
  export default {
    name: 'demo',
    version: '1.0.0',
    description: '测试插件',
    enabledByDefault: true,
    defaultConfig: { greeting: 'hi' },
    setup(ctx) {
      ctx.registry.registerApiRoute('GET', '/api/demo', (req, res) => ctx.json(res, 200, { hello: ctx.pluginConfig.greeting }));
    }
  };
`));
const zipBytes = demoZip.toBuffer();

// 本地 HTTP 服务提供 zip 下载
const zipServer = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/zip' });
  res.end(zipBytes);
});
await new Promise(resolve => zipServer.listen(0, '127.0.0.1', resolve));
const zipUrl = `http://127.0.0.1:${zipServer.address().port}/demo.zip`;

const { server, db } = await import('../server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const api = (path, options = {}) => fetch(`${base}${path}`, { headers: { 'content-type': 'application/json', ...options.headers }, ...options });

// 第一个注册用户自动成为管理员，供管理端点测试复用。
const adminReg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'plug_admin', password: 'plug-admin-password' }) });
const adminAuth = { authorization: `Bearer ${(await adminReg.json()).token}` };

test.after(async () => {
  zipServer.close();
  server.close();
  db.close();
  rmSync(temporary, { recursive: true, force: true });
});

test('管理员安装/启停/卸载外部插件（热加载，无需重启）', async () => {
  const auth = adminAuth;

  // 安装前：demo 不存在，/api/demo 404
  assert.equal((await api('/api/demo')).status, 404);

  // 从 URL 安装 → 热加载
  const install = await api('/api/admin/plugins/install', { method: 'POST', headers: auth, body: JSON.stringify({ url: zipUrl }) });
  assert.equal(install.status, 201);
  assert.equal((await api('/api/demo')).status, 200);
  assert.deepEqual(await (await api('/api/demo')).json(), { hello: 'hi' });
  assert.ok(existsSync(join(pluginsDir, 'polychat-plugin-demo')), '插件目录应存在');
  let list = (await (await api('/api/plugins')).json()).plugins;
  assert.ok(list.some(p => p.name === 'demo' && p.enabled && p.source === 'external' && p.install_method === 'url'));

  // 停用 → 路由消失（热移除）
  const disable = await api(`/api/admin/plugins/demo/enabled`, { method: 'PATCH', headers: auth, body: JSON.stringify({ enabled: false }) });
  assert.equal(disable.status, 200);
  assert.equal((await api('/api/demo')).status, 404);
  list = (await (await api('/api/plugins')).json()).plugins;
  assert.equal(list.find(p => p.name === 'demo').enabled, false);

  // 启用 → 路由恢复（热加载）
  const enable = await api(`/api/admin/plugins/demo/enabled`, { method: 'PATCH', headers: auth, body: JSON.stringify({ enabled: true }) });
  assert.equal(enable.status, 200);
  assert.equal((await api('/api/demo')).status, 200);

  // 卸载 → 路由消失 + 目录删除 + config 剪除
  const uninstall = await api('/api/admin/plugins/demo', { method: 'DELETE', headers: auth, body: JSON.stringify({ delete_config: true }) });
  assert.equal(uninstall.status, 200);
  assert.equal((await api('/api/demo')).status, 404);
  assert.equal(existsSync(join(pluginsDir, 'polychat-plugin-demo')), false, '插件目录应被删除');
  list = (await (await api('/api/plugins')).json()).plugins;
  assert.equal(list.some(p => p.name === 'demo'), false);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(config.plugins.demo, undefined, '配置应被剪除');
});

test('内置插件不可卸载（只能停用）', async () => {
  const auth = adminAuth;
  const res = await api('/api/admin/plugins/health', { method: 'DELETE', headers: auth });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /内置插件不可卸载/);
  // 内置插件仍可停用
  const disable = await api('/api/admin/plugins/health/enabled', { method: 'PATCH', headers: auth, body: JSON.stringify({ enabled: false }) });
  assert.equal(disable.status, 200);
  assert.equal((await api('/api/health')).status, 404);
  // 复原
  await api('/api/admin/plugins/health/enabled', { method: 'PATCH', headers: auth, body: JSON.stringify({ enabled: true }) });
  assert.equal((await api('/api/health')).status, 200);
});

test('插件管理端点需要管理员权限', async () => {
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'plug_user', password: 'plug-user-password' }) });
  const auth = { authorization: `Bearer ${(await reg.json()).token}` };
  assert.equal((await api('/api/admin/plugins/install', { method: 'POST', headers: auth, body: JSON.stringify({ url: zipUrl }) })).status, 403);
  assert.equal((await api('/api/admin/plugins/market', { headers: auth })).status, 403);
  assert.equal((await api('/api/admin/plugins/health', { method: 'DELETE', headers: auth })).status, 403);
});
