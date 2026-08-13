export default {
  name: 'health',
  version: '1.0.0',
  description: '健康检查端点 GET /api/health（uptime / version，不触碰数据库）',
  enabledByDefault: true,
  defaultConfig: {},
  setup(ctx) {
    const { registry, json } = ctx;
    const startTime = Date.now();
    registry.registerApiRoute('GET', '/api/health', (req, res) => {
      const uptimeMs = Date.now() - startTime;
      return json(res, 200, {
        status: 'ok',
        version: '1.0.0',
        uptime_ms: uptimeMs,
        uptime_human: `${Math.floor(uptimeMs / 86400000)}d ${Math.floor((uptimeMs % 86400000) / 3600000)}h ${Math.floor((uptimeMs % 3600000) / 60000)}m`
      });
    });
  }
};
