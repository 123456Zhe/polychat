import { USERNAME_RE, requireUser } from '../lib/auth.js';
import { db } from '../lib/db.js';
import { json, readBody } from '../lib/http.js';

export async function handleNotifyRoutes(req, res, url) {
  // ── 通知 API ──
  if (req.method === 'GET' && url.pathname === '/api/notifications') {
    const user = requireUser(req, res); if (!user) return true;
    const unreadOnly = url.searchParams.get('unread') === '1';
    const notifs = db.prepare(`SELECT * FROM notifications WHERE user_id = ?${unreadOnly ? ' AND is_read = 0' : ''} ORDER BY id DESC LIMIT 50`).all(user.id);
    return (json(res, 200, { notifications: notifs.map(n => ({ ...n, data: n.data ? JSON.parse(n.data) : null })) }), true);
  }

  if (req.method === 'GET' && url.pathname === '/api/notifications/unread-count') {
    const user = requireUser(req, res); if (!user) return true;
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id);
    return (json(res, 200, { count }), true);
  }

  const notifReadMatch = url.pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
  if (notifReadMatch && req.method === 'PUT') {
    const user = requireUser(req, res); if (!user) return true;
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(Number(notifReadMatch[1]), user.id);
    return (json(res, 200, { ok: true }), true);
  }

  if (req.method === 'POST' && url.pathname === '/api/notifications/read-all') {
    const user = requireUser(req, res); if (!user) return true;
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(user.id);
    return (json(res, 200, { ok: true }), true);
  }

  // ── Bot 创建申请 API ──
  if (req.method === 'POST' && url.pathname === '/api/bot-requests') {
    const user = requireUser(req, res); if (!user) return true;
    const { name = '', reason = '' } = await readBody(req);
    const botName = String(name).trim();
    const botReason = String(reason).trim();
    if (!USERNAME_RE.test(botName)) return (json(res, 400, { error: '机器人名称需为 2–24 位字母、数字、下划线或连字符' }), true);
    if (botReason.length > 500) return (json(res, 400, { error: '用途说明最多 500 个字符' }), true);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(botName)) return (json(res, 409, { error: '该名称已被使用' }), true);
    if (db.prepare("SELECT 1 FROM bot_requests WHERE name = ? COLLATE NOCASE AND status = 'pending'").get(botName)) return (json(res, 409, { error: '该机器人名称已有待处理申请' }), true);
    db.prepare('INSERT INTO bot_requests(user_id, name, reason) VALUES (?, ?, ?)').run(user.id, botName, botReason);
    return (json(res, 201, { ok: true }), true);
  }

  return false;
}
