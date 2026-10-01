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
  await api(url, { method: 'POST', body: { emoji } });
}

export async function editMessage(msg, content) {
  const url = msg.dm_id ? `/api/dm/messages/${msg.id}` : `/api/messages/${msg.id}`;
  const ret = await api(url, { method: 'PUT', body: { content } });
  applyLocalUpdate(ret.message);
}

export async function retractMessage(msg) {
  const url = msg.dm_id ? `/api/dm/messages/${msg.id}` : `/api/messages/${msg.id}`;
  await api(url, { method: 'DELETE' });
}

function applyLocalUpdate(updated) {
  if (!updated) return;
  const i = S.messages.findIndex(m => m.id === updated.id);
  if (i >= 0) { S.messages[i] = updated; cacheMentions(updated); emit('messages'); }
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

function handleEvent(ev) {
  switch (ev.type) {
    case 'message': {
      const m = ev.message; if (!m) break;
      if (S.active?.kind === 'room' && S.active.id === m.room_id) {
        if (!S.msgIds.has(m.id)) { S.msgIds.add(m.id); cacheMentions(m); S.messages.push(m); emit('messages'); }
      } else if (m.room_id) {
        S.unreadRooms[m.room_id] = (S.unreadRooms[m.room_id] || 0) + 1;
        persistUnread(); emit('rooms');
      }
      break;
    }
    case 'dm_message': {
      const m = ev.message; if (!m) break;
      if (S.active?.kind === 'dm' && S.active.id === m.dm_id) {
        if (!S.msgIds.has(m.id)) { S.msgIds.add(m.id); cacheMentions(m); S.messages.push(m); emit('messages'); }
        markDmRead();
      } else if (m.dm_id) {
        S.unreadDms[m.dm_id] = (S.unreadDms[m.dm_id] || 0) + 1;
        persistUnread(); emit('convs');
      }
      loadConvsSilent();
      break;
    }
    case 'message_update':
    case 'dm_message_update': {
      if (ev.message) applyLocalUpdate(ev.message);
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
      loadRooms();
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
