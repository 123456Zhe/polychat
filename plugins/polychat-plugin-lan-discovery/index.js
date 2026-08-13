import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 局域网发现端点：为未来客户端（Android/GUI 恢复自动发现）预留的服务器元信息。
// 规划：v2 在 heartbeat 中发送 UDP/multicast beacon（本轮不做）。
export default {
  name: 'lan-discovery',
  version: '1.0.0',
  description: '局域网发现端点 GET /api/discovery（服务器元信息，未来客户端自动发现预留）',
  enabledByDefault: true,
  defaultConfig: {},
  setup(ctx) {
    const { registry, json, requireUser, db, env, onlineUsers } = ctx;
    const startTime = Date.now();
    let version = '1.0.0';
    try { version = JSON.parse(readFileSync(join(ctx.root, 'package.json'), 'utf8')).version || '1.0.0'; } catch { /* 独立 SEA 部署无 package.json */ }
    registry.registerApiRoute('GET', '/api/discovery', (req, res) => {
      const user = requireUser(req, res); if (!user) return;
      const rooms = db.prepare('SELECT COUNT(*) AS c FROM rooms').get().c;
      return json(res, 200, {
        name: env.POLYCHAT_NAME || 'PolyChat',
        version,
        host: env.HOST || '0.0.0.0',
        port: Number(env.PORT || 3000),
        rooms,
        // 核心传入的 onlineUsers 是返回数组的函数；Set/数组/对象兜底表达式保留
        online: typeof onlineUsers === 'function'
          ? (onlineUsers()?.length ?? 0)
          : (onlineUsers?.size ?? onlineUsers?.length ?? 0),
        uptime_ms: Date.now() - startTime,
        features: ['rooms', 'dm', 'friends', 'upload', 'p2p', 'push', 'onebot', 'gallery']
      });
    });
  }
};
