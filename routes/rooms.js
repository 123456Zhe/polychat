import { requireRoomAccess, requireRoomManager, roomForUser } from '../lib/access.js';
import { checkPassword, hashPassword, isUserBanned, isUserMuted, logAudit, requireUser } from '../lib/auth.js';
import { db } from '../lib/db.js';
import { eventBus } from '../lib/eventbus.js';
import { json, readBody } from '../lib/http.js';
import { hydrateMessages } from '../lib/messages.js';
import { broadcast, sendToUser } from '../lib/realtime.js';
import { createNotification, validateMentions } from '../lib/users.js';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function handleRoomRoutes(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/rooms') {
    const user = requireUser(req, res); if (!user) return true;
    const rooms = db.prepare(`SELECT rooms.id, rooms.name, rooms.created_at, rooms.is_private, room_members.role,
      rooms.announcement, rooms.announcement_by, rooms.announcement_updated_at,
      rooms.locked, rooms.hidden, rooms.readonly, rooms.password_hash IS NOT NULL AS has_password,
      announcers.username AS announcement_username,
      (SELECT COUNT(*) FROM messages WHERE messages.room_id = rooms.id) AS message_count
      FROM rooms LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
      LEFT JOIN users AS announcers ON announcers.id = rooms.announcement_by
      WHERE rooms.hidden = 0 OR room_members.user_id IS NOT NULL OR ? = 1 ORDER BY rooms.id`).all(user.id, user.is_admin ? 1 : 0);
    return (json(res, 200, { rooms: rooms.map(r => ({ ...r, is_private: Boolean(r.is_private), locked: Boolean(r.locked), hidden: Boolean(r.hidden), readonly: Boolean(r.readonly), has_password: Boolean(r.has_password) })) }), true);
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    const user = requireUser(req, res); if (!user) return true;
    const after = Math.max(0, Number(url.searchParams.get('after') || 0));
    if (url.searchParams.get('bootstrap') === '1') {
      const latest = db.prepare(`SELECT COALESCE(MAX(messages.id), 0) AS id FROM messages JOIN rooms ON rooms.id = messages.room_id
        LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
        WHERE rooms.is_private = 0 OR room_members.user_id IS NOT NULL OR ? = 1`).get(user.id, user.is_admin ? 1 : 0);
      return (json(res, 200, { cursor: latest.id, messages: [] }), true);
    }
    const messages = db.prepare(`SELECT messages.id, messages.room_id, rooms.name AS room_name,
      messages.user_id, users.username, messages.content,
      attachments.original_name AS attachment_name
      FROM messages JOIN rooms ON rooms.id = messages.room_id
      JOIN users ON users.id = messages.user_id
      LEFT JOIN attachments ON attachments.id = messages.attachment_id
      LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
      WHERE messages.id > ? AND (rooms.is_private = 0 OR room_members.user_id IS NOT NULL OR ? = 1) ORDER BY messages.id LIMIT 200`).all(user.id, after, user.is_admin ? 1 : 0);
    return (json(res, 200, { cursor: messages.length ? messages.at(-1).id : after, messages }), true);
  }

  if (req.method === 'POST' && url.pathname === '/api/rooms') {
    const user = requireUser(req, res); if (!user) return true;
    const { name = '', is_private = false } = await readBody(req);
    if (!is_private && !user.is_admin) return (json(res, 403, { error: '只有管理员可以创建公共聊天室；请创建私有聊天室或联系管理员' }), true);
    const roomName = String(name).trim();
    if (roomName.length < 1 || roomName.length > 30) return (json(res, 400, { error: '房间名需为 1–30 位' }), true);
    try {
      const result = db.prepare('INSERT INTO rooms(name, created_by, is_private) VALUES (?, ?, ?)').run(roomName, user.id, is_private ? 1 : 0);
      const id = Number(result.lastInsertRowid);
      db.prepare("INSERT INTO room_members(room_id, user_id, role) VALUES (?, ?, 'owner')").run(id, user.id);
      broadcast({ type: 'rooms' });
      return (json(res, 201, { room: { id, name: roomName, is_private: Boolean(is_private), role: 'owner' } }), true);
    } catch (error) {
      if (error.message.includes('UNIQUE')) return (json(res, 409, { error: '房间已存在' }), true);
      throw error;
    }
  }

  const roomManageMatch = url.pathname.match(/^\/api\/rooms\/(\d+)$/);
  if (roomManageMatch && req.method === 'PUT') {
    const roomId = Number(roomManageMatch[1]);
    const context = requireRoomManager(req, res, roomId); if (!context) return true;
    if (!context.room.is_private && !context.user.is_admin) return (json(res, 403, { error: '只有管理员可以管理公共聊天室' }), true);
    const { name = '' } = await readBody(req); const roomName = String(name).trim();
    if (!roomName || roomName.length > 30) return (json(res, 400, { error: '房间名需为 1–30 位' }), true);
    try { db.prepare('UPDATE rooms SET name = ? WHERE id = ?').run(roomName, roomId); }
    catch (error) { if (error.message.includes('UNIQUE')) return (json(res, 409, { error: '房间名已存在' }), true); throw error; }
    broadcast({ type: 'rooms' });
    return (json(res, 200, { room: { ...context.room, name: roomName, is_private: Boolean(context.room.is_private) } }), true);
  }

  if (roomManageMatch && req.method === 'DELETE') {
    const roomId = Number(roomManageMatch[1]);
    if (roomId === 1) return (json(res, 400, { error: '大厅不能删除' }), true);
    const context = requireRoomManager(req, res, roomId); if (!context) return true;
    if (!context.room.is_private && !context.user.is_admin) return (json(res, 403, { error: '只有管理员可以删除公共聊天室' }), true);
    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    broadcast({ type: 'rooms' });
    return (json(res, 200, { ok: true }), true);
  }

  const announcementMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/announcement$/);
  if (announcementMatch && req.method === 'PUT') {
    const roomId = Number(announcementMatch[1]);
    const context = requireRoomManager(req, res, roomId); if (!context) return true;
    const { content = '' } = await readBody(req);
    const text = String(content).trim();
    if (!text || text.length > 2000) return (json(res, 400, { error: '公告内容需为 1–2000 位' }), true);
    db.prepare('UPDATE rooms SET announcement = ?, announcement_by = ?, announcement_updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(text, context.user.id, roomId);
    broadcast({ type: 'announcement', room_id: roomId });
    return (json(res, 200, { ok: true }), true);
  }

  if (announcementMatch && req.method === 'DELETE') {
    const roomId = Number(announcementMatch[1]);
    const context = requireRoomManager(req, res, roomId); if (!context) return true;
    db.prepare('UPDATE rooms SET announcement = NULL, announcement_by = NULL, announcement_updated_at = NULL WHERE id = ?').run(roomId);
    broadcast({ type: 'announcement', room_id: roomId });
    return (json(res, 200, { ok: true }), true);
  }

  const roomSettingsMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/settings$/);
  if (roomSettingsMatch && req.method === 'PATCH') {
    const context = requireRoomManager(req, res, Number(roomSettingsMatch[1])); if (!context) return true;
    if (!context.room.is_private && !context.user.is_admin) return (json(res, 403, { error: '只有管理员可以修改公共聊天室设置' }), true);
    const { locked, hidden, password, readonly } = await readBody(req);
    const room = context.room;
    const next = {
      locked: locked === undefined ? room.locked : (locked ? 1 : 0),
      hidden: hidden === undefined ? room.hidden : (hidden ? 1 : 0),
      readonly: readonly === undefined ? room.readonly : (readonly ? 1 : 0),
      password_hash: password === undefined ? room.password_hash : (password === '' ? null : hashPassword(String(password)))
    };
    db.prepare('UPDATE rooms SET locked = ?, hidden = ?, password_hash = ?, readonly = ? WHERE id = ?')
      .run(next.locked, next.hidden, next.password_hash, next.readonly, room.id);
    logAudit(context.user.id, 'room_settings', null, '房间 ' + room.id);
    const settings = { room_id: room.id, locked: Boolean(next.locked), hidden: Boolean(next.hidden), readonly: Boolean(next.readonly), has_password: next.password_hash !== null };
    broadcast({ type: 'room_settings', ...settings }, room.id);
    broadcast({ type: 'rooms' });
    return (json(res, 200, { settings }), true);
  }

  const roomJoinMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/join$/);
  if (roomJoinMatch && req.method === 'POST') {
    const user = requireUser(req, res); if (!user) return true;
    const room = roomForUser(Number(roomJoinMatch[1]), user.id);
    if (!room) return (json(res, 404, { error: '聊天室不存在' }), true);
    if (room.role) return (json(res, 200, { member: { role: room.role } }), true);
    if (room.locked) return (json(res, 403, { error: '房间已锁定，仅接受邀请' }), true);
    const { password = '' } = await readBody(req);
    if (room.password_hash) {
      if (!checkPassword(String(password), room.password_hash)) return (json(res, 403, { error: '房间密码错误' }), true);
    } else if (room.is_private) {
      return (json(res, 403, { error: '私有房间需申请加入' }), true);
    }
    db.prepare("INSERT INTO room_members(room_id, user_id, role) VALUES (?, ?, 'member') ON CONFLICT(room_id, user_id) DO NOTHING").run(room.id, user.id);
    broadcast({ type: 'rooms' });
    return (json(res, 200, { member: { role: 'member' } }), true);
  }

  const roomJoinRequestMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/join-request$/);
  if (roomJoinRequestMatch && req.method === 'POST') {
    const user = requireUser(req, res); if (!user) return true;
    const room = roomForUser(Number(roomJoinRequestMatch[1]), user.id);
    if (!room) return (json(res, 404, { error: '聊天室不存在' }), true);
    if (room.role) return (json(res, 409, { error: '你已是房间成员' }), true);
    if (!room.is_private) return (json(res, 400, { error: '公共房间可直接加入，无需申请' }), true);
    if (room.locked) return (json(res, 403, { error: '房间已锁定，仅接受邀请' }), true);
    const existing = db.prepare('SELECT id, status FROM room_join_requests WHERE room_id = ? AND user_id = ?').get(room.id, user.id);
    if (existing && existing.status === 'pending') return (json(res, 409, { error: '已提交过申请，等待审批' }), true);
    let requestId;
    if (existing) {
      db.prepare('UPDATE room_join_requests SET status = ?, created_at = ? WHERE id = ?').run('pending', Date.now(), existing.id);
      requestId = existing.id;
    } else {
      requestId = Number(db.prepare('INSERT INTO room_join_requests(room_id, user_id, status, created_at) VALUES (?, ?, ?, ?)').run(room.id, user.id, 'pending', Date.now()).lastInsertRowid);
    }
    const managers = db.prepare("SELECT user_id FROM room_members WHERE room_id = ? AND role IN ('owner','admin')").all(room.id);
    for (const m of managers) createNotification(m.user_id, { type: 'room', title: '新的加入申请', content: `${user.username} 申请加入房间「${room.name}」`, link: `/room/${room.id}`, data: { room_id: room.id, user_id: user.id } });
    return (json(res, 201, { request: { id: requestId } }), true);
  }

  const roomJoinRequestsMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/join-requests$/);
  if (roomJoinRequestsMatch && req.method === 'GET') {
    const context = requireRoomManager(req, res, Number(roomJoinRequestsMatch[1])); if (!context) return true;
    if (!context.room.is_private && !context.user.is_admin) return (json(res, 403, { error: '只有管理员可以管理公共聊天室申请' }), true);
    const rows = db.prepare(`SELECT room_join_requests.id, room_join_requests.user_id, room_join_requests.status, room_join_requests.created_at, users.username
      FROM room_join_requests JOIN users ON users.id = room_join_requests.user_id
      WHERE room_join_requests.room_id = ? AND room_join_requests.status = 'pending' ORDER BY room_join_requests.created_at`).all(context.room.id);
    return (json(res, 200, { requests: rows }), true);
  }

  const roomJoinDecisionMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/join-requests\/(\d+)\/(approve|reject)$/);
  if (roomJoinDecisionMatch && req.method === 'POST') {
    const context = requireRoomManager(req, res, Number(roomJoinDecisionMatch[1])); if (!context) return true;
    if (!context.room.is_private && !context.user.is_admin) return (json(res, 403, { error: '只有管理员可以管理公共聊天室申请' }), true);
    const targetId = Number(roomJoinDecisionMatch[2]); const action = roomJoinDecisionMatch[3];
    const request = db.prepare('SELECT * FROM room_join_requests WHERE room_id = ? AND user_id = ? AND status = ?').get(context.room.id, targetId, 'pending');
    if (!request) return (json(res, 404, { error: '申请不存在或已处理' }), true);
    if (action === 'approve') {
      db.prepare("INSERT INTO room_members(room_id, user_id, role) VALUES (?, ?, 'member') ON CONFLICT(room_id, user_id) DO NOTHING").run(context.room.id, targetId);
    }
    db.prepare('UPDATE room_join_requests SET status = ? WHERE id = ?').run(action === 'approve' ? 'approved' : 'rejected', request.id);
    createNotification(targetId, { type: 'room', title: action === 'approve' ? '加入申请已通过' : '加入申请被拒绝', content: `你申请加入「${context.room.name}」${action === 'approve' ? '已通过' : '被拒绝'}`, link: `/room/${context.room.id}`, data: { room_id: context.room.id } });
    broadcast({ type: 'rooms' });
    return (json(res, 200, { request: { status: action === 'approve' ? 'approved' : 'rejected' } }), true);
  }

  const roomMemberMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/members$/);
  if (roomMemberMatch && req.method === 'GET') {
    const context = requireRoomAccess(req, res, Number(roomMemberMatch[1])); if (!context) return true;
    const members = db.prepare(`SELECT users.id, users.username, room_members.role FROM room_members JOIN users ON users.id = room_members.user_id WHERE room_id = ? ORDER BY role, username`).all(context.room.id);
    return (json(res, 200, { members }), true);
  }

  const roomMentionMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/mentionables$/);
  if (roomMentionMatch && req.method === 'GET') {
    const context = requireRoomAccess(req, res, Number(roomMentionMatch[1])); if (!context) return true;
    let candidates;
    if (context.room.is_private) {
      candidates = db.prepare('SELECT users.id, users.username FROM room_members JOIN users ON users.id = room_members.user_id WHERE room_id = ? ORDER BY username').all(context.room.id);
    } else {
      candidates = db.prepare('SELECT id, username FROM users ORDER BY username').all();
    }
    return (json(res, 200, { users: candidates }), true);
  }

  if (roomMemberMatch && req.method === 'POST') {
    const context = requireRoomManager(req, res, Number(roomMemberMatch[1])); if (!context) return true;
    const { username = '', role = 'member' } = await readBody(req);
    const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(String(username).trim());
    if (!target) return (json(res, 404, { error: '用户不存在' }), true);
    const memberRole = role === 'admin' ? 'admin' : 'member';
    db.prepare('INSERT INTO room_members(room_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(room_id, user_id) DO UPDATE SET role = excluded.role').run(context.room.id, target.id, memberRole);
    broadcast({ type: 'rooms' });
    return (json(res, 200, { member: { ...target, role: memberRole } }), true);
  }

  const roomMemberDelete = url.pathname.match(/^\/api\/rooms\/(\d+)\/members\/(\d+)$/);
  if (roomMemberDelete && req.method === 'DELETE') {
    const context = requireRoomManager(req, res, Number(roomMemberDelete[1])); if (!context) return true;
    const targetId = Number(roomMemberDelete[2]);
    if (targetId === context.room.created_by) return (json(res, 400, { error: '不能移除房主' }), true);
    const result = db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(context.room.id, targetId);
    if (Number(result.changes) > 0) {
      createNotification(targetId, { type: 'room', title: '你已被移出房间', content: context.room.name });
      sendToUser(targetId, { type: 'room_kicked', room_id: context.room.id, room_name: context.room.name });
    }
    broadcast({ type: 'rooms' });
    return (json(res, 200, { ok: true }), true);
  }

  const inviteCodeListMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/invite-codes$/);
  if (inviteCodeListMatch && req.method === 'GET') {
    const context = requireRoomManager(req, res, Number(inviteCodeListMatch[1])); if (!context) return true;
    const codes = db.prepare('SELECT invite_codes.*, users.username AS created_by_name FROM invite_codes LEFT JOIN users ON users.id = invite_codes.created_by WHERE invite_codes.room_id = ? ORDER BY invite_codes.id DESC').all(context.room.id);
    return (json(res, 200, { codes }), true);
  }

  if (inviteCodeListMatch && req.method === 'POST') {
    const context = requireRoomManager(req, res, Number(inviteCodeListMatch[1])); if (!context) return true;
    const { max_uses = null, duration_hours = null } = await readBody(req);
    const code = randomBytes(4).toString('hex');
    const expiresAt = duration_hours ? Date.now() + Number(duration_hours) * 3600_000 : null;
    const maxUses = max_uses ? Number(max_uses) : null;
    db.prepare('INSERT INTO invite_codes(room_id, code, created_by, max_uses, expires_at) VALUES (?, ?, ?, ?, ?)').run(context.room.id, code, context.user.id, maxUses, expiresAt);
    return (json(res, 201, { code: { id: db.prepare('SELECT last_insert_rowid() AS id').get().id, code, max_uses: maxUses, use_count: 0, expires_at: expiresAt, created_by_name: context.user.username } }), true);
  }

  const inviteCodeDeleteMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/invite-codes\/(\d+)$/);
  if (inviteCodeDeleteMatch && req.method === 'DELETE') {
    const context = requireRoomManager(req, res, Number(inviteCodeDeleteMatch[1])); if (!context) return true;
    db.prepare('DELETE FROM invite_codes WHERE id = ? AND room_id = ?').run(Number(inviteCodeDeleteMatch[2]), context.room.id);
    return (json(res, 200, { ok: true }), true);
  }

  const inviteJoinMatch = url.pathname.match(/^\/api\/invite\/([a-f0-9]+)$/);
  if (inviteJoinMatch && req.method === 'POST') {
    const user = requireUser(req, res); if (!user) return true;
    const codeStr = inviteJoinMatch[1];
    const invite = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(codeStr);
    if (!invite) return (json(res, 404, { error: '邀请码无效' }), true);
    if (invite.expires_at && invite.expires_at <= Date.now()) return (json(res, 400, { error: '邀请码已过期' }), true);
    if (invite.max_uses && invite.use_count >= invite.max_uses) return (json(res, 400, { error: '邀请码已达到使用次数上限' }), true);
    db.prepare('UPDATE invite_codes SET use_count = use_count + 1 WHERE id = ?').run(invite.id);
    db.prepare('INSERT OR IGNORE INTO room_members(room_id, user_id, role) VALUES (?, ?, ?)').run(invite.room_id, user.id, 'member');
    const room = db.prepare('SELECT id, name FROM rooms WHERE id = ?').get(invite.room_id);
    broadcast({ type: 'rooms' });
    return (json(res, 200, { ok: true, room }), true);
  }

  if (req.method === 'GET' && url.pathname === '/api/users/search') {
    const user = requireUser(req, res); if (!user) return true;
    const q = url.searchParams.get('q') || '';
    if (q.length < 1) return (json(res, 200, { users: [] }), true);
    const byId = /^\d+$/.test(q) ? db.prepare('SELECT id, username FROM users WHERE id = ?').get(Number(q)) : null;
    const byName = db.prepare('SELECT id, username FROM users WHERE username LIKE ? ORDER BY username LIMIT 20').all(`%${q}%`);
    const users = byId ? [byId, ...byName.filter(u => u.id !== byId.id)] : byName;
    return (json(res, 200, { users }), true);
  }

  if (req.method === 'GET' && url.pathname === '/api/search') {
    const user = requireUser(req, res); if (!user) return true;
    const q = String(url.searchParams.get('q') || '').trim();
    const roomId = Number(url.searchParams.get('room_id') || 0);
    if (q.length < 1 || q.length > 100) return (json(res, 400, { error: '搜索关键词需为 1–100 个字符' }), true);
    if (roomId && !requireRoomAccess(req, res, roomId)) return true;
    const conditions = [`messages.deleted_at IS NULL`, `messages.content LIKE ?`, `(rooms.is_private = 0 OR room_members.user_id IS NOT NULL OR ? = 1)`];
    const values = [`%${q.replace(/[\\%_]/g, '\\$&')}%`, user.is_admin ? 1 : 0];
    if (roomId) { conditions.push('messages.room_id = ?'); values.push(roomId); }
    const rows = db.prepare(`SELECT messages.id, messages.room_id, rooms.name AS room_name, messages.content, messages.created_at,
      users.id AS user_id, users.username, users.avatar_updated_at, messages.reply_to, messages.edited_at, messages.deleted_at
      FROM messages JOIN rooms ON rooms.id = messages.room_id JOIN users ON users.id = messages.user_id
      LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
      WHERE ${conditions.join(' AND ')} ORDER BY messages.id DESC LIMIT 100`).all(user.id, ...values);
    return (json(res, 200, { messages: hydrateMessages(rows, user.id) }), true);
  }

  const threadMatch = url.pathname.match(/^\/api\/messages\/(\d+)\/thread$/);
  if (threadMatch && req.method === 'GET') {
    const rootId = Number(threadMatch[1]);
    const root = db.prepare('SELECT room_id FROM messages WHERE id = ? AND thread_root IS NULL').get(rootId);
    if (!root) return (json(res, 404, { error: '话题不存在' }), true);
    const context = requireRoomAccess(req, res, root.room_id); if (!context) return true;
    const rows = db.prepare(`SELECT messages.id, messages.room_id, messages.content, messages.created_at, messages.reply_to, messages.thread_root, messages.edited_at, messages.deleted_at,
      users.id AS user_id, users.username, users.avatar_updated_at, parent.content AS reply_content, parent_user.username AS reply_username,
      attachments.id AS attachment_id, attachments.original_name AS attachment_name, attachments.mime_type AS attachment_type, attachments.size AS attachment_size
      FROM messages JOIN users ON users.id = messages.user_id LEFT JOIN messages AS parent ON parent.id = messages.reply_to
      LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id LEFT JOIN attachments ON attachments.id = messages.attachment_id
      WHERE messages.id = ? OR messages.thread_root = ? ORDER BY messages.id LIMIT 500`).all(rootId, rootId);
    return (json(res, 200, { messages: hydrateMessages(rows, context.user.id) }), true);
  }

  const pinCollectionMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/pins$/);
  if (pinCollectionMatch && req.method === 'GET') {
    const roomId = Number(pinCollectionMatch[1]); const context = requireRoomAccess(req, res, roomId); if (!context) return true;
    const rows = db.prepare(`SELECT messages.id, messages.room_id, messages.content, messages.created_at, messages.edited_at, messages.deleted_at,
      users.id AS user_id, users.username, users.avatar_updated_at, room_pins.created_at AS pinned_at
      FROM room_pins JOIN messages ON messages.id = room_pins.message_id JOIN users ON users.id = messages.user_id
      WHERE room_pins.room_id = ? ORDER BY room_pins.created_at DESC`).all(roomId);
    return (json(res, 200, { messages: hydrateMessages(rows, context.user.id) }), true);
  }

  const pinMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/pins\/(\d+)$/);
  if (pinMatch && req.method === 'PUT') {
    const roomId = Number(pinMatch[1]), messageId = Number(pinMatch[2]); const context = requireRoomManager(req, res, roomId); if (!context) return true;
    if (!db.prepare('SELECT 1 FROM messages WHERE id = ? AND room_id = ?').get(messageId, roomId)) return (json(res, 404, { error: '消息不存在' }), true);
    db.prepare('INSERT OR IGNORE INTO room_pins(room_id, message_id, pinned_by) VALUES (?, ?, ?)').run(roomId, messageId, context.user.id);
    broadcast({ type: 'pins', room_id: roomId }, roomId); return (json(res, 200, { ok: true }), true);
  }

  if (pinMatch && req.method === 'DELETE') {
    const roomId = Number(pinMatch[1]), messageId = Number(pinMatch[2]); const context = requireRoomManager(req, res, roomId); if (!context) return true;
    db.prepare('DELETE FROM room_pins WHERE room_id = ? AND message_id = ?').run(roomId, messageId);
    broadcast({ type: 'pins', room_id: roomId }, roomId); return (json(res, 200, { ok: true }), true);
  }

  const messageMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/messages$/);
  if (messageMatch && req.method === 'GET') {
    const roomId = Number(messageMatch[1]);
    const context = requireRoomAccess(req, res, roomId); if (!context) return true;
    const after = Math.max(0, Number(url.searchParams.get('after') || 0));
    const before = Math.max(0, Number(url.searchParams.get('before') || 0));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
    if (!db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId)) return (json(res, 404, { error: '房间不存在' }), true);
    const query = `SELECT messages.id, messages.content, messages.created_at,
      users.id AS user_id, users.username, users.avatar_updated_at, messages.reply_to, messages.thread_root, messages.edited_at, messages.deleted_at,
      parent.content AS reply_content, parent_user.username AS reply_username, attachments.id AS attachment_id,
      attachments.original_name AS attachment_name, attachments.mime_type AS attachment_type,
      attachments.size AS attachment_size
      FROM messages JOIN users ON users.id = messages.user_id
      LEFT JOIN messages AS parent ON parent.id = messages.reply_to
      LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id
      LEFT JOIN attachments ON attachments.id = messages.attachment_id`;
    if (before > 0) {
      const rows = db.prepare(`${query} WHERE messages.room_id = ? AND messages.thread_root IS NULL AND messages.id < ? ORDER BY messages.id DESC LIMIT ?`).all(roomId, before, limit + 1);
      const hasMore = rows.length > limit;
      return (json(res, 200, { messages: hydrateMessages(rows.slice(0, limit).reverse(), context.user.id), has_more: hasMore }), true);
    }
    const rows = db.prepare(`${query} WHERE messages.room_id = ? AND messages.thread_root IS NULL AND messages.id > ? ORDER BY messages.id LIMIT ?`).all(roomId, after, limit + 1);
    const hasMore = rows.length > limit;
    return (json(res, 200, { messages: hydrateMessages(rows.slice(0, limit), context.user.id), has_more: hasMore }), true);
  }

  if (messageMatch && req.method === 'POST') {
    const roomId = Number(messageMatch[1]);
    const context = requireRoomAccess(req, res, roomId); if (!context) return true;
    const user = context.user;
    if (context.room.readonly && !user.is_admin && !['owner', 'admin'].includes(context.room.role)) {
      return (json(res, 403, { error: '房间为只读模式' }), true);
    }
    if (isUserBanned(user)) return (json(res, 403, { error: '账号已被封禁', banned_until: user.banned_until }), true);
    if (isUserMuted(user)) return (json(res, 403, { error: '你已被禁言，无法发送消息', muted_until: user.muted_until }), true);
    const { content = '', attachment_id = null, reply_to = null, thread_root = null } = await readBody(req);
    const text = String(content).trim();
    const attachmentId = attachment_id == null ? null : Number(attachment_id);
    if ((!text && !attachmentId) || text.length > 10_000) return (json(res, 400, { error: '消息或附件不能为空，文字最多 10000 个字符' }), true);
    if (attachmentId && !db.prepare('SELECT id FROM attachments WHERE id = ? AND user_id = ?').get(attachmentId, user.id)) {
      return (json(res, 400, { error: '附件不存在或不属于当前账号' }), true);
    }
    const replyId = reply_to == null ? null : Number(reply_to);
    if (replyId && !db.prepare('SELECT id FROM messages WHERE id = ? AND room_id = ?').get(replyId, roomId)) return (json(res, 400, { error: '回复目标不存在或不在当前聊天室' }), true);
    const threadRoot = thread_root == null ? null : Number(thread_root);
    if (threadRoot && !db.prepare('SELECT id FROM messages WHERE id = ? AND room_id = ? AND thread_root IS NULL').get(threadRoot, roomId)) return (json(res, 400, { error: '话题根消息不存在' }), true);
    const badMention = validateMentions(text);
    if (badMention) return (json(res, 400, { error: `被 @ 的用户 ${badMention} 不存在` }), true);
    const result = db.prepare('INSERT INTO messages(room_id, user_id, content, attachment_id, reply_to, thread_root) VALUES (?, ?, ?, ?, ?, ?)').run(roomId, user.id, text, attachmentId, replyId, threadRoot);
    const message = db.prepare(`SELECT messages.id, messages.content, messages.created_at, messages.reply_to, messages.thread_root, messages.edited_at, messages.deleted_at,
      users.id AS user_id, users.username, users.avatar_updated_at, parent.content AS reply_content, parent_user.username AS reply_username, attachments.id AS attachment_id,
      attachments.original_name AS attachment_name, attachments.mime_type AS attachment_type,
      attachments.size AS attachment_size, attachments.stored_name AS attachment_stored_name
      FROM messages JOIN users ON users.id = messages.user_id
      LEFT JOIN messages AS parent ON parent.id = messages.reply_to LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id
      LEFT JOIN attachments ON attachments.id = messages.attachment_id WHERE messages.id = ?`).get(result.lastInsertRowid);
    const hydrated = hydrateMessages([message], user.id)[0];
    broadcast({ type: threadRoot ? 'thread_message' : 'message', room_id: roomId, message_id: Number(result.lastInsertRowid), thread_root: threadRoot, message: hydrated }, roomId);
    // 通知插件（OneBot、web-push 等）有新消息；threadRoot 由订阅方自行过滤。
    eventBus.emit('message:sent', { roomId, message: hydrated, sender: user, threadRoot });
    return (json(res, 201, { message: hydrated }), true);
  }

  const singleMessageMatch = url.pathname.match(/^\/api\/messages\/(\d+)$/);
  if (singleMessageMatch && req.method === 'GET') {
    const messageId = Number(singleMessageMatch[1]);
    const row = db.prepare(`SELECT messages.id, messages.room_id, messages.content, messages.created_at, messages.reply_to, messages.thread_root, messages.edited_at, messages.deleted_at,
      users.id AS user_id, users.username, users.avatar_updated_at, parent.content AS reply_content, parent_user.username AS reply_username,
      attachments.id AS attachment_id, attachments.original_name AS attachment_name, attachments.mime_type AS attachment_type, attachments.size AS attachment_size,
      p2p_transfers.id AS p2p_transfer_id, p2p_transfers.sender_id AS p2p_sender_id, p2p_transfers.receiver_id AS p2p_receiver_id,
      p2p_transfers.name AS p2p_name, p2p_transfers.mime_type AS p2p_type, p2p_transfers.size AS p2p_size,
      p2p_transfers.sha256 AS p2p_sha256, p2p_transfers.status AS p2p_status
      FROM messages JOIN users ON users.id = messages.user_id LEFT JOIN messages AS parent ON parent.id = messages.reply_to
      LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id LEFT JOIN attachments ON attachments.id = messages.attachment_id
      LEFT JOIN p2p_transfers ON p2p_transfers.id = messages.p2p_transfer_id WHERE messages.id = ?`).get(messageId);
    if (!row) return (json(res, 404, { error: '消息不存在' }), true);
    const context = requireRoomAccess(req, res, row.room_id); if (!context) return true;
    return (json(res, 200, { message: hydrateMessages([row], context.user.id)[0] }), true);
  }

  if (singleMessageMatch && req.method === 'PUT') {
    const user = requireUser(req, res); if (!user) return true;
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(singleMessageMatch[1]));
    if (!message) return (json(res, 404, { error: '消息不存在' }), true);
    const context = requireRoomAccess(req, res, message.room_id); if (!context) return true;
    if (message.user_id !== user.id) return (json(res, 403, { error: '只能编辑自己的消息' }), true);
    const { content = '' } = await readBody(req); const text = String(content).trim();
    if (!text || text.length > 10_000) return (json(res, 400, { error: '消息需为 1–10000 个字符' }), true);
    db.prepare('UPDATE messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').run(text, message.id);
    broadcast({ type: 'message_update', room_id: message.room_id, message_id: message.id }, message.room_id);
    return (json(res, 200, { ok: true, message: hydrateMessages([db.prepare(`SELECT messages.id, messages.content, messages.created_at, messages.reply_to, messages.edited_at, messages.deleted_at,
      users.id AS user_id, users.username, users.avatar_updated_at FROM messages JOIN users ON users.id = messages.user_id WHERE messages.id = ?`).get(message.id)], user.id)[0] }), true);
  }

  if (singleMessageMatch && req.method === 'DELETE') {
    const user = requireUser(req, res); if (!user) return true;
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(singleMessageMatch[1]));
    if (!message) return (json(res, 404, { error: '消息不存在' }), true);
    const context = requireRoomAccess(req, res, message.room_id); if (!context) return true;
    if (message.user_id !== user.id && !user.is_admin && !['owner', 'admin'].includes(context.room.role)) return (json(res, 403, { error: '没有撤回此消息的权限' }), true);
    db.prepare("UPDATE messages SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(message.id);
    broadcast({ type: 'message_update', room_id: message.room_id, message_id: message.id }, message.room_id);
    return (json(res, 200, { ok: true }), true);
  }

  // 查看已撤回消息的原始内容
  const originalMatch = url.pathname.match(/^\/api\/messages\/(\d+)\/original$/);
  if (originalMatch && req.method === 'GET') {
    const user = requireUser(req, res); if (!user) return true;
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(originalMatch[1]));
    if (!message) return (json(res, 404, { error: '消息不存在' }), true);
    if (!message.deleted_at) return (json(res, 400, { error: '消息未被撤回' }), true);
    const context = requireRoomAccess(req, res, message.room_id); if (!context) return true;
    if (message.user_id !== user.id && !user.is_admin && !['owner', 'admin'].includes(context.room.role)) return (json(res, 403, { error: '没有查看撤回内容的权限' }), true);
    return (json(res, 200, { content: message.content, attachment_id: message.attachment_id, username: message.user_id ? (db.prepare('SELECT username FROM users WHERE id = ?').get(message.user_id)?.username || '') : '' }), true);
  }

  const reactionMatch = url.pathname.match(/^\/api\/messages\/(\d+)\/reactions$/);
  if (reactionMatch && req.method === 'POST') {
    const user = requireUser(req, res); if (!user) return true;
    const message = db.prepare('SELECT room_id FROM messages WHERE id = ?').get(Number(reactionMatch[1]));
    if (!message || !requireRoomAccess(req, res, message.room_id)) return true;
    const { emoji = '' } = await readBody(req); const value = String(emoji);
    if (!value || value.length > 24 || !/\p{Extended_Pictographic}/u.test(value)) return (json(res, 400, { error: '表情格式无效' }), true);
    const exists = db.prepare('SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(Number(reactionMatch[1]), user.id, value);
    if (exists) db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(Number(reactionMatch[1]), user.id, value);
    else db.prepare('INSERT INTO message_reactions(message_id, user_id, emoji) VALUES (?, ?, ?)').run(Number(reactionMatch[1]), user.id, value);
    broadcast({ type: 'message_update', room_id: message.room_id, message_id: Number(reactionMatch[1]) }, message.room_id);
    return (json(res, 200, { reactions: hydrateMessages([{ id: Number(reactionMatch[1]) }], user.id)[0].reactions }), true);
  }

  return false;
}
