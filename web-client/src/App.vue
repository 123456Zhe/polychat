<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';
import icon from '../../assets/polychat-icon.png';
import { createReceiver, createSender, p2pGetFile, p2pListFiles, p2pDeleteFile, downloadBlob } from './p2p.js';

const location = window.location;
const user = ref(null), rooms = ref([]), room = ref(null), messages = ref([]), content = ref('');
const mode = ref('login'), credentials = ref({ username: '', password: '' }), error = ref(''), toast = ref('');
const files = ref([]), adminOpen = ref(false), profileOpen = ref(false), themeOpen = ref(false), admin = ref({ stats: {}, users: [] });
const bannedIps = ref([]), banIpInput = ref(''), banIpDuration = ref(null);
const bannedFingerprints = ref([]), banFpInput = ref(''), banFpDuration = ref(null);
const emojiOpen = ref(false), emojiCategory = ref('常用'), replyTarget = ref(null), editingMessage = ref(null), editContent = ref('');
const searchOpen = ref(false), searchText = ref(''), searchResults = ref([]), membersOpen = ref(false), roomMembers = ref([]);
const createRoomOpen = ref(false), roomDraft = ref({ name: '', is_private: false }), memberName = ref(''), memberRole = ref('member');
const openMessageActions = ref(null), reactionPickerFor = ref(null);
const imagePreview = ref(''), roomManageOpen = ref(false), roomNameDraft = ref('');
const sidebarOpen = ref(false), isMobile = ref(false);
const mobileTab = ref('chats'), roomActionsOpen = ref(false);
const onlineUsers = ref([]), typingByRoom = ref({}), pinsOpen = ref(false), pinnedMessages = ref([]);
const roomPins = ref([]), pinsExpanded = ref(false), announcementExpanded = ref(true);
const threadRoot = ref(null), threadMessages = ref([]), threadContent = ref('');
const notificationOn = ref(false), notificationPermission = ref('default'), avatarInput = ref(null), fileInput = ref(null), messageList = ref(null);
const unread = ref({}); const mentionedUnread = ref({}); const atRoomMembers = ref([]);
const hasOlderMessages = ref(false), loadingOlderMessages = ref(false);
const view = ref('rooms'), conversations = ref([]), conversation = ref(null), dmMessages = ref([]), dmUnread = ref({});
const notifOpen = ref(false), notifications = ref([]), notifUnreadCount = ref(0);
const botTokens = ref([]);
const globalAnnouncement = ref(null), globalAnnouncementDraft = ref('');
const mdHelpOpen = ref(false);
let dmLastId = 0, dmOldestId = 0;
const friendsOpen = ref(false), friendList = ref({ accepted: [], incoming: [], outgoing: [] }), friendSearchQuery = ref(''), friendSearchResults = ref([]);
const dmTypeahead = ref(''), dmInput = ref(''), dmReplyTarget = ref(null), dmFiles = ref([]), dmSending = ref(false);
const p2pIncoming = ref(null), p2pProgress = ref({}), p2pLocalIds = ref(new Set());
let p2pConfig = null;
const p2pActive = new Map();
const helpOpen = ref(false), tourOpen = ref(false), tourStep = ref(0);
const tourHighlight = ref(null), tourHasTarget = ref(true), tourTipAtTop = ref(false);
const TOUR_DONE_KEY = 'polychat.tour-done';
const totalDmUnread = computed(() => Object.values(dmUnread.value).reduce((total, count) => total + count, 0));
const atOpen = ref(false), atQuery = ref(''), atResults = ref([]), atStartPos = ref(-1), atTarget = ref('content');
let messageTimer, roomTimer, eventTimer, dmTimer, friendTimer, lastId = 0, oldestId = 0, eventCursor = null;
let roomGeneration = 0, activeMessageRequest = null, roomsLoading = false, eventsLoading = false, messagesLoading = false;
let socket = null, reconnectTimer = null, socketBackoff = 1000;
let typingTimer = null, typingRoomId = null;
let themeStyleElement;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
function generateFingerprint() { try { const c = document.createElement('canvas'); const ctx = c.getContext('2d'); ctx.textBaseline = 'top'; ctx.font = '14px Arial'; ctx.fillStyle = '#f60'; ctx.fillRect(0, 0, 140, 20); ctx.fillStyle = '#069'; ctx.fillText('fingerprint', 2, 2); const canvasHash = c.toDataURL().slice(-50); const nav = [navigator.userAgent, navigator.language, screen.width + 'x' + screen.height, screen.colorDepth, new Date().getTimezoneOffset(), navigator.hardwareConcurrency || ''].join('|'); let hash = 0; for (let i = 0; i < nav.length; i++) { hash = ((hash << 5) - hash + nav.charCodeAt(i)) | 0; } return (Math.abs(hash).toString(36) + canvasHash.replace(/[^a-z0-9]/g, '')).slice(0, 32); } catch { return null; } }
const deviceFingerprint = ref(null);
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
// 功能指南：分类列出 PolyChat 的全部功能；action 为「去试试」快捷入口（见 featureActions）
const featureGroups = [
  { title: '聊天与消息', icon: '💬', features: [
    { icon: '#', title: 'Markdown 富文本', desc: '支持标题、加粗、斜体、删除线、引用、代码块、链接与表格，输入即渲染。' },
    { icon: '∑', title: 'LaTeX 公式', desc: '行内公式 $E=mc^2$，块级公式 $$\\int_0^1 x^2\\,dx$$，由 KaTeX 渲染。' },
    { icon: '●', title: '在线与输入状态', desc: '绿色圆点表示在线，输入消息时对方实时看到「正在输入…」。' },
    { icon: '😄', title: '表情反应', desc: '悬停消息，点击气泡下方 ☺ 为任意消息添加表情。' },
    { icon: '↩', title: '回复消息', desc: '在消息 ••• 菜单中选择「回复」，引用原消息继续讨论。' },
    { icon: '🧵', title: '话题串', desc: '「••• → 打开话题」围绕一条消息展开独立的子讨论。' },
    { icon: '📌', title: '置顶消息', desc: '房主/管理员可把重要消息置顶到房间顶部，随时查看。' },
    { icon: '@', title: '@提及', desc: '输入 @ 呼出成员列表选择，被 @ 的人会看到红色提醒。' },
    { icon: '⌕', title: '搜索消息', desc: '顶栏搜索可跨房间按关键词检索历史消息。' },
    { icon: '✎', title: '编辑与撤回', desc: '自己的消息可随时在 ••• 菜单中编辑或撤回。' },
    { icon: '🔍', title: '图片预览', desc: '点击聊天中的图片可全屏放大查看。' },
  ]},
  { title: '文件与直传', icon: '📁', features: [
    { icon: '＋', title: '发送文件', desc: '点击输入框左侧 ＋ 多选文件/图片，也可直接拖拽到输入框或粘贴截图。' },
    { icon: '🖼', title: '发送前预览', desc: '图片发送前即显示缩略图，确认无误再发送。' },
    { icon: '📦', title: '大文件分片上传', desc: '超大文件自动分片上传，单文件上限 100 MB。' },
    { icon: '⚡', title: 'P2P 大文件直传', desc: '私信发送 ≥5MB 文件时优先 WebRTC 点对点直传，文件不经过服务器，打洞失败自动回退上传。' },
  ]},
  { title: '好友与私信', icon: '👥', features: [
    { icon: '＋', title: '加好友', desc: '顶栏 👥 搜索用户名发送好友请求，对方接受后成为双向好友。', action: 'friends' },
    { icon: '✉', title: '私信（DM）', desc: '互为好友后即可私信，支持编辑、撤回、表情、未读计数与已读回执。', action: 'dm' },
  ]},
  { title: '房间管理', icon: '🏠', features: [
    { icon: '＋', title: '新建聊天室', desc: '创建公开房间，或勾选「私有」创建仅受邀成员可见的房间。', action: 'newRoom' },
    { icon: '📢', title: '房间公告', desc: '房主/管理员可发布公告，展示在房间顶部。' },
    { icon: '♙', title: '成员管理', desc: '私有房间可邀请成员、设置管理员角色或移除成员。' },
    { icon: '🔗', title: '邀请码与链接', desc: '生成一次性/限时邀请码，分享链接即可加入私有房间。' },
    { icon: '⚙', title: '房间设置', desc: '重命名或删除房间。' },
  ]},
  { title: '个性化与通知', icon: '🎨', features: [
    { icon: '◐', title: '主题与自定义 CSS', desc: '5 套预设主题一键切换，还可用自定义 CSS 深度定制界面。', action: 'theme' },
    { icon: '🔔', title: '桌面与离线通知', desc: '浏览器桌面通知 + Web Push 离线推送，离开页面也能收到消息提醒。' },
    { icon: '🔔', title: '通知中心', desc: '顶部铃铛汇总系统通知（好友请求、机器人审批结果等）。' },
  ]},
  { title: '账户与数据', icon: '👤', features: [
    { icon: '🖼', title: '头像', desc: '在个人资料中上传或移除头像（PNG/JPEG/WebP/GIF，≤2MB）。', action: 'profile' },
    { icon: '↓', title: '导出聊天记录', desc: '一键把全部聊天记录导出为 JSON 文件。', action: 'export' },
    { icon: '✕', title: '删除账号', desc: '删除账号及所有个人数据（需密码确认，不可恢复）。' },
  ]},
  { title: '管理员（仅管理员可见）', icon: '🛡', adminOnly: true, features: [
    { icon: '🔨', title: '用户管理', desc: '封禁/解封、禁言/解除、设置管理员，支持时长设置。' },
    { icon: '🛡', title: '安全防护', desc: '按 IP 或设备指纹封禁，登录限速与审计日志。' },
    { icon: '🤖', title: '机器人接入', desc: '审批 OneBot v11 机器人申请，复制 Token / WebSocket 地址 / 配置。' },
  ]},
];

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
  if (!response.ok) {
    if (response.status === 403 && body.banned_until) {
      user.value = null;
      shutdownRealtime();
      notify(`账号已被封禁至 ${new Date(body.banned_until).toLocaleString()}`);
      throw new Error(body.error);
    }
    throw new Error(body.error || `请求失败 (${response.status})`);
  }
  return body;
}
function notify(text) { toast.value = text; setTimeout(() => toast.value = '', 2200); }
function markdown(source = '', mentions = []) {
  let html = DOMPurify.sanitize(marked.parse(source), { USE_PROFILES: { html: true } });
  for (const m of mentions) {
    if (!m.id) continue;
    html = html.replaceAll(`[at:${m.id}]`, `<span class="mention" data-user-id="${m.id}">@${m.username}</span>`);
  }
  html = html.replace(/\[at:(\d+)\]/g, (_, id) => `<span class="mention">@用户${id}</span>`);
  html = html.replace(/(^|[\s>])@([\p{L}\p{N}_-]{2,24})/gu, '$1<span class="mention">@$2</span>');
  return html;
}
function time(value) { const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`; return new Date(normalized).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function size(value = 0) { return value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`; }
function onebotWsUrl(token) { return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/onebot/ws?token=${encodeURIComponent(token)}`; }
function onebotConfig(token) { return JSON.stringify({ adapter: 'OneBot v11', websocket_url: onebotWsUrl(token), access_token: '' }, null, 2); }
async function copyText(value, success = '已复制') { try { await navigator.clipboard.writeText(value); notify(success); } catch { notify('复制失败，请手动复制'); } }
function avatar(member) { return member?.avatar_url || (member?.avatar_updated_at ? `/api/users/${member.user_id ?? member.id}/avatar?v=${member.avatar_updated_at}` : ''); }
function clearTimers() { clearTimeout(messageTimer); clearInterval(roomTimer); clearInterval(eventTimer); activeMessageRequest?.abort(); }
function toggleSidebar() { sidebarOpen.value = !sidebarOpen.value; }
function closeSidebar() { if (isMobile.value) sidebarOpen.value = false; }
function shutdownRealtime() { clearTimers(); clearTimeout(reconnectTimer); clearInterval(dmTimer); clearInterval(friendTimer); cancelP2pAll(); if (socket) { socket.onclose = null; socket.close(); socket = null; } }
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
function clearUnread(roomId) { if (roomId != null) { if (unread.value[roomId]) setUnread(roomId, 0); mentionedUnread.value[roomId] = false; } }
function handleVisibility() { if (!document.hidden) clearUnread(room.value?.id); startPolling(); }
function renderThemeCss() {
  const preset = themes.find(theme => theme.id === activeTheme.value) || themes[0];
  if (!themeStyleElement) { themeStyleElement = document.createElement('style'); themeStyleElement.id = 'polychat-user-theme'; document.head.append(themeStyleElement); }
  themeStyleElement.textContent = `${preset.css}\n/* 用户自定义 CSS */\n${customCss.value}`;
}
function chooseTheme(themeId) { activeTheme.value = themeId; localStorage.setItem('polychat.theme', themeId); renderThemeCss(); }
function updateCustomCss() { localStorage.setItem('polychat.custom-css', customCss.value); renderThemeCss(); }
function resetCustomCss() { customCss.value = ''; localStorage.removeItem('polychat.custom-css'); renderThemeCss(); notify('已清除自定义 CSS'); }

async function authenticate() { error.value = ''; try { user.value = (await api(`/api/${mode.value}`, { method: 'POST', body: JSON.stringify({ ...credentials.value, fingerprint: deviceFingerprint.value }) })).user; await enter(); } catch (e) { error.value = e.message; } }
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
  loadConversations(); loadFriends(); loadNotifCount();
  loadPlugins(); loadGlobalAnnouncement();
  if (notificationOn.value) ensurePushSubscription().catch(() => {});
  if (navigator.permissions && notificationSupported.value) navigator.permissions.query({ name: 'notifications' }).then(status => { status.onchange = syncNotificationState; }).catch(() => {});
}
// 插件启用状态：停用的插件（如 onebot / announcement）对应 UI 应禁用
const enabledPlugins = ref([]);
async function loadPlugins() {
  try { enabledPlugins.value = (await api('/api/plugins')).plugins.filter(p => p.enabled).map(p => p.name); } catch { enabledPlugins.value = []; }
}
function pluginEnabled(name) { return enabledPlugins.value.includes(name); }
async function loadGlobalAnnouncement() {
  if (!pluginEnabled('announcement')) { globalAnnouncement.value = null; return; }
  try { globalAnnouncement.value = (await api('/api/admin/announcement')).announcement; } catch { globalAnnouncement.value = null; }
}
async function publishGlobalAnnouncement() {
  const text = globalAnnouncementDraft.value.trim();
  if (!text) return notify('公告内容不能为空');
  try { const result = await api('/api/admin/announcement', { method: 'POST', body: JSON.stringify({ content: text }) }); globalAnnouncement.value = result.announcement; globalAnnouncementDraft.value = ''; notify('全局公告已发布'); } catch (e) { notify(e.message); }
}
async function clearGlobalAnnouncement() {
  if (!confirm('清除全局公告？')) return;
  try { await api('/api/admin/announcement', { method: 'DELETE' }); globalAnnouncement.value = null; notify('全局公告已清除'); } catch (e) { notify(e.message); }
}
function startPolling() {
  clearTimeout(messageTimer); clearInterval(roomTimer); clearInterval(eventTimer); clearInterval(dmTimer); clearInterval(friendTimer);
  const background = document.hidden;
  roomTimer = setInterval(loadRooms, socket?.readyState === WebSocket.OPEN ? 120_000 : 15_000);
  if (socket?.readyState !== WebSocket.OPEN) eventTimer = setInterval(events, background ? 15_000 : 3_000);
  if (socket?.readyState !== WebSocket.OPEN) { dmTimer = setInterval(loadConversations, 10_000); friendTimer = setInterval(loadFriends, 30_000); }
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
  if (event.type === 'pins') { if (room.value?.id === event.room_id) { await loadRoomPins(); if (pinsOpen.value) await loadPins(); } return; }
  if (event.type === 'thread_message') { if (threadRoot.value?.id === event.thread_root) await openThread(threadRoot.value); return; }
  if (event.type === 'announcement') {
    if (event.global) {
      globalAnnouncement.value = event.content ? { content: event.content, admin_name: event.admin_name, created_at: event.created_at } : null;
    } else if (room.value?.id === event.room_id) {
      await loadRooms();
    }
    return;
  }
  if (event.type === 'room_kicked') {
    if (room.value?.id === event.room_id) { backToMobileHome(); notify(`你已被移出房间「${event.room_name}」`); }
    await loadRooms();
    return;
  }
  if (event.type === 'rooms') return loadRooms();
  if (event.type === 'message_update') {
    if (room.value?.id === event.room_id) await refreshMessage(event.message_id);
    return;
  }
  if (event.type === 'message') {
    const isMentioned = (event.message?.mentions || []).some(m => m.id === user.value.id);
    if (event.message && room.value?.id === event.room_id) {
      messages.value = appendUnique(messages.value, [event.message]); lastId = event.message.id || lastId; await nextTick(); messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: 'smooth' });
      if (isMentioned && document.hidden && notificationOn.value) showDesktopNotification({ ...event.message, content: '@你 ' + (event.message.content || ''), room_name: room.value?.name });
    } else if (event.message_id && room.value?.id !== event.room_id) {
      setUnread(event.room_id, (unread.value[event.room_id] || 0) + 1);
      if (isMentioned) mentionedUnread.value[event.room_id] = true;
      try {
        const message = (await api(`/api/messages/${event.message_id}`)).message;
        const targetRoom = rooms.value.find(item => item.id === event.room_id);
        const msgMentioned = message.mentions?.some(m => m.id === user.value.id);
        if (msgMentioned) mentionedUnread.value[event.room_id] = true;
        if (notificationOn.value && message.user_id !== user.value.id) await showDesktopNotification({ ...message, content: (msgMentioned ? '@你 ' : '') + (message.content || ''), room_name: targetRoom?.name || '聊天室' });
      } catch { /* room may have become inaccessible */ }
    } else if (event.message_id) await pollNewMessages();
    return;
  }
  if (event.type === 'dm_message') {
    if (event.message?.p2p_transfer_id) {
      const entry = p2pActive.get(event.message.p2p_transfer_id);
    if (entry?.role === 'sender') { cleanupSenderEntry(entry); entry.settle({ ok: true }); }
    }
    if (conversation.value?.id === event.conversation_id) { appendDmUnique([event.message]); dmLastId = event.message.id || dmLastId; await nextTick(); messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: 'smooth' }); }
    if (event.message?.user_id !== user.value.id) { dmUnread.value[event.conversation_id] = (dmUnread.value[event.conversation_id] || 0) + 1; if (conversation.value?.id === event.conversation_id) markConversationRead(); }
    loadConversations();
    return;
  }
  if (event.type === 'p2p_invite') { p2pIncoming.value = { transfer: event.transfer, sender_username: event.sender_username }; return; }
  if (event.type === 'p2p_accepted') {
    const entry = p2pActive.get(event.transfer_id);
    if (!entry || entry.role !== 'sender' || entry.engine) return;
    setP2pProgress(entry.transferId, { status: 'connecting' });
entry.engine = createSender({ transferId: entry.transferId, file: entry.file, iceServers: p2pConfig?.ice_servers || [], sendSignal: data => sendP2pSignal(entry.transferId, entry.peerId, data), onProgress: ratio => setP2pProgress(entry.transferId, { ratio, status: 'transferring' }), onState: state => { if (state === 'sent') setP2pProgress(entry.transferId, { ratio: 1, status: 'sent' }); }, onError: reason => { setP2pProgress(entry.transferId, { status: 'failed', error: reason }); cleanupSenderEntry(entry); entry.settle({ ok: false, reason: reason || '连接失败' }); } });
    return;
  }
  if (event.type === 'p2p_rejected' || event.type === 'p2p_canceled') {
    const entry = p2pActive.get(event.transfer_id);
    if (entry?.role === 'sender') { setP2pProgress(entry.transferId, { status: 'failed', error: event.type === 'p2p_rejected' ? '对方拒绝了直传' : '对方取消了直传' }); cleanupSenderEntry(entry); entry.settle({ ok: false, reason: event.type === 'p2p_rejected' ? '对方拒绝了直传' : '对方取消了直传' }); }
    return;
  }
  if (event.type === 'p2p_signal') {
    const entry = p2pActive.get(event.transfer_id);
    if (!entry) return;
    ensureReceiverEngine(entry);
    entry.engine?.signal(event.data);
    return;
  }
  if (event.type === 'dm_message_update') { if (conversation.value?.id === event.conversation_id) await refreshDmMessage(event.message_id); return; }
  if (event.type === 'dm_read') { dmUnread.value[event.conversation_id] = 0; return; }
  if (event.type === 'friend_request' || event.type === 'friend_accept' || event.type === 'friend_remove') { loadFriends(); loadConversations(); return; }
  if (event.type === 'notification') { pushNotification(event.notification); return; }
  return;
}
async function refreshDmMessage(messageId) {
  try {
    const updated = (await api(`/api/dm/messages/${messageId}`)).message;
    const index = dmMessages.value.findIndex(message => message.id === messageId);
    if (index >= 0) dmMessages.value.splice(index, 1, updated);
  } catch { /* message may be inaccessible */ }
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
  try { const result = await api('/api/rooms'); rooms.value = result.rooms; if (!room.value && rooms.value.length) await choose(result.rooms[0]); else if (room.value) { const updated = rooms.value.find(item => item.id === room.value.id); if (updated) room.value = updated; } }
  catch { /* retry on the next timer */ }
  finally { roomsLoading = false; }
}
async function choose(item) {
  const generation = ++roomGeneration;
  activeMessageRequest?.abort();
  stopTyping(); room.value = item; conversation.value = null; clearUnread(item.id); messages.value = []; lastId = 0; oldestId = 0; hasOlderMessages.value = false; roomPins.value = [];
  await loadLatestMessages(generation);
  await loadRoomPins();
  scheduleMessagePoll();
  loadAtMembers(item.id);
}
async function loadAtMembers(roomId) {
  try { const result = await api(`/api/rooms/${roomId}/mentionables`); atRoomMembers.value = result.users.filter(m => m.id !== user.value.id); }
  catch { atRoomMembers.value = []; }
}
async function loadRoomPins() {
  if (!room.value) return;
  try { roomPins.value = (await api(`/api/rooms/${room.value.id}/pins`)).messages; } catch { roomPins.value = []; }
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
  if (!room.value || messagesLoading || view.value === 'dm') return false;
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
      const textMentioned = new RegExp(`(^|[^\\p{L}\\p{N}_-])@${user.value.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_-])`, 'u').test(message.content || '');
      const atMentioned = message.mentions?.some(m => m.id === user.value.id);
      const mentioned = textMentioned || atMentioned;
      if (!currentlyReading || mentioned) setUnread(message.room_id, (unread.value[message.room_id] || 0) + 1);
      if (mentioned) mentionedUnread.value[message.room_id] = true;
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
async function loadNotifCount() { try { notifUnreadCount.value = (await api('/api/notifications/unread-count')).count; } catch { /* ignore */ } }
async function loadNotifications() { try { const result = await api('/api/notifications'); notifications.value = result.notifications || []; notifUnreadCount.value = notifications.value.filter(n => !n.is_read).length; } catch { /* ignore */ } }
async function openNotifications() { notifOpen.value = !notifOpen.value; if (notifOpen.value) await loadNotifications(); }
async function markNotifRead(id) { try { await api(`/api/notifications/${id}/read`, { method: 'PUT' }); const target = notifications.value.find(n => n.id === id); if (target) target.is_read = 1; notifUnreadCount.value = Math.max(0, notifUnreadCount.value - 1); } catch { /* ignore */ } }
async function markAllNotifRead() { try { await api('/api/notifications/read-all', { method: 'POST' }); notifications.value = notifications.value.map(n => ({ ...n, is_read: 1 })); notifUnreadCount.value = 0; } catch { /* ignore */ } }
function pushNotification(notif) { notifications.value = [notif, ...notifications.value].slice(0, 50); if (!notif.is_read) notifUnreadCount.value += 1; }
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
async function handleAtInput(event, target = 'content') {
  const val = target === 'dm' ? dmInput.value : content.value;
  const ta = event.target;
  const pos = ta.selectionStart;
  let i = pos - 1;
  while (i >= 0 && val[i] !== '@' && val[i] !== ' ' && val[i] !== '\n') i--;
  if (i >= 0 && val[i] === '@') {
    const query = val.slice(i + 1, pos);
    atStartPos.value = i; atQuery.value = query; atTarget.value = target;
    const lower = query.toLowerCase();
    const results = atRoomMembers.value.filter(m => !query.length || m.username.toLowerCase().includes(lower) || String(m.id).includes(lower));
    atResults.value = results;
    atOpen.value = results.length > 0;
    return;
  }
  atOpen.value = false;
}
function selectAtMention(u) {
  const refName = atTarget.value === 'dm' ? 'dmInput' : 'content';
  const val = atTarget.value === 'dm' ? dmInput.value : content.value;
  const after = val.slice(atStartPos.value + atQuery.value.length + 1);
  if (atTarget.value === 'dm') dmInput.value = val.slice(0, atStartPos.value) + `[at:${u.id}] ` + after;
  else content.value = val.slice(0, atStartPos.value) + `[at:${u.id}] ` + after;
  atOpen.value = false; atResults.value = [];
}
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
async function loadMembers() { if (!room.value) return; try { roomMembers.value = (await api(`/api/rooms/${room.value.id}/members`)).members; await loadInviteCodes(); memberName.value = ''; memberRole.value = 'member'; membersOpen.value = true; } catch (e) { notify(e.message); } }
async function inviteMember() { if (!memberName.value.trim() || !room.value) return; try { await api(`/api/rooms/${room.value.id}/members`, { method: 'POST', body: JSON.stringify({ username: memberName.value.trim(), role: memberRole.value }) }); memberName.value = ''; await loadMembers(); notify('成员已邀请'); } catch (e) { notify(e.message); } }
async function removeMember(member) { if (!room.value) return; try { await api(`/api/rooms/${room.value.id}/members/${member.id}`, { method: 'DELETE' }); await loadMembers(); } catch (e) { notify(e.message); } }
function newRoom() { roomDraft.value = { name: '', is_private: !isAdmin.value }; createRoomOpen.value = true; }
async function createRoom() { if (!roomDraft.value.name.trim()) return; try { const result = await api('/api/rooms', { method: 'POST', body: JSON.stringify(roomDraft.value) }); createRoomOpen.value = false; await loadRooms(); await choose(result.room); } catch (e) { notify(e.message); } }
function openRoomManage() { roomNameDraft.value = room.value?.name || ''; roomManageOpen.value = true; }
async function saveRoom() { if (!room.value || !roomNameDraft.value.trim()) return; try { const result = await api(`/api/rooms/${room.value.id}`, { method: 'PUT', body: JSON.stringify({ name: roomNameDraft.value }) }); room.value = { ...room.value, ...result.room }; rooms.value = rooms.value.map(item => item.id === room.value.id ? room.value : item); roomManageOpen.value = false; notify('房间已更新'); } catch (e) { notify(e.message); } }
const announcementDraft = ref(''), announcementOpen = ref(false);
function openAnnouncement() { announcementDraft.value = room.value?.announcement || ''; announcementOpen.value = true; }
async function saveAnnouncement() { if (!room.value) return; try { await api(`/api/rooms/${room.value.id}/announcement`, { method: 'PUT', body: JSON.stringify({ content: announcementDraft.value }) }); room.value = { ...room.value, announcement: announcementDraft.value, announcement_by: user.value.id, announcement_username: user.value.username }; rooms.value = rooms.value.map(item => item.id === room.value.id ? room.value : item); announcementOpen.value = false; notify('公告已更新'); } catch (e) { notify(e.message); } }
async function deleteAnnouncement() { if (!room.value || !confirm('确定删除公告？')) return; try { await api(`/api/rooms/${room.value.id}/announcement`, { method: 'DELETE' }); room.value = { ...room.value, announcement: null, announcement_by: null, announcement_username: null }; rooms.value = rooms.value.map(item => item.id === room.value.id ? room.value : item); announcementOpen.value = false; notify('公告已删除'); } catch (e) { notify(e.message); } }
const inviteCodes = ref([]), inviteSearchQuery = ref(''), inviteSearchResults = ref([]);
async function loadInviteCodes() { if (!room.value) return; try { inviteCodes.value = (await api(`/api/rooms/${room.value.id}/invite-codes`)).codes; } catch { inviteCodes.value = []; } }
async function createInviteCode(maxUses, durationHours) { if (!room.value) return; try { await api(`/api/rooms/${room.value.id}/invite-codes`, { method: 'POST', body: JSON.stringify({ max_uses: maxUses, duration_hours: durationHours }) }); await loadInviteCodes(); notify('邀请码已创建'); } catch (e) { notify(e.message); } }
async function deleteInviteCode(codeId) { if (!room.value) return; try { await api(`/api/rooms/${room.value.id}/invite-codes/${codeId}`, { method: 'DELETE' }); await loadInviteCodes(); notify('邀请码已删除'); } catch (e) { notify(e.message); } }
function copyInviteLink(code) { const link = `${location.origin}/#/invite/${code}`; navigator.clipboard?.writeText(link); notify('邀请链接已复制'); }
async function searchUsers() { if (!inviteSearchQuery.value.trim()) { inviteSearchResults.value = []; return; } try { inviteSearchResults.value = (await api(`/api/users/search?q=${encodeURIComponent(inviteSearchQuery.value)}`)).users; } catch { inviteSearchResults.value = []; } }
async function inviteUser(username) { if (!room.value || !username) return; try { await api(`/api/rooms/${room.value.id}/members`, { method: 'POST', body: JSON.stringify({ username, role: 'member' }) }); inviteSearchQuery.value = ''; inviteSearchResults.value = []; await loadMembers(); notify(`已邀请 ${username}`); } catch (e) { notify(e.message); } }
async function deleteRoom() { if (!room.value || !confirm(`删除 #${room.value.name} 及全部消息？此操作不可恢复。`)) return; try { await api(`/api/rooms/${room.value.id}`, { method: 'DELETE' }); roomManageOpen.value = false; room.value = null; await loadRooms(); notify('房间已删除'); } catch (e) { notify(e.message); } }
const inviteCodeInput = ref(''), inviteCodeOpen = ref(false);
function openInviteCodePrompt() { inviteCodeInput.value = ''; inviteCodeOpen.value = true; }
async function joinByInviteCode() { if (!inviteCodeInput.value.trim()) return; try { const result = await api(`/api/invite/${inviteCodeInput.value.trim()}`, { method: 'POST' }); inviteCodeOpen.value = false; if (result.room) { const room = rooms.value.find(item => item.id === result.room.id) || result.room; await choose(room); } notify('已通过邀请码加入房间'); } catch (e) { notify(e.message); } }
async function loadAdmin() { try { admin.value = await api('/api/admin/overview'); } catch (e) { notify(e.message); } }
async function toggleAdmin(member) { try { await api(`/api/admin/users/${member.id}/admin`, { method: 'PUT', body: JSON.stringify({ is_admin: !member.is_admin }) }); await loadAdmin(); } catch (e) { notify(e.message); } }
async function banUser(member, hours = 24) { try { await api(`/api/admin/users/${member.id}/ban`, { method: 'PUT', body: JSON.stringify({ duration_hours: hours }) }); await loadAdmin(); notify(`已封禁 ${member.username} ${hours} 小时`); } catch (e) { notify(e.message); } }
async function unbanUser(member) { try { await api(`/api/admin/users/${member.id}/unban`, { method: 'PUT' }); await loadAdmin(); notify(`已解封 ${member.username}`); } catch (e) { notify(e.message); } }
async function muteUser(member, hours = 1) { try { await api(`/api/admin/users/${member.id}/mute`, { method: 'PUT', body: JSON.stringify({ duration_hours: hours }) }); await loadAdmin(); notify(`已禁言 ${member.username} ${hours} 小时`); } catch (e) { notify(e.message); } }
async function unmuteUser(member) { try { await api(`/api/admin/users/${member.id}/unmute`, { method: 'PUT' }); await loadAdmin(); notify(`已解除 ${member.username} 的禁言`); } catch (e) { notify(e.message); } }
async function loadBannedIps() { try { bannedIps.value = (await api('/api/admin/banned-ips')).ips; } catch (e) { notify(e.message); } }
async function adminBanIp() { if (!banIpInput.value.trim()) return; try { await api('/api/admin/banned-ips/ban', { method: 'PUT', body: JSON.stringify({ ip: banIpInput.value.trim(), duration_hours: banIpDuration.value }) }); banIpInput.value = ''; await loadBannedIps(); notify('IP 已封禁'); } catch (e) { notify(e.message); } }
async function adminUnbanIp(ip) { try { await api('/api/admin/banned-ips/unban', { method: 'PUT', body: JSON.stringify({ ip }) }); await loadBannedIps(); notify('IP 已解封'); } catch (e) { notify(e.message); } }
async function banUserIp(member) { let ip = member.last_ip; if (!ip) { ip = prompt('该用户没有记录 IP，请手动输入 IP 地址：'); if (!ip) return; } const hours = prompt('封禁小时数（留空为永久）：'); const duration = hours ? Number(hours) : null; try { await api('/api/admin/banned-ips/ban', { method: 'PUT', body: JSON.stringify({ ip, duration_hours: duration, reason: `用户 ${member.username} 的 IP` }) }); await loadBannedIps(); notify(`已封禁 ${member.username} 的 IP ${ip}`); } catch (e) { notify(e.message); } }
async function banUserDevice(member) { if (!member.device_fingerprint) return; const hours = prompt('封禁小时数（留空为永久）：'); const duration = hours ? Number(hours) : null; try { await api('/api/admin/banned-fingerprints/ban', { method: 'PUT', body: JSON.stringify({ fingerprint: member.device_fingerprint, duration_hours: duration, reason: `用户 ${member.username} 的设备` }) }); await loadBannedFingerprints(); notify(`已封禁 ${member.username} 的设备`); } catch (e) { notify(e.message); } }
async function loadBannedFingerprints() { try { bannedFingerprints.value = (await api('/api/admin/banned-fingerprints')).fingerprints; } catch (e) { notify(e.message); } }
async function adminBanFingerprint() { if (!banFpInput.value.trim()) return; try { await api('/api/admin/banned-fingerprints/ban', { method: 'PUT', body: JSON.stringify({ fingerprint: banFpInput.value.trim(), duration_hours: banFpDuration.value }) }); banFpInput.value = ''; await loadBannedFingerprints(); notify('设备已封禁'); } catch (e) { notify(e.message); } }
async function adminUnbanFingerprint(fp) { try { await api('/api/admin/banned-fingerprints/unban', { method: 'PUT', body: JSON.stringify({ fingerprint: fp }) }); await loadBannedFingerprints(); notify('设备已解封'); } catch (e) { notify(e.message); } }
const adminTab = ref('users');
const botRequests = ref([]);
const botRequestDraft = ref({ name: '', reason: '' });
async function loadBotRequests() { try { botRequests.value = (await api('/api/admin/bot-requests')).requests; } catch (e) { notify(e.message); } }
async function loadBotTokens() { try { botTokens.value = (await api('/api/admin/bot/tokens')).tokens || []; } catch (e) { notify(e.message); } }
async function reviewBotRequest(id, status) { try { await api(`/api/admin/bot-requests/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }); await Promise.all([loadBotRequests(), loadBotTokens()]); notify(status === 'approved' ? '已通过机器人申请' : '已拒绝机器人申请'); } catch (e) { notify(e.message); } }
async function submitBotRequest() { if (!botRequestDraft.value.name.trim()) return; try { await api('/api/bot-requests', { method: 'POST', body: JSON.stringify({ name: botRequestDraft.value.name.trim(), reason: botRequestDraft.value.reason.trim() }) }); botRequestDraft.value = { name: '', reason: '' }; notify('机器人申请已提交，等待管理员审批'); } catch (e) { notify(e.message); } }
async function revokeBotToken(token) { if (!confirm('撤销后机器人会立即断开，确定继续？')) return; try { await api(`/api/admin/bot/tokens/${encodeURIComponent(token)}`, { method: 'DELETE' }); await loadBotTokens(); notify('Bot Token 已撤销'); } catch (e) { notify(e.message); } }
async function logout() { await api('/api/logout', { method: 'POST' }); shutdownRealtime(); location.reload(); }
async function exportData() { try { const response = await fetch('/api/me/export'); if (!response.ok) throw new Error('导出失败'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `polychat-export-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url); notify('聊天记录已导出'); } catch (e) { notify(e.message); } }
async function deleteAccount() { const password = prompt('请输入密码以确认删除账号：'); if (!password) return; if (!confirm('确定要删除账号吗？此操作不可恢复，所有消息和文件将被永久删除。')) return; try { await api('/api/me', { method: 'DELETE', body: JSON.stringify({ password }) }); notify('账号已删除'); shutdownRealtime(); location.reload(); } catch (e) { notify(e.message); } }
async function loadFriends() { try { friendList.value = await api('/api/friends'); } catch { /* ignore */ } }
async function openFriends() { friendsOpen.value = true; dmTypeahead.value = ''; friendSearchResults.value = []; await loadFriends(); }
async function searchFriends() { if (!friendSearchQuery.value.trim()) { friendSearchResults.value = []; return; } try { friendSearchResults.value = (await api(`/api/users/search?q=${encodeURIComponent(friendSearchQuery.value)}`)).users; } catch { friendSearchResults.value = []; } }
async function sendFriendRequest(username) { if (!username) return; try { await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ username }) }); friendSearchQuery.value = ''; friendSearchResults.value = []; await loadFriends(); notify(`已向 ${username} 发送好友请求`); } catch (e) { notify(e.message); } }
async function acceptFriend(userId) { try { await api(`/api/friends/${userId}/accept`, { method: 'POST' }); await loadFriends(); notify('已接受好友请求'); } catch (e) { notify(e.message); } }
async function declineFriend(userId) { try { await api(`/api/friends/${userId}/decline`, { method: 'POST' }); await loadFriends(); } catch (e) { notify(e.message); } }
async function removeFriend(userId) { try { await api(`/api/friends/${userId}`, { method: 'DELETE' }); await loadFriends(); await loadConversations(); } catch (e) { notify(e.message); } }
async function loadConversations() { try { const result = await api('/api/dm/conversations'); conversations.value = result.conversations; dmUnread.value = {}; for (const conv of conversations.value) if (conv.unread) dmUnread.value[conv.id] = conv.unread; } catch { /* ignore */ } }
async function openDm(peer) { try { const result = await api('/api/dm/conversations', { method: 'POST', body: JSON.stringify({ username: peer.username }) }); await loadConversations(); await selectConversation(result.conversation); } catch (e) { notify(e.message); } }
async function selectConversation(conv) { conversation.value = conv; dmMessages.value = []; dmLastId = 0; dmOldestId = 0; dmReplyTarget.value = null; dmInput.value = ''; view.value = 'dm'; room.value = null; roomPins.value = []; friendsOpen.value = false; try { const result = await api(`/api/dm/conversations/${conv.id}/messages?before=9007199254740991&limit=60`); dmMessages.value = result.messages; dmLastId = dmMessages.value.at(-1)?.id || 0; dmOldestId = dmMessages.value[0]?.id || 0; await nextTick(); messageList.value?.scrollTo({ top: messageList.value.scrollHeight }); } catch (e) { notify(e.message); } await markConversationRead(); }
function addDmFiles(fileList) { if (!fileList?.length) return; dmFiles.value = [...dmFiles.value, ...Array.from(fileList).map(file => ({ file, status: 'ready', error: '' }))]; }
function removeDmFile(index) { dmFiles.value.splice(index, 1); }
async function markConversationRead() { if (!conversation.value) return; const last = dmLastId || (dmMessages.value.at(-1)?.id || 0); if (!last) return; try { await api(`/api/dm/conversations/${conversation.value.id}/read`, { method: 'POST', body: JSON.stringify({ message_id: last }) }); dmUnread.value[conversation.value.id] = 0; } catch { /* ignore */ } }
// ---------- P2P 大文件直传（WebRTC 打洞 + 服务器信令，失败自动回退分片上传） ----------
async function loadP2pConfig() { try { p2pConfig = await api('/api/p2p/config'); } catch { p2pConfig = null; } }
function setP2pProgress(transferId, patch) { p2pProgress.value = { ...p2pProgress.value, [transferId]: { ...(p2pProgress.value[transferId] || {}), ...patch } }; }
function removeP2pProgress(transferId) { const copy = { ...p2pProgress.value }; delete copy[transferId]; p2pProgress.value = copy; }
function sendP2pSignal(transferId, toUserId, data) { sendSocket({ type: 'p2p_signal', transfer_id: transferId, to_user_id: toUserId, data }); }
function p2pStatusText(p) {
  if (p.status === 'waiting') return p.direction === 'send' ? '等待对方接受…' : '等待连接…';
if (p.status === 'uploading') return `服务器分片上传 ${Math.round((p.ratio || 0) * 100)}%`; if (p.status === 'uploaded') return '服务器上传完成'; if (p.status === 'connecting') return '正在打洞连接…';
  if (p.status === 'transferring') return `传输中 ${Math.round(p.ratio * 100)}%`;
  if (p.status === 'received') return '已接收并保存到本机';
  if (p.status === 'sent') return '直传完成';
  if (p.status === 'failed') return `直传失败${p.error ? `：${p.error}` : ''}`;
  return p.status;
}
async function uploadFileChunked(file, progressId) { const id = progressId || `upload-${Date.now()}-${Math.random()}`; setP2pProgress(id, { name: file.name, size: file.size, direction: 'send', ratio: 0, status: 'uploading' });
  const init = await api('/api/uploads', { method: 'POST', body: JSON.stringify({ name: file.name, type: file.type || 'application/octet-stream', size: file.size }) });
  const upload = init.upload;
  let offset = 0;
  while (offset < file.size) {
    const part = file.slice(offset, Math.min(offset + upload.chunk_size, file.size));
    const data = await fileData(part);
    const result = await api(`/api/uploads/${upload.id}/chunks`, { method: 'PUT', body: JSON.stringify({ offset, data }) });
    offset += part.size;
    setP2pProgress(id, { ratio: offset / file.size, status: 'uploading' });
    if (result.completed) { setP2pProgress(id, { ratio: 1, status: 'uploaded' }); setTimeout(() => removeP2pProgress(id), 2500); return result; }
  }
  throw new Error('文件上传失败');
}
function cleanupSenderEntry(entry) {
  clearTimeout(entry.fallbackTimeout);
  if (entry.engine) { try { entry.engine.cancel(); } catch { /* already closed */ } }
  removeP2pProgress(entry.transferId);
  p2pActive.delete(entry.transferId);
}
function tryP2pSend(conv, file, content, replyTo) {
  return new Promise(resolve => {
    let settled = false;
    const settle = value => { if (settled) return; settled = true; resolve(value); };
    api('/api/p2p/transfers', { method: 'POST', body: JSON.stringify({ conversation_id: conv.id, name: file.name, type: file.type || 'application/octet-stream', size: file.size, content, reply_to: replyTo }) })
      .then(created => {
        const transferId = created.transfer.id;
        if (!created.transfer.peer_online) {
          settle({ ok: false, reason: '对方当前离线', transferId });
          return;
        }
        const entry = { role: 'sender', transferId, file, peerId: conv.peer?.id, engine: null, settle, fallbackTimeout: null };
        p2pActive.set(transferId, entry);
        setP2pProgress(transferId, { name: file.name, size: file.size, direction: 'send', ratio: 0, status: 'waiting' });
        entry.fallbackTimeout = setTimeout(() => {
          setP2pProgress(transferId, { status: 'failed', error: '对方未响应' });
          cleanupSenderEntry(entry);
          settle({ ok: false, reason: '对方未响应', transferId });
        }, 60_000);
      })
      .catch(() => settle({ ok: false, reason: '无法创建直传' }));
  });
}
async function acceptP2p() {
  const invite = p2pIncoming.value;
  if (!invite) return;
  p2pIncoming.value = null;
  const transfer = invite.transfer;
  p2pActive.set(transfer.id, { role: 'receiver', transferId: transfer.id, peerId: transfer.sender_id, engine: null });
  setP2pProgress(transfer.id, { name: transfer.name, size: transfer.size, direction: 'recv', ratio: 0, status: 'waiting' });
  try { await api(`/api/p2p/transfers/${transfer.id}/accept`, { method: 'POST' }); }
  catch (e) { p2pActive.delete(transfer.id); removeP2pProgress(transfer.id); notify(e.message); }
}
async function rejectP2p() {
  const invite = p2pIncoming.value;
  if (!invite) return;
  p2pIncoming.value = null;
  try { await api(`/api/p2p/transfers/${invite.transfer.id}/reject`, { method: 'POST' }); } catch { /* ignore */ }
}
function ensureReceiverEngine(entry) {
  if (entry.role !== 'receiver' || entry.engine) return;
  entry.engine = createReceiver({
    transferId: entry.transferId,
    iceServers: p2pConfig?.ice_servers || [],
    sendSignal: data => sendP2pSignal(entry.transferId, entry.peerId, data),
    onProgress: ratio => setP2pProgress(entry.transferId, { ratio, status: 'transferring' }),
    onState: () => {},
    onComplete: ({ sha256 }) => { void finalizeReceiver(entry, sha256); },
    onError: reason => { setP2pProgress(entry.transferId, { status: 'failed', error: reason }); p2pActive.delete(entry.transferId); notify(`直传失败：${reason}`); },
  });
}
async function finalizeReceiver(entry, sha256) {
  setP2pProgress(entry.transferId, { status: 'received', ratio: 1 });
  try { await api(`/api/p2p/transfers/${entry.transferId}/complete`, { method: 'POST', body: JSON.stringify({ sha256 }) }); }
  catch (e) {
    setP2pProgress(entry.transferId, { status: 'failed', error: e.message });
    await api(`/api/p2p/transfers/${entry.transferId}/fail`, { method: 'POST' }).catch(() => {});
  }
  finally { p2pActive.delete(entry.transferId); }
}
async function downloadP2p(message) {
  try {
    const stored = await p2pGetFile(message.p2p_transfer_id);
    if (!stored) { notify('本机没有该文件的副本'); return; }
    downloadBlob(stored.blob, stored.meta?.name || message.p2p_name || 'p2p-file');
  } catch (e) { notify(e.message); }
}
async function deleteLocalP2p(message) {
  if (!confirm('删除本机保存的 P2P 文件副本？')) return;
  try { await p2pDeleteFile(message.p2p_transfer_id); p2pLocalIds.value.delete(message.p2p_transfer_id); notify('已删除本机副本'); }
  catch (e) { notify(e.message); }
}
function cancelP2pAll() { for (const entry of p2pActive.values()) { try { entry.engine?.cancel(); } catch { /* ignore */ } } p2pActive.clear(); p2pProgress.value = {}; p2pIncoming.value = null; }
async function sendDm() {
  if (!conversation.value || dmSending.value || (!dmInput.value.trim() && !dmFiles.value.length)) return;
  const conv = conversation.value;
  const text = dmInput.value.trim();
  const replyTo = dmReplyTarget.value?.id || null;
  const ready = dmFiles.value.filter(entry => entry.status !== 'failed');
  if (!text && ready.length === 0) return;
  dmSending.value = true;
  let failed = false;
  let sentCount = 0;
  try {
    if (ready.length === 0) {
      const result = await api(`/api/dm/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ content: text, reply_to: replyTo }) });
      dmMessages.value = appendUnique(dmMessages.value, [result.message]);
      dmLastId = result.message.id;
      dmInput.value = '';
      dmReplyTarget.value = null;
    } else {
      for (let i = 0; i < ready.length; i++) {
        const entry = ready[i];
        const msgContent = i === 0 && text ? text : '';
        const msgReplyTo = i === 0 ? replyTo : null;
        entry.status = 'uploading';
        entry.error = '';
        try {
          const p2pEligible = p2pConfig && entry.file.size >= p2pConfig.min_size && onlineIds.value.has(conv.peer?.id);
          const p2pResult = p2pEligible ? await tryP2pSend(conv, entry.file, msgContent, msgReplyTo) : null;
          if (p2pResult?.ok) {
            entry.status = 'sent';
          } else {
            if (p2pResult && !p2pResult.ok) notify(`P2P 直传失败：${p2pResult.reason || '未知原因'}，已切换为服务器分片上传`);
            const uploaded = await uploadFileChunked(entry.file, p2pResult?.transferId);
            const result = await api(`/api/dm/conversations/${conv.id}/messages`, { method: 'POST', body: JSON.stringify({ content: msgContent, attachment_id: uploaded.file.id, reply_to: msgReplyTo }) });
            dmMessages.value = appendUnique(dmMessages.value, [result.message]);
            dmLastId = result.message.id;
            entry.status = 'sent';
          }
          sentCount += 1;
        } catch (e) {
          entry.status = 'failed';
          entry.error = e.message || '上传失败';
          failed = true;
        }
      }
      dmFiles.value = dmFiles.value.filter(entry => entry.status !== 'sent');
      if (!failed || sentCount > 0) {
        dmInput.value = '';
        dmReplyTarget.value = null;
      }
    }
    await nextTick();
    messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: 'smooth' });
    await loadConversations();
  } catch (e) {
    notify(e.message);
  } finally {
    dmSending.value = false;
  }
}
function selectRooms() { view.value = 'rooms'; conversation.value = null; }
async function selectDmView() { await loadConversations(); if (conversations.value.length) await selectConversation(conversations.value[0]); else { view.value = 'rooms'; openFriends(); } }
function dmAvatar(member) { return member?.avatar_url || (member?.avatar_updated_at ? `/api/users/${member.user_id ?? member.id}/avatar?v=${member.avatar_updated_at}` : ''); }
function startDmReply(message) { dmReplyTarget.value = message; }
async function retractDm(message) { if (!confirm('确定撤回这条私信吗？')) return; try { await api(`/api/dm/messages/${message.id}`, { method: 'DELETE' }); message.content = ''; message.attachment_id = null; message.deleted_at = new Date().toISOString(); notify('消息已撤回'); } catch (e) { notify(e.message); } }
async function toggleDmReaction(message, emoji) { try { const result = await api(`/api/dm/messages/${message.id}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) }); message.reactions = result.reactions; } catch (e) { notify(e.message); } }
function appendDmUnique(incoming) { const known = new Set(dmMessages.value.map(message => message.id)); const fresh = incoming.filter(message => !known.has(message.id)); if (fresh.length) dmMessages.value = [...dmMessages.value, ...fresh]; }
function backToMobileHome() { room.value = null; conversation.value = null; view.value = 'rooms'; roomActionsOpen.value = false; }
function switchMobileTab(tab) { backToMobileHome(); mobileTab.value = tab; }
// ---------- 功能指南与首次使用引导 ----------
const featureActions = {
  newRoom: () => newRoom(),
  friends: () => openFriends(),
  dm: () => selectDmView(),
  theme: () => { themeOpen.value = true; },
  profile: () => { profileOpen.value = true; },
  export: () => exportData(),
};
function runFeatureAction(key) { if (!featureActions[key]) return; helpOpen.value = false; featureActions[key](); }
function getTourSteps() {
  if (isMobile.value) return [
    { selector: null, title: '欢迎使用 PolyChat 📱', desc: '手机版同样支持聊天、私信与全部功能。我们快速带你熟悉一下界面。' },
    { selector: '.m-tabbar', title: '底部导航', desc: '三个标签页：💬 聊天列表、👥 联系人与好友、👤 我的（设置与数据）。' },
    { selector: '.m-new', title: '新建聊天室', desc: '点击右上角 ＋ 创建公开或私有聊天室。' },
    { selector: null, title: '消息支持 Markdown 与公式', desc: '输入 **加粗**、`代码`、行内 $E=mc^2$ 或 $$ 块级公式 $$，还支持 @提及、emoji 表情与拖拽/粘贴图片。' },
    { selector: null, title: '消息与房间操作', desc: '点消息旁 ••• 可回复、打开话题、编辑、撤回；聊天页顶部 ••• 管理房间、成员与公告。' },
    { selector: null, title: '好友与私信', desc: '联系人页搜索加好友、接受请求；好友间可私信，大文件支持 P2P 直传，不经过服务器。' },
    { selector: null, title: '全部功能在这里', desc: '随时到「我的 → 功能指南」查看完整功能列表，或重新观看引导。开始聊天吧！' },
  ];
  return [
    { selector: null, title: '欢迎使用 PolyChat 👋', desc: '一个支持 Markdown、LaTeX 公式、私信与大文件直传的聊天室。我们快速带你熟悉界面。' },
    { selector: '.chat > aside .new', title: '新建聊天室', desc: '点击「新建聊天室」创建公开房间；勾选「私有」则创建仅受邀成员可见的房间。' },
    { selector: '.chat > aside nav', title: '房间与私信列表', desc: '左侧列出聊天室与私信会话，未读消息显示红色数字角标，被 @ 提及显示红色 @。' },
    { selector: '.topbar-actions', title: '顶栏工具栏', desc: '好友、私信、置顶、加入、搜索、公告、主题、通知与管理员面板都在这里。' },
    { selector: '.composer .compose-row', title: '输入消息', desc: '支持 Markdown、LaTeX 公式、emoji、@提及，还可粘贴截图、拖拽文件、多文件同时发送。' },
    { selector: '.bubble .message-menu-trigger', title: '消息操作', desc: '悬停消息点 ••• 可回复、打开话题、置顶、复制 Markdown、编辑或撤回；气泡下方 ☺ 可添加表情反应。' },
    { selector: '.topbar-actions .toolbar-button[title="帮助"]', title: '全部功能指南', desc: '点击顶栏 ? 随时查看完整功能列表与操作提示，也可以重新观看这段引导。' },
  ];
}
const tourHighlightStyle = computed(() => {
  const box = tourHighlight.value;
  return box ? { left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' } : {};
});
function positionTour() {
  const step = getTourSteps()[tourStep.value];
  if (!step) { tourHighlight.value = null; tourHasTarget.value = false; tourTipAtTop.value = false; return; }
  if (!step.selector) { tourHighlight.value = null; tourHasTarget.value = false; tourTipAtTop.value = false; return; }
  const el = document.querySelector(step.selector);
  if (!el) { tourHighlight.value = null; tourHasTarget.value = false; return; }
  el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  const rect = el.getBoundingClientRect();
  const pad = 6;
  tourHighlight.value = { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  tourHasTarget.value = true;
  // 移动端：高亮目标位于屏幕下半部时，把提示卡移到顶部，避免盖住目标
  tourTipAtTop.value = isMobile.value && rect.top >= window.innerHeight * 0.45;
}
function onTourScroll() { if (tourOpen.value) positionTour(); }
function startTour() { if (isMobile.value) backToMobileHome(); tourStep.value = 0; tourOpen.value = true; document.addEventListener('scroll', onTourScroll, true); nextTick(() => positionTour()); }
function endTour() { tourOpen.value = false; tourHighlight.value = null; document.removeEventListener('scroll', onTourScroll, true); localStorage.setItem(TOUR_DONE_KEY, '1'); }
function skipTour() { endTour(); }
function tourNext() { if (tourStep.value >= getTourSteps().length - 1) return endTour(); tourStep.value += 1; nextTick(() => positionTour()); }
function tourPrev() { if (tourStep.value <= 0) return; tourStep.value -= 1; nextTick(() => positionTour()); }
onMounted(async () => {
  deviceFingerprint.value = generateFingerprint();
  renderThemeCss();
  document.addEventListener('visibilitychange', handleVisibility);
  isMobile.value = window.innerWidth <= 768;
  window.addEventListener('resize', () => { isMobile.value = window.innerWidth <= 768; if (!isMobile.value) sidebarOpen.value = false; if (tourOpen.value) positionTour(); });
  try { user.value = (await api('/api/me')).user; await enter(); } catch {}
  loadP2pConfig();
  p2pListFiles().then(files => { for (const f of files) p2pLocalIds.value.add(f.id); }).catch(() => {});
  if (user.value && !localStorage.getItem(TOUR_DONE_KEY)) setTimeout(() => { if (user.value && !localStorage.getItem(TOUR_DONE_KEY)) startTour(); }, 900);
});
onBeforeUnmount(() => { shutdownRealtime(); document.removeEventListener('visibilitychange', handleVisibility); document.removeEventListener('scroll', onTourScroll, true); });
</script>

<template>
  <main v-if="!user" class="auth"><section><img :src="icon"><p>MARKDOWN · LATEX · EVERYWHERE</p><h1>欢迎来到 PolyChat</h1><div class="tabs"><button :class="{active: mode === 'login'}" @click="mode = 'login'">登录</button><button :class="{active: mode === 'register'}" @click="mode = 'register'">注册</button></div><form @submit.prevent="authenticate"><input v-model="credentials.username" placeholder="用户名" required><input v-model="credentials.password" type="password" placeholder="密码" required><small>{{ error }}</small><button> {{ mode === 'login' ? '登录' : '创建账号' }} </button></form></section></main>
  <main v-else-if="!isMobile" class="chat">
    <div v-if="isMobile && sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false"></div>
    <aside :class="{open: sidebarOpen}"><header class="brand"><img :src="icon"><span>PolyChat<small>让交流保持简单</small></span></header><button class="new" @click="newRoom"><span>＋</span> 新建聊天室</button><p class="nav-label">聊天室</p><nav><button v-for="item in rooms" :key="item.id" :class="{active: view === 'rooms' && room?.id === item.id, hasUnread: unread[item.id], mentioned: mentionedUnread[item.id]}" @click="view = 'rooms'; choose(item); closeSidebar()"><span>#</span><b>{{ item.name }}</b><small v-if="mentionedUnread[item.id]" class="unread" style="background:#dc2626">@</small><small v-else-if="unread[item.id]" class="unread">{{ unread[item.id] > 99 ? '99+' : unread[item.id] }}</small></button></nav>
        <p class="nav-label">私信<button class="nav-add" title="好友与私信" @click="openFriends">＋</button></p>
        <nav><button v-for="conv in conversations" :key="conv.id" :class="{active: view === 'dm' && conversation?.id === conv.id, hasUnread: dmUnread[conv.id]}" @click="selectConversation(conv); closeSidebar()"><span>✉</span><b>{{ conv.peer?.username || '私信' }}</b><small v-if="dmUnread[conv.id]" class="unread">{{ dmUnread[conv.id] > 99 ? '99+' : dmUnread[conv.id] }}</small></button></nav>
        <footer><button class="profile-button" title="更换头像" @click="profileOpen = true"><img v-if="avatar(user)" :src="avatar(user)"><b v-else>{{ user.username[0] }}</b></button><span>{{ user.username }}<small class="user-number">#{{ user.number || user.id }}</small><small>{{ isAdmin ? '管理员 · 在线' : '在线' }}</small></span><button class="logout" title="退出登录" @click="logout">↪</button></footer></aside>
    <section class="conversation">
      <header class="topbar">
        <button v-if="isMobile" class="toolbar-button mobile-menu-btn" @click="toggleSidebar">☰</button>
        <div v-if="view === 'dm' && conversation"><button class="toolbar-button" @click="selectRooms">← 返回</button><h2><span>✉</span> {{ conversation.peer?.username }} <small>私信</small></h2></div>
        <div v-else><h2><span>#</span> {{ room?.name || '大厅' }} <small v-if="room?.is_private">🔒 私有</small></h2><small><i class="online-dot"></i>{{ onlineUsers.length }} 人在线<span v-if="typingText"> · {{ typingText }}</span></small></div>
        <div class="topbar-actions">
          <button class="toolbar-button" title="好友与私信" @click="openFriends"><span>👥</span><em>好友</em><small v-if="totalDmUnread || friendList.incoming.length" class="unread">{{ (totalDmUnread + friendList.incoming.length) > 99 ? '99+' : (totalDmUnread + friendList.incoming.length) }}</small></button>
          <button class="toolbar-button" title="私信" @click="selectDmView()" v-if="view !== 'dm'"><span>✉</span><em>私信</em><small v-if="totalDmUnread" class="unread">{{ totalDmUnread > 99 ? '99+' : totalDmUnread }}</small></button>
          <button class="toolbar-button" title="置顶消息" @click="loadPins">⌖ <em>置顶</em></button>
          <button class="toolbar-button" title="通过邀请码加入" @click="openInviteCodePrompt">🔗 <em>加入</em></button>
          <button class="toolbar-button" title="搜索消息" @click="searchOpen = true">⌕ <em>搜索</em></button>
          <button v-if="room?.is_private && (room?.role === 'owner' || room?.role === 'admin' || isAdmin)" class="toolbar-button" title="成员管理" @click="loadMembers">♙ <em>成员</em></button>
          <button v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" class="toolbar-button" title="房间公告" @click="openAnnouncement">📢 <em>公告</em></button>
          <button v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" class="toolbar-button" title="房间设置" @click="openRoomManage">⚙ <em>房间</em></button>
          <button class="toolbar-button" title="主题与自定义 CSS" @click="themeOpen = true"><span>◐</span><em>主题</em></button>
          <button v-if="isAdmin" class="toolbar-button" title="管理面板" @click="adminOpen = true; loadAdmin(); loadBannedIps(); loadBannedFingerprints(); loadBotRequests(); loadBotTokens(); adminTab = 'users'">管理面板</button>
          <button class="toolbar-button notification" :class="{on: notificationOn, blocked: notificationPermission === 'denied'}" :title="notificationLabel" @click="toggleNotifications"><span>{{ notificationOn ? '🔔' : '🔕' }}</span><em>{{ notificationButtonText }}</em></button>
          <button class="toolbar-button notif-bell" :class="{active: notifOpen}" title="通知" @click="openNotifications"><span>🔔</span><small v-if="notifUnreadCount" class="unread">{{ notifUnreadCount > 99 ? '99+' : notifUnreadCount }}</small></button>
          <button class="toolbar-button" title="帮助" @click="helpOpen = true"><span>?</span><em>帮助</em></button>
        </div>
      </header>
      <div v-if="globalAnnouncement" class="global-announcement-bar"><span class="pinned-icon">🔊</span><div class="global-announcement-body"><div class="global-announcement-meta"><b>系统公告</b><small>by {{ globalAnnouncement.admin_name }}</small></div><div class="markdown" v-html="markdown(globalAnnouncement.content)"></div></div><button class="global-announcement-close" title="关闭" @click="globalAnnouncement = null">×</button></div>
      <div class="pinned-area" :class="{hidden: view === 'dm' || (!room?.announcement && !roomPins.length)}">
        <div v-if="room?.announcement" class="announcement-bar"><div class="announcement-bar-header" @click="announcementExpanded = !announcementExpanded"><span class="pinned-icon">📢</span><span>公告</span><small>by {{ room.announcement_username }}</small><span class="pinned-toggle">{{ announcementExpanded ? '收起' : '展开' }}</span><div v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" class="announcement-bar-actions" @click.stop><button @click="openAnnouncement">编辑</button><button @click="deleteAnnouncement">删除</button></div></div><div v-if="announcementExpanded" class="announcement-bar-content markdown" v-html="markdown(room.announcement)"></div></div>
        <div v-if="roomPins.length" class="pinned-bar"><div class="pinned-bar-header" @click="pinsExpanded = !pinsExpanded"><span class="pinned-icon">📌</span><span>置顶消息 ({{ roomPins.length }})</span><span class="pinned-toggle">{{ pinsExpanded ? '收起' : '展开' }}</span></div><div v-if="pinsExpanded" class="pinned-bar-list"><article v-for="pin in roomPins" :key="pin.id" class="pinned-bar-item"><div class="pinned-bar-meta"><strong>{{ pin.username }}</strong><small>{{ time(pin.created_at) }}</small><button v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" class="pinned-unpin" @click="unpinMessage(pin)">取消置顶</button></div><div v-if="pin.content" class="markdown" v-html="markdown(pin.content)"></div></article></div></div>
      </div>
      <div ref="messageList" class="messages-scroll" @scroll.passive="maybeLoadOlderMessages">
        <template v-if="view === 'dm' && conversation">
          <div v-if="!dmMessages.length" class="empty"><img :src="icon"><h3>与 {{ conversation.peer?.username }} 的私信</h3><p>只有互为好友才能私信，消息仅双方可见。</p></div>
          <article v-for="message in dmMessages" :key="message.id"><div class="avatar"><img v-if="dmAvatar(message)" :src="dmAvatar(message)"><b v-else>{{ message.username[0] }}</b></div><div class="bubble"><header><strong>{{ message.username }}<small class="user-number">#{{ message.user_id }}</small><i v-if="onlineIds.has(message.user_id)" class="online-dot" title="在线"></i></strong><small>{{ time(message.created_at) }}{{ message.edited_at ? ' · 已编辑' : '' }}</small><button class="message-menu-trigger" @click="openMessageActions = openMessageActions === message.id ? null : message.id">•••</button><div v-if="openMessageActions === message.id" class="message-menu"><button @click="startDmReply(message); openMessageActions = null">回复</button><button @click="copy(message); openMessageActions = null">复制 Markdown</button><button v-if="message.user_id === user.id && !message.deleted_at" @click="beginEdit(message); openMessageActions = null">编辑</button><button v-if="message.user_id === user.id || isAdmin" class="danger" @click="retractDm(message); openMessageActions = null">撤回</button></div></header><blockquote v-if="message.reply_to" class="reply-reference">回复 {{ message.reply_username || '消息' }}：{{ message.reply_content || '已撤回的消息' }}</blockquote><p v-if="message.deleted_at" class="retracted">此消息已撤回</p><div v-else-if="message.content" class="markdown" @click="previewMarkdownImage" v-html="markdown(message.content, message.mentions)"></div><template v-if="message.attachment_id"><img v-if="imageTypes.has(message.attachment_type)" class="attachment-image previewable" :src="`/api/files/${message.attachment_id}?inline=1`" :alt="message.attachment_name" @click="previewImage(`/api/files/${message.attachment_id}?inline=1`)"><a v-else class="attachment-file" :href="`/api/files/${message.attachment_id}`" :download="message.attachment_name">{{ message.attachment_name }}</a></template><template v-if="message.p2p_transfer_id && !message.deleted_at"><div class="p2p-card"><span>📦</span><div><b>{{ message.p2p_name }}</b><small>{{ size(message.p2p_size) }} · P2P 直传</small><div class="p2p-card-actions"><template v-if="p2pLocalIds.has(message.p2p_transfer_id)"><button @click="downloadP2p(message)">下载</button><button class="danger" @click="deleteLocalP2p(message)">删除本机副本</button></template><small v-else-if="message.p2p_sender_id === user.id">已通过 P2P 直传</small><small v-else class="p2p-note">文件仅到达接收设备</small></div></div></div></template><div class="reactions" v-if="message.reactions && message.reactions.length"><button v-for="reaction in message.reactions" :key="reaction.emoji" @click="toggleDmReaction(message, reaction.emoji)">{{ reaction.emoji }} {{ reaction.count }}</button></div></div></article>
        </template>
        <template v-else>
        <p v-if="loadingOlderMessages" class="history-loading">正在加载更早消息…</p><p v-else-if="hasOlderMessages" class="history-hint">向上滚动加载更早消息</p><div v-if="!messages.length" class="empty"><img :src="icon"><h3>开始一段新对话</h3><p>发送 Markdown、公式、图片或文件。</p></div>
        <article v-for="message in messages" :key="message.id"><div class="avatar"><img v-if="avatar(message)" :src="avatar(message)"><b v-else>{{ message.username[0] }}</b></div><div class="bubble"><header><strong>{{ message.username }}<small class="user-number">#{{ message.user_id }}</small><i v-if="onlineIds.has(message.user_id)" class="online-dot" title="在线"></i></strong><small>{{ time(message.created_at) }}{{ message.edited_at ? ' · 已编辑' : '' }}</small><button class="message-menu-trigger" @click="openMessageActions = openMessageActions === message.id ? null : message.id">•••</button><div v-if="openMessageActions === message.id" class="message-menu"><button @click="startReply(message); openMessageActions = null">回复</button><button @click="openThread(message); openMessageActions = null">打开话题</button><button @click="copy(message); openMessageActions = null">复制 Markdown</button><button v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" @click="pinMessage(message); openMessageActions = null">置顶消息</button><button v-if="message.user_id === user.id && !message.deleted_at" @click="beginEdit(message); openMessageActions = null">编辑</button><button v-if="message.user_id === user.id || isAdmin || room?.role === 'owner' || room?.role === 'admin'" class="danger" @click="retract(message); openMessageActions = null">撤回</button></div></header><blockquote v-if="message.reply_to" class="reply-reference">回复 {{ message.reply_username || '消息' }}：{{ message.reply_content || '已撤回的消息' }}</blockquote><p v-if="message.deleted_at" class="retracted">此消息已撤回</p><div v-else-if="message.content" class="markdown" @click="previewMarkdownImage" v-html="markdown(message.content, message.mentions)"></div><template v-if="message.attachment_id"><img v-if="imageTypes.has(message.attachment_type)" class="attachment-image previewable" :src="`/api/files/${message.attachment_id}?inline=1`" :alt="message.attachment_name" @click="previewImage(`/api/files/${message.attachment_id}?inline=1`)"><a v-else class="attachment-file" :href="`/api/files/${message.attachment_id}`"><span>↓</span><div><b>{{ message.attachment_name }}</b><small>{{ size(message.attachment_size) }}</small></div></a></template><div v-if="!message.deleted_at" class="reactions"><button v-for="reaction in message.reactions" :key="reaction.emoji" :class="{active: reaction.reacted}" @click="toggleReaction(message, reaction.emoji)">{{ reaction.emoji }} {{ reaction.count }}</button><button class="reaction-add" @click="reactionPickerFor = reactionPickerFor === message.id ? null : message.id">☺</button><div v-if="reactionPickerFor === message.id" class="reaction-picker"><button v-for="emoji in emojiGroups['常用']" :key="emoji" @click="toggleReaction(message, emoji)">{{ emoji }}</button></div></div></div></article></template>
      </div>
      <form v-if="view === 'dm' && conversation" class="composer" @submit.prevent="sendDm"><div v-if="dmReplyTarget" class="file-chip">↳ 回复 {{ dmReplyTarget.username }}：{{ dmReplyTarget.content?.slice(0, 80) }}<button type="button" @click="dmReplyTarget = null">×</button></div><div v-if="dmFiles.length" class="file-chips"><div v-for="(f, index) in dmFiles" :key="index" class="file-chip"><img v-if="imageTypes.has(f.file.type)" :src="filePreview(f.file)" class="file-preview"><span>{{ imageTypes.has(f.file.type) ? '图片' : '文件' }}</span><b>{{ f.file.name }}</b><small v-if="f.status === 'uploading'" class="dm-file-status">上传中</small><small v-else-if="f.status === 'failed'" class="dm-file-status dm-file-error">{{ f.error || '发送失败' }}</small><button v-if="f.status === 'failed'" type="button" title="重试" @click="f.status = 'ready'; f.error = ''">↻</button><button type="button" @click="removeDmFile(index)">×</button></div></div><div v-if="Object.keys(p2pProgress).length" class="p2p-strip"><div v-for="(p, id) in p2pProgress" :key="id" class="p2p-progress"><span class="p2p-dir">{{ p.direction === 'send' ? '↑' : '↓' }}</span><div class="p2p-info"><b>{{ p.name }}</b><small>{{ p2pStatusText(p) }}</small><div class="p2p-bar"><i :style="{ width: Math.round((p.ratio || 0) * 100) + '%' }"></i></div></div></div></div><div class="compose-row"><label class="attach" title="添加文件">＋<input ref="dmFileInput" type="file" multiple @change="addDmFiles($event.target.files)"></label><button type="button" class="attach emoji-trigger" title="表情" @click="emojiOpen = !emojiOpen">☺</button><button type="button" class="attach md-trigger" title="Markdown 语法速查" @click="mdHelpOpen = true">MD</button><div class="at-wrapper"><textarea v-model="dmInput" rows="1" :placeholder="'私信给 ' + (conversation.peer?.username || '好友') + '…'" @input="handleAtInput($event, 'dm')" @keydown.esc="atOpen = false" @keydown.enter.exact.prevent="sendDm"></textarea><div v-if="atOpen && atTarget === 'dm'" class="at-suggestions"><button v-for="u in atResults" :key="u.id" @click="selectAtMention(u)"><small>#{{ u.id }}</small> {{ u.username }}</button></div></div><button class="send" :disabled="dmSending" title="发送">发送</button></div><div v-if="emojiOpen" class="emoji-picker"><nav><button v-for="(_, category) in emojiGroups" :key="category" :class="{active: emojiCategory === category}" type="button" @click="emojiCategory = category">{{ category }}</button></nav><div><button v-for="emoji in emojiGroups[emojiCategory]" :key="emoji" type="button" :title="emoji" @click="dmInput += emoji; emojiOpen = false">{{ emoji }}</button></div></div><small>Enter 发送 · Shift + Enter 换行 · 私信仅双方可见</small></form>
      <form v-else class="composer" @submit.prevent="send" @dragover.prevent="handleDragOver" @dragleave="handleDragLeave" @drop.prevent="handleDrop"><div v-if="replyTarget" class="file-chip">↳ 回复 {{ replyTarget.username }}：{{ replyTarget.content?.slice(0, 80) }}<button type="button" @click="cancelReply">×</button></div><div v-if="files.length" class="file-chips"><div v-for="(f, index) in files" :key="index" class="file-chip"><img v-if="imageTypes.has(f.type)" :src="filePreview(f)" class="file-preview"><span>{{ imageTypes.has(f.type) ? '图片' : '文件' }}</span>{{ f.name }}<button type="button" @click="removeFile(index)">×</button></div></div><div class="compose-row"><label class="attach" title="添加文件（支持多选）">＋<input ref="fileInput" type="file" multiple @change="selectFile"></label><button type="button" class="attach emoji-trigger" title="EmojiAll 表情" @click="emojiOpen = !emojiOpen">☺</button><button type="button" class="attach md-trigger" title="Markdown 语法速查" @click="mdHelpOpen = true">MD</button><div class="at-wrapper"><textarea v-model="content" rows="1" placeholder="输入消息，粘贴图片、拖拽文件或使用 Markdown…" @input="sendTyping; handleAtInput($event, 'content')" @paste="paste" @keydown.esc="atOpen = false" @keydown.enter.exact.prevent="send"></textarea><div v-if="atOpen && atTarget === 'content'" class="at-suggestions"><button v-for="u in atResults" :key="u.id" @click="selectAtMention(u)"><small>#{{ u.id }}</small> {{ u.username }}</button></div></div><button class="send" title="发送消息">发送</button></div><div v-if="emojiOpen" class="emoji-picker"><nav><button v-for="(_, category) in emojiGroups" :key="category" :class="{active: emojiCategory === category}" type="button" @click="emojiCategory = category">{{ category }}</button></nav><div><button v-for="emoji in emojiGroups[emojiCategory]" :key="emoji" type="button" :title="emoji" @click="insertEmoji(emoji)">{{ emoji }}</button></div></div><small><span v-if="typingText">{{ typingText }}</span><span v-else>Enter 发送 · Shift + Enter 换行 · 拖拽文件到此处上传</span></small></form>
    </section></main>
  <main v-else class="m-app">
    <template v-if="room || conversation">
      <header class="m-topbar"><button class="m-back" title="返回" @click="backToMobileHome">‹</button><div class="m-topbar-title"><h2><span>{{ conversation ? '✉' : '#' }}</span> {{ conversation?.peer?.username || room?.name || '大厅' }} <small v-if="room?.is_private">🔒</small></h2><small v-if="conversation">私信</small><small v-else><i class="online-dot"></i>{{ onlineUsers.length }} 人在线<span v-if="typingText"> · {{ typingText }}</span></small></div><button class="m-more" title="更多操作" @click="roomActionsOpen = true">•••</button></header>
      <div v-if="globalAnnouncement" class="global-announcement-bar"><span class="pinned-icon">🔊</span><div class="global-announcement-body"><div class="global-announcement-meta"><b>系统公告</b><small>by {{ globalAnnouncement.admin_name }}</small></div><div class="markdown" v-html="markdown(globalAnnouncement.content)"></div></div><button class="global-announcement-close" title="关闭" @click="globalAnnouncement = null">×</button></div>
      <div class="pinned-area" :class="{hidden: view === 'dm' || (!room?.announcement && !roomPins.length)}">
        <div v-if="room?.announcement" class="announcement-bar"><div class="announcement-bar-header" @click="announcementExpanded = !announcementExpanded"><span class="pinned-icon">📢</span><span>公告</span><small>by {{ room.announcement_username }}</small><span class="pinned-toggle">{{ announcementExpanded ? '收起' : '展开' }}</span><div v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" class="announcement-bar-actions" @click.stop><button @click="openAnnouncement">编辑</button><button @click="deleteAnnouncement">删除</button></div></div><div v-if="announcementExpanded" class="announcement-bar-content markdown" v-html="markdown(room.announcement)"></div></div>
        <div v-if="roomPins.length" class="pinned-bar"><div class="pinned-bar-header" @click="pinsExpanded = !pinsExpanded"><span class="pinned-icon">📌</span><span>置顶消息 ({{ roomPins.length }})</span><span class="pinned-toggle">{{ pinsExpanded ? '收起' : '展开' }}</span></div><div v-if="pinsExpanded" class="pinned-bar-list"><article v-for="pin in roomPins" :key="pin.id" class="pinned-bar-item"><div class="pinned-bar-meta"><strong>{{ pin.username }}</strong><small>{{ time(pin.created_at) }}</small><button v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" class="pinned-unpin" @click="unpinMessage(pin)">取消置顶</button></div><div v-if="pin.content" class="markdown" v-html="markdown(pin.content)"></div></article></div></div>
      </div>
      <div ref="messageList" class="m-messages" @scroll.passive="maybeLoadOlderMessages">
        <template v-if="view === 'dm' && conversation">
          <div v-if="!dmMessages.length" class="empty"><img :src="icon"><h3>与 {{ conversation.peer?.username }} 的私信</h3><p>只有互为好友才能私信，消息仅双方可见。</p></div>
          <article v-for="message in dmMessages" :key="message.id"><div class="avatar"><img v-if="dmAvatar(message)" :src="dmAvatar(message)"><b v-else>{{ message.username[0] }}</b></div><div class="bubble" :class="{own: message.user_id === user.id}"><header><strong>{{ message.username }}<small class="user-number">#{{ message.user_id }}</small><i v-if="onlineIds.has(message.user_id)" class="online-dot" title="在线"></i></strong><small>{{ time(message.created_at) }}{{ message.edited_at ? ' · 已编辑' : '' }}</small><button class="message-menu-trigger" @click="openMessageActions = openMessageActions === message.id ? null : message.id">•••</button><div v-if="openMessageActions === message.id" class="message-menu"><button @click="startDmReply(message); openMessageActions = null">回复</button><button @click="copy(message); openMessageActions = null">复制 Markdown</button><button v-if="message.user_id === user.id && !message.deleted_at" @click="beginEdit(message); openMessageActions = null">编辑</button><button v-if="message.user_id === user.id || isAdmin" class="danger" @click="retractDm(message); openMessageActions = null">撤回</button></div></header><blockquote v-if="message.reply_to" class="reply-reference">回复 {{ message.reply_username || '消息' }}：{{ message.reply_content || '已撤回的消息' }}</blockquote><p v-if="message.deleted_at" class="retracted">此消息已撤回</p><div v-else-if="message.content" class="markdown" @click="previewMarkdownImage" v-html="markdown(message.content, message.mentions)"></div><template v-if="message.attachment_id"><img v-if="imageTypes.has(message.attachment_type)" class="attachment-image previewable" :src="`/api/files/${message.attachment_id}?inline=1`" :alt="message.attachment_name" @click="previewImage(`/api/files/${message.attachment_id}?inline=1`)"><a v-else class="attachment-file" :href="`/api/files/${message.attachment_id}`" :download="message.attachment_name">{{ message.attachment_name }}</a></template><template v-if="message.p2p_transfer_id && !message.deleted_at"><div class="p2p-card"><span>📦</span><div><b>{{ message.p2p_name }}</b><small>{{ size(message.p2p_size) }} · P2P 直传</small><div class="p2p-card-actions"><template v-if="p2pLocalIds.has(message.p2p_transfer_id)"><button @click="downloadP2p(message)">下载</button><button class="danger" @click="deleteLocalP2p(message)">删除本机副本</button></template><small v-else-if="message.p2p_sender_id === user.id">已通过 P2P 直传</small><small v-else class="p2p-note">文件仅到达接收设备</small></div></div></div></template><div class="reactions" v-if="message.reactions && message.reactions.length"><button v-for="reaction in message.reactions" :key="reaction.emoji" @click="toggleDmReaction(message, reaction.emoji)">{{ reaction.emoji }} {{ reaction.count }}</button></div></div></article>
        </template>
        <template v-else>
        <p v-if="loadingOlderMessages" class="history-loading">正在加载更早消息…</p><p v-else-if="hasOlderMessages" class="history-hint">向上滚动加载更早消息</p><div v-if="!messages.length" class="empty"><img :src="icon"><h3>开始一段新对话</h3><p>发送 Markdown、公式、图片或文件。</p></div>
        <article v-for="message in messages" :key="message.id"><div class="avatar"><img v-if="avatar(message)" :src="avatar(message)"><b v-else>{{ message.username[0] }}</b></div><div class="bubble" :class="{own: message.user_id === user.id}"><header><strong>{{ message.username }}<small class="user-number">#{{ message.user_id }}</small><i v-if="onlineIds.has(message.user_id)" class="online-dot" title="在线"></i></strong><small>{{ time(message.created_at) }}{{ message.edited_at ? ' · 已编辑' : '' }}</small><button class="message-menu-trigger" @click="openMessageActions = openMessageActions === message.id ? null : message.id">•••</button><div v-if="openMessageActions === message.id" class="message-menu"><button @click="startReply(message); openMessageActions = null">回复</button><button @click="openThread(message); openMessageActions = null">打开话题</button><button @click="copy(message); openMessageActions = null">复制 Markdown</button><button v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" @click="pinMessage(message); openMessageActions = null">置顶消息</button><button v-if="message.user_id === user.id && !message.deleted_at" @click="beginEdit(message); openMessageActions = null">编辑</button><button v-if="message.user_id === user.id || isAdmin || room?.role === 'owner' || room?.role === 'admin'" class="danger" @click="retract(message); openMessageActions = null">撤回</button></div></header><blockquote v-if="message.reply_to" class="reply-reference">回复 {{ message.reply_username || '消息' }}：{{ message.reply_content || '已撤回的消息' }}</blockquote><p v-if="message.deleted_at" class="retracted">此消息已撤回</p><div v-else-if="message.content" class="markdown" @click="previewMarkdownImage" v-html="markdown(message.content, message.mentions)"></div><template v-if="message.attachment_id"><img v-if="imageTypes.has(message.attachment_type)" class="attachment-image previewable" :src="`/api/files/${message.attachment_id}?inline=1`" :alt="message.attachment_name" @click="previewImage(`/api/files/${message.attachment_id}?inline=1`)"><a v-else class="attachment-file" :href="`/api/files/${message.attachment_id}`"><span>↓</span><div><b>{{ message.attachment_name }}</b><small>{{ size(message.attachment_size) }}</small></div></a></template><div v-if="!message.deleted_at" class="reactions"><button v-for="reaction in message.reactions" :key="reaction.emoji" :class="{active: reaction.reacted}" @click="toggleReaction(message, reaction.emoji)">{{ reaction.emoji }} {{ reaction.count }}</button><button class="reaction-add" @click="reactionPickerFor = reactionPickerFor === message.id ? null : message.id">☺</button><div v-if="reactionPickerFor === message.id" class="reaction-picker"><button v-for="emoji in emojiGroups['常用']" :key="emoji" @click="toggleReaction(message, emoji)">{{ emoji }}</button></div></div></div></article></template>
      </div>
      <form v-if="view === 'dm' && conversation" class="composer" @submit.prevent="sendDm"><div v-if="dmReplyTarget" class="file-chip">↳ 回复 {{ dmReplyTarget.username }}：{{ dmReplyTarget.content?.slice(0, 80) }}<button type="button" @click="dmReplyTarget = null">×</button></div><div v-if="dmFiles.length" class="file-chips"><div v-for="(f, index) in dmFiles" :key="index" class="file-chip"><img v-if="imageTypes.has(f.file.type)" :src="filePreview(f.file)" class="file-preview"><span>{{ imageTypes.has(f.file.type) ? '图片' : '文件' }}</span><b>{{ f.file.name }}</b><small v-if="f.status === 'uploading'" class="dm-file-status">上传中</small><small v-else-if="f.status === 'failed'" class="dm-file-status dm-file-error">{{ f.error || '发送失败' }}</small><button v-if="f.status === 'failed'" type="button" title="重试" @click="f.status = 'ready'; f.error = ''">↻</button><button type="button" @click="removeDmFile(index)">×</button></div></div><div v-if="Object.keys(p2pProgress).length" class="p2p-strip"><div v-for="(p, id) in p2pProgress" :key="id" class="p2p-progress"><span class="p2p-dir">{{ p.direction === 'send' ? '↑' : '↓' }}</span><div class="p2p-info"><b>{{ p.name }}</b><small>{{ p2pStatusText(p) }}</small><div class="p2p-bar"><i :style="{ width: Math.round((p.ratio || 0) * 100) + '%' }"></i></div></div></div></div><div class="compose-row"><label class="attach" title="添加文件">＋<input ref="dmFileInput" type="file" multiple @change="addDmFiles($event.target.files)"></label><button type="button" class="attach emoji-trigger" title="表情" @click="emojiOpen = !emojiOpen">☺</button><button type="button" class="attach md-trigger" title="Markdown 语法速查" @click="mdHelpOpen = true">MD</button><div class="at-wrapper"><textarea v-model="dmInput" rows="1" :placeholder="'私信给 ' + (conversation.peer?.username || '好友') + '…'" @input="handleAtInput($event, 'dm')" @keydown.esc="atOpen = false" @keydown.enter.exact.prevent="sendDm"></textarea><div v-if="atOpen && atTarget === 'dm'" class="at-suggestions"><button v-for="u in atResults" :key="u.id" @click="selectAtMention(u)"><small>#{{ u.id }}</small> {{ u.username }}</button></div></div><button class="send" :disabled="dmSending" title="发送">发送</button></div><div v-if="emojiOpen" class="emoji-picker"><nav><button v-for="(_, category) in emojiGroups" :key="category" :class="{active: emojiCategory === category}" type="button" @click="emojiCategory = category">{{ category }}</button></nav><div><button v-for="emoji in emojiGroups[emojiCategory]" :key="emoji" type="button" :title="emoji" @click="dmInput += emoji; emojiOpen = false">{{ emoji }}</button></div></div><small>Enter 发送 · Shift + Enter 换行 · 私信仅双方可见</small></form>
      <form v-else class="composer" @submit.prevent="send" @dragover.prevent="handleDragOver" @dragleave="handleDragLeave" @drop.prevent="handleDrop"><div v-if="replyTarget" class="file-chip">↳ 回复 {{ replyTarget.username }}：{{ replyTarget.content?.slice(0, 80) }}<button type="button" @click="cancelReply">×</button></div><div v-if="files.length" class="file-chips"><div v-for="(f, index) in files" :key="index" class="file-chip"><img v-if="imageTypes.has(f.type)" :src="filePreview(f)" class="file-preview"><span>{{ imageTypes.has(f.type) ? '图片' : '文件' }}</span>{{ f.name }}<button type="button" @click="removeFile(index)">×</button></div></div><div class="compose-row"><label class="attach" title="添加文件（支持多选）">＋<input ref="fileInput" type="file" multiple @change="selectFile"></label><button type="button" class="attach emoji-trigger" title="EmojiAll 表情" @click="emojiOpen = !emojiOpen">☺</button><button type="button" class="attach md-trigger" title="Markdown 语法速查" @click="mdHelpOpen = true">MD</button><div class="at-wrapper"><textarea v-model="content" rows="1" placeholder="输入消息，粘贴图片、拖拽文件或使用 Markdown…" @input="sendTyping; handleAtInput($event, 'content')" @paste="paste" @keydown.esc="atOpen = false" @keydown.enter.exact.prevent="send"></textarea><div v-if="atOpen && atTarget === 'content'" class="at-suggestions"><button v-for="u in atResults" :key="u.id" @click="selectAtMention(u)"><small>#{{ u.id }}</small> {{ u.username }}</button></div></div><button class="send" title="发送消息">发送</button></div><div v-if="emojiOpen" class="emoji-picker"><nav><button v-for="(_, category) in emojiGroups" :key="category" :class="{active: emojiCategory === category}" type="button" @click="emojiCategory = category">{{ category }}</button></nav><div><button v-for="emoji in emojiGroups[emojiCategory]" :key="emoji" type="button" :title="emoji" @click="insertEmoji(emoji)">{{ emoji }}</button></div></div><small><span v-if="typingText">{{ typingText }}</span><span v-else>Enter 发送 · Shift + Enter 换行 · 拖拽文件到此处上传</span></small></form>
      <div v-if="roomActionsOpen" class="m-sheet-backdrop" @click="roomActionsOpen = false"></div>
      <div v-if="roomActionsOpen" class="m-sheet"><h3>{{ conversation ? '私信操作' : '房间操作' }}</h3><button @click="openFriends(); roomActionsOpen = false">👥 好友与私信</button><button v-if="view !== 'dm'" @click="loadPins(); roomActionsOpen = false">📌 置顶消息</button><button @click="searchOpen = true; roomActionsOpen = false">⌕ 搜索消息</button><button v-if="view !== 'dm' && room?.is_private && (room?.role === 'owner' || room?.role === 'admin' || isAdmin)" @click="loadMembers(); roomActionsOpen = false">♙ 成员管理</button><button v-if="view !== 'dm' && (isAdmin || room?.role === 'owner' || room?.role === 'admin')" @click="openAnnouncement(); roomActionsOpen = false">📢 公告</button><button v-if="view !== 'dm' && (isAdmin || room?.role === 'owner' || room?.role === 'admin')" @click="openRoomManage(); roomActionsOpen = false">⚙ 房间设置</button><button @click="themeOpen = true; roomActionsOpen = false">◐ 主题</button><button class="m-sheet-cancel" @click="roomActionsOpen = false">取消</button></div>
    </template>
    <template v-else>
      <header class="m-home-top"><h1><img :src="icon"> PolyChat</h1><button class="m-new" title="新建聊天室" @click="newRoom">＋</button></header>
      <div v-if="globalAnnouncement" class="global-announcement-bar"><span class="pinned-icon">🔊</span><div class="global-announcement-body"><div class="global-announcement-meta"><b>系统公告</b><small>by {{ globalAnnouncement.admin_name }}</small></div><div class="markdown" v-html="markdown(globalAnnouncement.content)"></div></div><button class="global-announcement-close" title="关闭" @click="globalAnnouncement = null">×</button></div>
      <div class="m-home-body">
        <div v-if="mobileTab === 'chats'" class="m-page">
          <p class="m-list-label">聊天室</p>
          <button v-for="item in rooms" :key="item.id" class="m-list-item" :class="{hasUnread: unread[item.id]}" @click="choose(item)"><span class="m-badge">#</span><span class="m-list-main"><b>{{ item.name }}</b><small v-if="item.is_private">🔒 私有</small></span><small v-if="mentionedUnread[item.id]" class="unread" style="background:#dc2626">@</small><small v-else-if="unread[item.id]" class="unread">{{ unread[item.id] > 99 ? '99+' : unread[item.id] }}</small></button>
          <p class="m-list-label">私信 <button class="m-nav-add" title="好友与私信" @click="openFriends">＋</button></p>
          <button v-for="conv in conversations" :key="conv.id" class="m-list-item" :class="{hasUnread: dmUnread[conv.id]}" @click="selectConversation(conv)"><span class="m-avatar"><img v-if="dmAvatar(conv.peer)" :src="dmAvatar(conv.peer)"><b v-else>{{ (conv.peer?.username || '私')[0] }}</b></span><span class="m-list-main"><b>{{ conv.peer?.username || '私信' }}</b><small>私信</small></span><small v-if="dmUnread[conv.id]" class="unread">{{ dmUnread[conv.id] > 99 ? '99+' : dmUnread[conv.id] }}</small></button>
          <p v-if="!rooms.length && !conversations.length" class="m-empty">还没有聊天，创建一个聊天室或找好友私信吧。</p>
        </div>
        <div v-else-if="mobileTab === 'contacts'" class="m-page">
          <p class="m-list-label">添加好友</p>
          <div class="m-search"><input v-model="friendSearchQuery" placeholder="搜索用户名…" @input="searchFriends" @keydown.enter.prevent="searchFriends"><button @click="searchFriends">搜索</button></div>
          <div v-if="friendSearchResults.length" class="m-search-results"><div v-for="u in friendSearchResults" :key="u.id" class="m-friend-row"><b>{{ u.username }}</b><button @click="sendFriendRequest(u.username)">＋ 加好友</button></div></div>
          <p v-if="friendList.incoming.length" class="m-list-label">好友请求 ({{ friendList.incoming.length }})</p>
          <div v-for="f in friendList.incoming" :key="f.id" class="m-friend-row"><b>{{ f.username }}</b><span class="m-friend-actions"><button class="primary" @click="acceptFriend(f.id)">接受</button><button @click="declineFriend(f.id)">忽略</button></span></div>
          <p class="m-list-label">我的好友 ({{ friendList.accepted.length }})</p>
          <div v-for="f in friendList.accepted" :key="f.id" class="m-list-item" @click="openDm(f)"><span class="m-avatar"><img v-if="f.avatar_url" :src="f.avatar_url"><b v-else>{{ f.username[0] }}</b></span><span class="m-list-main"><b>{{ f.username }}</b><small>{{ onlineIds.has(f.id) ? '在线' : '离线' }}</small></span><small class="m-dm-hint">私信</small></div>
          <p v-if="!friendList.accepted.length && !friendList.incoming.length" class="m-empty">还没有好友，搜索并发送好友请求吧。</p>
        </div>
        <div v-else class="m-page">
          <div class="m-me-profile" @click="profileOpen = true"><span class="m-avatar m-avatar-lg"><img v-if="avatar(user)" :src="avatar(user)"><b v-else>{{ user.username[0] }}</b></span><div><h2>{{ user.username }}</h2><p>#{{ user.number || user.id }}{{ isAdmin ? ' · 管理员' : '' }}</p></div></div>
          <button class="m-menu-item" @click="helpOpen = true"><span>❓</span> 功能指南</button>
          <button class="m-menu-item" @click="themeOpen = true"><span>◐</span> 主题与自定义 CSS</button>
          <button class="m-menu-item" @click="toggleNotifications"><span>{{ notificationOn ? '🔔' : '🔕' }}</span> {{ notificationButtonText }}</button>
          <button class="m-menu-item" @click="openNotifications"><span>🔔</span> 通知中心<small v-if="notifUnreadCount" class="unread">{{ notifUnreadCount > 99 ? '99+' : notifUnreadCount }}</small></button>
          <button v-if="isAdmin" class="m-menu-item" @click="adminOpen = true; loadAdmin(); loadBannedIps(); loadBannedFingerprints(); loadBotRequests(); loadBotTokens(); adminTab = 'users'"><span>⚙</span> 管理面板</button>
          <button class="m-menu-item" @click="exportData"><span>↓</span> 导出聊天记录</button>
          <button class="m-menu-item danger" @click="deleteAccount"><span>✕</span> 删除账号</button>
          <button class="m-menu-item danger" @click="logout"><span>↪</span> 退出登录</button>
        </div>
      </div>
      <nav class="m-tabbar">
        <button :class="{active: mobileTab === 'chats'}" @click="switchMobileTab('chats')"><span>💬</span>聊天<small v-if="totalUnread" class="unread">{{ totalUnread > 99 ? '99+' : totalUnread }}</small></button>
        <button :class="{active: mobileTab === 'contacts'}" @click="switchMobileTab('contacts')"><span>👥</span>联系人<small v-if="friendList.incoming.length" class="unread">{{ friendList.incoming.length }}</small></button>
        <button :class="{active: mobileTab === 'me'}" @click="switchMobileTab('me')"><span>👤</span>我的</button>
      </nav>
    </template>
  </main>
  <div v-if="profileOpen" class="modal"><section class="profile-modal"><button class="close" @click="profileOpen = false">×</button><p>YOUR PROFILE</p><h2>个人资料</h2><div class="avatar-preview"><img v-if="avatar(user)" :src="avatar(user)"><b v-else>{{ user.username[0] }}</b></div><h3>{{ user.username }}</h3><p class="hint">支持 PNG、JPEG、WebP、GIF，最大 2 MB</p><input ref="avatarInput" class="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="setAvatar($event.target.files[0])"><div class="profile-actions"><button class="primary" @click="avatarInput.click()">选择新头像</button><button v-if="avatar(user)" @click="removeAvatar">移除头像</button></div><div class="data-actions"><h3>数据管理</h3><button @click="exportData">导出聊天记录</button><button class="danger-button" @click="deleteAccount">删除账号</button><p class="hint">删除账号将永久移除所有消息和文件</p></div></section></div>
  <div v-if="themeOpen" class="modal"><section class="theme-modal"><button class="close" @click="themeOpen = false">×</button><p>THEMES · LOCAL ONLY</p><h2>主题与自定义 CSS</h2><p class="hint">预设可一键切换；自定义 CSS 只保存在当前浏览器。</p><div class="theme-grid"><button v-for="theme in themes" :key="theme.id" :class="{selected: activeTheme === theme.id}" @click="chooseTheme(theme.id)"><span class="swatches"><i v-for="color in theme.colors" :key="color" :style="{background: color}"></i></span><b>{{ theme.name }}</b><small>{{ theme.note }}</small></button></div><label class="css-label">自定义 CSS <textarea v-model="customCss" spellcheck="false" placeholder="例如：\n.chat > aside { background: #0f172a; }" @input="updateCustomCss"></textarea></label><div class="theme-actions"><button class="primary" @click="updateCustomCss(); notify('自定义 CSS 已保存')">保存 CSS</button><button @click="resetCustomCss">清除自定义 CSS</button></div></section></div>
  <div v-if="adminOpen" class="modal"><section class="admin-modal"><button class="close" @click="adminOpen = false">×</button><p>ADMINISTRATION</p><h2>管理面板</h2><div class="admin-tabs"><button :class="{active: adminTab === 'users'}" @click="adminTab = 'users'">用户</button><button :class="{active: adminTab === 'security'}" @click="adminTab = 'security'">安全</button><button :class="{active: adminTab === 'bots'}" :disabled="!pluginEnabled('onebot')" :title="pluginEnabled('onebot') ? '' : 'OneBot 插件未启用'" @click="adminTab = 'bots'">机器人</button><button :class="{active: adminTab === 'announcement'}" :disabled="!pluginEnabled('announcement')" :title="pluginEnabled('announcement') ? '' : '全局公告插件未启用'" @click="adminTab = 'announcement'">公告</button></div><div v-if="adminTab === 'users'"><div class="stats"><span v-for="(value, key) in admin.stats" :key="key"><b>{{ value }}</b>{{ {users:'用户', rooms:'聊天室', messages:'消息', files:'文件'}[key] }}</span></div><h3>用户 <button @click="loadAdmin">刷新</button></h3><div v-for="member in admin.users" :key="member.id" class="member"><div class="member-info"><span>{{ member.username }} · {{ member.message_count }} 条消息 <small v-if="member.last_ip" class="ip-badge">{{ member.last_ip }}</small><small v-if="member.device_fingerprint" class="fp-badge" :title="member.device_fingerprint">📱{{ member.device_fingerprint.slice(0, 8) }}</small></span><span v-if="member.banned_until" class="status-badge banned">封禁至 {{ new Date(member.banned_until).toLocaleString() }}</span><span v-if="member.muted_until" class="status-badge muted">禁言至 {{ new Date(member.muted_until).toLocaleString() }}</span></div><div class="member-actions"><button @click="toggleAdmin(member)">{{ member.is_admin ? '撤销管理员' : '设为管理员' }}</button><template v-if="!member.is_admin"><button v-if="!member.banned_until" @click="banUser(member)">封禁</button><button v-else @click="unbanUser(member)">解封</button><button v-if="!member.muted_until" @click="muteUser(member)">禁言</button><button v-else @click="unmuteUser(member)">解除禁言</button><button @click="banUserIp(member)">封禁 IP</button><button v-if="member.device_fingerprint" @click="banUserDevice(member)">封禁设备</button></template></div></div></div><div v-else-if="adminTab === 'security'"><h3>IP 封禁 <button @click="loadBannedIps">刷新</button></h3><form class="ban-ip-form" @submit.prevent="adminBanIp"><input v-model="banIpInput" placeholder="输入 IP 地址" class="modal-input"><select v-model="banIpDuration"><option :value="null">永久</option><option :value="1">1 小时</option><option :value="24">24 小时</option><option :value="168">7 天</option><option :value="720">30 天</option></select><button class="primary">封禁</button></form><div v-for="entry in bannedIps" :key="entry.ip_address" class="banned-ip"><span class="code-value">{{ entry.ip_address }}</span><small v-if="entry.banned_until">至 {{ new Date(entry.banned_until).toLocaleString() }}</small><small v-else>永久</small><small v-if="entry.reason">{{ entry.reason }}</small><small v-if="entry.admin_name">by {{ entry.admin_name }}</small><button @click="adminUnbanIp(entry.ip_address)">解封</button></div><h3>设备封禁 <button @click="loadBannedFingerprints">刷新</button></h3><form class="ban-ip-form" @submit.prevent="adminBanFingerprint"><input v-model="banFpInput" placeholder="输入设备指纹" class="modal-input"><select v-model="banFpDuration"><option :value="null">永久</option><option :value="1">1 小时</option><option :value="24">24 小时</option><option :value="168">7 天</option><option :value="720">30 天</option></select><button class="primary">封禁</button></form><div v-for="entry in bannedFingerprints" :key="entry.fingerprint" class="banned-ip"><span class="code-value" :title="entry.fingerprint">📱{{ entry.fingerprint.slice(0, 12) }}…</span><small v-if="entry.banned_until">至 {{ new Date(entry.banned_until).toLocaleString() }}</small><small v-else>永久</small><small v-if="entry.reason">{{ entry.reason }}</small><small v-if="entry.admin_name">by {{ entry.admin_name }}</small><button @click="adminUnbanFingerprint(entry.fingerprint)">解封</button></div></div><div v-else-if="adminTab === 'bots' && pluginEnabled('onebot')"><p class="hint">用户可提交机器人创建申请，管理员审批通过后自动创建账号并分配 Bot Token（OneBot v11 接入）。</p><form class="bot-request-form" @submit.prevent="submitBotRequest"><input v-model="botRequestDraft.name" placeholder="机器人名称" maxlength="24"><input v-model="botRequestDraft.reason" placeholder="用途说明（可选）"><button class="primary">提交申请</button></form><h3>待处理申请 <button @click="loadBotRequests">刷新</button></h3><div v-if="!botRequests.length" class="modal-empty">暂无申请</div><div v-for="req in botRequests" :key="req.id" class="bot-request"><div class="bot-request-info"><b>{{ req.name }}</b><small>by {{ req.username }}</small><span v-if="req.status === 'pending'" class="status-badge pending">待审批</span><span v-else-if="req.status === 'approved'" class="status-badge approved">已通过</span><span v-else class="status-badge rejected">已拒绝</span><small v-if="req.reason">· {{ req.reason }}</small></div><div v-if="req.status === 'pending'" class="member-actions"><button class="primary" @click="reviewBotRequest(req.id, 'approved')">通过</button><button class="danger" @click="reviewBotRequest(req.id, 'rejected')">拒绝</button></div></div></div><div v-else-if="adminTab === 'announcement' && pluginEnabled('announcement')"><p class="hint">发布后立即向所有在线用户广播，并显示在顶部横幅；公告保存在服务器，重启后仍保留。</p><form class="bot-request-form" @submit.prevent="publishGlobalAnnouncement"><textarea v-model="globalAnnouncementDraft" placeholder="输入全局公告内容（支持 Markdown）" rows="3" class="modal-input"></textarea><button class="primary">发布公告</button></form><h3>当前公告 <button @click="loadGlobalAnnouncement">刷新</button></h3><div v-if="globalAnnouncement" class="bot-request"><div class="bot-request-info"><b>{{ globalAnnouncement.admin_name }}</b><small>{{ time(globalAnnouncement.created_at) }} 发布</small></div><div class="markdown" v-html="markdown(globalAnnouncement.content)"></div><div class="member-actions"><button class="danger" @click="clearGlobalAnnouncement">清除公告</button></div></div><div v-else class="modal-empty">当前没有全局公告</div></div><div v-else-if="adminTab === 'bots' || adminTab === 'announcement'" class="modal-empty">该功能对应的插件未启用（onebot / announcement），可在服务器端检查 data/plugins.json 或 DISABLED_PLUGINS 环境变量。</div></section></div>
  <div v-if="adminOpen && adminTab === 'bots' && pluginEnabled('onebot')" class="bot-config-overlay"><section class="bot-config-panel"><button class="close" @click="adminOpen = false">×</button><p>ONEBOT CONFIGURATION</p><h2>机器人接入</h2><div class="bot-connect"><div><b>OneBot v11 正向 WebSocket</b><small>{{ location.protocol === 'https:' ? 'wss' : 'ws' }}://{{ location.host }}/api/onebot/ws</small></div><button @click="copyText(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/onebot/ws`, '接入地址已复制')">复制地址</button></div><form class="bot-request-form" @submit.prevent="submitBotRequest"><input v-model="botRequestDraft.name" placeholder="机器人名称" minlength="2" maxlength="24"><input v-model="botRequestDraft.reason" placeholder="用途说明（可选）" maxlength="500"><button class="primary">提交申请</button></form><div class="bot-config-grid"><div class="bot-config-column"><h3>申请记录 <button @click="loadBotRequests">刷新</button></h3><div v-if="!botRequests.length" class="modal-empty">暂无申请</div><div v-for="req in botRequests" :key="req.id" class="bot-request"><div class="bot-request-info"><b>{{ req.name }}</b><small>by {{ req.username }}</small><span v-if="req.status === 'pending'" class="status-badge pending">待审批</span><span v-else-if="req.status === 'approved'" class="status-badge approved">已通过</span><span v-else class="status-badge rejected">已拒绝</span><small v-if="req.reason">{{ req.reason }}</small></div><div v-if="req.status === 'pending'" class="member-actions"><button class="primary" @click="reviewBotRequest(req.id, 'approved')">通过</button><button class="danger" @click="reviewBotRequest(req.id, 'rejected')">拒绝</button></div></div></div><div class="bot-config-column"><h3>已签发 Token <button @click="loadBotTokens">刷新</button></h3><div v-if="!botTokens.length" class="modal-empty">暂无可用 Token</div><div v-for="entry in botTokens" :key="entry.token" class="bot-token-row"><div><b>{{ entry.name || entry.username }}</b><small>{{ entry.username }} #{{ entry.user_id }} · {{ time(entry.created_at) }}</small><code>{{ entry.token.slice(0, 6) }}••••{{ entry.token.slice(-4) }}</code></div><div class="bot-token-actions"><button @click="copyText(entry.token, 'Token 已复制')">复制 Token</button><button @click="copyText(onebotWsUrl(entry.token), 'WebSocket 地址已复制')">复制 WS</button><button @click="copyText(onebotConfig(entry.token), '配置 JSON 已复制')">复制配置</button><button class="danger" @click="revokeBotToken(entry.token)">撤销</button></div></div></div></div></section></div>
  <div v-if="searchOpen" class="modal"><section><button class="close" @click="searchOpen = false">×</button><p>SEARCH</p><h2>搜索消息</h2><form class="search-form" @submit.prevent="searchMessages"><input v-model="searchText" autofocus placeholder="输入关键词"><button class="primary">搜索</button></form><div class="search-results"><button v-for="message in searchResults" :key="message.id" @click="choose(rooms.find(item => item.id === message.room_id)); searchOpen = false"><b>#{{ message.room_name }} · {{ message.username }}</b><span>{{ message.content }}</span></button><p v-if="searchText && !searchResults.length">没有结果</p></div></section></div>
  <div v-if="editingMessage" class="modal"><section><button class="close" @click="editingMessage = null">×</button><p>EDIT MESSAGE</p><h2>编辑消息</h2><textarea class="edit-area" v-model="editContent"></textarea><div class="theme-actions"><button class="primary" @click="saveEdit">保存</button><button @click="editingMessage = null">取消</button></div></section></div>
  <div v-if="createRoomOpen" class="modal"><section class="room-modal"><button class="close" @click="createRoomOpen = false">×</button><p>NEW ROOM</p><h2>创建聊天室</h2><label>名称<input v-model="roomDraft.name" autofocus maxlength="30" placeholder="例如：项目讨论"></label><label class="privacy-choice"><input v-model="roomDraft.is_private" type="checkbox"><span><b>私有聊天室</b><small>只有被邀请的成员可以发现、查看和发送消息。</small></span></label><div class="theme-actions"><button class="primary" @click="createRoom">创建</button><button @click="createRoomOpen = false">取消</button></div></section></div>
  <div v-if="membersOpen" class="modal"><section class="members-modal"><button class="close" @click="membersOpen = false">×</button><p>ROOM ACCESS</p><h2>管理成员</h2><p class="hint">私有房间只对以下成员可见。</p><div class="invite-search"><input v-model="inviteSearchQuery" placeholder="搜索用户并邀请…" @input="searchUsers"><div v-if="inviteSearchResults.length" class="invite-search-results"><div v-for="u in inviteSearchResults" :key="u.id" class="invite-search-item" @click="inviteUser(u.username)">{{ u.username }}</div></div></div><form class="member-invite" @submit.prevent="inviteMember"><input v-model="memberName" placeholder="输入用户名"><select v-model="memberRole"><option value="member">成员</option><option value="admin">房间管理员</option></select><button class="primary">邀请</button></form><div class="member" v-for="member in roomMembers" :key="member.id"><span>{{ member.username }}</span><small>{{ member.role === 'owner' ? '房主' : member.role === 'admin' ? '管理员' : '成员' }}</small><button v-if="member.role !== 'owner'" @click="removeMember(member)">移除</button></div><h3>邀请码</h3><div class="invite-code-actions"><button @click="createInviteCode(null, null)">永久邀请码</button><button @click="createInviteCode(1, null)">一次性</button><button @click="createInviteCode(null, 24)">24小时</button></div><div v-for="code in inviteCodes" :key="code.id" class="invite-code"><span class="code-value">{{ code.code }}</span><small v-if="code.max_uses">{{ code.use_count }}/{{ code.max_uses }}</small><small v-else>{{ code.use_count }} 次</small><small v-if="code.expires_at">过期 {{ new Date(code.expires_at).toLocaleDateString() }}</small><button @click="copyInviteLink(code.code)">复制</button><button class="danger" @click="deleteInviteCode(code.id)">删除</button></div></section></div>
  <div v-if="roomManageOpen" class="modal"><section class="room-modal"><button class="close" @click="roomManageOpen = false">×</button><p>ROOM SETTINGS</p><h2>房间设置</h2><label>名称<input v-model="roomNameDraft" maxlength="30"></label><div class="theme-actions"><button class="primary" @click="saveRoom">保存更改</button><button class="danger-button" @click="deleteRoom">删除房间</button></div></section></div>
  <div v-if="imagePreview" class="image-lightbox" @click.self="imagePreview = ''"><button class="close" @click="imagePreview = ''">×</button><img :src="imagePreview" alt="图片预览"></div>
  <div v-if="pinsOpen" class="modal"><section class="pins-modal"><button class="close" @click="pinsOpen = false">×</button><p>PINNED</p><h2>置顶消息</h2><div v-if="!pinnedMessages.length" class="modal-empty">暂无置顶消息</div><article v-for="message in pinnedMessages" :key="message.id" class="pin-card"><b>{{ message.username }}</b><small>{{ time(message.pinned_at || message.created_at) }}</small><div class="markdown" v-html="markdown(message.content)"></div><button v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" @click="unpinMessage(message)">取消置顶</button></article></section></div>
  <div v-if="announcementOpen" class="modal"><section><button class="close" @click="announcementOpen = false">×</button><p>ANNOUNCEMENT</p><h2>房间公告</h2><textarea v-model="announcementDraft" class="modal-textarea" rows="5" placeholder="输入公告内容…"></textarea><div class="theme-actions"><button class="primary" @click="saveAnnouncement">保存</button><button @click="announcementOpen = false">取消</button></div></section></div>
  <div v-if="inviteCodeOpen" class="modal"><section><button class="close" @click="inviteCodeOpen = false">×</button><p>JOIN ROOM</p><h2>通过邀请码加入</h2><p class="hint">输入邀请码加入私有聊天室</p><input v-model="inviteCodeInput" class="modal-input" placeholder="输入邀请码" autofocus @keydown.enter.prevent="joinByInviteCode"><div class="theme-actions"><button class="primary" @click="joinByInviteCode">加入</button><button @click="inviteCodeOpen = false">取消</button></div></section></div>
  <div v-if="threadRoot" class="thread-panel"><header><div><small>话题</small><h2>{{ threadRoot.username }} 的消息</h2></div><button @click="threadRoot = null">×</button></header><div class="thread-list"><article v-for="message in threadMessages" :key="message.id"><b>{{ message.username }}<i v-if="onlineIds.has(message.user_id)" class="online-dot"></i></b><small>{{ time(message.created_at) }}</small><div class="markdown" v-html="markdown(message.content)"></div></article></div><form @submit.prevent="sendThread"><textarea v-model="threadContent" rows="2" placeholder="回复这个话题…"></textarea><button class="send">发送</button></form></div>
  <div v-if="friendsOpen" class="modal"><section class="friends-modal"><button class="close" @click="friendsOpen = false">×</button><p>FRIENDS</p><h2>好友与私信</h2>
    <div class="invite-search"><input v-model="friendSearchQuery" placeholder="搜索用户名并发送好友请求…" @input="searchFriends"><div v-if="friendSearchResults.length" class="invite-search-results"><div v-for="u in friendSearchResults" :key="u.id" class="invite-search-item" @click="sendFriendRequest(u.username)">{{ u.username }} <small>＋ 加好友</small></div></div></div>
    <div v-if="friendList.incoming.length" class="friend-section"><h3>好友请求 ({{ friendList.incoming.length }})</h3><div v-for="f in friendList.incoming" :key="f.id" class="member"><span>{{ f.username }}</span><button @click="acceptFriend(f.id)">接受</button><button @click="declineFriend(f.id)">忽略</button></div></div>
    <div class="friend-section"><h3>我的好友 ({{ friendList.accepted.length }})</h3><div v-for="f in friendList.accepted" :key="f.id" class="member"><span><img v-if="f.avatar_url" :src="f.avatar_url" class="friend-avatar"><b v-else class="friend-avatar">{{ f.username[0] }}</b> {{ f.username }}</span><div class="member-actions"><button @click="openDm(f)">私信</button><button @click="removeFriend(f.id)">删除</button></div></div><p v-if="!friendList.accepted.length" class="hint">还没有好友，搜索并发送好友请求吧。</p></div>
    <div v-if="friendList.outgoing.length" class="friend-section"><h3>等待接受</h3><div v-for="f in friendList.outgoing" :key="f.id" class="member"><span>{{ f.username }}</span><small>已发送请求</small></div></div>
  </section></div>
  <div v-if="p2pIncoming" class="modal"><section class="p2p-modal"><button class="close" @click="rejectP2p">×</button><p>P2P DIRECT TRANSFER</p><h2>收到直传请求</h2><p class="hint">{{ p2pIncoming.sender_username }} 想直传「{{ p2pIncoming.transfer.name }}」（{{ size(p2pIncoming.transfer.size) }}），文件不经过服务器，仅到达本设备。</p><div class="theme-actions"><button class="primary" @click="acceptP2p">接收</button><button @click="rejectP2p">拒绝</button></div></section></div>
  <div v-if="helpOpen" class="modal"><section class="help-modal"><button class="close" @click="helpOpen = false">×</button><p>FEATURE GUIDE</p><h2>功能指南</h2><p class="hint">PolyChat 全部功能一览。部分功能支持「去试试」直接打开；也可重新观看首次使用引导。</p><div class="help-tour-entry"><button class="primary" @click="startTour(); helpOpen = false">▶ 重新观看引导</button></div><template v-for="group in featureGroups" :key="group.title"><div v-if="!group.adminOnly || isAdmin" class="feature-group"><h3><span>{{ group.icon }}</span>{{ group.title }}</h3><div class="feature-grid"><div v-for="feature in group.features" :key="feature.title" class="feature-item"><b class="feature-icon">{{ feature.icon }}</b><div class="feature-body"><b>{{ feature.title }}</b><small>{{ feature.desc }}</small></div><button v-if="feature.action" class="feature-action" @click="runFeatureAction(feature.action)">去试试</button></div></div></div></template></section></div>
  <div v-if="mdHelpOpen" class="modal"><section class="md-help"><button class="close" @click="mdHelpOpen = false">×</button><p>MARKDOWN · LATEX</p><h2>语法速查</h2><table><tbody><tr><td><code># 标题</code></td><td>一级到六级标题（# ～ ######）</td></tr><tr><td><code>**加粗**</code></td><td>加粗</td></tr><tr><td><code>*斜体*</code></td><td>斜体</td></tr><tr><td><code>~~删除线~~</code></td><td>删除线</td></tr><tr><td><code>`行内代码`</code></td><td>行内代码</td></tr><tr><td><code>```js 代码块```</code></td><td>多行代码块（可指定语言）</td></tr><tr><td><code>[文字](https://…)</code></td><td>链接</td></tr><tr><td><code>![说明](图片URL)</code></td><td>图片</td></tr><tr><td><code>&gt; 引用</code></td><td>引用</td></tr><tr><td><code>- 项目</code> / <code>1. 第一项</code></td><td>无序 / 有序列表</td></tr><tr><td><code>| 列1 | 列2 |</code><br><code>| --- | --- |</code></td><td>表格</td></tr><tr><td><code>$E=mc^2$</code></td><td>行内 LaTeX 公式</td></tr><tr><td><code>$$…$$</code></td><td>块级 LaTeX 公式</td></tr><tr><td><code>@用户名</code></td><td>提及用户（会高亮提醒）</td></tr></tbody></table></section></div>
  <div v-if="tourOpen" class="tour-overlay">
    <div v-if="!tourHasTarget" class="tour-dim"></div>
    <div v-else class="tour-highlight" :style="tourHighlightStyle"></div>
    <div class="tour-tip" :class="{top: tourTipAtTop}">
      <div class="tour-progress"><span v-for="(_, i) in getTourSteps()" :key="i" class="tour-dot" :class="{active: i === tourStep}"></span><small>{{ tourStep + 1 }} / {{ getTourSteps().length }}</small></div>
      <h3>{{ getTourSteps()[tourStep]?.title }}</h3>
      <p>{{ getTourSteps()[tourStep]?.desc }}</p>
      <div class="tour-actions"><button class="tour-skip" @click="skipTour">跳过</button><button v-if="tourStep > 0" class="tour-prev" @click="tourPrev">上一步</button><button class="primary" @click="tourNext">{{ tourStep >= getTourSteps().length - 1 ? '完成' : '下一步' }}</button></div>
    </div>
  </div>
  <div v-if="toast" class="toast">{{ toast }}</div>
  <div v-if="notifOpen" class="notif-dropdown">
    <header><h3>通知</h3><button v-if="notifUnreadCount" @click="markAllNotifRead">全部标为已读</button><button class="notif-close" @click="notifOpen = false">×</button></header>
    <div v-if="!notifications.length" class="notif-empty">暂无通知</div>
    <div v-for="n in notifications" :key="n.id" class="notif-item" :class="{unread: !n.is_read}" @click="n.is_read || markNotifRead(n.id)">
      <div class="notif-title"><b>{{ n.title }}</b><small v-if="!n.is_read" class="notif-dot"></small></div>
      <div class="notif-content">{{ n.content }}</div>
      <small class="notif-time">{{ time(n.created_at) }}</small>
      <div v-if="n.data?.token" class="notif-token"><span>Bot Token（请妥善保存）：</span><code>{{ n.data.token }}</code><div><button @click.stop="copyText(n.data.token, 'Token 已复制')">复制 Token</button><button @click.stop="copyText(onebotWsUrl(n.data.token), 'WebSocket 地址已复制')">复制 WS 地址</button><button @click.stop="copyText(onebotConfig(n.data.token), '配置 JSON 已复制')">复制配置</button></div></div>
    </div>
  </div>
</template>
