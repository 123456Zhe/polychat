import { db } from './db.js';
import { json } from './http.js';
import { requireUser } from './auth.js';

export function isDmMember(conversationId, userId) {
  return Boolean(db.prepare('SELECT 1 FROM dm_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, userId));
}

export function canAccessAttachment(attachmentId, user) {
  const attachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId);
  if (!attachment) return null;
  const linked = db.prepare(`SELECT messages.room_id, messages.dm_id
    FROM messages WHERE messages.attachment_id = ? LIMIT 1`).get(attachmentId);
  if (!linked) return null;
  if (attachment.user_id === user.id || user.is_admin) return attachment;
  if (linked.dm_id) return isDmMember(linked.dm_id, user.id) ? attachment : null;
  if (linked.room_id) {
    const room = roomForUser(linked.room_id, user.id);
    if (!room) return null;
    if (room.is_private && !room.role && !user.is_admin) return null;
    return attachment;
  }
  return null;
}

export function roomForUser(roomId, userId) {
  return db.prepare(`SELECT rooms.*, room_members.role FROM rooms
    LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
    WHERE rooms.id = ?`).get(userId, roomId);
}

export function requireRoomAccess(req, res, roomId) {
  const user = requireUser(req, res); if (!user) return null;
  const room = roomForUser(roomId, user.id);
  if (!room) { json(res, 404, { error: '聊天室不存在' }); return null; }
  if (room.is_private && !room.role && !user.is_admin) { json(res, 403, { error: '这是私有聊天室' }); return null; }
  return { user, room };
}

export function requireRoomManager(req, res, roomId) {
  const context = requireRoomAccess(req, res, roomId); if (!context) return null;
  if (!context.user.is_admin && !['owner', 'admin'].includes(context.room.role)) { json(res, 403, { error: '需要聊天室管理权限' }); return null; }
  return context;
}
