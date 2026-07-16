import { onebotSegments as segments } from './utils.js';

export function registerOnebotEventListeners(ctx) {
  const { eventBus, botSockets, conversationMembers, socketCanAccess } = ctx;
  const onebotTS = () => Math.floor(Date.now() / 1000);

  function broadcastGroup(roomId, message, sender) {
    const cache = new Map();
    for (const s of botSockets) {
      if (s.readyState !== 1 || !socketCanAccess(s, roomId)) continue;
      if (!cache.has(s.user.id)) cache.set(s.user.id, JSON.stringify({
        time: onebotTS(), self_id: s.user.id, post_type: 'message',
        message_type: 'group', sub_type: 'normal',
        message_id: message.id, group_id: roomId, user_id: sender.id,
        sender: { user_id: sender.id, nickname: sender.username, sex: 'unknown', age: 0 },
        message: segments(message), raw_message: message.content || '', font: 0
      }));
      s.send(cache.get(s.user.id));
    }
  }

  function broadcastPrivate(convId, message, sender) {
    const mIds = new Set(conversationMembers(convId));
    const cache = new Map();
    for (const s of botSockets) {
      if (s.readyState !== 1 || !mIds.has(s.user.id)) continue;
      if (!cache.has(s.user.id)) cache.set(s.user.id, JSON.stringify({
        time: onebotTS(), self_id: s.user.id, post_type: 'message',
        message_type: 'private', sub_type: 'friend',
        message_id: message.id, user_id: sender.id,
        sender: { user_id: sender.id, nickname: sender.username, sex: 'unknown', age: 0 },
        message: segments(message), raw_message: message.content || '', font: 0
      }));
      s.send(cache.get(s.user.id));
    }
  }

  eventBus.on('message:sent', ({ roomId, message, sender, threadRoot }) => {
    if (threadRoot) return;
    broadcastGroup(roomId, message, sender);
  });
  eventBus.on('dm:sent', ({ conversationId, message, sender }) => {
    broadcastPrivate(conversationId, message, sender);
  });
}
