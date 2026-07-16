import { WebSocket } from 'ws';
import { onebotTS } from './utils.js';

export function createOnebotReverse({ db, isUserBanned, botSockets, handleAction }) {
  const connections = [];

  function parseConfig() {
    const url = (process.env.ONEBOT_REVERSE_URL || '').trim();
    if (!url) return [];
    const urls = url.split(',').map(u => u.trim()).filter(Boolean);
    const token = (process.env.ONEBOT_BOT_TOKEN || '').trim();
    const accessToken = (process.env.ONEBOT_ACCESS_TOKEN || '').trim();
    if (!token) {
      console.warn('OneBot reverse: ONEBOT_REVERSE_URL 已设置但缺少 ONEBOT_BOT_TOKEN，跳过反向连接');
      return [];
    }
    return urls.map(u => ({ url: u, token, accessToken }));
  }

  function resolveBotUser(token) {
    const row = db.prepare('SELECT user_id FROM bot_tokens WHERE token = ?').get(token);
    if (!row) return null;
    const botUser = db.prepare('SELECT id, username, is_admin, avatar_updated_at, banned_until, muted_until, device_fingerprint FROM users WHERE id = ?').get(row.user_id);
    if (!botUser || isUserBanned(botUser)) return null;
    return botUser;
  }

  function connectOne(cfg) {
    const state = { cfg, token: cfg.token, socket: null, closed: false, reconnectTimer: null };
    connections.push(state);
    open(state);
  }

  function open(state) {
    if (state.closed) return;
    const botUser = resolveBotUser(state.token);
    if (!botUser) {
      console.warn(`OneBot reverse: ${state.token ? 'bot token 无效或机器人被封禁' : '缺少 bot token'}，${state.cfg.url} 将在 5s 后重试`);
      return scheduleReconnect(state);
    }
    state.botUser = botUser;
    const { cfg } = state;
    const headers = {
      'X-Self-ID': String(botUser.id),
      'X-Client-Role': 'Universal',
      'User-Agent': 'PolyChat-OneBot/11',
    };
    if (cfg.accessToken) headers.Authorization = `Bearer ${cfg.accessToken}`;

    const ws = new WebSocket(cfg.url, { headers });
    state.socket = ws;
    ws.user = botUser;
    ws.isAlive = true;

    ws.on('open', () => {
      botSockets.add(ws);
      console.log(`OneBot reverse: 已连接 ${cfg.url} (bot=${botUser.username}#${botUser.id})`);
      ws.send(JSON.stringify({ time: onebotTS(), self_id: botUser.id, post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'connect' }));
      ws.send(JSON.stringify({ time: onebotTS(), self_id: botUser.id, post_type: 'meta_event', meta_event_type: 'heartbeat', status: { online: true, good: true }, interval: 30000 }));
    });
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', raw => {
      try { handleAction(ws, JSON.parse(String(raw))); }
      catch { /* ignore malformed messages */ }
    });
    ws.on('close', () => {
      botSockets.delete(ws);
      scheduleReconnect(state);
    });
    ws.on('error', err => {
      console.warn(`OneBot reverse: 连接 ${cfg.url} 出错: ${err.message}`);
    });
  }

  function scheduleReconnect(state) {
    if (state.closed || state.reconnectTimer) return;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      open(state);
    }, 5000);
    state.reconnectTimer.unref?.();
  }

  function heartbeat() {
    for (const state of connections) {
      const ws = state.socket;
      if (!ws || ws.readyState !== 1) continue;
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
      ws.send(JSON.stringify({ time: onebotTS(), self_id: state.botUser.id, post_type: 'meta_event', meta_event_type: 'heartbeat', status: { online: true, good: true }, interval: 30000 }));
    }
  }

  function start() {
    const configs = parseConfig();
    for (const cfg of configs) connectOne(cfg);
    if (configs.length) console.log(`OneBot reverse: 启动 ${configs.length} 个反向连接`);
  }

  function stop() {
    for (const state of connections) {
      state.closed = true;
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
      state.socket?.close();
    }
  }

  return { start, stop, heartbeat };
}
