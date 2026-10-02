// 应用状态与数据层：房间/私信/消息/WS 事件。
import { api, auth, uploadFile, ApiError } from './api.js';
import { mentionNames } from './markdown.js';

export const S = {
  user: null,
  rooms: [], convs: [],
  active: null,            // { kind: 'room'|'dm', id }
  roomDetail: null,        // 当前房间（含 role、announcement）
  convDetail: null,
  messages: [], msgIds: new Set(), hasMore: true, loadingMore: false,
  online: new Map(),       // userId -> presence
  typing: new Map(),       // key -> Map(userId -> {name, timer})
  unreadRooms: {}, unreadDms: {},
  notifUnread: 0,
  globalAnnouncement: null,
  pins: [],
  mentionables: [],
  gallery: { images: [], quota_mb: 0, used_mb: 0 },
  thread: { root: null, messages: [] },
  members: [], joinRequests: [], inviteCodes: [],
  admin: { tab: 'users', overview: null, bannedIps: [], bannedFps: [], botRequests: [], botTokens: [], plugins: [], pluginMarket: [], pluginsEnabled: {} },
  ws: null, wsOk: false, pollTimer: null,
  device: 'auto', resolved: 'desktop',
  replyTo: null, editing: null,
  phoneTab: 'chats', drawerOpen: false,
  watchView: 'list',
  searchFilter: '',
  listeners: new Set(),
};

export function onChange(fn) { S.listeners.add(fn); return () => S.listeners.delete(fn); }
export function emit(what) { S.listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } }); }

function persistUnread() {
  try { localStorage.setItem('pc2.unread', JSON.stringify({ r: S.unreadRooms, d: S.unreadDms })); } catch {}
}
function restoreUnread() {
  try {
    const u = JSON.parse(localStorage.getItem('pc2.unread') || '{}');
    S.unreadRooms = u.r || {}; S.unreadDms = u.d || {};
  } catch {}
}

export function activeKey() {
  return S.active ? `${S.active.kind}:${S.active.id}` : null;
}

// ---------- 初始化 ----------
export async function init() {
  restoreUnread();
  try {
    const me = await auth.me();
    S.user = me.user || me;
    await enter();
    return true;
  } catch (e) {
    return false; // 未登录 → 显示登录页
  }
}

export async function doLogin(username, password) {
  const ret = await auth.login(username, password);
  S.user = ret.user;
  await enter();
}
export async function doRegister(username, password) {
  const ret = await auth.register(username, password);
  S.user = ret.user;
  await enter();
}
export async function doLogout() {
  try { await auth.logout(); } catch {}
  closeWs();
  Object.assign(S, { user: null, rooms: [], convs: [], active: null, messages: [], msgIds: new Set(), unreadRooms: {}, unreadDms: {}, notifUnread: 0 });
  persistUnread();
  emit('auth');
}

async function enter() {
  await Promise.all([loadRooms(), loadConvs(), loadNotifCount(), loadGlobalAnnouncement()]);
  connectWs();
  startPollFallback();
  emit('enter');
}

export async function loadRooms() {
  const ret = await api('/api/rooms');
  S.rooms = ret.rooms || [];
  if (S.active?.kind === 'room') {
    const r = S.rooms.find(r => r.id === S.active.id);
    if (r) { S.roomDetail = r; }
  }
  emit('rooms');
}
export async function loadConvs() {
  const ret = await api('/api/dm/conversations');
  S.convs = ret.conversations || [];
  emit('convs');
}
async function loadNotifCount() {
  try {
    const ret = await api('/api/notifications/unread-count');
    S.notifUnread = ret.count || 0;
    emit('notif');
  } catch {}
}
async function loadGlobalAnnouncement() {
  try {
    const ret = await api('/api/admin/announcement');
    S.globalAnnouncement = ret.announcement;
    emit('announcement');
  } catch {}
}

// ---------- 会话切换 ----------
export async function selectRoom(id) {
  const room = S.rooms.find(r => r.id === id);
  S.active = { kind: 'room', id };
  S.roomDetail = room || null;
  S.convDetail = null;
  S.replyTo = null; S.editing = null;
  S.messages = []; S.msgIds = new Set(); S.hasMore = true;
  S.unreadRooms[id] = 0; persistUnread();
  S.drawerOpen = false;
  emit('active');
  await loadMessages();
  loadMentionables(id);
  loadPins(id, true);
  emit('rooms');
}
export async function selectDM(id) {
  const conv = S.convs.find(c => c.id === id);
  S.active = { kind: 'dm', id };
  S.convDetail = conv || null;
  S.roomDetail = null;
  S.replyTo = null; S.editing = null;
  S.messages = []; S.msgIds = new Set(); S.hasMore = true;
  S.unreadDms[id] = 0; persistUnread();
  S.drawerOpen = false;
  emit('active');
  await loadMessages();
  emit('convs');
}

