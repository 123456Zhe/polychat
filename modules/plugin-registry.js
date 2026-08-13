// Plugin registry: the single wiring point between the core server and plugins.
// Plugins receive this registry via `ctx.registry` and register their HTTP
// routes, WS message handlers, heartbeat/cleanup hooks, and named services.
// The core server consults the same collections when dispatching requests,
// WS messages and timers, so plugins never need to import server.mjs.
//
// Public interface (also documented in docs/PLUGIN_API.md):
//   registerApiRoute(method, pattern, handler)   — pattern: exact string or RegExp; handler(req, res, url) must respond itself
//   registerWsMessage(type, handler)             — handler(client, event) for WS messages of the given type
//   registerHeartbeat(fn)                        — called every 30s alongside the socket heartbeat
//   registerCleanup(fn)                          — called by cleanupExpiredData()
//   provide(name, service) / service(name)       — plugin-to-core (or plugin-to-plugin) service lookup
//   removePlugin(name)                           — unregister everything a plugin registered (used on uninstall/disable)
//
// Every registration records the owning plugin name (null = core), so a plugin
// can be hot-removed by name. The loader passes the plugin name as `owner`.

export function createPluginRegistry() {
  const apiRoutes = [];
  const wsHandlers = new Map();       // type -> handler
  const wsHandlerOwners = new Map();  // type -> owner
  const heartbeatFns = [];            // { fn, owner }
  const cleanupFns = [];              // { fn, owner }
  const services = {};                // name -> service
  const serviceOwners = {};           // name -> owner
  const enabledPlugins = [];          // plugin records (for /api/plugins list)

  return {
    // Collections read by the core dispatcher.
    apiRoutes,
    wsHandlers,
    heartbeatFns,
    cleanupFns,

    // Registration API used by plugins.
    registerApiRoute(method, pattern, handler, owner = null) {
      apiRoutes.push({ method, pattern, handler, owner });
    },
    registerWsMessage(type, handler, owner = null) {
      wsHandlers.set(type, handler);
      wsHandlerOwners.set(type, owner);
    },
    registerHeartbeat(fn, owner = null) {
      heartbeatFns.push({ fn, owner });
    },
    registerCleanup(fn, owner = null) {
      cleanupFns.push({ fn, owner });
    },
    provide(name, service, owner = null) {
      services[name] = service;
      serviceOwners[name] = owner;
    },
    service(name) {
      return services[name];
    },

    // Hot removal: drop every registration owned by a plugin (uninstall/disable).
    removePlugin(name) {
      for (let i = apiRoutes.length - 1; i >= 0; i--) {
        if (apiRoutes[i].owner === name) apiRoutes.splice(i, 1);
      }
      for (const [type, owner] of wsHandlerOwners) {
        if (owner === name) {
          wsHandlers.delete(type);
          wsHandlerOwners.delete(type);
        }
      }
      for (const list of [heartbeatFns, cleanupFns]) {
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].owner === name) list.splice(i, 1);
        }
      }
      for (const key of Object.keys(serviceOwners)) {
        if (serviceOwners[key] === name) {
          delete services[key];
          delete serviceOwners[key];
        }
      }
    },

    // Bookkeeping used by the plugin loader (name/status/description listing).
    recordPlugin(meta) {
      enabledPlugins.push(meta);
    },
    unrecordPlugin(name) {
      for (let i = enabledPlugins.length - 1; i >= 0; i--) {
        if (enabledPlugins[i].name === name) enabledPlugins.splice(i, 1);
      }
    },
    listPlugins() {
      return enabledPlugins;
    }
  };
}
