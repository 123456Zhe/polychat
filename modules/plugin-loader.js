// Plugin loader: discovers plugins, auto-generates/migrates their config
// (`data/plugins.json`) and wires each one into the server through the
// registry. Built-in plugins are statically imported so esbuild bundles them
// into the single-file / SEA build — the default deployment stays a single
// self-contained binary. External plugins (dropped into the plugins/ dir or
// installed from npm under the `polychat-plugin-*` naming convention) are
// loaded dynamically and require a directory deployment.
//
// Config auto-migration: on every startup the config file is regenerated with
// defaults for newly discovered plugins, pruned of removed ones, and merged
// key-by-key with each plugin's declared `defaultConfig` (stored values win,
// new keys fall back to defaults) — so existing deployments upgrade with zero
// manual steps.
//
// Runtime management (used by the admin plugin-management APIs): plugins can
// be hot-installed (from URL / upload), enabled/disabled and uninstalled
// without a restart — setup() may return a cleanup function which is invoked
// on disable/uninstall.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';

import backupPlugin from '../plugins/polychat-plugin-backup/index.js';
import healthPlugin from '../plugins/polychat-plugin-health/index.js';
import announcementPlugin from '../plugins/polychat-plugin-announcement/index.js';
import webPushPlugin from '../plugins/polychat-plugin-web-push/index.js';
import p2pPlugin from '../plugins/polychat-plugin-p2p/index.js';
import onebotPlugin from '../plugins/polychat-plugin-onebot/index.js';
import galleryPlugin from '../plugins/polychat-plugin-gallery/index.js';

const PLUGIN_PREFIX = 'polychat-plugin-';
const CONFIG_VERSION = 1;

// Built-ins are statically imported (SEA-safe). To add one: drop its module in
// here and create plugins/polychat-plugin-<name>/. To disable by default set
// `enabledByDefault: false` in the plugin manifest.
const BUILTIN_MODULES = {
  backup: backupPlugin,
  health: healthPlugin,
  announcement: announcementPlugin,
  'web-push': webPushPlugin,
  p2p: p2pPlugin,
  onebot: onebotPlugin,
  gallery: galleryPlugin
};
const BUILTINS = Object.values(BUILTIN_MODULES);

// Runtime state for hot management (enable/disable/uninstall).
const installed = new Map();  // name -> { meta, record, cleanup, source, modulePath }
const cleanups = new Map();   // name -> cleanup fn returned by setup()

// Serialize management operations (install/uninstall/enable) to avoid races.
let managementQueue = Promise.resolve();
function withManagementLock(fn) {
  const run = managementQueue.then(fn, fn);
  managementQueue = run.catch(() => {});
  return run;
}

function normalizePlugin(mod) {
  return {
    name: String(mod?.name || ''),
    version: String(mod?.version || '0.0.0'),
    description: String(mod?.description || ''),
    enabledByDefault: mod?.enabledByDefault !== false,
    defaultConfig: mod?.defaultConfig && typeof mod.defaultConfig === 'object' ? mod.defaultConfig : {},
    setup: typeof mod?.setup === 'function' ? mod.setup : () => {}
  };
}

function disabledSet() {
  return new Set((process.env.DISABLED_PLUGINS || '').split(',').map(s => s.trim()).filter(Boolean));
}

function pluginDir(ctx) {
  return process.env.PLUGINS_DIR || join(ctx.root, 'plugins');
}

function safeReaddir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

