// PolyChat server entry — thin composition root.
//
// 2026-09-30 refactor: the original 2160-line server.mjs was split verbatim
// into lib/ (config, db, eventbus, http, auth, users, access, realtime,
// messages, static) and routes/ (auth, admin, rooms, friends, files, dm,
// notify) plus lib/router.js (the api() dispatcher). This file keeps only
// wiring: registry, HTTP server, pluginCtx, WebSocket upgrade, heartbeat,
// cleanupExpiredData and the startup guard. No logic was changed.
import http from 'node:http';
import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { createPluginRegistry } from './modules/plugin-registry.js';
import { setupPlugins, setupExternalPlugins } from './modules/plugin-loader.js';

import {
  ROOT, HOST, PORT, DB_PATH, UPLOAD_DIR, AVATAR_DIR,
  MAX_FILE_SIZE, FILE_URL_SECRET, FILE_URL_TTL_MS,
} from './lib/config.js';
import { db } from './lib/db.js';
import { eventBus } from './lib/eventbus.js';
import { json, readBody } from './lib/http.js';
import { staticFile } from './lib/static.js';
import { api } from './lib/router.js';
import {
  currentUser, getClientIp, isFingerprintBanned, isIpBanned, isUserBanned, isUserMuted,
  logAudit, requireAdmin, requireUser, verifyPublicFileUrl,
} from './lib/auth.js';
import {
  createNotification, publicUser, validateMentions,
} from './lib/users.js';
import { hydrateMessages } from './lib/messages.js';
import {
  broadcast, broadcastDm, conversationMembers, onlineUsers,
  sendToUser, socketCanAccess, sockets, userOnline,
} from './lib/realtime.js';
import { isDmMember, roomForUser } from './lib/access.js';
export { db } from './lib/db.js';

// 插件注册表：插件通过它注册 HTTP 路由 / WS 消息处理 / 心跳 / 清理钩子，
// 核心分发器在下面读取同一批集合（详见 modules/plugin-loader.js 与 docs/PLUGIN_API.md）。
const registry = createPluginRegistry();

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url, registry, pluginCtx);
    else if (req.method === 'GET') staticFile(res, url.pathname);
    else json(res, 405, { error: '方法不支持' });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '服务器内部错误' });
  }
});

// Public-facing base URL. With the default wildcard bind (0.0.0.0) the server
// can't know its own reachable hostname, so fall back to localhost for URLs
// (file links, OneBot origin) unless the deployer sets PUBLIC_URL explicitly.
const publicHost = /^(0\.0\.0\.0|::|\[::\])$/.test(HOST) ? 'localhost' : HOST;
const publicBaseUrl = (process.env.PUBLIC_URL || `http://${publicHost}:${PORT}`).replace(/\/+$/, '');

// 插件装配：注入核心依赖（ctx），同步加载内置插件（backup/health/announcement/
// web-push/p2p/onebot）。外部插件（plugins/ 目录或 npm 的 polychat-plugin-*）在
// 非 test 启动路径下异步加载，见文件底部。
const pluginCtx = {
  root: ROOT, db, eventBus, registry, server, env: process.env,
  dbPath: DB_PATH, uploadDir: UPLOAD_DIR, avatarDir: AVATAR_DIR,
  maxFileSize: MAX_FILE_SIZE, publicBaseUrl, fileUrlSecret: FILE_URL_SECRET, fileUrlTtlMs: FILE_URL_TTL_MS,
  verifyPublicFileUrl,
  json, requireUser, requireAdmin, readBody, logAudit, getClientIp, publicUser,
  hydrateMessages, broadcast, broadcastDm, conversationMembers, socketCanAccess,
  onlineUsers, sendToUser, userOnline, createNotification, isUserBanned, isUserMuted,
  roomForUser, validateMentions, isDmMember
};
setupPlugins(pluginCtx, registry);

