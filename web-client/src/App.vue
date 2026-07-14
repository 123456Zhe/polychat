<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';
import icon from '../../assets/polychat-icon.png';

const user = ref(null), rooms = ref([]), room = ref(null), messages = ref([]), content = ref('');
const mode = ref('login'), credentials = ref({ username: '', password: '' }), error = ref(''), toast = ref('');
const file = ref(null), adminOpen = ref(false), profileOpen = ref(false), themeOpen = ref(false), admin = ref({ stats: {}, users: [] });
const notificationOn = ref(false), notificationPermission = ref('default'), avatarInput = ref(null), fileInput = ref(null), messageList = ref(null);
const unread = ref({});
const hasOlderMessages = ref(false), loadingOlderMessages = ref(false);
let messageTimer, roomTimer, eventTimer, lastId = 0, oldestId = 0, eventCursor = null;
let roomGeneration = 0, activeMessageRequest = null, roomsLoading = false, eventsLoading = false, messagesLoading = false;
let themeStyleElement;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const themes = [
  { id: 'mist', name: '雾蓝', note: '当前默认的低饱和蓝灰', colors: ['#435675', '#6f8da8', '#5d527c', '#f2f0ef'], css: '' },
  { id: 'midnight', name: '午夜靛蓝', note: '深色专注，蓝紫强调', colors: ['#111827', '#312e81', '#818cf8', '#e0e7ff'], css: `:root { --slate-950:#0f172a; --slate-900:#172554; --slate-800:#1e3a8a; --blue-700:#4f46e5; --blue-600:#6366f1; --blue-400:#a5b4fc; --violet-700:#7c3aed; --violet-600:#8b5cf6; --warm-100:#111827; --warm-200:#243047; --warm-300:#34425c; --white:#1e293b; color:#e5e7eb; background:#111827; } body { background:#111827; } .chat { background:#111827; } .topbar, .composer { background:rgba(15,23,42,.92); border-color:#243047; } .topbar h2, .bubble > header strong, .markdown h1, .markdown h2, .markdown h3 { color:#eef2ff; } .topbar small, .markdown, .composer textarea { color:#cbd5e1; } .bubble { border-color:#29364d; background:#1e293b; } .composer textarea, .attach { border-color:#334155; background:#172033; color:#e5e7eb; } .auth { background:#111827; } .auth > section, .modal > section { background:#1e293b; border-color:#334155; color:#e5e7eb; } .tabs, .stats span { background:#172033; } .auth input { color:#e5e7eb; border-color:#334155; background:#172033; }` },
  { id: 'teal', name: '青绿浅色', note: '参考 Tailwind 的 slate 与 teal', colors: ['#0f766e', '#14b8a6', '#0f172a', '#f8fafc'], css: `:root { --slate-950:#0f172a; --slate-900:#134e4a; --slate-800:#115e59; --blue-700:#0f766e; --blue-600:#14b8a6; --blue-400:#99f6e4; --violet-700:#0f766e; --violet-600:#14b8a6; --warm-100:#f8fafc; --warm-200:#e2e8f0; --warm-300:#cbd5e1; } .chat > aside { background:linear-gradient(155deg, rgba(20,184,166,.28), transparent 44%), #134e4a; } .chat { background:#f8fafc; } .bubble { border-color:#dbe7e6; } .notification.on { color:#0f766e; background:#ccfbf1; }` },
  { id: 'mocha', name: 'Catppuccin Mocha', note: '官方 Mocha 深色调色板', colors: ['#1e1e2e', '#313244', '#cba6f7', '#a6e3a1'], css: `:root { --slate-950:#11111b; --slate-900:#1e1e2e; --slate-800:#313244; --blue-700:#89b4fa; --blue-600:#89b4fa; --blue-400:#b4befe; --violet-700:#cba6f7; --violet-600:#cba6f7; --warm-100:#181825; --warm-200:#313244; --warm-300:#45475a; --white:#1e1e2e; color:#cdd6f4; background:#181825; } body, .chat { background:#181825; } .chat > aside { background:linear-gradient(155deg, rgba(203,166,247,.16), transparent 44%), #1e1e2e; } .topbar, .composer { border-color:#313244; background:rgba(30,30,46,.94); } .topbar h2, .bubble > header strong, .markdown h1, .markdown h2, .markdown h3 { color:#cdd6f4; } .topbar small, .markdown, .composer textarea { color:#bac2de; } .bubble { border-color:#313244; background:#1e1e2e; } .composer textarea, .attach { border-color:#45475a; background:#181825; color:#cdd6f4; } .attachment-file, .markdown blockquote, .file-chip { color:#bac2de; border-color:#45475a; background:#313244; } .auth { background:#181825; } .auth > section, .modal > section { color:#cdd6f4; background:#1e1e2e; border-color:#45475a; } .tabs, .stats span { background:#181825; } .auth input { color:#cdd6f4; border-color:#45475a; background:#181825; } .close { color:#bac2de; }` }
];
const activeTheme = ref(localStorage.getItem('polychat.theme') || 'mist');
const customCss = ref(localStorage.getItem('polychat.custom-css') || '');
const isAdmin = computed(() => user.value?.is_admin);
const totalUnread = computed(() => Object.values(unread.value).reduce((total, count) => total + count, 0));
const notificationSupported = computed(() => 'Notification' in window);
const notificationLabel = computed(() => {
  if (!notificationSupported.value) return '浏览器不支持通知';
  if (!window.isSecureContext) return '通知需要 HTTPS';
  if (notificationPermission.value === 'denied') return '通知已被浏览器阻止';
  return notificationOn.value ? '关闭桌面通知' : '开启桌面通知';
});
const notificationButtonText = computed(() => notificationPermission.value === 'denied' ? '通知受阻' : (notificationOn.value ? '通知已开' : '通知'));