async function loadMentionables(roomId) {
  try {
    const ret = await api(`/api/rooms/${roomId}/mentionables`);
    S.mentionables = ret.users || ret.members || [];
    S.mentionables.forEach(u => { mentionNames[u.id] = u.username; });
  } catch { S.mentionables = []; }
}

export async function loadMessages() {
  if (!S.active) return;
  const { kind, id } = S.active;
  // 初始加载取最新一页：before 用最大安全整数（与 v1 老 UI 一致）
  const url = kind === 'room' ? `/api/rooms/${id}/messages?limit=40&before=9007199254740991` : `/api/dm/conversations/${id}/messages?limit=40&before=9007199254740991`;
  const ret = await api(url);
  const msgs = (ret.messages || []).slice();
  S.messages = msgs;
  S.msgIds = new Set(msgs.map(m => m.id));
  S.hasMore = ret.has_more ?? (ret.messages || []).length >= 40;
  msgs.forEach(cacheMentions);
  if (kind === 'dm') markDmRead();
  emit('messages');
}

export async function loadMore() {
  if (!S.active || !S.hasMore || S.loadingMore || S.messages.length === 0) return;
  S.loadingMore = true; emit('messages');
  try {
    const { kind, id } = S.active;
    const oldest = S.messages[0].id;
    const url = kind === 'room'
      ? `/api/rooms/${id}/messages?limit=40&before=${oldest}`
      : `/api/dm/conversations/${id}/messages?limit=40&before=${oldest}`;
    const ret = await api(url);
    const msgs = (ret.messages || []).slice().filter(m => !S.msgIds.has(m.id));
    msgs.forEach(m => S.msgIds.add(m.id));
    S.messages = [...msgs, ...S.messages];
    S.hasMore = ret.has_more ?? (ret.messages || []).length >= 40;
    msgs.forEach(cacheMentions);
  } catch {}
  S.loadingMore = false; emit('messages');
}

function cacheMentions(m) {
  (m.mentions || []).forEach(u => { mentionNames[u.id] = u.username; });
}

async function markDmRead() {
  const last = S.messages[S.messages.length - 1];
  if (!last || !S.active || S.active.kind !== 'dm') return;
  if (last.user_id === S.user.id) return;
  try {
    await api(`/api/dm/conversations/${S.active.id}/read`, { method: 'POST', body: { message_id: last.id } });
    if (S.convDetail) S.convDetail.unread_count = 0;
  } catch {}
}

// ---------- 消息操作 ----------
export async function sendMessage(content, { attachment = null, replyTo = null } = {}) {
  if (!S.active) return;
  const { kind, id } = S.active;
  const body = { content: content || '' };
  if (attachment) body.attachment_id = attachment.id;
  if (replyTo) body.reply_to = replyTo;
  const url = kind === 'room' ? `/api/rooms/${id}/messages` : `/api/dm/conversations/${id}/messages`;
  const ret = await api(url, { method: 'POST', body });
  const msg = ret.message;
  if (msg && !S.msgIds.has(msg.id)) {
    S.msgIds.add(msg.id); cacheMentions(msg);
    S.messages.push(msg);
    emit('messages');
  }
  S.replyTo = null; S.editing = null;
  return msg;
}

export async function toggleReaction(msg, emoji) {
  const url = msg.dm_id
    ? `/api/dm/messages/${msg.id}/reactions`
    : `/api/messages/${msg.id}/reactions`;
  const ret = await api(url, { method: 'POST', body: { emoji } });
  // 立刻本地更新表情（服务端返回最新 reactions），不再干等广播
  if (ret && ret.reactions) {
    const i = S.messages.findIndex(m => m.id === msg.id);
    if (i >= 0) { S.messages[i] = { ...S.messages[i], reactions: ret.reactions }; emit('messages'); }
  }
}