function statIsDir(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

// Per-plugin registry proxy: every registration is tagged with the plugin name
// so `registry.removePlugin(name)` can hot-unregister it later.
function pluginRegistryFor(registry, name) {
  return {
    ...registry,
    registerApiRoute: (method, pattern, handler) => registry.registerApiRoute(method, pattern, handler, name),
    registerWsMessage: (type, handler) => registry.registerWsMessage(type, handler, name),
    registerHeartbeat: (fn) => registry.registerHeartbeat(fn, name),
    registerCleanup: (fn) => registry.registerCleanup(fn, name),
    provide: (serviceName, service) => registry.provide(serviceName, service, name)
  };
}

// ── config file (auto-generate + auto-migrate) ─────────────────────────────

function configPath(ctx) {
  return process.env.PLUGINS_CONFIG_PATH || join(ctx.root, 'data', 'plugins.json');
}

function loadConfig(ctx) {
  const path = configPath(ctx);
  let data = { version: CONFIG_VERSION, plugins: {} };
  try {
    data = { version: CONFIG_VERSION, plugins: {}, ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch { /* first run — start from defaults */ }
  if (!data.plugins || typeof data.plugins !== 'object') data.plugins = {};
  return { path, data, changed: false };
}

// Add missing plugins, merge stored config with manifest defaults key-by-key.
function migratePluginConfig(meta, config) {
  const entry = config.data.plugins[meta.name];
  if (!entry || typeof entry !== 'object') {
    config.data.plugins[meta.name] = { enabled: meta.enabledByDefault, config: { ...meta.defaultConfig } };
    config.changed = true;
  } else {
    const merged = { ...meta.defaultConfig, ...(entry.config || {}) };
    if (JSON.stringify(merged) !== JSON.stringify(entry.config)) {
      entry.config = merged;
      config.changed = true;
    }
  }
  return config.data.plugins[meta.name];
}

function saveConfig(config) {
  if (!config.changed) return;
  try {
    mkdirSync(dirname(config.path), { recursive: true });
    writeFileSync(config.path, JSON.stringify(config.data, null, 2) + '\n');
  } catch (error) {
    console.error('Failed to save plugin config:', error.message);
  }
}

// ── install one plugin into the registry ───────────────────────────────────

function install(meta, ctx, registry, config, disabledEnv, source, modulePath = '', installMethod = null) {
  const entry = migratePluginConfig(meta, config);
  const enabled = !disabledEnv.has(meta.name) && entry.enabled !== false;
  const record = { name: meta.name, version: meta.version, description: meta.description, source, enabled: false };
  if (installMethod) record.install_method = installMethod;
  if (!enabled) {
    registry.recordPlugin(record);
    return { meta, record, installed: false };
  }
  try {
    const setupCtx = { ...ctx, registry: pluginRegistryFor(ctx.registry, meta.name), pluginConfig: entry.config || {} };
    const cleanup = meta.setup(setupCtx);
    record.enabled = true;
    if (typeof cleanup === 'function') cleanups.set(meta.name, cleanup);
    registry.recordPlugin(record);
    installed.set(meta.name, { meta, record, cleanup, source, modulePath });
    return { meta, record, installed: true };
  } catch (error) {
    console.error(`Plugin "${meta.name}" failed to start:`, error);
    record.enabled = false;
    record.error = error.message;
    registry.recordPlugin(record);
    return { meta, record, installed: false };
  }
}

// ── zip package helpers (install from URL / upload) ────────────────────────

function isPluginPackage(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof pkg.name === 'string' && pkg.name.startsWith(PLUGIN_PREFIX) && existsSync(join(dir, 'index.js'));
  } catch { return false; }
}

// Locate the plugin package inside an extracted archive (top 2 levels).
function findPluginPackage(root) {
  if (isPluginPackage(root)) return root;
  for (const entry of safeReaddir(root)) {
    const sub = join(root, entry);
    if (!statIsDir(sub)) continue;
    if (isPluginPackage(sub)) return sub;
    for (const entry2 of safeReaddir(sub)) {
      const sub2 = join(sub, entry2);
      if (statIsDir(sub2) && isPluginPackage(sub2)) return sub2;
    }
  }
  return null;
}

// Shared install path for URL/upload: extract → locate package → move into
// plugins/ → config migrate → hot setup.
async function installPluginPackage(ctx, registry, { zipPath, installMethod }) {
  const extractDir = mkdtempSync(join(tmpdir(), 'polychat-plugin-'));
  try {
    new AdmZip(zipPath).extractAllTo(extractDir, true);
    const pkgDir = findPluginPackage(extractDir);
    if (!pkgDir) throw new Error('压缩包中未找到 polychat-plugin-* 插件（需要 package.json 的 name 以 polychat-plugin- 开头）');
    const pkgName = String(JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).name || '');
    const name = pkgName.startsWith(PLUGIN_PREFIX) ? pkgName.slice(PLUGIN_PREFIX.length) : pkgName;
    if (!name || registry.listPlugins().some(p => p.name === name)) throw new Error(`插件 ${name} 已存在`);
    const targetDir = join(pluginDir(ctx), `${PLUGIN_PREFIX}${name}`);
    if (existsSync(targetDir)) throw new Error(`插件目录 ${targetDir} 已存在`);
    mkdirSync(pluginDir(ctx), { recursive: true });
    renameSync(pkgDir, targetDir);

    const mod = await import(pathToFileURL(join(targetDir, 'index.js')).href);
    const meta = normalizePlugin(mod?.default || mod);
    const config = loadConfig(ctx);
    const result = install(meta, ctx, registry, config, disabledSet(), 'external', targetDir, installMethod);
    saveConfig(config);
    if (!result.installed) throw new Error(`插件 ${name} 启动失败：${result.record.error || '未知错误'}（目录已保留，可卸载）`);
    return { name, version: meta.version, description: meta.description, installed: true };
  } finally {
    try { rmSync(extractDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(zipPath, { force: true }); } catch { /* ignore */ }
  }
}

// ── runtime management (admin API) ─────────────────────────────────────────

// GitHub 仓库页 URL → codeload 归档 zip（纯 HTTP，无需 git 二进制）。
async function resolveDownloadUrl(url) {
  const match = String(url).match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (!match) return url;
  const [, owner, repo] = match;
  let branch = 'main';
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'polychat-server' }, signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const data = await res.json();
      if (data.default_branch) branch = data.default_branch;
    }
  } catch { /* 回退 main */ }
  return `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`;
}

