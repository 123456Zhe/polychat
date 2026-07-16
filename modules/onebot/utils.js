export function onebotTS() {
  return Math.floor(Date.now() / 1000);
}

export function onebotTextSegments(text) {
  const seg = [];
  const regex = /\[at:(\d+)\]/g;
  let last = 0, m;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) seg.push({ type: 'text', data: { text: text.slice(last, m.index) } });
    seg.push({ type: 'at', data: { qq: m[1] } });
    last = regex.lastIndex;
  }
  if (last < text.length) seg.push({ type: 'text', data: { text: text.slice(last) } });
  return seg;
}

export function onebotSegments(message) {
  const seg = [];
  if (message.content) seg.push(...onebotTextSegments(message.content));
  if (message.attachment_id && message.attachment_type?.startsWith('image/')) {
    seg.push({ type: 'image', data: { file: `/api/files/${message.attachment_id}` } });
  } else if (message.attachment_id) {
    seg.push({ type: 'file', data: { file: `/api/files/${message.attachment_id}`, name: message.attachment_name || '' } });
  }
  return seg;
}

export function onebotMessageText(raw) {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map(s => {
    if (s.type === 'text') return s.data?.text || '';
    if (s.type === 'at') return `@${s.data?.qq || s.data?.user_id || ''}`;
    if (s.type === 'image') return `[图片]`;
    if (s.type === 'file') return `[文件: ${s.data?.name || ''}]`;
    return '';
  }).join('').trim();
  return '';
}

export function onebotGetOrCreateDm(db, botUserId, targetUserId) {
  const existing = db.prepare(`SELECT dm_conversations.id FROM dm_conversations
    JOIN dm_members a ON a.conversation_id = dm_conversations.id AND a.user_id = ?
    JOIN dm_members b ON b.conversation_id = dm_conversations.id AND b.user_id = ? LIMIT 1`).get(botUserId, targetUserId);
  if (existing) return existing.id;
  const result = db.prepare('INSERT INTO dm_conversations(created_by) VALUES (?)').run(botUserId);
  const id = Number(result.lastInsertRowid);
  db.prepare('INSERT INTO dm_members(conversation_id, user_id) VALUES (?, ?)').run(id, botUserId);
  db.prepare('INSERT INTO dm_members(conversation_id, user_id) VALUES (?, ?)').run(id, targetUserId);
  return id;
}