marked.use({
  gfm: true,
  breaks: true,
  extensions: [
    {
      name: 'blockMath', level: 'block', start: src => src.indexOf('$$'),
      tokenizer(src) { const match = /^\$\$\s*\n?([\s\S]+?)\n?\s*\$\$(?:\n|$)/.exec(src); return match ? { type: 'blockMath', raw: match[0], text: match[1] } : undefined; },
      renderer(token) { return `<div class="math math-block">${katex.renderToString(token.text, { displayMode: true, throwOnError: false })}</div>`; }
    },
    {
      name: 'inlineMath', level: 'inline', start: src => src.indexOf('$'),
      tokenizer(src) { const match = /^\$([^$\n]+?)\$/.exec(src); return match ? { type: 'inlineMath', raw: match[0], text: match[1] } : undefined; },
      renderer(token) { return katex.renderToString(token.text, { throwOnError: false }); }
    }
  ]
});

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}
function notify(text) { toast.value = text; setTimeout(() => toast.value = '', 2200); }
function markdown(source = '') {
  return DOMPurify.sanitize(marked.parse(source), { USE_PROFILES: { html: true } });
}
function time(value) { return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function size(value = 0) { return value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`; }
function avatar(member) { return member?.avatar_url || (member?.avatar_updated_at ? `/api/users/${member.user_id ?? member.id}/avatar?v=${member.avatar_updated_at}` : ''); }
function clearTimers() { clearTimeout(messageTimer); clearInterval(roomTimer); clearInterval(eventTimer); activeMessageRequest?.abort(); }
function fileData(selected) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(selected); }); }
function updateTitle() { document.title = totalUnread.value ? `(${totalUnread.value}) PolyChat` : 'PolyChat'; }
function setUnread(roomId, count) { unread.value = { ...unread.value, [roomId]: Math.max(0, count) }; updateTitle(); }
function clearUnread(roomId) { if (roomId != null && unread.value[roomId]) setUnread(roomId, 0); }
function handleVisibility() { if (!document.hidden) clearUnread(room.value?.id); startPolling(); }
function renderThemeCss() {
  const preset = themes.find(theme => theme.id === activeTheme.value) || themes[0];
  if (!themeStyleElement) { themeStyleElement = document.createElement('style'); themeStyleElement.id = 'polychat-user-theme'; document.head.append(themeStyleElement); }
  themeStyleElement.textContent = `${preset.css}\n/* 用户自定义 CSS */\n${customCss.value}`;
}
function chooseTheme(themeId) { activeTheme.value = themeId; localStorage.setItem('polychat.theme', themeId); renderThemeCss(); }
function updateCustomCss() { localStorage.setItem('polychat.custom-css', customCss.value); renderThemeCss(); }
function resetCustomCss() { customCss.value = ''; localStorage.removeItem('polychat.custom-css'); renderThemeCss(); notify('已清除自定义 CSS'); }

async function authenticate() { error.value = ''; try { user.value = (await api(`/api/${mode.value}`, { method: 'POST', body: JSON.stringify(credentials.value) })).user; await enter(); } catch (e) { error.value = e.message; } }
function syncNotificationState() {
  notificationPermission.value = notificationSupported.value ? Notification.permission : 'unsupported';
  notificationOn.value = notificationPermission.value === 'granted' && localStorage.getItem('polychat.notifications') !== 'off';
}
async function enter() {
  await loadRooms(); await events(); startPolling(); syncNotificationState();
  if (navigator.permissions && notificationSupported.value) navigator.permissions.query({ name: 'notifications' }).then(status => { status.onchange = syncNotificationState; }).catch(() => {});
}
function startPolling() {
  clearTimeout(messageTimer); clearInterval(roomTimer); clearInterval(eventTimer);
  const background = document.hidden;
  roomTimer = setInterval(loadRooms, background ? 30_000 : 10_000);
  eventTimer = setInterval(events, background ? 15_000 : 2_500);
  scheduleMessagePoll(background ? 12_000 : 1_500);
}
function scheduleMessagePoll(delay = 1_500) {
  clearTimeout(messageTimer);
  messageTimer = setTimeout(async () => { const hasBacklog = await pollNewMessages(); scheduleMessagePoll(hasBacklog ? 50 : (document.hidden ? 12_000 : 1_500)); }, delay);
}
function appendUnique(target, incoming, prepend = false) {
  const known = new Set(target.map(message => message.id));
  const fresh = incoming.filter(message => !known.has(message.id));
  return prepend ? [...fresh, ...target] : [...target, ...fresh];
}
async function loadRooms() {
  if (roomsLoading) return; roomsLoading = true;
  try { const result = await api('/api/rooms'); rooms.value = result.rooms; if (!room.value && rooms.value.length) await choose(result.rooms[0]); }
  catch { /* retry on the next timer */ }
  finally { roomsLoading = false; }
}
async function choose(item) {
  const generation = ++roomGeneration;
  activeMessageRequest?.abort();
  room.value = item; clearUnread(item.id); messages.value = []; lastId = 0; oldestId = 0; hasOlderMessages.value = false;
  await loadLatestMessages(generation);
  scheduleMessagePoll();
}
async function loadLatestMessages(generation = roomGeneration) {
  if (!room.value) return;
  messagesLoading = true;
  const targetRoom = room.value.id;
  const controller = new AbortController(); activeMessageRequest = controller;
  try {
    const result = await api(`/api/rooms/${targetRoom}/messages?before=9007199254740991&limit=60`, { signal: controller.signal });
    if (generation !== roomGeneration || targetRoom !== room.value?.id) return;
    messages.value = result.messages;
    lastId = messages.value.at(-1)?.id || 0;
    oldestId = messages.value[0]?.id || 0;
    hasOlderMessages.value = Boolean(result.has_more);
    await nextTick(); messageList.value?.scrollTo({ top: messageList.value.scrollHeight });
  } catch (error) { if (error.name !== 'AbortError') notify('加载聊天记录失败，将自动重试'); }
  finally { if (activeMessageRequest === controller) activeMessageRequest = null; messagesLoading = false; }
}
async function pollNewMessages() {
  if (!room.value || messagesLoading) return false;
  const targetRoom = room.value.id;
  const generation = roomGeneration;
  const nearBottom = !messageList.value || messageList.value.scrollHeight - messageList.value.scrollTop - messageList.value.clientHeight < 100;
  messagesLoading = true;
  try {
    const result = await api(`/api/rooms/${targetRoom}/messages?after=${lastId}&limit=200`);
    if (generation !== roomGeneration || targetRoom !== room.value?.id || !result.messages.length) return false;
    messages.value = appendUnique(messages.value, result.messages);
    lastId = messages.value.at(-1)?.id || lastId;
    oldestId ||= messages.value[0]?.id || 0;
    await nextTick(); if (nearBottom) messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: 'smooth' });
    return Boolean(result.has_more);
  } catch { /* retry on the next timer */ }
  finally { messagesLoading = false; }
  return false;
}
async function loadOlderMessages() {
  if (!room.value || !oldestId || !hasOlderMessages.value || loadingOlderMessages.value) return;
  const targetRoom = room.value.id, generation = roomGeneration, previousHeight = messageList.value?.scrollHeight || 0;
  loadingOlderMessages.value = true;
  try {
    const result = await api(`/api/rooms/${targetRoom}/messages?before=${oldestId}&limit=60`);
    if (generation !== roomGeneration || targetRoom !== room.value?.id) return;
    messages.value = appendUnique(messages.value, result.messages, true);
    oldestId = messages.value[0]?.id || oldestId;
    hasOlderMessages.value = Boolean(result.has_more);
    await nextTick(); if (messageList.value) messageList.value.scrollTop += messageList.value.scrollHeight - previousHeight;
  } catch { notify('加载更早消息失败'); }
  finally { loadingOlderMessages.value = false; }
}
function maybeLoadOlderMessages(event) { if (event.target.scrollTop < 80) loadOlderMessages(); }
async function showDesktopNotification(message) {
  const title = `${message.username} · #${message.room_name}`;
  const options = { body: message.content || (message.attachment_name ? `发送了 ${message.attachment_name}` : '发送了附件'), icon, tag: `polychat-${message.id}`, data: { roomId: message.room_id } };
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.register('/sw.js');
      await registration.showNotification(title, options);
    } else new Notification(title, options);
  } catch { try { new Notification(title, options); } catch { /* browser rejected notifications */ } }
}
async function events() {
  if (eventsLoading) return; eventsLoading = true;
  try {
    const result = await api(`/api/events${eventCursor == null ? '?bootstrap=1' : `?after=${eventCursor}`}`);
    eventCursor = result.cursor;
    for (const message of result.messages) {
      if (message.user_id === user.value.id) continue;
      const currentlyReading = room.value?.id === message.room_id && !document.hidden;
      if (!currentlyReading) setUnread(message.room_id, (unread.value[message.room_id] || 0) + 1);
      if (notificationOn.value && (!currentlyReading || document.hidden)) await showDesktopNotification(message);
    }
  } catch { /* retry on the next interval */ }
  finally { eventsLoading = false; }
}
async function toggleNotifications() {
  if (!notificationSupported.value) return notify('当前浏览器不支持桌面通知');
  if (!window.isSecureContext) return notify('请通过 HTTPS 访问后开启通知');
  if (notificationOn.value) { localStorage.setItem('polychat.notifications', 'off'); notificationOn.value = false; return notify('桌面通知已关闭'); }
  if (Notification.permission === 'denied') return notify('请在浏览器的网站设置中允许通知');
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  notificationPermission.value = permission;
  if (permission === 'granted') {
    localStorage.setItem('polychat.notifications', 'on'); notificationOn.value = true;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    notify('桌面通知已开启');
  }
  else notify('未获得通知权限，可在浏览器网站设置中修改');
}
async function setAvatar(selected) {
  if (!selected) return;
  if (!imageTypes.has(selected.type) || selected.size > 2 * 1024 * 1024) return notify('请选择 2 MB 以内的 PNG、JPEG、WebP 或 GIF');
  try { user.value = (await api('/api/me/avatar', { method: 'POST', body: JSON.stringify({ type: selected.type, data: await fileData(selected) }) })).user; notify('头像已更新'); }
  catch (e) { notify(e.message); }
  finally { if (avatarInput.value) avatarInput.value.value = ''; }
}
async function removeAvatar() { try { user.value = (await api('/api/me/avatar', { method: 'DELETE' })).user; notify('已恢复默认头像'); } catch (e) { notify(e.message); } }
function selectFile(event) { file.value = event.target.files?.[0] || null; }
function paste(event) { const image = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/')); if (image) { event.preventDefault(); file.value = image.getAsFile(); notify('已添加剪贴板图片'); } }
async function send() { if (!room.value || (!content.value.trim() && !file.value)) return; try { let attachmentId = null; if (file.value) { const uploaded = await api('/api/files', { method: 'POST', body: JSON.stringify({ name: file.value.name, type: file.value.type || 'application/octet-stream', data: await fileData(file.value) }) }); attachmentId = uploaded.file.id; } const result = await api(`/api/rooms/${room.value.id}/messages`, { method: 'POST', body: JSON.stringify({ content: content.value, attachment_id: attachmentId }) }); messages.value = appendUnique(messages.value, [result.message]); lastId = result.message.id; oldestId ||= result.message.id; content.value = ''; file.value = null; if (fileInput.value) fileInput.value.value = ''; await nextTick(); messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: 'smooth' }); } catch (e) { notify(e.message); } }
async function copy(message) { try { await navigator.clipboard.writeText(message.content || ''); notify('已复制完整 Markdown'); } catch { notify('复制失败'); } }
async function newRoom() { const name = prompt('聊天室名称'); if (!name) return; try { await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) }); await loadRooms(); } catch (e) { notify(e.message); } }
async function loadAdmin() { try { admin.value = await api('/api/admin/overview'); } catch (e) { notify(e.message); } }
async function toggleAdmin(member) { try { await api(`/api/admin/users/${member.id}/admin`, { method: 'PUT', body: JSON.stringify({ is_admin: !member.is_admin }) }); await loadAdmin(); } catch (e) { notify(e.message); } }
async function logout() { await api('/api/logout', { method: 'POST' }); clearTimers(); location.reload(); }
onMounted(async () => { renderThemeCss(); document.addEventListener('visibilitychange', handleVisibility); try { user.value = (await api('/api/me')).user; await enter(); } catch {} });
onBeforeUnmount(() => { clearTimers(); document.removeEventListener('visibilitychange', handleVisibility); });
</script>

