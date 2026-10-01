import { isUserBanned, isUserMuted, requireUser } from '../lib/auth.js';
import { db } from '../lib/db.js';
import { eventBus } from '../lib/eventbus.js';
import { json, readBody } from '../lib/http.js';
import { hydrateMessages } from '../lib/messages.js';
import { broadcast, broadcastDm } from '../lib/realtime.js';
import { publicUser, validateMentions } from '../lib/users.js';

export async function handleDmRoutes(req, res, url) {
  const dmMessageColumns = `messages.id, messages.content, messages.created_at, messages.reply_to, messages.thread_root, messages.edited_at, messages.deleted_at,
    users.id AS user_id, users.username, users.avatar_updated_at, parent.content AS reply_content, parent_user.username AS reply_username, attachments.id AS attachment_id,
    attachments.original_name AS attachment_name, attachments.mime_type AS attachment_type, attachments.size AS attachment_size, attachments.stored_name AS attachment_stored_name,
    p2p_transfers.id AS p2p_transfer_id, p2p_transfers.sender_id AS p2p_sender_id, p2p_transfers.receiver_id AS p2p_receiver_id,
    p2p_transfers.name AS p2p_name, p2p_transfers.mime_type AS p2p_type, p2p_transfers.size AS p2p_size,
    p2p_transfers.sha256 AS p2p_sha256, p2p_transfers.status AS p2p_status`;

  if (req.method === 'GET' && url.pathname === '/api/dm/conversations') {
    const user = requireUser(req, res); if (!user) return true;
    const conversations = db.prepare(`SELECT dm_conversations.id, dm_conversations.created_at,
      (SELECT messages.id FROM messages WHERE messages.dm_id = dm_conversations.id ORDER BY messages.id DESC LIMIT 1) AS last_message_id
      FROM dm_conversations JOIN dm_members ON dm_members.conversation_id = dm_conversations.id
      WHERE dm_members.user_id = ? ORDER BY COALESCE(last_message_id, dm_conversations.id) DESC`).all(user.id);
    const result = [];
    for (const conversation of conversations) {
      const peer = db.prepare(`SELECT users.id, users.username, users.avatar_updated_at FROM dm_members
        JOIN users ON users.id = dm_members.user_id WHERE dm_members.conversation_id = ? AND dm_members.user_id != ?`).get(conversation.id, user.id);
      const lastMessage = conversation.last_message_id ? db.prepare(`SELECT ${dmMessageColumns} FROM messages JOIN users ON users.id = messages.user_id
        LEFT JOIN messages AS parent ON parent.id = messages.reply_to LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id
        LEFT JOIN attachments ON attachments.id = messages.attachment_id LEFT JOIN p2p_transfers ON p2p_transfers.id = messages.p2p_transfer_id WHERE messages.id = ?`).get(conversation.last_message_id) : null;
      const unread = db.prepare(`SELECT COUNT(*) AS count FROM messages
        WHERE dm_id = ? AND id > COALESCE((SELECT last_read_id FROM dm_members WHERE conversation_id = ? AND user_id = ?), 0) AND user_id != ?`).get(conversation.id, conversation.id, user.id, user.id).count;
      result.push({
        id: conversation.id,
        peer: peer ? publicUser(peer) : null,
        last_message: lastMessage ? hydrateMessages([lastMessage], user.id)[0] : null,
        unread: unread
      });
    }
    return (json(res, 200, { conversations: result }), true);
  }

  if (req.method === 'POST' && url.pathname === '/api/dm/conversations') {
    const user = requireUser(req, res); if (!user) return true;
    const { username = '' } = await readBody(req);
    const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(String(username).trim());
    if (!target) return (json(res, 404, { error: '用户不存在' }), true);
    if (target.id === user.id) return (json(res, 400, { error: '不能和自己私信' }), true);
    const friendship = db.prepare("SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'accepted'").get(user.id, target.id)
      || db.prepare("SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'accepted'").get(target.id, user.id);
    if (!friendship) return (json(res, 403, { error: '只有互为好友才能私信' }), true);
    const existing = db.prepare(`SELECT dm_conversations.id FROM dm_conversations
      JOIN dm_members a ON a.conversation_id = dm_conversations.id AND a.user_id = ?
      JOIN dm_members b ON b.conversation_id = dm_conversations.id AND b.user_id = ? LIMIT 1`).get(user.id, target.id);
    if (existing) return (json(res, 200, { conversation: { id: existing.id, peer: publicUser(target) } }), true);
    const result = db.prepare('INSERT INTO dm_conversations(created_by) VALUES (?)').run(user.id);
    const id = Number(result.lastInsertRowid);
    db.prepare('INSERT INTO dm_members(conversation_id, user_id) VALUES (?, ?)').run(id, user.id);
    db.prepare('INSERT INTO dm_members(conversation_id, user_id) VALUES (?, ?)').run(id, target.id);
    return (json(res, 201, { conversation: { id, peer: publicUser(target) } }), true);
  }

  const dmMessagesMatch = url.pathname.match(/^\/api\/dm\/conversations\/(\d+)\/messages$/);
  if (dmMessagesMatch && req.method === 'GET') {
    const convId = Number(dmMessagesMatch[1]);
    const user = requireUser(req, res); if (!user) return true;
    if (!db.prepare('SELECT 1 FROM dm_members WHERE conversation_id = ? AND user_id = ?').get(convId, user.id)) return (json(res, 403, { error: '无权访问该会话' }), true);
    const after = Math.max(0, Number(url.searchParams.get('after') || 0));
    const before = Math.max(0, Number(url.searchParams.get('before') || 0));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
    if (before > 0) {
      const rows = db.prepare(`SELECT ${dmMessageColumns} FROM messages JOIN users ON users.id = messages.user_id
        LEFT JOIN messages AS parent ON parent.id = messages.reply_to LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id
        LEFT JOIN attachments ON attachments.id = messages.attachment_id LEFT JOIN p2p_transfers ON p2p_transfers.id = messages.p2p_transfer_id WHERE messages.dm_id = ? AND messages.id < ? ORDER BY messages.id DESC LIMIT ?`).all(convId, before, limit + 1);
      const hasMore = rows.length > limit;
      return (json(res, 200, { messages: hydrateMessages(rows.slice(0, limit).reverse(), user.id), has_more: hasMore }), true);
    }
    const rows = db.prepare(`SELECT ${dmMessageColumns} FROM messages JOIN users ON users.id = messages.user_id
      LEFT JOIN messages AS parent ON parent.id = messages.reply_to LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id
      LEFT JOIN attachments ON attachments.id = messages.attachment_id LEFT JOIN p2p_transfers ON p2p_transfers.id = messages.p2p_transfer_id WHERE messages.dm_id = ? AND messages.id > ? ORDER BY messages.id LIMIT ?`).all(convId, after, limit + 1);
    const hasMore = rows.length > limit;
    return (json(res, 200, { messages: hydrateMessages(rows.slice(0, limit), user.id), has_more: hasMore }), true);
  }

  if (dmMessagesMatch && req.method === 'POST') {
    const convId = Number(dmMessagesMatch[1]);
    const user = requireUser(req, res); if (!user) return true;
    const membership = db.prepare('SELECT user_id FROM dm_members WHERE conversation_id = ? AND user_id = ?').get(convId, user.id);
    if (!membership) return (json(res, 403, { error: '无权访问该会话' }), true);
    if (isUserBanned(user)) return (json(res, 403, { error: '账号已被封禁', banned_until: user.banned_until }), true);
    if (isUserMuted(user)) return (json(res, 403, { error: '你已被禁言，无法发送消息', muted_until: user.muted_until }), true);
    const { content = '', attachment_id = null, reply_to = null } = await readBody(req);
    const text = String(content).trim();
    const attachmentId = attachment_id == null ? null : Number(attachment_id);
    if ((!text && !attachmentId) || text.length > 10_000) return (json(res, 400, { error: '消息或附件不能为空，文字最多 10000 个字符' }), true);
    if (attachmentId && !db.prepare('SELECT id FROM attachments WHERE id = ? AND user_id = ?').get(attachmentId, user.id)) {
      return (json(res, 400, { error: '附件不存在或不属于当前账号' }), true);
    }
    const replyId = reply_to == null ? null : Number(reply_to);
    if (replyId && !db.prepare('SELECT id FROM messages WHERE id = ? AND dm_id = ?').get(replyId, convId)) return (json(res, 400, { error: '回复目标不存在或不在当前会话' }), true);
    const badMention = validateMentions(text);
    if (badMention) return (json(res, 400, { error: `被 @ 的用户 ${badMention} 不存在` }), true);
    const result = db.prepare('INSERT INTO messages(dm_id, user_id, content, attachment_id, reply_to) VALUES (?, ?, ?, ?, ?)').run(convId, user.id, text, attachmentId, replyId);
    const message = db.prepare(`SELECT ${dmMessageColumns} FROM messages JOIN users ON users.id = messages.user_id
      LEFT JOIN messages AS parent ON parent.id = messages.reply_to LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id
      LEFT JOIN attachments ON attachments.id = messages.attachment_id LEFT JOIN p2p_transfers ON p2p_transfers.id = messages.p2p_transfer_id WHERE messages.id = ?`).get(result.lastInsertRowid);
    const hydrated = hydrateMessages([message], user.id)[0];
    broadcastDm(convId, { type: 'dm_message', conversation_id: convId, message: hydrated });
    eventBus.emit('dm:sent', { conversationId: convId, message: hydrated, sender: user });
    return (json(res, 201, { message: hydrated }), true);
  }

  const dmReadMatch = url.pathname.match(/^\/api\/dm\/conversations\/(\d+)\/read$/);
  if (dmReadMatch && req.method === 'POST') {
    const convId = Number(dmReadMatch[1]);
    const user = requireUser(req, res); if (!user) return true;
    const { message_id = 0 } = await readBody(req);
    if (!db.prepare('SELECT 1 FROM dm_members WHERE conversation_id = ? AND user_id = ?').get(convId, user.id)) return (json(res, 403, { error: '无权访问该会话' }), true);
    db.prepare('UPDATE dm_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?').run(Number(message_id), convId, user.id);
    broadcast({ type: 'dm_read', conversation_id: convId, user_id: user.id, message_id: Number(message_id) });
    return (json(res, 200, { ok: true }), true);
  }

  const dmSingleMatch = url.pathname.match(/^\/api\/dm\/messages\/(\d+)$/);
  if (dmSingleMatch && req.method === 'GET') {
    const user = requireUser(req, res); if (!user) return true;
    const messageId = Number(dmSingleMatch[1]);
    const message = db.prepare('SELECT * FROM messages WHERE id = ? AND dm_id IS NOT NULL').get(messageId);
    if (!message) return (json(res, 404, { error: '消息不存在' }), true);
    if (!db.prepare('SELECT 1 FROM dm_members WHERE conversation_id = ? AND user_id = ?').get(message.dm_id, user.id)) return (json(res, 403, { error: '无权访问该会话' }), true);
    const row = db.prepare(`SELECT ${dmMessageColumns} FROM messages JOIN users ON users.id = messages.user_id LEFT JOIN messages AS parent ON parent.id = messages.reply_to LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id LEFT JOIN attachments ON attachments.id = messages.attachment_id LEFT JOIN p2p_transfers ON p2p_transfers.id = messages.p2p_transfer_id WHERE messages.id = ?`).get(message.id);
    return (json(res, 200, { message: hydrateMessages([row], user.id)[0] }), true);
  }
  if (dmSingleMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
    const user = requireUser(req, res); if (!user) return true;
    const messageId = Number(dmSingleMatch[1]);
    const message = db.prepare('SELECT * FROM messages WHERE id = ? AND dm_id IS NOT NULL').get(messageId);
    if (!message) return (json(res, 404, { error: '消息不存在' }), true);
    if (!db.prepare('SELECT 1 FROM dm_members WHERE conversation_id = ? AND user_id = ?').get(message.dm_id, user.id)) return (json(res, 403, { error: '无权访问该会话' }), true);
    if (req.method === 'PUT') {
      if (message.user_id !== user.id) return (json(res, 403, { error: '只能编辑自己的消息' }), true);
      const { content = '' } = await readBody(req); const text = String(content).trim();
      if (!text || text.length > 10_000) return (json(res, 400, { error: '消息需为 1–10000 个字符' }), true);
      db.prepare('UPDATE messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').run(text, message.id);
      broadcastDm(message.dm_id, { type: 'dm_message_update', conversation_id: message.dm_id, message_id: message.id });
      return (json(res, 200, { ok: true, message: hydrateMessages([db.prepare(`SELECT ${dmMessageColumns} FROM messages JOIN users ON users.id = messages.user_id LEFT JOIN messages AS parent ON parent.id = messages.reply_to LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id LEFT JOIN attachments ON attachments.id = messages.attachment_id LEFT JOIN p2p_transfers ON p2p_transfers.id = messages.p2p_transfer_id WHERE messages.id = ?`).get(message.id)], user.id)[0] }), true);
    }
    if (message.user_id !== user.id && !user.is_admin) return (json(res, 403, { error: '没有撤回此消息的权限' }), true);
    db.prepare("UPDATE messages SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(message.id);
    broadcastDm(message.dm_id, { type: 'dm_message_update', conversation_id: message.dm_id, message_id: message.id });
    return (json(res, 200, { ok: true }), true);
  }

  // 查看已撤回 DM 消息的原始内容
  const dmOriginalMatch = url.pathname.match(/^\/api\/dm\/messages\/(\d+)\/original$/);
  if (dmOriginalMatch && req.method === 'GET') {
    const user = requireUser(req, res); if (!user) return true;
    const message = db.prepare('SELECT * FROM messages WHERE id = ? AND dm_id IS NOT NULL').get(Number(dmOriginalMatch[1]));
    if (!message) return (json(res, 404, { error: '消息不存在' }), true);
    if (!message.deleted_at) return (json(res, 400, { error: '消息未被撤回' }), true);
    if (!db.prepare('SELECT 1 FROM dm_members WHERE conversation_id = ? AND user_id = ?').get(message.dm_id, user.id)) return (json(res, 403, { error: '无权访问该会话' }), true);
    if (message.user_id !== user.id && !user.is_admin) return (json(res, 403, { error: '没有查看撤回内容的权限' }), true);
    return (json(res, 200, { content: message.content, attachment_id: message.attachment_id, username: message.user_id ? (db.prepare('SELECT username FROM users WHERE id = ?').get(message.user_id)?.username || '') : '' }), true);
  }

  const dmReactionMatch = url.pathname.match(/^\/api\/dm\/messages\/(\d+)\/reactions$/);
  if (dmReactionMatch && req.method === 'POST') {
    const user = requireUser(req, res); if (!user) return true;
    const messageId = Number(dmReactionMatch[1]);
    const message = db.prepare('SELECT dm_id FROM messages WHERE id = ? AND dm_id IS NOT NULL').get(messageId);
    if (!message || !db.prepare('SELECT 1 FROM dm_members WHERE conversation_id = ? AND user_id = ?').get(message.dm_id, user.id)) return (json(res, 403, { error: '无权访问该会话' }), true);
    const { emoji = '' } = await readBody(req); const value = String(emoji);
    if (!value || value.length > 24 || !/\p{Extended_Pictographic}/u.test(value)) return (json(res, 400, { error: '表情格式无效' }), true);
    const exists = db.prepare('SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(messageId, user.id, value);
    if (exists) db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(messageId, user.id, value);
    else db.prepare('INSERT INTO message_reactions(message_id, user_id, emoji) VALUES (?, ?, ?)').run(messageId, user.id, value);
    broadcastDm(message.dm_id, { type: 'dm_message_update', conversation_id: message.dm_id, message_id: messageId });
    return (json(res, 200, { reactions: hydrateMessages([{ id: messageId }], user.id)[0].reactions }), true);
  }

  return false;
}