const webSocketServer = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  // /api/* 的 WS 升级交给插件自行处理（onebot 的 /api/onebot/ws、sanguosha 的 /api/sanguosha/ws 等），核心只负责 /ws。
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  if (url.pathname !== '/ws') return socket.destroy();
  const token = url.searchParams.get('token');
  if (token && !req.headers.authorization) req.headers.authorization = `Bearer ${token}`;
  const user = currentUser(req);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  if (isUserBanned(user)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  const wsIp = getClientIp(req);
  if (!user.is_admin && (isIpBanned(wsIp) || (user.device_fingerprint && isFingerprintBanned(user.device_fingerprint)))) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  webSocketServer.handleUpgrade(req, socket, head, client => {
    client.user = user;
    client.isAlive = true;
    sockets.add(client);
    client.send(JSON.stringify({ type: 'presence_snapshot', users: onlineUsers() }));
    broadcast({ type: 'presence', user_id: user.id, username: user.username, online: true });
    client.on('pong', () => { client.isAlive = true; });
    client.on('message', raw => {
      try {
        const event = JSON.parse(String(raw));
        if (event.type === 'typing') {
          const roomId = Number(event.room_id);
          if (!roomId || !socketCanAccess(client, roomId)) return;
          const payload = JSON.stringify({ type: 'typing', room_id: roomId, user_id: user.id, username: user.username, typing: Boolean(event.typing) });
          for (const peer of sockets) if (peer !== client && peer.readyState === 1 && socketCanAccess(peer, roomId)) peer.send(payload);
          return;
        }
        // 插件 WS 消息类型（如 p2p_signal → p2p 插件）。
        const pluginWsHandler = registry.wsHandlers.get(event.type);
        if (pluginWsHandler) pluginWsHandler(client, event);
      } catch { /* ignore malformed client messages */ }
    });
    client.on('close', () => {
      sockets.delete(client);
      if (![...sockets].some(peer => peer.user.id === user.id)) broadcast({ type: 'presence', user_id: user.id, username: user.username, online: false });
    });
    client.send(JSON.stringify({ type: 'ready' }));
  });
});
const heartbeat = setInterval(() => {
  for (const socket of sockets) {
    if (!socket.isAlive) { socket.terminate(); sockets.delete(socket); continue; }
    socket.isAlive = false;
    socket.ping();
  }
  for (const { fn } of registry.heartbeatFns) fn();
}, 30_000);
heartbeat.unref();

export function cleanupExpiredData() {
  const now = Date.now();
  try {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    db.prepare('DELETE FROM login_attempts WHERE created_at <= ?').run(now - 7 * 24 * 3600_000);
    const expiredUploads = db.prepare('SELECT temp_name FROM upload_sessions WHERE expires_at <= ?').all(now);
    for (const row of expiredUploads) {
      try { unlinkSync(join(UPLOAD_DIR, row.temp_name)); } catch { /* already gone */ }
    }
    db.prepare('DELETE FROM upload_sessions WHERE expires_at <= ?').run(now);
    const activeTempNames = new Set(db.prepare('SELECT temp_name FROM upload_sessions').all().map(row => row.temp_name));
    for (const name of readdirSync(UPLOAD_DIR)) {
      if (name.startsWith('.upload-') && name.endsWith('.part') && !activeTempNames.has(name)) {
        try { unlinkSync(join(UPLOAD_DIR, name)); } catch { /* already gone */ }
      }
    }
    for (const { fn } of registry.cleanupFns) fn();
  } catch { /* cleanup failures are non-fatal */ }
}

const cleanupTimer = setInterval(cleanupExpiredData, 60 * 60_000);
cleanupTimer.unref();

// 手动触发外部插件加载（正常启动路径已自动调用；供测试/运维按需加载）。
export function loadExternalPlugins() {
  return setupExternalPlugins(pluginCtx, registry);
}

if (process.env.NODE_ENV !== 'test') {
  cleanupExpiredData();
  (async () => {
    // 外部插件（plugins/ 目录或 npm 的 polychat-plugin-*）在监听前加载完毕；
    // 内置插件已由上面的 setupPlugins 同步注册（SEA 单文件也自包含它们）。
    await setupExternalPlugins(pluginCtx, registry);
    server.listen(PORT, HOST, () => console.log(`PolyChat: http://${HOST}:${PORT}`));
  })();
}
