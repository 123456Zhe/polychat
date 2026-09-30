import { db } from './db.js';
import { resolveMentions } from './users.js';

export function hydrateMessages(messages, viewerId) {
  if (!messages.length) return messages;
  const ids = messages.map(message => message.id);
  const placeholders = ids.map(() => '?').join(',');
  const reactions = db.prepare(`SELECT message_id, emoji, GROUP_CONCAT(user_id) AS users
    FROM message_reactions WHERE message_id IN (${placeholders}) GROUP BY message_id, emoji`).all(...ids);
  const byMessage = new Map();
  for (const reaction of reactions) {
    if (!byMessage.has(reaction.message_id)) byMessage.set(reaction.message_id, []);
    const userIds = reaction.users.split(',').map(Number);
    byMessage.get(reaction.message_id).push({ emoji: reaction.emoji, count: userIds.length, reacted: userIds.includes(viewerId) });
  }
  return messages.map(message => {
    const enriched = { ...message, is_deleted: Boolean(message.deleted_at), reactions: byMessage.get(message.id) || [] };
    enriched.mentions = resolveMentions(enriched.content);
    return enriched;
  });
}
