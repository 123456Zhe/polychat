import { db } from './db.js';
import { sockets } from './realtime.js';

export function publicUser(user) {
  return {
    id: user.id,
    number: user.id,
    username: user.username,
    is_admin: Boolean(user.is_admin),
    avatar_updated_at: user.avatar_updated_at || null,
    avatar_url: user.avatar_updated_at ? `/api/users/${user.id}/avatar?v=${user.avatar_updated_at}` : null,
    banned_until: user.banned_until || null,
    muted_until: user.muted_until || null
  };
}

export function validAvatar(bytes, type) {
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (type === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

export function validateMentions(text) {
  const regex = /\[at:(\d+)\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const userId = Number(match[1]);
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) return userId;
  }
  return null;
}

export function resolveMentions(text) {
  if (!text) return [];
  const seen = new Set();
  const mentions = [];
  const regex = /\[at:(\d+)\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const userId = Number(match[1]);
    if (!seen.has(userId)) {
      seen.add(userId);
      const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
      if (user) mentions.push({ id: user.id, username: user.username, type: 'user' });
      else mentions.push({ id: userId, username: `用户${userId}`, type: 'unknown' });
    }
  }
  return mentions;
}

export function createNotification(userId, { type = 'system', title, content, link = null, data = null }) {
  const result = db.prepare('INSERT INTO notifications(user_id, type, title, content, link, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, type, title, content, link, data ? JSON.stringify(data) : null);
  const id = Number(result.lastInsertRowid);
  const notif = { id, type, title, content, link, data, is_read: false, created_at: new Date().toISOString() };
  for (const s of sockets) {
    if (s.readyState === 1 && s.user.id === userId) {
      s.send(JSON.stringify({ type: 'notification', notification: notif }));
    }
  }
  return id;
}
