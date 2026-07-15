<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';
import icon from '../../assets/polychat-icon.png';

const user = ref(null), rooms = ref([]), room = ref(null), messages = ref([]), content = ref('');
const mode = ref('login'), credentials = ref({ username: '', password: '' }), error = ref(''), toast = ref('');
const files = ref([]), adminOpen = ref(false), profileOpen = ref(false), themeOpen = ref(false), admin = ref({ stats: {}, users: [] });
const emojiOpen = ref(false), emojiCategory = ref('常用'), replyTarget = ref(null), editingMessage = ref(null), editContent = ref('');
const searchOpen = ref(false), searchText = ref(''), searchResults = ref([]), membersOpen = ref(false), roomMembers = ref([]);
const createRoomOpen = ref(false), roomDraft = ref({ name: '', is_private: false }), memberName = ref(''), memberRole = ref('member');
const openMessageActions = ref(null), reactionPickerFor = ref(null);
const imagePreview = ref(''), roomManageOpen = ref(false), roomNameDraft = ref('');
const onlineUsers = ref([]), typingByRoom = ref({}), pinsOpen = ref(false), pinnedMessages = ref([]);
const threadRoot = ref(null), threadMessages = ref([]), threadContent = ref('');
const notificationOn = ref(false), notificationPermission = ref('default'), avatarInput = ref(null), fileInput = ref(null), messageList = ref(null);
const unread = ref({});
const hasOlderMessages = ref(false), loadingOlderMessages = ref(false);
let messageTimer, roomTimer, eventTimer, lastId = 0, oldestId = 0, eventCursor = null;
let roomGeneration = 0, activeMessageRequest = null, roomsLoading = false, eventsLoading = false, messagesLoading = false;
let socket = null, reconnectTimer = null, socketBackoff = 1000;
let typingTimer = null, typingRoomId = null;
let themeStyleElement;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
// Unicode emoji grouped using the same official categories exposed by EmojiAll.
const emojiGroups = {
  '常用': '😀 😃 😄 😁 😆 🥹 😂 🤣 😊 😍 🥰 😘 😎 🤔 😭 😡 👍 👎 🙏 👏 🎉 ❤️ 🔥 ✅ 👀 💯'.split(' '),
  '表情': '🙂 🙃 😉 😌 😋 😜 🤪 🤨 🫡 🤗 🤭 🤫 🤥 😶 😐 🫠 😏 😒 🙄 😬 🤐 🤢 🤮 😴 🤩 🥳 😇 🤠 🤖 👻 💀'.split(' '),
  '人物': '👋 🤚 🖐️ ✋ 🫶 🤝 💪 🧠 👶 🧒 👦 👧 🧑 👨 👩 🧓 🧔 👮 🕵️ 👷 🧑‍💻 👩‍💻 👨‍💻 👩‍🎨 👨‍🎓'.split(' '),
  '自然': '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦋 🌸 🌲 🌈 ☀️ 🌙 ⭐ 🌊 🔥'.split(' '),
  '食物': '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥑 🍅 🍔 🍟 🍕 🍣 🍜 🍰 🎂 🍪 ☕ 🍺'.split(' '),
  '活动': '⚽ 🏀 🏈 ⚾ 🎾 🏐 🎮 🎲 🧩 🎨 🎵 🎸 🎹 🎬 🎯 🏆 🥇 🚗 ✈️ 🚀 🗺️ 🏖️ 🏕️ 🏠 🎁'.split(' '),
  '物品': '📱 💻 ⌨️ 🖥️ 🖨️ 💡 🔦 📷 🎥 📺 📚 📝 ✏️ 📌 📎 🔒 🔑 🔧 🧰 💊 🩹 🧪 💎 💰 🛒'.split(' '),
  '符号': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💯 ✅ ❌ ⚠️ ❓ ❗ ♻️ 🔞 🚫 ⬆️ ⬇️ ⬅️ ➡️ 🔔 📌'.split(' ')
};
const themes = [
  { id: 'mist', name: '雾蓝', note: '当前默认的低饱和蓝灰', colors: ['#435675', '#6f8da8', '#5d527c', '#f2f0ef'], css: '' },
  { id: 'midnight', name: '午夜靛蓝', note: '深色专注，蓝紫强调', colors: ['#111827', '#312e81', '#818cf8', '#e0e7ff'], css: `:root { --slate-950:#0f172a; --slate-900:#172554; --slate-800:#1e3a8a; --blue-700:#4f46e5; --blue-600:#6366f1; --blue-400:#a5b4fc; --violet-700:#7c3aed; --violet-600:#8b5cf6; --warm-100:#111827; --warm-200:#243047; --warm-300:#34425c; --white:#1e293b; color:#e5e7eb; background:#111827; } body { background:#111827; } .chat { background:#111827; } .topbar, .composer { background:rgba(15,23,42,.92); border-color:#243047; } .topbar h2, .bubble > header strong, .markdown h1, .markdown h2, .markdown h3 { color:#eef2ff; } .topbar small, .markdown, .composer textarea { color:#cbd5e1; } .bubble { border-color:#29364d; background:#1e293b; } .composer textarea, .attach { border-color:#334155; background:#172033; color:#e5e7eb; } .auth { background:#111827; } .auth > section, .modal > section { background:#1e293b; border-color:#334155; color:#e5e7eb; } .tabs, .stats span { background:#172033; } .auth input { color:#e5e7eb; border-color:#334155; background:#172033; }` },
  { id: 'teal', name: '青绿浅色', note: '参考 Tailwind 的 slate 与 teal', colors: ['#0f766e', '#14b8a6', '#0f172a', '#f8fafc'], css: `:root { --slate-950:#0f172a; --slate-900:#134e4a; --slate-800:#115e59; --blue-700:#0f766e; --blue-600:#14b8a6; --blue-400:#99f6e4; --violet-700:#0f766e; --violet-600:#14b8a6; --warm-100:#f8fafc; --warm-200:#e2e8f0; --warm-300:#cbd5e1; } .chat > aside { background:linear-gradient(155deg, rgba(20,184,166,.28), transparent 44%), #134e4a; } .chat { background:#f8fafc; } .bubble { border-color:#dbe7e6; } .notification.on { color:#0f766e; background:#ccfbf1; }` },
  { id: 'mocha', name: 'Catppuccin Mocha', note: '官方 Mocha 深色调色板', colors: ['#1e1e2e', '#313244', '#cba6f7', '#a6e3a1'], css: `:root { --slate-950:#11111b; --slate-900:#1e1e2e; --slate-800:#313244; --blue-700:#89b4fa; --blue-600:#89b4fa; --blue-400:#b4befe; --violet-700:#cba6f7; --violet-600:#cba6f7; --warm-100:#181825; --warm-200:#313244; --warm-300:#45475a; --white:#1e1e2e; color:#cdd6f4; background:#181825; } body, .chat { background:#181825; } .chat > aside { background:linear-gradient(155deg, rgba(203,166,247,.16), transparent 44%), #1e1e2e; } .topbar, .composer { border-color:#313244; background:rgba(30,30,46,.94); } .topbar h2, .bubble > header strong, .markdown h1, .markdown h2, .markdown h3 { color:#cdd6f4; } .topbar small, .markdown, .composer textarea { color:#bac2de; } .bubble { border-color:#313244; background:#1e1e2e; } .composer textarea, .attach { border-color:#45475a; background:#181825; color:#cdd6f4; } .attachment-file, .markdown blockquote, .file-chip { color:#bac2de; border-color:#45475a; background:#313244; } .auth { background:#181825; } .auth > section, .modal > section { color:#cdd6f4; background:#1e1e2e; border-color:#45475a; } .tabs, .stats span { background:#181825; } .auth input { color:#cdd6f4; border-color:#45475a; background:#181825; } .close { color:#bac2de; }` },
  { id: 'amber-rose', name: '琥珀玫瑰', note: '温暖的琥珀与玫瑰调色板', colors: ['#78350f', '#d97706', '#be185d', '#fef3c7'], css: `:root { --slate-950:#451a03; --slate-900:#78350f; --slate-800:#92400e; --blue-700:#b45309; --blue-600:#d97706; --blue-400:#fcd34d; --violet-700:#be185d; --violet-600:#ec4899; --warm-100:#fffbeb; --warm-200:#fef3c7; --warm-300:#fde68a; --white:#fffbeb; color:#451a03; background:#fef3c7; } body, .chat { background:#fef3c7; } .chat > aside { background:linear-gradient(155deg, rgba(190,24,93,.22), transparent 44%), #78350f; } .chat > aside { color:#fef3c7; } .brand small { color:#fcd34d; } .new { color:#fffbeb; border-color:rgba(255,251,235,.15); background:rgba(252,211,77,.14); } .new:hover { background:rgba(252,211,77,.24); } .nav-label { color:#fcd34d; } .chat nav button { color:#fde68a; } .chat nav button:hover { color:#fffbeb; background:rgba(255,251,235,.08); } .chat nav button.active { color:#fffbeb; background:linear-gradient(100deg, rgba(217,119,6,.52), rgba(190,24,93,.42)); box-shadow:inset 3px 0 #fcd34d; } .chat nav button > span { color:#fcd34d; } .chat nav button > small { color:#fde68a; } .chat nav button .unread { background:#be185d; } .profile-button { border-color:rgba(255,251,235,.15); } .profile-button:hover { border-color:#fcd34d; } .profile-button b, .avatar b, .avatar-preview b { background:linear-gradient(135deg, #d97706, #be185d); } .chat > aside > footer small { color:#86efac; } .logout { color:#fde68a; } .topbar { border-color:#fde68a; background:rgba(255,251,235,.9); } .topbar h2 span { color:#d97706; } .topbar small { color:#92400e; } .toolbar-button { border-color:#fde68a; color:#78350f; background:rgba(255,251,235,.8); } .toolbar-button:hover { border-color:#d97706; color:#451a03; } .notification.on { color:#be185d; background:#fce7f3; } .notification.blocked { color:#991b1b; background:#fef2f2; } .bubble { border-color:#fde68a; background:rgba(255,251,235,.92); } .bubble > header strong { color:#78350f; } .bubble > header small { color:#92400e; } .bubble > header button { color:#b45309; background:#fffbeb; } .markdown { color:#451a03; } .markdown h1, .markdown h2, .markdown h3 { color:#78350f; } .markdown blockquote { border-color:#d97706; color:#92400e; background:#fef9ee; } .markdown code { color:#7c2d12; background:#fef3c7; } .markdown pre { color:#fef3c7; background:#451a03; } .markdown a { color:#b45309; } .markdown th, .markdown td { border-color:#fde68a; } .composer { border-color:#fde68a; background:rgba(255,251,235,.95); } .composer textarea { border-color:#fde68a; background:#fffbeb; color:#451a03; } .composer textarea:focus { border-color:#d97706; box-shadow:0 0 0 3px rgba(217,119,6,.15); } .attach { border-color:#fde68a; color:#b45309; background:#fffbeb; } .attach:hover { border-color:#d97706; } .send, .auth form > button, .primary { background:linear-gradient(135deg, #b45309, #be185d); } .file-chip { color:#78350f; background:#fef3c7; } .file-chip > span { background:#d97706; } .auth { background:radial-gradient(circle at 12% 10%, rgba(252,211,77,.45), transparent 34%), radial-gradient(circle at 90% 86%, rgba(190,24,93,.22), transparent 32%), #fef3c7; } .auth > section, .modal > section { border-color:#fde68a; background:rgba(255,251,235,.95); color:#451a03; } .auth p { color:#b45309; } .auth input { border-color:#fde68a; background:#fffbeb; color:#451a03; } .auth input:focus { border-color:#d97706; box-shadow:0 0 0 3px rgba(217,119,6,.15); } .auth form small { color:#be123c; } .tabs { background:#fef9ee; } .tabs button { color:#92400e; } .tabs button.active { color:#78350f; background:#fffbeb; } .stats span { background:#fffbeb; } .stats b { color:#78350f; } .member button, .modal h3 button, .profile-actions button { border-color:#fde68a; color:#78350f; background:#fffbeb; } .close { color:#92400e; } .toast { background:#451a03; } .attachment-file { border-color:#fde68a; background:#fef9ee; color:#451a03; } .attachment-file > span { color:#b45309; } ::-webkit-scrollbar-thumb { background:#d4a574; } * { scrollbar-color:#d4a574 #fef3c7; }` }
];
const activeTheme = ref(localStorage.getItem('polychat.theme') || 'mist');
const customCss = ref(localStorage.getItem('polychat.custom-css') || '');
const isAdmin = computed(() => user.value?.is_admin);
const totalUnread = computed(() => Object.values(unread.value).reduce((total, count) => total + count, 0));
const onlineIds = computed(() => new Set(onlineUsers.value.map(member => member.id)));
const typingText = computed(() => {
  const names = Object.values(typingByRoom.value[room.value?.id] || {});
  if (!names.length) return '';
  return names.length > 2 ? `${names.slice(0, 2).join('、')} 等 ${names.length} 人正在输入…` : `${names.join('、')}正在输入…`;
});
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
  return DOMPurify.sanitize(marked.parse(source), { USE_PROFILES: { html: true } }).replace(/(^|[\s>])@([\p{L}\p{N}_-]{2,24})/gu, '$1<span class="mention">@$2</span>');
}
function time(value) { return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function size(value = 0) { return value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`; }
function avatar(member) { return member?.avatar_url || (member?.avatar_updated_at ? `/api/users/${member.user_id ?? member.id}/avatar?v=${member.avatar_updated_at}` : ''); }
function clearTimers() { clearTimeout(messageTimer); clearInterval(roomTimer); clearInterval(eventTimer); activeMessageRequest?.abort(); }
function shutdownRealtime() { clearTimers(); clearTimeout(reconnectTimer); if (socket) { socket.onclose = null; socket.close(); socket = null; } }
function sendSocket(event) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event)); }
function stopTyping() { clearTimeout(typingTimer); if (typingRoomId) sendSocket({ type: 'typing', room_id: typingRoomId, typing: false }); typingRoomId = null; }
function sendTyping() {
  if (!room.value) return;
  if (typingRoomId !== room.value.id) { stopTyping(); typingRoomId = room.value.id; sendSocket({ type: 'typing', room_id: room.value.id, typing: true }); }
  clearTimeout(typingTimer); typingTimer = setTimeout(stopTyping, 1500);
}
function fileData(selected) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(selected); }); }
function filePreview(file) { if (!imageTypes.has(file.type)) return ''; return URL.createObjectURL(file); }
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
function base64UrlBytes(value) {
  const normalized = `${value}${'='.repeat((4 - value.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normalized), character => character.charCodeAt(0));
}
async function ensurePushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const registration = await navigator.serviceWorker.register('/sw.js');
  const publicKey = (await api('/api/push/vapid-public-key')).publicKey;
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlBytes(publicKey) });
  await api('/api/push/subscriptions', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
  return true;
}
async function removePushSubscription() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/sw.js');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await api('/api/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {});
  await subscription.unsubscribe();
}
async function enter() {
  await loadRooms(); await events(); connectSocket(); startPolling(); syncNotificationState();
  if (notificationOn.value) ensurePushSubscription().catch(() => {});
  if (navigator.permissions && notificationSupported.value) navigator.permissions.query({ name: 'notifications' }).then(status => { status.onchange = syncNotificationState; }).catch(() => {});
}
function startPolling() {
  clearTimeout(messageTimer); clearInterval(roomTimer); clearInterval(eventTimer);
  const background = document.hidden;
  roomTimer = setInterval(loadRooms, socket?.readyState === WebSocket.OPEN ? 120_000 : 15_000);
  if (socket?.readyState !== WebSocket.OPEN) eventTimer = setInterval(events, background ? 15_000 : 3_000);
  scheduleMessagePoll(socket?.readyState === WebSocket.OPEN ? 60_000 : (background ? 12_000 : 1_500));
}
function scheduleMessagePoll(delay = 1_500) {
  clearTimeout(messageTimer);
  messageTimer = setTimeout(async () => { const hasBacklog = await pollNewMessages(); const idle = socket?.readyState === WebSocket.OPEN ? 60_000 : (document.hidden ? 12_000 : 1_500); scheduleMessagePoll(hasBacklog ? 50 : idle); }, delay);
}
async function refreshMessage(messageId) {
  try {
    const updated = (await api(`/api/messages/${messageId}`)).message;
    const index = messages.value.findIndex(message => message.id === messageId);
    if (index >= 0) messages.value.splice(index, 1, updated);
  } catch { /* message may belong to another room or have become inaccessible */ }
}
async function handleSocketEvent(event) {
  if (event.type === 'presence_snapshot') { onlineUsers.value = event.users || []; return; }
  if (event.type === 'presence') {
    onlineUsers.value = event.online ? [...onlineUsers.value.filter(member => member.id !== event.user_id), { id: event.user_id, username: event.username }] : onlineUsers.value.filter(member => member.id !== event.user_id);
    return;
  }
  if (event.type === 'typing') {
    const current = { ...(typingByRoom.value[event.room_id] || {}) };
    if (event.typing) current[event.user_id] = event.username; else delete current[event.user_id];
    typingByRoom.value = { ...typingByRoom.value, [event.room_id]: current };
    if (event.typing) setTimeout(() => { const latest = { ...(typingByRoom.value[event.room_id] || {}) }; delete latest[event.user_id]; typingByRoom.value = { ...typingByRoom.value, [event.room_id]: latest }; }, 4000);
    return;
  }
  if (event.type === 'pins') { if (pinsOpen.value && room.value?.id === event.room_id) await loadPins(); return; }
  if (event.type === 'thread_message') { if (threadRoot.value?.id === event.thread_root) await openThread(threadRoot.value); return; }
  if (event.type === 'rooms') return loadRooms();
  if (event.type === 'message_update') {
    if (room.value?.id === event.room_id) await refreshMessage(event.message_id);
    return;
  }
  if (event.type !== 'message') return;
  if (room.value?.id === event.room_id) await pollNewMessages();
  else {
    setUnread(event.room_id, (unread.value[event.room_id] || 0) + 1);
    try {
      const message = (await api(`/api/messages/${event.message_id}`)).message;
      const targetRoom = rooms.value.find(item => item.id === event.room_id);
      if (notificationOn.value && message.user_id !== user.value.id) await showDesktopNotification({ ...message, room_name: targetRoom?.name || '聊天室' });
    } catch { /* room may have become inaccessible */ }
  }
}
function connectSocket() {
  if (!user.value || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/ws`);
  socket.onopen = async () => { socketBackoff = 1000; await loadRooms(); await pollNewMessages(); startPolling(); };
  socket.onmessage = message => { try { handleSocketEvent(JSON.parse(message.data)); } catch { /* ignore malformed frames */ } };
  socket.onclose = () => { socket = null; startPolling(); clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connectSocket, socketBackoff); socketBackoff = Math.min(socketBackoff * 2, 30_000); };
  socket.onerror = () => socket?.close();
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
  stopTyping(); room.value = item; clearUnread(item.id); messages.value = []; lastId = 0; oldestId = 0; hasOlderMessages.value = false;
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
      const mentioned = new RegExp(`(^|[^\\p{L}\\p{N}_-])@${user.value.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_-])`, 'u').test(message.content || '');
      if (!currentlyReading || mentioned) setUnread(message.room_id, (unread.value[message.room_id] || 0) + 1);
      if (notificationOn.value && (!currentlyReading || document.hidden || mentioned)) await showDesktopNotification({ ...message, content: mentioned ? `@你 ${message.content}` : message.content });
    }
  } catch { /* retry on the next interval */ }
  finally { eventsLoading = false; }
}
async function toggleNotifications() {
  if (!notificationSupported.value) return notify('当前浏览器不支持桌面通知');
  if (!window.isSecureContext) return notify('请通过 HTTPS 访问后开启通知');
  if (notificationOn.value) { localStorage.setItem('polychat.notifications', 'off'); notificationOn.value = false; await removePushSubscription(); return notify('桌面与离线通知已关闭'); }
  if (Notification.permission === 'denied') return notify('请在浏览器的网站设置中允许通知');
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  notificationPermission.value = permission;
  if (permission === 'granted') {
    localStorage.setItem('polychat.notifications', 'on'); notificationOn.value = true;
    try { await ensurePushSubscription(); notify('桌面与离线通知已开启'); }
    catch { notify('桌面通知已开启，但离线推送订阅失败'); }
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
function selectFile(event) { const selected = event.target.files; if (selected?.length) { files.value = [...files.value, ...Array.from(selected)]; notify(`已添加 ${selected.length} 个文件`); } }
function addFiles(newFiles) { if (newFiles?.length) { files.value = [...files.value, ...Array.from(newFiles)]; notify(`已添加 ${newFiles.length} 个文件`); } }
function removeFile(index) { files.value.splice(index, 1); }
function paste(event) { const image = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/')); if (image) { event.preventDefault(); files.value = [...files.value, image.getAsFile()]; notify('已添加剪贴板图片'); } }
function handleDragOver(event) { event.preventDefault(); event.currentTarget.classList.add('drag-over'); }
function handleDragLeave(event) { event.currentTarget.classList.remove('drag-over'); }
function handleDrop(event) { event.preventDefault(); event.currentTarget.classList.remove('drag-over'); const dropped = event.dataTransfer?.files; if (dropped?.length) addFiles(dropped); }
function insertEmoji(emoji) { content.value += emoji; emojiOpen.value = false; }
function previewImage(src) { imagePreview.value = src; }
function previewMarkdownImage(event) { if (event.target?.tagName === 'IMG') previewImage(event.target.currentSrc || event.target.src); }
function startReply(message) { replyTarget.value = message; }
function cancelReply() { replyTarget.value = null; }
async function send() { if (!room.value || (!content.value.trim() && !files.value.length)) return; stopTyping(); try { const textContent = content.value; const filesToSend = [...files.value]; const replyTo = replyTarget.value?.id || null; content.value = ''; files.value = []; replyTarget.value = null; if (fileInput.value) fileInput.value.value = ''; if (filesToSend.length === 0) { const result = await api(`/api/rooms/${room.value.id}/messages`, { method: 'POST', body: JSON.stringify({ content: textContent, reply_to: replyTo }) }); messages.value = appendUnique(messages.value, [result.message]); lastId = result.message.id; oldestId ||= result.message.id; } else { for (let i = 0; i < filesToSend.length; i++) { const file = filesToSend[i]; const uploaded = await api('/api/files', { method: 'POST', body: JSON.stringify({ name: file.name, type: file.type || 'application/octet-stream', data: await fileData(file) }) }); const msgContent = i === 0 ? textContent : ''; const result = await api(`/api/rooms/${room.value.id}/messages`, { method: 'POST', body: JSON.stringify({ content: msgContent, attachment_id: uploaded.file.id, reply_to: i === 0 ? replyTo : null }) }); messages.value = appendUnique(messages.value, [result.message]); lastId = result.message.id; oldestId ||= result.message.id; } } await nextTick(); messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: 'smooth' }); } catch (e) { notify(e.message); } }
async function openThread(message) { try { threadRoot.value = message; threadMessages.value = (await api(`/api/messages/${message.id}/thread`)).messages; } catch (e) { notify(e.message); } }
async function sendThread() { if (!threadRoot.value || !threadContent.value.trim()) return; try { const result = await api(`/api/rooms/${room.value.id}/messages`, { method: 'POST', body: JSON.stringify({ content: threadContent.value, thread_root: threadRoot.value.id }) }); threadMessages.value = appendUnique(threadMessages.value, [result.message]); threadContent.value = ''; } catch (e) { notify(e.message); } }
async function loadPins() { if (!room.value) return; try { pinnedMessages.value = (await api(`/api/rooms/${room.value.id}/pins`)).messages; pinsOpen.value = true; } catch (e) { notify(e.message); } }
async function pinMessage(message) { try { await api(`/api/rooms/${room.value.id}/pins/${message.id}`, { method: 'PUT' }); notify('消息已置顶'); } catch (e) { notify(e.message); } }
async function unpinMessage(message) { try { await api(`/api/rooms/${room.value.id}/pins/${message.id}`, { method: 'DELETE' }); await loadPins(); } catch (e) { notify(e.message); } }
async function copy(message) { try { await navigator.clipboard.writeText(message.content || ''); notify('已复制完整 Markdown'); } catch { notify('复制失败'); } }
async function toggleReaction(message, emoji) { try { const result = await api(`/api/messages/${message.id}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) }); message.reactions = result.reactions; reactionPickerFor.value = null; } catch (e) { notify(e.message); } }
function beginEdit(message) { editingMessage.value = message; editContent.value = message.content || ''; }
async function saveEdit() { try { await api(`/api/messages/${editingMessage.value.id}`, { method: 'PUT', body: JSON.stringify({ content: editContent.value }) }); editingMessage.value.content = editContent.value; editingMessage.value.edited_at = new Date().toISOString(); editingMessage.value = null; notify('消息已编辑'); } catch (e) { notify(e.message); } }
async function retract(message) { if (!confirm('确定撤回这条消息吗？')) return; try { await api(`/api/messages/${message.id}`, { method: 'DELETE' }); message.content = ''; message.attachment_id = null; message.deleted_at = new Date().toISOString(); notify('消息已撤回'); } catch (e) { notify(e.message); } }
async function searchMessages() { if (!searchText.value.trim()) return; try { searchResults.value = (await api(`/api/search?q=${encodeURIComponent(searchText.value)}`)).messages; } catch (e) { notify(e.message); } }
async function loadMembers() { if (!room.value) return; try { roomMembers.value = (await api(`/api/rooms/${room.value.id}/members`)).members; memberName.value = ''; memberRole.value = 'member'; membersOpen.value = true; } catch (e) { notify(e.message); } }
async function inviteMember() { if (!memberName.value.trim() || !room.value) return; try { await api(`/api/rooms/${room.value.id}/members`, { method: 'POST', body: JSON.stringify({ username: memberName.value.trim(), role: memberRole.value }) }); memberName.value = ''; await loadMembers(); notify('成员已邀请'); } catch (e) { notify(e.message); } }
async function removeMember(member) { if (!room.value) return; try { await api(`/api/rooms/${room.value.id}/members/${member.id}`, { method: 'DELETE' }); await loadMembers(); } catch (e) { notify(e.message); } }
function newRoom() { roomDraft.value = { name: '', is_private: !isAdmin.value }; createRoomOpen.value = true; }
async function createRoom() { if (!roomDraft.value.name.trim()) return; try { const result = await api('/api/rooms', { method: 'POST', body: JSON.stringify(roomDraft.value) }); createRoomOpen.value = false; await loadRooms(); await choose(result.room); } catch (e) { notify(e.message); } }
function openRoomManage() { roomNameDraft.value = room.value?.name || ''; roomManageOpen.value = true; }
async function saveRoom() { if (!room.value || !roomNameDraft.value.trim()) return; try { const result = await api(`/api/rooms/${room.value.id}`, { method: 'PUT', body: JSON.stringify({ name: roomNameDraft.value }) }); room.value = { ...room.value, ...result.room }; rooms.value = rooms.value.map(item => item.id === room.value.id ? room.value : item); roomManageOpen.value = false; notify('房间已更新'); } catch (e) { notify(e.message); } }
async function deleteRoom() { if (!room.value || !confirm(`删除 #${room.value.name} 及全部消息？此操作不可恢复。`)) return; try { await api(`/api/rooms/${room.value.id}`, { method: 'DELETE' }); roomManageOpen.value = false; room.value = null; await loadRooms(); notify('房间已删除'); } catch (e) { notify(e.message); } }
async function loadAdmin() { try { admin.value = await api('/api/admin/overview'); } catch (e) { notify(e.message); } }
async function toggleAdmin(member) { try { await api(`/api/admin/users/${member.id}/admin`, { method: 'PUT', body: JSON.stringify({ is_admin: !member.is_admin }) }); await loadAdmin(); } catch (e) { notify(e.message); } }
async function banUser(member, hours = 24) { try { await api(`/api/admin/users/${member.id}/ban`, { method: 'PUT', body: JSON.stringify({ duration_hours: hours }) }); await loadAdmin(); notify(`已封禁 ${member.username} ${hours} 小时`); } catch (e) { notify(e.message); } }
async function unbanUser(member) { try { await api(`/api/admin/users/${member.id}/unban`, { method: 'PUT' }); await loadAdmin(); notify(`已解封 ${member.username}`); } catch (e) { notify(e.message); } }
async function muteUser(member, hours = 1) { try { await api(`/api/admin/users/${member.id}/mute`, { method: 'PUT', body: JSON.stringify({ duration_hours: hours }) }); await loadAdmin(); notify(`已禁言 ${member.username} ${hours} 小时`); } catch (e) { notify(e.message); } }
async function unmuteUser(member) { try { await api(`/api/admin/users/${member.id}/unmute`, { method: 'PUT' }); await loadAdmin(); notify(`已解除 ${member.username} 的禁言`); } catch (e) { notify(e.message); } }
async function logout() { await api('/api/logout', { method: 'POST' }); shutdownRealtime(); location.reload(); }
async function exportData() { try { const response = await fetch('/api/me/export'); if (!response.ok) throw new Error('导出失败'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `polychat-export-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url); notify('聊天记录已导出'); } catch (e) { notify(e.message); } }
async function deleteAccount() { const password = prompt('请输入密码以确认删除账号：'); if (!password) return; if (!confirm('确定要删除账号吗？此操作不可恢复，所有消息和文件将被永久删除。')) return; try { await api('/api/me', { method: 'DELETE', body: JSON.stringify({ password }) }); notify('账号已删除'); shutdownRealtime(); location.reload(); } catch (e) { notify(e.message); } }
onMounted(async () => { renderThemeCss(); document.addEventListener('visibilitychange', handleVisibility); try { user.value = (await api('/api/me')).user; await enter(); } catch {} });
onBeforeUnmount(() => { shutdownRealtime(); document.removeEventListener('visibilitychange', handleVisibility); });
</script>

<template>
  <main v-if="!user" class="auth"><section><img :src="icon"><p>MARKDOWN · LATEX · EVERYWHERE</p><h1>欢迎来到 PolyChat</h1><div class="tabs"><button :class="{active: mode === 'login'}" @click="mode = 'login'">登录</button><button :class="{active: mode === 'register'}" @click="mode = 'register'">注册</button></div><form @submit.prevent="authenticate"><input v-model="credentials.username" placeholder="用户名" required><input v-model="credentials.password" type="password" placeholder="密码" required><small>{{ error }}</small><button> {{ mode === 'login' ? '登录' : '创建账号' }} </button></form></section></main>
  <main v-else class="chat"><aside><header class="brand"><img :src="icon"><span>PolyChat<small>让交流保持简单</small></span></header><button class="new" @click="newRoom"><span>＋</span> 新建聊天室</button><p class="nav-label">聊天室</p><nav><button v-for="item in rooms" :key="item.id" :class="{active: room?.id === item.id, hasUnread: unread[item.id]}" @click="choose(item)"><span>#</span><b>{{ item.name }}</b><small v-if="unread[item.id]" class="unread">{{ unread[item.id] > 99 ? '99+' : unread[item.id] }}</small></button></nav><footer><button class="profile-button" title="更换头像" @click="profileOpen = true"><img v-if="avatar(user)" :src="avatar(user)"><b v-else>{{ user.username[0] }}</b></button><span>{{ user.username }}<small>{{ isAdmin ? '管理员 · 在线' : '在线' }}</small></span><button class="logout" title="退出登录" @click="logout">↪</button></footer></aside>
    <section class="conversation">
      <header class="topbar"><div><h2><span>#</span> {{ room?.name || '大厅' }} <small v-if="room?.is_private">🔒 私有</small></h2><small><i class="online-dot"></i>{{ onlineUsers.length }} 人在线<span v-if="typingText"> · {{ typingText }}</span></small></div><button class="toolbar-button" @click="loadPins">⌖ <em>置顶</em></button><button class="toolbar-button" @click="searchOpen = true">⌕ <em>搜索</em></button><button v-if="room?.is_private && (room?.role === 'owner' || room?.role === 'admin' || isAdmin)" class="toolbar-button" @click="loadMembers">♙ <em>成员</em></button><button v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" class="toolbar-button" @click="openRoomManage">⚙ <em>房间</em></button><button class="toolbar-button" title="主题与自定义 CSS" @click="themeOpen = true"><span>◐</span><em>主题</em></button><button v-if="isAdmin" class="toolbar-button" @click="adminOpen = true; loadAdmin()">管理面板</button><button class="toolbar-button notification" :class="{on: notificationOn, blocked: notificationPermission === 'denied'}" :title="notificationLabel" @click="toggleNotifications"><span>{{ notificationOn ? '🔔' : '🔕' }}</span><em>{{ notificationButtonText }}</em></button></header>
      <div ref="messageList" class="messages" @scroll.passive="maybeLoadOlderMessages"><p v-if="loadingOlderMessages" class="history-loading">正在加载更早消息…</p><p v-else-if="hasOlderMessages" class="history-hint">向上滚动加载更早消息</p><div v-if="!messages.length" class="empty"><img :src="icon"><h3>开始一段新对话</h3><p>发送 Markdown、公式、图片或文件。</p></div>
        <article v-for="message in messages" :key="message.id"><div class="avatar"><img v-if="avatar(message)" :src="avatar(message)"><b v-else>{{ message.username[0] }}</b></div><div class="bubble"><header><strong>{{ message.username }}<i v-if="onlineIds.has(message.user_id)" class="online-dot" title="在线"></i></strong><small>{{ time(message.created_at) }}{{ message.edited_at ? ' · 已编辑' : '' }}</small><button class="message-menu-trigger" @click="openMessageActions = openMessageActions === message.id ? null : message.id">•••</button><div v-if="openMessageActions === message.id" class="message-menu"><button @click="startReply(message); openMessageActions = null">回复</button><button @click="openThread(message); openMessageActions = null">打开话题</button><button @click="copy(message); openMessageActions = null">复制 Markdown</button><button v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" @click="pinMessage(message); openMessageActions = null">置顶消息</button><button v-if="message.user_id === user.id && !message.deleted_at" @click="beginEdit(message); openMessageActions = null">编辑</button><button v-if="message.user_id === user.id || isAdmin || room?.role === 'owner' || room?.role === 'admin'" class="danger" @click="retract(message); openMessageActions = null">撤回</button></div></header><blockquote v-if="message.reply_to" class="reply-reference">回复 {{ message.reply_username || '消息' }}：{{ message.reply_content || '已撤回的消息' }}</blockquote><p v-if="message.deleted_at" class="retracted">此消息已撤回</p><div v-else-if="message.content" class="markdown" @click="previewMarkdownImage" v-html="markdown(message.content)"></div><template v-if="message.attachment_id"><img v-if="imageTypes.has(message.attachment_type)" class="attachment-image previewable" :src="`/api/files/${message.attachment_id}?inline=1`" :alt="message.attachment_name" @click="previewImage(`/api/files/${message.attachment_id}?inline=1`)"><a v-else class="attachment-file" :href="`/api/files/${message.attachment_id}`"><span>↓</span><div><b>{{ message.attachment_name }}</b><small>{{ size(message.attachment_size) }}</small></div></a></template><div v-if="!message.deleted_at" class="reactions"><button v-for="reaction in message.reactions" :key="reaction.emoji" :class="{active: reaction.reacted}" @click="toggleReaction(message, reaction.emoji)">{{ reaction.emoji }} {{ reaction.count }}</button><button class="reaction-add" @click="reactionPickerFor = reactionPickerFor === message.id ? null : message.id">☺</button><div v-if="reactionPickerFor === message.id" class="reaction-picker"><button v-for="emoji in emojiGroups['常用']" :key="emoji" @click="toggleReaction(message, emoji)">{{ emoji }}</button></div></div></div></article>
      </div>
      <form class="composer" @submit.prevent="send" @dragover.prevent="handleDragOver" @dragleave="handleDragLeave" @drop.prevent="handleDrop"><div v-if="replyTarget" class="file-chip">↳ 回复 {{ replyTarget.username }}：{{ replyTarget.content?.slice(0, 80) }}<button type="button" @click="cancelReply">×</button></div><div v-if="files.length" class="file-chips"><div v-for="(f, index) in files" :key="index" class="file-chip"><img v-if="imageTypes.has(f.type)" :src="filePreview(f)" class="file-preview"><span>{{ imageTypes.has(f.type) ? '图片' : '文件' }}</span>{{ f.name }}<button type="button" @click="removeFile(index)">×</button></div></div><div class="compose-row"><label class="attach" title="添加文件（支持多选）">＋<input ref="fileInput" type="file" multiple @change="selectFile"></label><button type="button" class="attach emoji-trigger" title="EmojiAll 表情" @click="emojiOpen = !emojiOpen">☺</button><textarea v-model="content" rows="1" placeholder="输入消息，粘贴图片、拖拽文件或使用 Markdown…" @input="sendTyping" @paste="paste" @keydown.enter.exact.prevent="send"></textarea><button class="send" title="发送消息">发送</button></div><div v-if="emojiOpen" class="emoji-picker"><nav><button v-for="(_, category) in emojiGroups" :key="category" :class="{active: emojiCategory === category}" type="button" @click="emojiCategory = category">{{ category }}</button></nav><div><button v-for="emoji in emojiGroups[emojiCategory]" :key="emoji" type="button" :title="emoji" @click="insertEmoji(emoji)">{{ emoji }}</button></div></div><small><span v-if="typingText">{{ typingText }}</span><span v-else>Enter 发送 · Shift + Enter 换行 · 拖拽文件到此处上传</span></small></form>
    </section></main>
  <div v-if="profileOpen" class="modal"><section class="profile-modal"><button class="close" @click="profileOpen = false">×</button><p>YOUR PROFILE</p><h2>个人资料</h2><div class="avatar-preview"><img v-if="avatar(user)" :src="avatar(user)"><b v-else>{{ user.username[0] }}</b></div><h3>{{ user.username }}</h3><p class="hint">支持 PNG、JPEG、WebP、GIF，最大 2 MB</p><input ref="avatarInput" class="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="setAvatar($event.target.files[0])"><div class="profile-actions"><button class="primary" @click="avatarInput.click()">选择新头像</button><button v-if="avatar(user)" @click="removeAvatar">移除头像</button></div><div class="data-actions"><h3>数据管理</h3><button @click="exportData">导出聊天记录</button><button class="danger-button" @click="deleteAccount">删除账号</button><p class="hint">删除账号将永久移除所有消息和文件</p></div></section></div>
  <div v-if="themeOpen" class="modal"><section class="theme-modal"><button class="close" @click="themeOpen = false">×</button><p>THEMES · LOCAL ONLY</p><h2>主题与自定义 CSS</h2><p class="hint">预设可一键切换；自定义 CSS 只保存在当前浏览器。</p><div class="theme-grid"><button v-for="theme in themes" :key="theme.id" :class="{selected: activeTheme === theme.id}" @click="chooseTheme(theme.id)"><span class="swatches"><i v-for="color in theme.colors" :key="color" :style="{background: color}"></i></span><b>{{ theme.name }}</b><small>{{ theme.note }}</small></button></div><label class="css-label">自定义 CSS <textarea v-model="customCss" spellcheck="false" placeholder="例如：\n.chat > aside { background: #0f172a; }" @input="updateCustomCss"></textarea></label><div class="theme-actions"><button class="primary" @click="updateCustomCss(); notify('自定义 CSS 已保存')">保存 CSS</button><button @click="resetCustomCss">清除自定义 CSS</button></div></section></div>
  <div v-if="adminOpen" class="modal"><section class="admin-modal"><button class="close" @click="adminOpen = false">×</button><p>ADMINISTRATION</p><h2>管理面板</h2><div class="stats"><span v-for="(value, key) in admin.stats" :key="key"><b>{{ value }}</b>{{ {users:'用户', rooms:'聊天室', messages:'消息', files:'文件'}[key] }}</span></div><h3>用户 <button @click="loadAdmin">刷新</button></h3><div v-for="member in admin.users" :key="member.id" class="member"><div class="member-info"><span>{{ member.username }} · {{ member.message_count }} 条消息</span><span v-if="member.banned_until" class="status-badge banned">封禁至 {{ new Date(member.banned_until).toLocaleString() }}</span><span v-if="member.muted_until" class="status-badge muted">禁言至 {{ new Date(member.muted_until).toLocaleString() }}</span></div><div class="member-actions"><button @click="toggleAdmin(member)">{{ member.is_admin ? '撤销管理员' : '设为管理员' }}</button><template v-if="!member.is_admin"><button v-if="!member.banned_until" @click="banUser(member)">封禁</button><button v-else @click="unbanUser(member)">解封</button><button v-if="!member.muted_until" @click="muteUser(member)">禁言</button><button v-else @click="unmuteUser(member)">解除禁言</button></template></div></div></section></div>
  <div v-if="searchOpen" class="modal"><section><button class="close" @click="searchOpen = false">×</button><p>SEARCH</p><h2>搜索消息</h2><form class="search-form" @submit.prevent="searchMessages"><input v-model="searchText" autofocus placeholder="输入关键词"><button class="primary">搜索</button></form><div class="search-results"><button v-for="message in searchResults" :key="message.id" @click="choose(rooms.find(item => item.id === message.room_id)); searchOpen = false"><b>#{{ message.room_name }} · {{ message.username }}</b><span>{{ message.content }}</span></button><p v-if="searchText && !searchResults.length">没有结果</p></div></section></div>
  <div v-if="editingMessage" class="modal"><section><button class="close" @click="editingMessage = null">×</button><p>EDIT MESSAGE</p><h2>编辑消息</h2><textarea class="edit-area" v-model="editContent"></textarea><div class="theme-actions"><button class="primary" @click="saveEdit">保存</button><button @click="editingMessage = null">取消</button></div></section></div>
  <div v-if="createRoomOpen" class="modal"><section class="room-modal"><button class="close" @click="createRoomOpen = false">×</button><p>NEW ROOM</p><h2>创建聊天室</h2><label>名称<input v-model="roomDraft.name" autofocus maxlength="30" placeholder="例如：项目讨论"></label><label class="privacy-choice"><input v-model="roomDraft.is_private" type="checkbox"><span><b>私有聊天室</b><small>只有被邀请的成员可以发现、查看和发送消息。</small></span></label><div class="theme-actions"><button class="primary" @click="createRoom">创建</button><button @click="createRoomOpen = false">取消</button></div></section></div>
  <div v-if="membersOpen" class="modal"><section class="members-modal"><button class="close" @click="membersOpen = false">×</button><p>ROOM ACCESS</p><h2>管理成员</h2><p class="hint">私有房间只对以下成员可见。</p><form class="member-invite" @submit.prevent="inviteMember"><input v-model="memberName" placeholder="输入用户名"><select v-model="memberRole"><option value="member">成员</option><option value="admin">房间管理员</option></select><button class="primary">邀请</button></form><div class="member" v-for="member in roomMembers" :key="member.id"><span>{{ member.username }}</span><small>{{ member.role === 'owner' ? '房主' : member.role === 'admin' ? '管理员' : '成员' }}</small><button v-if="member.role !== 'owner'" @click="removeMember(member)">移除</button></div></section></div>
  <div v-if="roomManageOpen" class="modal"><section class="room-modal"><button class="close" @click="roomManageOpen = false">×</button><p>ROOM SETTINGS</p><h2>房间设置</h2><label>名称<input v-model="roomNameDraft" maxlength="30"></label><div class="theme-actions"><button class="primary" @click="saveRoom">保存更改</button><button class="danger-button" @click="deleteRoom">删除房间</button></div></section></div>
  <div v-if="imagePreview" class="image-lightbox" @click.self="imagePreview = ''"><button class="close" @click="imagePreview = ''">×</button><img :src="imagePreview" alt="图片预览"></div>
  <div v-if="pinsOpen" class="modal"><section class="pins-modal"><button class="close" @click="pinsOpen = false">×</button><p>PINNED</p><h2>置顶消息</h2><div v-if="!pinnedMessages.length" class="modal-empty">暂无置顶消息</div><article v-for="message in pinnedMessages" :key="message.id" class="pin-card"><b>{{ message.username }}</b><small>{{ time(message.pinned_at || message.created_at) }}</small><div class="markdown" v-html="markdown(message.content)"></div><button v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" @click="unpinMessage(message)">取消置顶</button></article></section></div>
  <div v-if="threadRoot" class="thread-panel"><header><div><small>话题</small><h2>{{ threadRoot.username }} 的消息</h2></div><button @click="threadRoot = null">×</button></header><div class="thread-list"><article v-for="message in threadMessages" :key="message.id"><b>{{ message.username }}<i v-if="onlineIds.has(message.user_id)" class="online-dot"></i></b><small>{{ time(message.created_at) }}</small><div class="markdown" v-html="markdown(message.content)"></div></article></div><form @submit.prevent="sendThread"><textarea v-model="threadContent" rows="2" placeholder="回复这个话题…"></textarea><button class="send">发送</button></form></div>
  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
