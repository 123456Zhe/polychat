import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 插件框架测试：配置自动迁移、配置禁用、管理员列表、外部插件投放与内置优先。
const temporary = mkdtempSync(join(tmpdir(), 'polychat-plugins-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = join(temporary, 'test.db');
process.env.UPLOAD_DIR = join(temporary, 'uploads');
process.env.AVATAR_DIR = join(temporary, 'avatars');
process.env.FILE_URL_SECRET = 'test-file-secret';
const configPath = join(temporary, 'plugins.json');
process.env.PLUGINS_CONFIG_PATH = configPath;

// 预置“旧部署”配置：只含部分插件、部分键不完整 → 启动时应自动迁移补全。
writeFileSync(configPath, JSON.stringify({
  version: 1,
  plugins: {
    health: { enabled: true, config: { extra: 'stale' } },
    p2p: { enabled: false, config: { minSize: 999 } }
  }
}));

const { server, db, loadExternalPlugins } = await import('../server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const api = (path, options = {}) => fetch(`${base}${path}`, { headers: { 'content-type': 'application/json', ...options.headers }, ...options });

test.after(async () => {
  server.close();
  db.close();
  rmSync(temporary, { recursive: true, force: true });
});

test('插件配置自动迁移：缺插件自动补全、旧配置键并入默认值、写回文件', () => {
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  // 缺失的 backup / announcement / web-push / onebot 已自动补全并默认启用
  for (const name of ['backup', 'announcement', 'web-push', 'onebot']) {
    assert.ok(raw.plugins[name], `缺少插件配置: ${name}`);
    assert.equal(raw.plugins[name].enabled, true);
  }
  // p2p：存储值优先，新增键补默认
  assert.equal(raw.plugins.p2p.enabled, false);
  assert.equal(raw.plugins.p2p.config.minSize, 999);           // 存储值优先
  assert.equal(raw.plugins.p2p.config.activeLimit, 10);        // 新键补默认
  assert.equal(raw.plugins.p2p.config.ttlMs, 900000);
  assert.equal(raw.plugins.p2p.config.connectTimeoutMs, 30000);
  // health：自定义存储键保留
  assert.equal(raw.plugins.health.config.extra, 'stale');
});

test('配置中停用的插件不注册路由（p2p → /api/p2p/config 404）', async () => {
  assert.equal((await api('/api/p2p/config')).status, 404);
});

test('启用的插件路由生效（health 200 / 公告与 push 需登录返回 401）', async () => {
  assert.equal((await api('/api/health')).status, 200);
  assert.equal((await api('/api/admin/announcement')).status, 401);
  assert.equal((await api('/api/push/vapid-public-key')).status, 401);
});

test('管理员可列出插件名称与状态', async () => {
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'admin_plug', password: 'plug-password-1' }) });
  const auth = { authorization: `Bearer ${(await reg.json()).token}` };
  const res = await api('/api/admin/plugins', { headers: auth });
  assert.equal(res.status, 200);
  const plugins = (await res.json()).plugins;
  const names = plugins.map(p => p.name);
  for (const name of ['backup', 'health', 'announcement', 'web-push', 'p2p', 'onebot']) assert.ok(names.includes(name), `缺少 ${name}`);
  assert.equal(plugins.find(p => p.name === 'p2p').enabled, false); // 配置中禁用
  assert.equal(plugins.find(p => p.name === 'onebot').source, 'builtin');
});

test('公开插件状态端点 /api/plugins 无需登录返回启用状态', async () => {
  const res = await api('/api/plugins');
  assert.equal(res.status, 200);
  const plugins = (await res.json()).plugins;
  assert.ok(plugins.some(p => p.name === 'onebot' && p.enabled));
  assert.ok(plugins.some(p => p.name === 'health' && p.enabled));
  assert.ok(plugins.some(p => p.name === 'p2p' && !p.enabled)); // 配置中禁用
});

test('外部插件：PLUGINS_DIR 投放 polychat-plugin-demo 生效，内置同名冲突内置优先', async () => {
  const pluginsDir = join(temporary, 'external-plugins');
  const demoDir = join(pluginsDir, 'polychat-plugin-demo');
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(join(demoDir, 'package.json'), JSON.stringify({ name: 'polychat-plugin-demo', version: '1.0.0', type: 'module', main: 'index.js' }));
  writeFileSync(join(demoDir, 'index.js'), `
    export default {
      name: 'demo',
      version: '1.0.0',
      description: '测试外部插件',
      enabledByDefault: true,
      defaultConfig: { greeting: 'hi' },
      setup(ctx) {
        ctx.registry.registerApiRoute('GET', '/api/demo', (req, res) => ctx.json(res, 200, { hello: ctx.pluginConfig.greeting }));
      }
    };
  `);
  // 与内置同名的外部插件：内置应优先，其路由不应注册
  const clashDir = join(pluginsDir, 'polychat-plugin-health');
  mkdirSync(clashDir, { recursive: true });
  writeFileSync(join(clashDir, 'index.js'), `export default { name: 'health', setup(ctx) { ctx.registry.registerApiRoute('GET', '/api/demo-clash', (req, res) => ctx.json(res, 200, { clash: true })); } };`);

  process.env.PLUGINS_DIR = pluginsDir;
  await loadExternalPlugins();
  delete process.env.PLUGINS_DIR;

  const demo = await api('/api/demo');
  assert.equal(demo.status, 200);
  assert.deepEqual(await demo.json(), { hello: 'hi' });
  assert.equal((await api('/api/demo-clash')).status, 404); // 内置优先

  // 外部插件并入配置并写回
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(raw.plugins.demo.enabled, true);
  assert.equal(raw.plugins.demo.config.greeting, 'hi');
});