export function installPluginFromUrl(ctx, registry, { url, download_url } = {}) {
  return withManagementLock(async () => {
    const raw = String(download_url || url || '').trim();
    if (!raw) throw new Error('缺少插件地址');
    if (!/^https?:\/\//i.test(raw)) throw new Error('插件地址必须是 http(s) URL');
    const target = await resolveDownloadUrl(raw);
    const res = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
    const zipPath = join(tmpdir(), `polychat-plugin-${Date.now()}.zip`);
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
    return installPluginPackage(ctx, registry, { zipPath, installMethod: 'url' });
  });
}

export function installPluginFromUpload(ctx, registry, bytes, { filename = '' } = {}) {
  return withManagementLock(async () => {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('上传内容为空');
    const safe = String(filename || 'plugin.zip').replace(/[^\w.\-]/g, '_');
    const zipPath = join(tmpdir(), `polychat-plugin-${Date.now()}-${safe}`);
    writeFileSync(zipPath, bytes);
    return installPluginPackage(ctx, registry, { zipPath, installMethod: 'upload' });
  });
}

export function uninstallPlugin(ctx, registry, name, { delete_config = false } = {}) {
  return withManagementLock(async () => {
    const plugin = installed.get(name);
    const record = registry.listPlugins().find(p => p.name === name);
    if (!plugin && !record) throw new Error(`插件 ${name} 不存在`);
    if (record?.source === 'builtin' || plugin?.source === 'builtin') throw new Error('内置插件不可卸载，只能停用');

    if (plugin) {
      try { if (typeof plugin.cleanup === 'function') await plugin.cleanup(); } catch (e) { console.error(`Plugin ${name} cleanup error:`, e); }
      registry.removePlugin(name);
      registry.unrecordPlugin(name);
      cleanups.delete(name);
      installed.delete(name);
      if (plugin.modulePath) {
        try { rmSync(plugin.modulePath, { recursive: true, force: true }); } catch (e) { console.error(`Failed to remove ${plugin.modulePath}:`, e.message); }
      }
    } else if (record && record.source === 'external') {
      // 未加载（配置停用）的外部插件：按目录删除
      const dir = join(pluginDir(ctx), `${PLUGIN_PREFIX}${name}`);
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      registry.unrecordPlugin(name);
    }

    const config = loadConfig(ctx);
    if (config.data.plugins[name]) {
      delete config.data.plugins[name];
      config.changed = true;
      saveConfig(config);
    }
    return { ok: true };
  });
}

export function setPluginEnabled(ctx, registry, name, enabled) {
  return withManagementLock(async () => {
    const config = loadConfig(ctx);
    const entry = config.data.plugins[name];
    if (!entry) throw new Error(`插件 ${name} 未配置`);
    const plugin = installed.get(name);

    if (enabled) {
      if (plugin?.record?.enabled) return { ok: true, enabled: true };
      const mod = await loadPluginModule(ctx, name);
      if (!mod) throw new Error(`插件 ${name} 的模块不存在`);
      entry.enabled = true;
      const result = install(normalizePlugin(mod), ctx, registry, config, disabledSet(), sourceOf(ctx, name), modulePathOf(ctx, name));
      saveConfig(config);
      if (!result.installed) throw new Error(`插件 ${name} 启动失败：${result.record.error || '未知错误'}`);
      return { ok: true, enabled: true };
    }

    if (!plugin) {
      entry.enabled = false;
      saveConfig(config);
      return { ok: true, enabled: false };
    }
    try { if (typeof plugin.cleanup === 'function') await plugin.cleanup(); } catch (e) { console.error(`Plugin ${name} cleanup error:`, e); }
    registry.removePlugin(name);
    plugin.record.enabled = false;
    cleanups.delete(name);
    installed.delete(name);
    entry.enabled = false;
    saveConfig(config);
    return { ok: true, enabled: false };
  });
}

function sourceOf(ctx, name) {
  return BUILTIN_MODULES[name] ? 'builtin' : 'external';
}

function modulePathOf(ctx, name) {
  if (BUILTIN_MODULES[name]) return '';
  const dir = join(pluginDir(ctx), `${PLUGIN_PREFIX}${name}`);
  return existsSync(join(dir, 'index.js')) ? dir : '';
}

async function loadPluginModule(ctx, name) {
  if (BUILTIN_MODULES[name]) return BUILTIN_MODULES[name];
  const dir = join(pluginDir(ctx), `${PLUGIN_PREFIX}${name}`);
  const entryFile = join(dir, 'index.js');
  if (!existsSync(entryFile)) return null;
  const mod = await import(pathToFileURL(entryFile).href);
  return mod?.default || mod;
}

// 插件市场：优先 PLUGIN_MARKET_REGISTRY（JSON：{name,description,repo}[]），
// 否则用 GitHub 搜索 polychat-plugin-* 仓库。
export async function listMarketPlugins() {
  const registryUrl = String(process.env.PLUGIN_MARKET_REGISTRY || '').trim();
  if (registryUrl) {
    const res = await fetch(registryUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`插件源请求失败：HTTP ${res.status}`);
    return res.json();
  }
  const res = await fetch('https://api.github.com/search/repositories?q=polychat-plugin-+in:name&sort=updated&per_page=50', {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'polychat-server' },
    signal: AbortSignal.timeout(15_000)
  });
  if (!res.ok) throw new Error(`GitHub 搜索失败：HTTP ${res.status}`);
  const data = await res.json();
  return (data.items || [])
    .map(item => ({
      name: String(item.name || '').replace(/^polychat-plugin-/, ''),
      full_name: item.full_name,
      description: item.description || '',
      repo: item.html_url,
      stars: item.stargazers_count,
      updated_at: item.updated_at
    }))
    .filter(item => item.name);
}

