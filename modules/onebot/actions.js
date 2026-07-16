import { onebotTS, onebotSegments, onebotMessageText, onebotGetOrCreateDm } from './utils.js';

export function createOnebotActionHandler(ctx) {
  const { db, roomForUser, validateMentions, hydrateMessages, broadcast, conversationMembers, socketCanAccess, botSockets } = ctx;

  function broadcastOnebotGroupMessage(roomId, message, sender) {
    const cache = new Map();
    for (const s of botSockets) {
      if (s.readyState !== 1 || !socketCanAccess(s, roomId)) continue;
      if (!cache.has(s.user.id)) cache.set(s.user.id, JSON.stringify({
        time: onebotTS(), self_id: s.user.id, post_type: 'message',
        message_type: 'group', sub_type: 'normal',
        message_id: message.id, group_id: roomId, user_id: sender.id,
        sender: { user_id: sender.id, nickname: sender.username, sex: 'unknown', age: 0 },
        message: onebotSegments(message), raw_message: message.content || '', font: 0
      }));
      s.send(cache.get(s.user.id));
    }
  }

  function broadcastOnebotPrivateMessage(convId, message, sender) {
    const mIds = new Set(conversationMembers(convId));
    const cache = new Map();
    for (const s of botSockets) {
      if (s.readyState !== 1 || !mIds.has(s.user.id)) continue;
      if (!cache.has(s.user.id)) cache.set(s.user.id, JSON.stringify({
        time: onebotTS(), self_id: s.user.id, post_type: 'message',
        message_type: 'private', sub_type: 'friend',
        message_id: message.id, user_id: sender.id,
        sender: { user_id: sender.id, nickname: sender.username, sex: 'unknown', age: 0 },
        message: onebotSegments(message), raw_message: message.content || '', font: 0
      }));
      s.send(cache.get(s.user.id));
    }
  }

  return async function handleOnebotAction(client, msg) {
    const { action, params = {}, echo } = msg;
    const user = client.user;
    function respond(data = null, status = 'ok', retcode = 0, errMsg = null) {
      if (client.readyState !== 1) return;
      const res = { status, retcode, data, echo, message: errMsg };
      client.send(JSON.stringify(Object.fromEntries(Object.entries(res).filter(([, v]) => v !== null))));
    }
    try {
      switch (action) {
        case 'send_group_msg': {
          if (!params.group_id) return respond(null, 'failed', 100, '缺少 group_id');
          const roomId = Number(params.group_id);
          const room = roomForUser(roomId, user.id);
          if (!room) return respond(null, 'failed', 100, '房间不存在或无权限');
          const text = onebotMessageText(params.message);
          if (!text || text.length > 10000) return respond(null, 'failed', 100, '消息内容无效');
          const badMention = validateMentions(text);
          if (badMention) return respond(null, 'failed', 100, `被 @ 的用户 ${badMention} 不存在`);
          const r = db.prepare('INSERT INTO messages(room_id, user_id, content) VALUES (?, ?, ?)').run(roomId, user.id, text);
          const mid = Number(r.lastInsertRowid);
          respond({ message_id: mid });
          const message = db.prepare(`SELECT messages.id, messages.content, messages.created_at, messages.reply_to, messages.thread_root, messages.edited_at, messages.deleted_at,
            users.id AS user_id, users.username, users.avatar_updated_at FROM messages JOIN users ON users.id = messages.user_id WHERE messages.id = ?`).get(mid);
          const hydrated = hydrateMessages([message], user.id)[0];
          broadcast({ type: 'message', room_id: roomId, message_id: mid, thread_root: null, message: hydrated }, roomId);
          broadcastOnebotGroupMessage(roomId, hydrated, user);
          break;
        }
        case 'send_private_msg': {
          if (!params.user_id) return respond(null, 'failed', 100, '缺少 user_id');
          const targetId = Number(params.user_id);
          if (targetId === user.id) return respond(null, 'failed', 100, '不能给自己发消息');
          const convId = onebotGetOrCreateDm(db, user.id, targetId);
          const text = onebotMessageText(params.message);
          if (!text || text.length > 10000) return respond(null, 'failed', 100, '消息内容无效');
          const badMention = validateMentions(text);
          if (badMention) return respond(null, 'failed', 100, `被 @ 的用户 ${badMention} 不存在`);
          const r = db.prepare('INSERT INTO messages(dm_id, user_id, content) VALUES (?, ?, ?)').run(convId, user.id, text);
          const mid = Number(r.lastInsertRowid);
          respond({ message_id: mid });
          const message = db.prepare(`SELECT messages.id, messages.content, messages.created_at, messages.reply_to, messages.thread_root, messages.edited_at, messages.deleted_at,
            users.id AS user_id, users.username, users.avatar_updated_at FROM messages JOIN users ON users.id = messages.user_id WHERE messages.id = ?`).get(mid);
          const hydrated = hydrateMessages([message], user.id)[0];
          broadcast({ type: 'dm_message', conversation_id: convId, message: hydrated });
          broadcastOnebotPrivateMessage(convId, hydrated, user);
          break;
        }
        case 'send_msg': {
          if (params.message_type === 'private' || params.user_id) {
            return handleOnebotAction(client, { action: 'send_private_msg', params: { ...params, group_id: undefined }, echo });
          }
          return handleOnebotAction(client, { action: 'send_group_msg', params: { ...params, user_id: undefined }, echo });
        }
        case 'delete_msg': {
          const mid = Number(params.message_id);
          if (!mid) return respond(null, 'failed', 100, '缺少 message_id');
          const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(mid);
          if (!message) return respond(null, 'failed', 100, '消息不存在');
          const canDelete = message.user_id === user.id || (message.room_id && (user.is_admin || ['owner', 'admin'].includes(roomForUser(message.room_id, user.id)?.role)));
          if (!canDelete) return respond(null, 'failed', 100, '无权撤回');
          db.prepare("UPDATE messages SET content = '', attachment_id = NULL, deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(mid);
          respond(null);
          if (message.room_id) broadcast({ type: 'message_update', room_id: message.room_id, message_id: mid }, message.room_id);
          else if (message.dm_id) broadcast({ type: 'dm_message_update', conversation_id: message.dm_id, message_id: mid });
          break;
        }
        case 'get_msg': {
          const mid = Number(params.message_id);
          if (!mid) return respond(null, 'failed', 100, '缺少 message_id');
          const message = db.prepare(`SELECT messages.*, users.username FROM messages JOIN users ON users.id = messages.user_id WHERE messages.id = ?`).get(mid);
          if (!message) return respond(null, 'failed', 100, '消息不存在');
          respond({
            message_id: message.id, user_id: message.user_id, message: onebotSegments(message),
            real_id: message.id, sender: { user_id: message.user_id, nickname: message.username },
            time: Math.floor(new Date(message.created_at).getTime() / 1000)
          });
          break;
        }
        case 'get_login_info': {
          respond({ user_id: user.id, nickname: user.username });
          break;
        }
        case 'get_group_list': {
          const rooms = db.prepare(`SELECT rooms.id, rooms.name FROM rooms LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
            WHERE rooms.is_private = 0 OR room_members.user_id IS NOT NULL OR ? = 1 ORDER BY rooms.id`).all(user.id, user.is_admin ? 1 : 0);
          respond(rooms.map(r => ({ group_id: r.id, group_name: r.name })));
          break;
        }
        case 'get_group_info': {
          const roomId = Number(params.group_id);
          const room = roomForUser(roomId, user.id);
          if (!room) return respond(null, 'failed', 100, '房间不存在或无权限');
          respond({ group_id: room.id, group_name: room.name });
          break;
        }
        case 'get_group_member_list': {
          const roomId = Number(params.group_id);
          const room = roomForUser(roomId, user.id);
          if (!room) return respond(null, 'failed', 100, '房间不存在或无权限');
          const members = db.prepare(`SELECT users.id, users.username, room_members.role FROM room_members JOIN users ON users.id = room_members.user_id WHERE room_id = ? ORDER BY role, username`).all(roomId);
          respond(members.map(m => ({ user_id: m.id, nickname: m.username, role: m.role })));
          break;
        }
        case 'get_group_member_info': {
          const roomId = Number(params.group_id);
          const targetId = Number(params.user_id);
          if (!targetId) return respond(null, 'failed', 100, '缺少 user_id');
          const room = roomId ? roomForUser(roomId, user.id) : null;
          const member = roomId
            ? db.prepare(`SELECT users.id, users.username, room_members.role FROM room_members JOIN users ON users.id = room_members.user_id WHERE room_id = ? AND user_id = ?`).get(roomId, targetId)
            : null;
          const fallback = member || db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId);
          if (!fallback) return respond(null, 'failed', 100, '用户不存在');
          respond({ user_id: fallback.id, nickname: fallback.username, role: member?.role || 'member' });
          break;
        }
        case 'get_group_msg_history': {
          const roomId = Number(params.group_id);
          const room = roomForUser(roomId, user.id);
          if (!room) return respond(null, 'failed', 100, '房间不存在或无权限');
          const count = Math.min(Number(params.count) || 20, 100);
          const beforeId = Number(params.message_seq || params.message_id) || null;
          const rows = beforeId
            ? db.prepare(`SELECT messages.*, users.username FROM messages JOIN users ON users.id = messages.user_id WHERE messages.room_id = ? AND messages.id < ? ORDER BY messages.id DESC LIMIT ?`).all(roomId, beforeId, count)
            : db.prepare(`SELECT messages.*, users.username FROM messages JOIN users ON users.id = messages.user_id WHERE messages.room_id = ? ORDER BY messages.id DESC LIMIT ?`).all(roomId, count);
          rows.reverse();
          respond({
            messages: rows.map(m => ({
              time: Math.floor(new Date(m.created_at).getTime() / 1000),
              message_type: 'group', message_id: m.id, real_id: m.id, group_id: roomId,
              user_id: m.user_id, sender: { user_id: m.user_id, nickname: m.username },
              message: onebotSegments(m), raw_message: m.content || ''
            }))
          });
          break;
        }
        case 'get_friend_list': {
          const friends = db.prepare(`SELECT users.id, users.username FROM friendships JOIN users ON users.id = friendships.friend_id
            WHERE friendships.user_id = ? AND friendships.status = 'accepted' ORDER BY users.username`).all(user.id);
          respond(friends.map(f => ({ user_id: f.id, nickname: f.username })));
          break;
        }
        case 'get_stranger_info': {
          const targetId = Number(params.user_id);
          const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(targetId);
          if (!target) return respond(null, 'failed', 100, '用户不存在');
          respond({ user_id: target.id, nickname: target.username, sex: 'unknown', age: 0 });
          break;
        }
        default:
          respond(null, 'failed', 100, `不支持的动作: ${action}`);
      }
    } catch (err) {
      console.error('OneBot action error:', err);
      respond(null, 'failed', 100, '服务器内部错误');
    }
  };
}