<template>
  <main v-if="!user" class="auth"><section><img :src="icon"><p>MARKDOWN · LATEX · EVERYWHERE</p><h1>欢迎来到 PolyChat</h1><div class="tabs"><button :class="{active: mode === 'login'}" @click="mode = 'login'">登录</button><button :class="{active: mode === 'register'}" @click="mode = 'register'">注册</button></div><form @submit.prevent="authenticate"><input v-model="credentials.username" placeholder="用户名" required><input v-model="credentials.password" type="password" placeholder="密码" required><small>{{ error }}</small><button> {{ mode === 'login' ? '登录' : '创建账号' }} </button></form></section></main>
  <main v-else class="chat"><aside><header class="brand"><img :src="icon"><span>PolyChat<small>让交流保持简单</small></span></header><button class="new" @click="newRoom"><span>＋</span> 新建聊天室</button><p class="nav-label">聊天室</p><nav><button v-for="item in rooms" :key="item.id" :class="{active: room?.id === item.id, hasUnread: unread[item.id]}" @click="choose(item)"><span>#</span><b>{{ item.name }}</b><small v-if="unread[item.id]" class="unread">{{ unread[item.id] > 99 ? '99+' : unread[item.id] }}</small></button></nav><footer><button class="profile-button" title="更换头像" @click="profileOpen = true"><img v-if="avatar(user)" :src="avatar(user)"><b v-else>{{ user.username[0] }}</b></button><span>{{ user.username }}<small>{{ isAdmin ? '管理员 · 在线' : '在线' }}</small></span><button class="logout" title="退出登录" @click="logout">↪</button></footer></aside>
    <section class="conversation"><header class="topbar"><div><h2><span>#</span> {{ room?.name || '大厅' }}</h2><small>支持 Markdown、LaTeX 与图片粘贴</small></div><button class="toolbar-button" title="主题与自定义 CSS" @click="themeOpen = true"><span>◐</span><em>主题</em></button><button v-if="isAdmin" class="toolbar-button" @click="adminOpen = true; loadAdmin()">管理面板</button><button class="toolbar-button notification" :class="{on: notificationOn, blocked: notificationPermission === 'denied'}" :title="notificationLabel" @click="toggleNotifications"><span>{{ notificationOn ? '🔔' : '🔕' }}</span><em>{{ notificationButtonText }}</em></button></header><div ref="messageList" class="messages" @scroll.passive="maybeLoadOlderMessages"><p v-if="loadingOlderMessages" class="history-loading">正在加载更早消息…</p><p v-else-if="hasOlderMessages" class="history-hint">向上滚动加载更早消息</p><div v-if="!messages.length" class="empty"><img :src="icon"><h3>开始一段新对话</h3><p>发送 Markdown、公式、图片或文件。</p></div><article v-for="message in messages" :key="message.id"><div class="avatar"><img v-if="avatar(message)" :src="avatar(message)"><b v-else>{{ message.username[0] }}</b></div><div class="bubble"><header><strong>{{ message.username }}</strong><small>{{ time(message.created_at) }}</small><button title="复制原始 Markdown" @click="copy(message)">复制</button></header><div v-if="message.content" class="markdown" v-html="markdown(message.content)"></div><template v-if="message.attachment_id"><img v-if="imageTypes.has(message.attachment_type)" class="attachment-image" :src="`/api/files/${message.attachment_id}?inline=1`" :alt="message.attachment_name"><a v-else class="attachment-file" :href="`/api/files/${message.attachment_id}`"><span>↓</span><div><b>{{ message.attachment_name }}</b><small>{{ size(message.attachment_size) }}</small></div></a></template></div></article></div><form class="composer" @submit.prevent="send"><div v-if="file" class="file-chip"><span>{{ imageTypes.has(file.type) ? '图片' : '文件' }}</span>{{ file.name }}<button type="button" @click="file = null">×</button></div><div class="compose-row"><label class="attach" title="添加文件">＋<input ref="fileInput" type="file" @change="selectFile"></label><textarea v-model="content" rows="1" placeholder="输入消息，粘贴图片或使用 Markdown…" @paste="paste" @keydown.enter.exact.prevent="send"></textarea><button class="send" title="发送消息">发送</button></div><small>Enter 发送 · Shift + Enter 换行</small></form></section></main>
  <div v-if="profileOpen" class="modal"><section class="profile-modal"><button class="close" @click="profileOpen = false">×</button><p>YOUR PROFILE</p><h2>个人资料</h2><div class="avatar-preview"><img v-if="avatar(user)" :src="avatar(user)"><b v-else>{{ user.username[0] }}</b></div><h3>{{ user.username }}</h3><p class="hint">支持 PNG、JPEG、WebP、GIF，最大 2 MB</p><input ref="avatarInput" class="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="setAvatar($event.target.files[0])"><div class="profile-actions"><button class="primary" @click="avatarInput.click()">选择新头像</button><button v-if="avatar(user)" @click="removeAvatar">移除头像</button></div></section></div>
  <div v-if="themeOpen" class="modal"><section class="theme-modal"><button class="close" @click="themeOpen = false">×</button><p>THEMES · LOCAL ONLY</p><h2>主题与自定义 CSS</h2><p class="hint">预设可一键切换；自定义 CSS 只保存在当前浏览器。</p><div class="theme-grid"><button v-for="theme in themes" :key="theme.id" :class="{selected: activeTheme === theme.id}" @click="chooseTheme(theme.id)"><span class="swatches"><i v-for="color in theme.colors" :key="color" :style="{background: color}"></i></span><b>{{ theme.name }}</b><small>{{ theme.note }}</small></button></div><label class="css-label">自定义 CSS <textarea v-model="customCss" spellcheck="false" placeholder="例如：\n.chat > aside { background: #0f172a; }" @input="updateCustomCss"></textarea></label><div class="theme-actions"><button class="primary" @click="updateCustomCss(); notify('自定义 CSS 已保存')">保存 CSS</button><button @click="resetCustomCss">清除自定义 CSS</button></div></section></div>
  <div v-if="adminOpen" class="modal"><section><button class="close" @click="adminOpen = false">×</button><p>ADMINISTRATION</p><h2>管理面板</h2><div class="stats"><span v-for="(value, key) in admin.stats" :key="key"><b>{{ value }}</b>{{ {users:'用户', rooms:'聊天室', messages:'消息', files:'文件'}[key] }}</span></div><h3>用户 <button @click="loadAdmin">刷新</button></h3><div v-for="member in admin.users" :key="member.id" class="member"><span>{{ member.username }} · {{ member.message_count }} 条消息</span><button @click="toggleAdmin(member)">{{ member.is_admin ? '撤销管理员' : '设为管理员' }}</button></div></section></div>
  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
