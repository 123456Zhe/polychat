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

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import backupPlugin from '../plugins/polychat-plugin-backup/index.js';
import healthPlugin from '../plugins/polychat-plugin-health/index.js';
import announcementPlugin from '../plugins/polychat-plugin-announcement/index.js';
import webPushPlugin from '../plugins/polychat-plugin-web-push/index.js';
import p2pPlugin from '../plugins/polychat-plugin-p2p/index.js';
import onebotPlugin from '../plugins/polychat-plugin-onebot/index.js';

const PLUGIN_PREFIX = 'polychat-plugin-';
const CONFIG_VERSION = 1;

// Built-ins are statically imported (SEA-safe). To add one: drop its module in
// here and create plugins/polychat-plugin-<name>/. To disable by default set
// `enabledByDefault: false` in the plugin manifest.
const BUILTINS = [backupPlugin, healthPlugin, announcementPlugin, webPushPlugin, p2pPlugin, onebotPlugin];

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

function safeReaddir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

function statIsDir(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
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

function install(meta, ctx, registry, config, disabledEnv, source) {
  const entry = migratePluginConfig(meta, config);
  const enabled = !disabledEnv.has(meta.name) && entry.enabled !== false;
  if (!enabled) {
    registry.recordPlugin({ name: meta.name, version: meta.version, description: meta.description, enabled: false, source });
    return false;
  }
  try {
    meta.setup({ ...ctx, pluginConfig: entry.config || {} });
    registry.recordPlugin({ name: meta.name, version: meta.version, description: meta.description, enabled: true, source });
    return true;
  } catch (error) {
    console.error(`Plugin "${meta.name}" failed to start:`, error);
    registry.recordPlugin({ name: meta.name, version: meta.version, description: meta.description, enabled: false, source, error: error.message });
    return false;
  }
}

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

  const pluginDir = process.env.PLUGINS_DIR || join(ctx.root, 'plugins');
  for (const entry of safeReaddir(pluginDir)) {
    if (!entry.startsWith(PLUGIN_PREFIX)) continue;
    const name = entry.slice(PLUGIN_PREFIX.length);
    if (!name || knownNames.has(name) || found.has(name)) continue;
    const dir = join(pluginDir, entry);
    const entryFile = join(dir, 'index.js');
    if (!statIsDir(dir) || !existsSync(entryFile)) continue;
    found.set(name, pathToFileURL(entryFile).href);
  }

  const nodeModulesDir = join(ctx.root, 'node_modules');
  for (const entry of safeReaddir(nodeModulesDir)) {
    if (!entry.startsWith(PLUGIN_PREFIX)) continue;
    const name = entry.slice(PLUGIN_PREFIX.length);
    if (!name || knownNames.has(name) || found.has(name)) continue;
    const dir = join(nodeModulesDir, entry);
    if (!statIsDir(dir)) continue;
    let main = 'index.js';
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (typeof pkg.main === 'string') main = pkg.main;
    } catch { /* fall back to index.js */ }
    const entryFile = join(dir, main);
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