// ── startup loading ────────────────────────────────────────────────────────

// Synchronous: built-in plugins are registered before the server starts
// listening so the first request already sees every route/WS handler.
export function setupPlugins(ctx, registry) {
  const config = loadConfig(ctx);
  const disabledEnv = disabledSet();
  for (const plugin of BUILTINS) {
    install(normalizePlugin(plugin), ctx, registry, config, disabledEnv, 'builtin');
  }
  saveConfig(config);
}

// Asynchronous: external plugins discovered by the `polychat-plugin-*` naming
// convention — from PLUGINS_DIR (default plugins/, e.g. git-cloned repos) and
// from node_modules (npm-installed packages). Built-in names always win.
export async function setupExternalPlugins(ctx, registry) {
  const config = loadConfig(ctx);
  const disabledEnv = disabledSet();
  const knownNames = new Set(BUILTINS.map(plugin => plugin.name));
  const found = new Map(); // name -> entry file URL

  const dir = pluginDir(ctx);
  for (const entry of safeReaddir(dir)) {
    if (!entry.startsWith(PLUGIN_PREFIX)) continue;
    const name = entry.slice(PLUGIN_PREFIX.length);
    if (!name || knownNames.has(name) || found.has(name)) continue;
    const pluginDir_ = join(dir, entry);
    const entryFile = join(pluginDir_, 'index.js');
    if (!statIsDir(pluginDir_) || !existsSync(entryFile)) continue;
    found.set(name, pathToFileURL(entryFile).href);
  }

  const nodeModulesDir = join(ctx.root, 'node_modules');
  for (const entry of safeReaddir(nodeModulesDir)) {
    if (!entry.startsWith(PLUGIN_PREFIX)) continue;
    const name = entry.slice(PLUGIN_PREFIX.length);
    if (!name || knownNames.has(name) || found.has(name)) continue;
    const pkgDir = join(nodeModulesDir, entry);
    if (!statIsDir(pkgDir)) continue;
    let main = 'index.js';
    try {
      const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
      if (typeof pkg.main === 'string') main = pkg.main;
    } catch { /* fall back to index.js */ }
    const entryFile = join(pkgDir, main);
    if (!existsSync(entryFile)) continue;
    found.set(name, pathToFileURL(entryFile).href);
  }

  for (const [name, href] of found) {
    try {
      const mod = await import(href);
      install(normalizePlugin(mod?.default || mod), ctx, registry, config, disabledEnv, 'external');
    } catch (error) {
      console.error(`External plugin "${name}" failed to load:`, error);
      registry.recordPlugin({ name, version: '', description: '', enabled: false, source: 'external', error: error.message });
    }
  }

  // Prune config entries for plugins that no longer exist.
  const allNames = new Set([...knownNames, ...found.keys()]);
  for (const name of Object.keys(config.data.plugins)) {
    if (!allNames.has(name)) {
      delete config.data.plugins[name];
      config.changed = true;
    }
  }
  saveConfig(config);
}
