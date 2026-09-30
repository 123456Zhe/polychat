import { requireUser } from '../lib/auth.js';
import { db } from '../lib/db.js';
import { json, readBody } from '../lib/http.js';
import { broadcast } from '../lib/realtime.js';
import { publicUser } from '../lib/users.js';

export async function handleFriendRoutes(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/friends') {
    const user = requireUser(req, res); if (!user) return true;
    const accepted = db.prepare(`SELECT users.id, users.username, users.avatar_updated_at, friendships.created_at
      FROM friendships JOIN users ON users.id = friendships.friend_id
      WHERE friendships.user_id = ? AND friendships.status = 'accepted' ORDER BY users.username`).all(user.id);
    const incoming = db.prepare(`SELECT users.id, users.username, users.avatar_updated_at, friendships.created_at
      FROM friendships JOIN users ON users.id = friendships.user_id
      WHERE friendships.friend_id = ? AND friendships.status = 'pending' ORDER BY friendships.created_at`).all(user.id);
    const outgoing = db.prepare(`SELECT users.id, users.username, users.avatar_updated_at, friendships.created_at
      FROM friendships JOIN users ON users.id = friendships.friend_id
      WHERE friendships.user_id = ? AND friendships.status = 'pending' ORDER BY friendships.created_at`).all(user.id);
    return (json(res, 200, {
      accepted: accepted.map(row => publicUser(row)),
      incoming: incoming.map(row => publicUser(row)),
      outgoing: outgoing.map(row => publicUser(row))
    }), true);
  }

  if (req.method === 'POST' && url.pathname === '/api/friends/request') {
    const user = requireUser(req, res); if (!user) return true;
    const { username = '' } = await readBody(req);
    const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(String(username).trim());
    if (!target) return (json(res, 404, { error: '用户不存在' }), true);
    if (target.id === user.id) return (json(res, 400, { error: '不能添加自己为好友' }), true);
    const existing = db.prepare('SELECT * FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').get(user.id, target.id, target.id, user.id);
    if (existing) {
      if (existing.status === 'accepted') return (json(res, 409, { error: '你们已经是好友了' }), true);
      return (json(res, 409, { error: '好友请求已发送，等待对方接受' }), true);
    }
    db.prepare('INSERT INTO friendships(user_id, friend_id, status) VALUES (?, ?, ?)').run(user.id, target.id, 'pending');
    broadcast({ type: 'friend_request', from: publicUser(user), user_id: target.id });
    return (json(res, 201, { friend: publicUser(target) }), true);
  }

  const friendManageMatch = url.pathname.match(/^\/api\/friends\/(\d+)\/(accept|decline)$/);
  if (friendManageMatch && req.method === 'POST') {
    const user = requireUser(req, res); if (!user) return true;
    const targetId = Number(friendManageMatch[1]);
    const action = friendManageMatch[2];
    const relation = db.prepare('SELECT * FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?').get(targetId, user.id, 'pending');
    if (!relation) return (json(res, 404, { error: '没有待处理的好友请求' }), true);
    if (action === 'accept') {
      const other = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId);
      db.prepare("UPDATE friendships SET status = 'accepted' WHERE user_id = ? AND friend_id = ?").run(targetId, user.id);
      db.prepare('INSERT OR IGNORE INTO friendships(user_id, friend_id, status) VALUES (?, ?, ?)').run(user.id, targetId, 'accepted');
      broadcast({ type: 'friend_accept', user_id: targetId, friend: publicUser(user) });
      broadcast({ type: 'friend_accept', user_id: user.id, friend: publicUser(other) });
      return (json(res, 200, { friend: publicUser(other) }), true);
    }
    db.prepare('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?').run(targetId, user.id);
    return (json(res, 200, { ok: true }), true);
  }

  if (req.method === 'DELETE' && url.pathname.match(/^\/api\/friends\/\d+$/)) {
    const user = requireUser(req, res); if (!user) return true;
    const targetId = Number(url.pathname.match(/^\/api\/friends\/(\d+)$/)[1]);
    db.prepare('DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(user.id, targetId, targetId, user.id);
    broadcast({ type: 'friend_remove', user_id: user.id, friend_id: targetId });
    broadcast({ type: 'friend_remove', user_id: targetId, friend_id: user.id });
    return (json(res, 200, { ok: true }), true);
  }

  return false;
}