export async function editMessage(msg, content) {
  const url = msg.dm_id ? `/api/dm/messages/${msg.id}` : `/api/messages/${msg.id}`;
  const ret = await api(url, { method: 'PUT', body: { content } });
  applyLocalUpdate(ret.message);
}

export async function retractMessage(msg) {
  const url = msg.dm_id ? `/api/dm/messages/${msg.id}` : `/api/messages/${msg.id}`;
  await api(url, { method: 'DELETE' });
  // 立刻本地标记已撤回（广播只带 message_id，靠上面的拉取更新他人视角）
  const i = S.messages.findIndex(m => m.id === msg.id);
  if (i >= 0) {
    S.messages[i] = { ...S.messages[i], is_deleted: true, deleted_at: new Date().toISOString() };
    emit('messages');
  }
}

function applyLocalUpdate(updated) {
  if (!updated) return;
  const i = S.messages.findIndex(m => m.id === updated.id);
  if (i >= 0) { S.messages[i] = updated; cacheMentions(updated); emit('messages'); }
  const j = S.thread.messages.findIndex(m => m.id === updated.id);
  if (j >= 0) { S.thread.messages[j] = updated; emit('thread'); }
}

export async function pinMessage(msgId) {
  if (!S.active || S.active.kind !== 'room') return;
  await api(`/api/rooms/${S.active.id}/pins/${msgId}`, { method: 'PUT' });
  await loadPins(S.active.id);
}
export async function unpinMessage(msgId) {
  if (!S.active || S.active.kind !== 'room') return;
  await api(`/api/rooms/${S.active.id}/pins/${msgId}`, { method: 'DELETE' });
  await loadPins(S.active.id);
}
export async function loadPins(roomId, silent) {
  try {
    const ret = await api(`/api/rooms/${roomId}/pins`);
    S.pins = ret.pins || ret.messages || [];
    if (!silent) emit('pins'); else emit('pins-silent');
  } catch { S.pins = []; }
}

