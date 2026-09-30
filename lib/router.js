import { handleAuthRoutes } from '../routes/auth.js';
import { handleAdminRoutes } from '../routes/admin.js';
import { handleRoomRoutes } from '../routes/rooms.js';
import { handleFriendRoutes } from '../routes/friends.js';
import { handleFileRoutes } from '../routes/files.js';
import { handleDmRoutes } from '../routes/dm.js';
import { handleNotifyRoutes } from '../routes/notify.js';
import { json } from './http.js';

// 插件路由（/api/health、/api/p2p/*、/api/push/*、/api/admin/announcement 等）
// 由末尾的插件分发器处理，核心路由保持原有匹配顺序优先。
// 调用顺序与原 api() 中的 if 链一致（各匹配器路径前缀互不重叠，语义不变）。
export async function api(req, res, url, registry, pluginCtx) {
  if (await handleAuthRoutes(req, res, url, registry)) return;
  if (await handleAdminRoutes(req, res, url, registry, pluginCtx)) return;
  if (await handleRoomRoutes(req, res, url)) return;
  if (await handleFriendRoutes(req, res, url)) return;
  if (await handleFileRoutes(req, res, url)) return;
  if (await handleDmRoutes(req, res, url)) return;
  if (await handleNotifyRoutes(req, res, url)) return;

  // 插件 HTTP 路由分发（内置/外部插件注册，核心路由优先）
  for (const route of registry.apiRoutes) {
    if (route.method !== req.method) continue;
    const hit = typeof route.pattern === 'string' ? url.pathname === route.pattern : route.pattern.test(url.pathname);
    if (hit) return await route.handler(req, res, url);
  }

  return json(res, 404, { error: '接口不存在' });
}
