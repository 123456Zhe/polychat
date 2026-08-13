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

export function createPluginRegistry() {
  const apiRoutes = [];
  const wsHandlers = new Map();
  const heartbeatFns = [];
  const cleanupFns = [];
  const services = {};
  const enabledPlugins = [];

  return {
    // Collections read by the core dispatcher.
    apiRoutes,
    wsHandlers,
    heartbeatFns,
    cleanupFns,

    // Registration API used by plugins.
    registerApiRoute(method, pattern, handler) {
      apiRoutes.push({ method, pattern, handler });
    },
    registerWsMessage(type, handler) {
      wsHandlers.set(type, handler);
    },
    registerHeartbeat(fn) {
      heartbeatFns.push(fn);
    },
    registerCleanup(fn) {
      cleanupFns.push(fn);
    },
    provide(name, service) {
      services[name] = service;
    },
    service(name) {
      return services[name];
    },

    // Bookkeeping used by the plugin loader (name/status/description listing).
    recordPlugin(meta) {
      enabledPlugins.push(meta);
    },
    listPlugins() {
      return enabledPlugins;
    }
  };
}