// ---------- 图床 ----------
export async function loadGallery() {
  try {
    const ret = await api('/api/gallery');
    S.gallery = { images: ret.images || [], quota_mb: ret.quota_mb || 0, used_mb: ret.used_mb || 0 };
    emit('gallery');
  } catch (e) { emit({ text: e.message }); }
}
// ---------- 话题串 ----------
export async function openThread(msgId) {
  const ret = await api(`/api/messages/${msgId}/thread`);
  const msgs = ret.messages || [];
  S.thread = { root: msgs[0] || null, messages: msgs };
  emit('thread');
}
export async function sendThreadReply(rootId, content) {
  const roomId = S.thread.root?.room_id ?? S.active?.id;
  if (!roomId) throw new Error('无法确定房间');
  await api(`/api/rooms/${roomId}/messages`, { method: 'POST', body: { content, thread_root: rootId } });
  // 回复经 thread_message 实时事件推回；若 WS 未连则补拉一次
  if (!S.wsOk) { try { await openThread(rootId); } catch {} }
}
// 图床上传：服务端只接受原始字节 + 真实图片 MIME（非 multipart/JSON）
export async function uploadGalleryImage(file) {
  const res = await fetch('/api/gallery', {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `上传失败 (${res.status})`);
  await loadGallery();
  return data.image;
}
export async function deleteGalleryImage(id) {
  await api(`/api/gallery/${id}`, { method: 'DELETE' });
  await loadGallery();
}

// ---------- 房间管理 ----------
export async function renameRoom(roomId, name) {
  await api(`/api/rooms/${roomId}`, { method: 'PUT', body: { name } });
  await loadRooms();
}
export async function deleteRoom(roomId) {
  await api(`/api/rooms/${roomId}`, { method: 'DELETE' });
  if (S.active?.kind === 'room' && S.active.id === roomId) {
    S.active = null; S.roomDetail = null; S.messages = []; S.msgIds = new Set();
    emit('active');
  }
  await loadRooms();
}
export async function saveRoomSettings(roomId, settings) {
  await api(`/api/rooms/${roomId}/settings`, { method: 'PATCH', body: settings });
  await loadRooms();
}
export async function loadMembers(roomId) {
  const ret = await api(`/api/rooms/${roomId}/members`);
  S.members = ret.members || [];
  emit('members');
}
export async function inviteMember(roomId, username, role) {
  await api(`/api/rooms/${roomId}/members`, { method: 'POST', body: { username, role } });
  await loadMembers(roomId);
}
export async function removeMember(roomId, uid) {
  await api(`/api/rooms/${roomId}/members/${uid}`, { method: 'DELETE' });
  await loadMembers(roomId);
}
export async function setMemberRole(roomId, username, role) {
  // 服务端 POST members 为 upsert：已是成员则更新角色
  await api(`/api/rooms/${roomId}/members`, { method: 'POST', body: { username, role } });
  await loadMembers(roomId);
}
export async function loadJoinRequests(roomId) {
  const ret = await api(`/api/rooms/${roomId}/join-requests`);
  S.joinRequests = ret.requests || [];
  emit('join-requests');
}
export async function decideJoinRequest(roomId, uid, action) {
  await api(`/api/rooms/${roomId}/join-requests/${uid}/${action}`, { method: 'POST' });
  await loadJoinRequests(roomId);
}
export async function loadInviteCodes(roomId) {
  const ret = await api(`/api/rooms/${roomId}/invite-codes`);
  S.inviteCodes = ret.codes || [];
  emit('invite-codes');
}
export async function createInviteCode(roomId, maxUses, durationHours) {
  await api(`/api/rooms/${roomId}/invite-codes`, { method: 'POST', body: { max_uses: maxUses, duration_hours: durationHours } });
  await loadInviteCodes(roomId);
}
export async function deleteInviteCode(roomId, codeId) {
  await api(`/api/rooms/${roomId}/invite-codes/${codeId}`, { method: 'DELETE' });
  await loadInviteCodes(roomId);
}
export async function searchUsers(q) {
  const ret = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
  return ret.users || [];
}
export async function saveAnnouncement(roomId, content) {
  await api(`/api/rooms/${roomId}/announcement`, { method: 'PUT', body: { content } });
  await loadRooms();
}
export async function deleteAnnouncement(roomId) {
  await api(`/api/rooms/${roomId}/announcement`, { method: 'DELETE' });
  await loadRooms();
}

// ---------- 管理面板 ----------
export const adminApi = {
  async loadAll() {
    const [overview, ips, fps, botRequests, botTokens, plugins, pubPlugins] = await Promise.all([
      api('/api/admin/overview').catch(() => null),
      api('/api/admin/banned-ips').catch(() => ({ ips: [] })),
      api('/api/admin/banned-fingerprints').catch(() => ({ fingerprints: [] })),
      api('/api/admin/bot-requests').catch(() => ({ requests: [] })),
      api('/api/admin/bot/tokens').catch(() => ({ tokens: [] })),
      api('/api/admin/plugins').catch(() => ({ plugins: [] })),
      api('/api/plugins').catch(() => ({ plugins: [] })),
    ]);
    S.admin.overview = overview;
    S.admin.bannedIps = ips.ips || [];
    S.admin.bannedFps = fps.fingerprints || [];
    S.admin.botRequests = botRequests.requests || [];
    S.admin.botTokens = botTokens.tokens || [];
    S.admin.plugins = plugins.plugins || [];
    const enabled = {};
    (pubPlugins.plugins || []).forEach(p => { enabled[p.name] = !!p.enabled; });
    S.admin.pluginsEnabled = enabled;
    emit('admin');
  },
  setTab(tab) { S.admin.tab = tab; emit('admin'); },
  async setUserAdmin(id, isAdmin) {
    await api(`/api/admin/users/${id}/admin`, { method: 'PUT', body: { is_admin: isAdmin } });
    S.admin.overview = await api('/api/admin/overview'); emit('admin');
  },
  async banUser(id, hours) { await api(`/api/admin/users/${id}/ban`, { method: 'PUT', body: { duration_hours: hours } }); S.admin.overview = await api('/api/admin/overview'); emit('admin'); },
  async unbanUser(id) { await api(`/api/admin/users/${id}/unban`, { method: 'PUT' }); S.admin.overview = await api('/api/admin/overview'); emit('admin'); },
  async muteUser(id, hours) { await api(`/api/admin/users/${id}/mute`, { method: 'PUT', body: { duration_hours: hours } }); S.admin.overview = await api('/api/admin/overview'); emit('admin'); },
  async unmuteUser(id) { await api(`/api/admin/users/${id}/unmute`, { method: 'PUT' }); S.admin.overview = await api('/api/admin/overview'); emit('admin'); },
  async banIp(ip, hours, reason) { await api('/api/admin/banned-ips/ban', { method: 'PUT', body: { ip, duration_hours: hours, reason } }); const r = await api('/api/admin/banned-ips'); S.admin.bannedIps = r.ips || []; emit('admin'); },
  async unbanIp(ip) { await api('/api/admin/banned-ips/unban', { method: 'PUT', body: { ip } }); const r = await api('/api/admin/banned-ips'); S.admin.bannedIps = r.ips || []; emit('admin'); },
  async banFp(fp, hours, reason) { await api('/api/admin/banned-fingerprints/ban', { method: 'PUT', body: { fingerprint: fp, duration_hours: hours, reason } }); const r = await api('/api/admin/banned-fingerprints'); S.admin.bannedFps = r.fingerprints || []; emit('admin'); },
  async unbanFp(fp) { await api('/api/admin/banned-fingerprints/unban', { method: 'PUT', body: { fingerprint: fp } }); const r = await api('/api/admin/banned-fingerprints'); S.admin.bannedFps = r.fingerprints || []; emit('admin'); },
  async submitBotRequest(name, reason) { await api('/api/bot-requests', { method: 'POST', body: { name, reason } }); const r = await api('/api/admin/bot-requests'); S.admin.botRequests = r.requests || []; emit('admin'); },
  async reviewBotRequest(id, status) { await api(`/api/admin/bot-requests/${id}`, { method: 'PUT', body: { status } }); const r = await api('/api/admin/bot-requests'); S.admin.botRequests = r.requests || []; emit('admin'); },
  async revokeBotToken(token) { await api(`/api/admin/bot/tokens/${token}`, { method: 'DELETE' }); const r = await api('/api/admin/bot/tokens'); S.admin.botTokens = r.tokens || []; emit('admin'); },
  async setPluginEnabled(name, enabled) { await api(`/api/admin/plugins/${name}/enabled`, { method: 'PATCH', body: { enabled } }); const r = await api('/api/admin/plugins'); S.admin.plugins = r.plugins || []; emit('admin'); },
  async uninstallPlugin(name, deleteConfig) { await api(`/api/admin/plugins/${name}`, { method: 'DELETE', body: { delete_config: deleteConfig } }); const r = await api('/api/admin/plugins'); S.admin.plugins = r.plugins || []; emit('admin'); },
  async installPlugin(url) { await api('/api/admin/plugins/install', { method: 'POST', body: { url } }); const r = await api('/api/admin/plugins'); S.admin.plugins = r.plugins || []; emit('admin'); },
  async uploadPlugin(file) {
    const res = await fetch(`/api/admin/plugins/install/upload?filename=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `安装失败 (${res.status})`);
    const r = await api('/api/admin/plugins'); S.admin.plugins = r.plugins || []; emit('admin');
  },
  async loadMarket() { const r = await api('/api/admin/plugins/market'); S.admin.pluginMarket = r.plugins || []; emit('admin'); },
  async saveGlobalAnnouncement(content) { const r = await api('/api/admin/announcement', { method: 'POST', body: { content } }); S.globalAnnouncement = r.announcement; emit('admin'); },
  async clearGlobalAnnouncement() { await api('/api/admin/announcement', { method: 'DELETE' }); S.globalAnnouncement = null; emit('admin'); },
};

// ---------- 房间 ----------
export async function createRoom({ name, isPrivate }) {
  const ret = await api('/api/rooms', { method: 'POST', body: { name, is_private: isPrivate } });
  await loadRooms();
  return ret.room;
}
export async function joinRoom(id, password) {
  await api(`/api/rooms/${id}/join`, { method: 'POST', body: password ? { password } : {} });
  await loadRooms();
}

// ---------- 好友 / 通知 / 搜索 ----------
export const friendsApi = {
  list: () => api('/api/friends'),
  searchUsers: q => api(`/api/users/search?q=${encodeURIComponent(q)}`),
  request: username => api('/api/friends/request', { method: 'POST', body: { username } }),
  accept: id => api(`/api/friends/${id}/accept`, { method: 'POST' }),
  decline: id => api(`/api/friends/${id}/decline`, { method: 'POST' }),
  remove: id => api(`/api/friends/${id}`, { method: 'DELETE' }),
  startDM: username => api('/api/dm/conversations', { method: 'POST', body: { username } }),
};
export const notifApi = {
  list: () => api('/api/notifications'),
  readAll: () => api('/api/notifications/read-all', { method: 'POST' }),
};
export function searchMessages(q, roomId) {
  const p = new URLSearchParams({ q });
  if (roomId) p.set('room_id', roomId);
  return api(`/api/search?${p}`);
}

// ---------- WebSocket ----------
function connectWs() {
  closeWs();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  S.ws = ws;
  ws.onopen = () => { S.wsOk = true; emit('ws'); };
  ws.onclose = () => { S.wsOk = false; emit('ws'); setTimeout(() => { if (!S.wsOk && S.user) connectWs(); }, 5000); };
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onmessage = ev => {
    try { handleEvent(JSON.parse(ev.data)); } catch (e) { console.error('ws event', e); }
  };
}
function closeWs() {
  if (S.ws) { try { S.ws.close(); } catch {} S.ws = null; }
  S.wsOk = false;
}

function startPollFallback() {
  if (S.pollTimer) clearInterval(S.pollTimer);
  S.pollTimer = setInterval(async () => {
    if (S.wsOk || !S.user) return;
    try {
      if (S.active) {
        const { kind, id } = S.active;
        const last = S.messages[S.messages.length - 1];
        const url = kind === 'room'
          ? `/api/rooms/${id}/messages?limit=20${last ? `&after=${last.id}` : ''}`
          : `/api/dm/conversations/${id}/messages?limit=20${last ? `&after=${last.id}` : ''}`;
        const ret = await api(url);
        const fresh = (ret.messages || []).slice().filter(m => !S.msgIds.has(m.id));
        if (fresh.length) {
          fresh.forEach(m => { S.msgIds.add(m.id); cacheMentions(m); S.messages.push(m); });
          emit('messages');
        }
      }
      await loadConvs();
    } catch {}
  }, 15000);
}

export function sendTyping(typing) {
  if (!S.wsOk || !S.active) return;
  const { kind, id } = S.active;
  try {
    S.ws.send(JSON.stringify({ type: 'typing', typing, ...(kind === 'room' ? { room_id: id } : { conversation_id: id }) }));
  } catch {}
}

function typingKey(ev) {
  if (ev.room_id) return `room:${ev.room_id}`;
  if (ev.conversation_id) return `dm:${ev.conversation_id}`;
  return null;
}

async function handleEvent(ev) {
  switch (ev.type) {
    case 'thread_message': {
      const m = ev.message; if (!m) break;
      // 广播的 message 对象不带 room_id（用事件级 ev.room_id），补上
      const roomId = ev.room_id ?? m.room_id;
      if (roomId != null) m.room_id = roomId;
      const rootId = ev.thread_root ?? m.thread_root;
      // 仅在正查看该话题时更新；不在当前话题时忽略（无未读徽标，与 v1 一致）
      if (S.thread.root && S.thread.root.id === rootId) {
        if (!S.thread.messages.some(x => x.id === m.id)) { S.thread.messages.push(m); emit('thread'); }
      }
      break;
    }
    case 'message': {
      const m = ev.message; if (!m) break;
      // 广播的 message 对象不带 room_id（用事件级 ev.room_id），补上以便后续表情/编辑/撤回使用
      const roomId = ev.room_id ?? m.room_id;
      if (roomId != null) m.room_id = roomId;
      if (S.active?.kind === 'room' && S.active.id === roomId) {
        if (!S.msgIds.has(m.id)) { S.msgIds.add(m.id); cacheMentions(m); S.messages.push(m); emit('messages'); }
      } else if (roomId != null) {
        S.unreadRooms[roomId] = (S.unreadRooms[roomId] || 0) + 1;
        persistUnread(); emit('rooms');
      }
      break;
    }
    case 'dm_message': {
      const m = ev.message; if (!m) break;
      const convId = ev.conversation_id ?? m.dm_id;
      if (convId != null) m.dm_id = convId;
      if (S.active?.kind === 'dm' && S.active.id === convId) {
        if (!S.msgIds.has(m.id)) { S.msgIds.add(m.id); cacheMentions(m); S.messages.push(m); emit('messages'); }
        markDmRead();
      } else if (convId != null) {
        S.unreadDms[convId] = (S.unreadDms[convId] || 0) + 1;
        persistUnread(); emit('convs');
      }
      loadConvsSilent();
      break;
    }
    case 'message_update': {
      if (ev.message) { applyLocalUpdate(ev.message); break; }
      // 服务端广播只带 message_id（无消息体），按 id 拉单条再更新
      if (ev.message_id) {
        try {
          const ret = await api(`/api/messages/${ev.message_id}`);
          if (ret.message) applyLocalUpdate(ret.message);
        } catch {}
      }
      break;
    }
    case 'dm_message_update': {
      if (ev.message) { applyLocalUpdate(ev.message); break; }
      if (ev.message_id) {
        try {
          const ret = await api(`/api/dm/messages/${ev.message_id}`);
          if (ret.message) applyLocalUpdate(ret.message);
        } catch {}
      }
      break;
    }
    case 'dm_read': {
      emit('messages');
      break;
    }
    case 'typing': {
      const key = typingKey(ev); if (!key) break;
      let set = S.typing.get(key);
      if (!set) { set = new Map(); S.typing.set(key, set); }
      if (ev.typing && ev.user_id !== S.user?.id) {
        const name = ev.username || '有人';
        if (set.has(ev.user_id)) clearTimeout(set.get(ev.user_id).timer);
        set.set(ev.user_id, { name, timer: setTimeout(() => { set.delete(ev.user_id); emit('typing'); }, 6000) });
      } else {
        const e = set.get(ev.user_id);
        if (e) { clearTimeout(e.timer); set.delete(ev.user_id); }
      }
      emit('typing');
      break;
    }
    case 'presence_snapshot': {
      S.online = new Map((ev.users || []).map(u => [u.id, u]));
      emit('presence');
      break;
    }
    case 'presence': {
      if (ev.user) {
        if (ev.online === false) S.online.delete(ev.user.id);
        else S.online.set(ev.user.id, ev.user);
        emit('presence');
      }
      break;
    }
    case 'pins': {
      if (S.active?.kind === 'room' && ev.room_id === S.active.id) loadPins(ev.room_id);
      break;
    }
    case 'announcement': {
      if (ev.global) { S.globalAnnouncement = ev.content ? { content: ev.content, admin_name: ev.admin_name } : null; emit('announcement'); }
      else if (S.active?.kind === 'room' && ev.room_id === S.active.id && S.roomDetail) {
        S.roomDetail.announcement = ev.content;
        emit('announcement');
      }
      break;
    }
    case 'notification': {
      S.notifUnread++;
      emit('notif'); emit('toast', { text: ev.title ? `${ev.title}` : '新通知' });
      break;
    }
    case 'room_kicked': {
      if (S.active?.kind === 'room' && S.active.id === ev.room_id) {
        S.active = null; S.messages = []; S.msgIds = new Set();
        emit('active');
      }
      loadRooms();
      emit('toast', { text: `你已被移出房间「${ev.room_name || ''}」` });
      break;
    }
    case 'rooms':
    case 'room_settings': {
      loadRooms(); // 内部已用最新房间列表同步 S.roomDetail
      break;
    }
    case 'friend_request':
    case 'friend_accept':
    case 'friend_remove': {
      emit('friends-changed');
      break;
    }
    case 'ready': break;
    default: break;
  }
}

let convSilentTimer = null;
function loadConvsSilent() {
  if (convSilentTimer) return;
  convSilentTimer = setTimeout(async () => {
    convSilentTimer = null;
    try { await loadConvs(); } catch {}
  }, 800);
}

// ---------- 设备识别 ----------
export function detectDevice() {
  const ua = navigator.userAgent || '';
  const w = window.innerWidth;
  const isWatch = /Watch|SM-R|Galaxy Watch|Pixel Watch/i.test(ua) || (w <= 320 && window.innerHeight <= 360);
  if (isWatch) return 'watch';
  if (/Mobi|Android|iPhone|iPad|Mobile/i.test(ua) || w <= 640) return 'phone';
  if (/Tablet|iPad/i.test(ua) || w <= 1024) return 'tablet';
  return 'desktop';
}
export function resolveDevice() {
  let manual = 'auto';
  try { manual = localStorage.getItem('pc2.device') || 'auto'; } catch {}
  S.device = manual;
  S.resolved = manual === 'auto' ? detectDevice() : manual;
  const el = document.getElementById('v2app');
  if (el) {
    el.classList.remove('desktop', 'tablet', 'phone', 'watch');
    el.classList.add(S.resolved);
  }
  emit('device');
  return S.resolved;
}
export function setDevice(d) {
  try { localStorage.setItem('pc2.device', d); } catch {}
  resolveDevice();
}
