<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';
import icon from '../../assets/polychat-icon.png';

const user = ref(null), rooms = ref([]), room = ref(null), messages = ref([]), content = ref('');
const mode = ref('login'), credentials = ref({ username: '', password: '' }), error = ref(''), toast = ref('');
const file = ref(null), adminOpen = ref(false), profileOpen = ref(false), admin = ref({ stats: {}, users: [] });
const notificationOn = ref(false), notificationPermission = ref('default'), avatarInput = ref(null), fileInput = ref(null);
let messageTimer, roomTimer, eventTimer, lastId = 0, eventCursor = null;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const isAdmin = computed(() => user.value?.is_admin);
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
function clearTimers() { clearInterval(messageTimer); clearInterval(roomTimer); clearInterval(eventTimer); }
function fileData(selected) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(selected); }); }

async function authenticate() { error.value = ''; try { user.value = (await api(`/api/${mode.value}`, { method: 'POST', body: JSON.stringify(credentials.value) })).user; await enter(); } catch (e) { error.value = e.message; } }
function syncNotificationState() {
  notificationPermission.value = notificationSupported.value ? Notification.permission : 'unsupported';
  notificationOn.value = notificationPermission.value === 'granted' && localStorage.getItem('polychat.notifications') !== 'off';
}
async function enter() {
  await loadRooms(); roomTimer = setInterval(loadRooms, 3000); eventTimer = setInterval(events, 2500); syncNotificationState();
  if (navigator.permissions && notificationSupported.value) navigator.permissions.query({ name: 'notifications' }).then(status => { status.onchange = syncNotificationState; }).catch(() => {});
}
async function loadRooms() { try { const result = await api('/api/rooms'); rooms.value = result.rooms; if (!room.value && rooms.value.length) await choose(rooms.value[0]); } catch {} }
async function choose(item) { room.value = item; messages.value = []; lastId = 0; await poll(); clearInterval(messageTimer); messageTimer = setInterval(poll, 1800); }
async function poll() { if (!room.value) return; try { const result = await api(`/api/rooms/${room.value.id}/messages?after=${lastId}`); if (result.messages.length) { messages.value.push(...result.messages); lastId = result.messages.at(-1).id; await nextTick(); document.querySelector('.messages')?.scrollTo({ top: 1e9 }); } } catch {} }
async function events() { try { const result = await api(`/api/events${eventCursor == null ? '?bootstrap=1' : `?after=${eventCursor}`}`); eventCursor = result.cursor; for (const message of result.messages) if (message.user_id !== user.value.id && notificationOn.value && document.hidden) new Notification(`${message.username} · #${message.room_name}`, { body: message.content || '发送了附件', icon }); } catch {} }
async function toggleNotifications() {
  if (!notificationSupported.value) return notify('当前浏览器不支持桌面通知');
  if (!window.isSecureContext) return notify('请通过 HTTPS 访问后开启通知');
  if (notificationOn.value) { localStorage.setItem('polychat.notifications', 'off'); notificationOn.value = false; return notify('桌面通知已关闭'); }
  if (Notification.permission === 'denied') return notify('请在浏览器的网站设置中允许通知');
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  notificationPermission.value = permission;
  if (permission === 'granted') { localStorage.setItem('polychat.notifications', 'on'); notificationOn.value = true; notify('桌面通知已开启'); }
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
async function send() { if (!room.value || (!content.value.trim() && !file.value)) return; try { let attachmentId = null; if (file.value) { const uploaded = await api('/api/files', { method: 'POST', body: JSON.stringify({ name: file.value.name, type: file.value.type || 'application/octet-stream', data: await fileData(file.value) }) }); attachmentId = uploaded.file.id; } const result = await api(`/api/rooms/${room.value.id}/messages`, { method: 'POST', body: JSON.stringify({ content: content.value, attachment_id: attachmentId }) }); messages.value.push(result.message); lastId = result.message.id; content.value = ''; file.value = null; if (fileInput.value) fileInput.value.value = ''; await nextTick(); document.querySelector('.messages')?.scrollTo({ top: 1e9, behavior: 'smooth' }); } catch (e) { notify(e.message); } }
async function copy(message) { try { await navigator.clipboard.writeText(message.content || ''); notify('已复制完整 Markdown'); } catch { notify('复制失败'); } }
async function newRoom() { const name = prompt('聊天室名称'); if (!name) return; try { await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) }); await loadRooms(); } catch (e) { notify(e.message); } }
async function loadAdmin() { try { admin.value = await api('/api/admin/overview'); } catch (e) { notify(e.message); } }
async function toggleAdmin(member) { try { await api(`/api/admin/users/${member.id}/admin`, { method: 'PUT', body: JSON.stringify({ is_admin: !member.is_admin }) }); await loadAdmin(); } catch (e) { notify(e.message); } }
async function logout() { await api('/api/logout', { method: 'POST' }); clearTimers(); location.reload(); }
onMounted(async () => { try { user.value = (await api('/api/me')).user; await enter(); } catch {} }); onBeforeUnmount(clearTimers);
</script>

<template>
  <main v-if="!user" class="auth"><section><img :src="icon"><p>MARKDOWN · LATEX · EVERYWHERE</p><h1>欢迎来到 PolyChat</h1><div class="tabs"><button :class="{active: mode === 'login'}" @click="mode = 'login'">登录</button><button :class="{active: mode === 'register'}" @click="mode = 'register'">注册</button></div><form @submit.prevent="authenticate"><input v-model="credentials.username" placeholder="用户名" required><input v-model="credentials.password" type="password" placeholder="密码" required><small>{{ error }}</small><button> {{ mode === 'login' ? '登录' : '创建账号' }} </button></form></section></main>
  <main v-else class="chat"><aside><header class="brand"><img :src="icon"><span>PolyChat<small>让交流保持简单</small></span></header><button class="new" @click="newRoom"><span>＋</span> 新建聊天室</button><p class="nav-label">聊天室</p><nav><button v-for="item in rooms" :key="item.id" :class="{active: room?.id === item.id}" @click="choose(item)"><span>#</span><b>{{ item.name }}</b><small>{{ item.message_count || '' }}</small></button></nav><footer><button class="profile-button" title="更换头像" @click="profileOpen = true"><img v-if="avatar(user)" :src="avatar(user)"><b v-else>{{ user.username[0] }}</b></button><span>{{ user.username }}<small>{{ isAdmin ? '管理员 · 在线' : '在线' }}</small></span><button class="logout" title="退出登录" @click="logout">↪</button></footer></aside>
    <section class="conversation"><header class="topbar"><div><h2><span>#</span> {{ room?.name || '大厅' }}</h2><small>支持 Markdown、LaTeX 与图片粘贴</small></div><button v-if="isAdmin" class="toolbar-button" @click="adminOpen = true; loadAdmin()">管理面板</button><button class="toolbar-button notification" :class="{on: notificationOn, blocked: notificationPermission === 'denied'}" :title="notificationLabel" @click="toggleNotifications"><span>{{ notificationOn ? '🔔' : '🔕' }}</span><em>{{ notificationButtonText }}</em></button></header><div class="messages"><div v-if="!messages.length" class="empty"><img :src="icon"><h3>开始一段新对话</h3><p>发送 Markdown、公式、图片或文件。</p></div><article v-for="message in messages" :key="message.id"><div class="avatar"><img v-if="avatar(message)" :src="avatar(message)"><b v-else>{{ message.username[0] }}</b></div><div class="bubble"><header><strong>{{ message.username }}</strong><small>{{ time(message.created_at) }}</small><button title="复制原始 Markdown" @click="copy(message)">复制</button></header><div v-if="message.content" class="markdown" v-html="markdown(message.content)"></div><template v-if="message.attachment_id"><img v-if="imageTypes.has(message.attachment_type)" class="attachment-image" :src="`/api/files/${message.attachment_id}?inline=1`" :alt="message.attachment_name"><a v-else class="attachment-file" :href="`/api/files/${message.attachment_id}`"><span>↓</span><div><b>{{ message.attachment_name }}</b><small>{{ size(message.attachment_size) }}</small></div></a></template></div></article></div><form class="composer" @submit.prevent="send"><div v-if="file" class="file-chip"><span>{{ imageTypes.has(file.type) ? '图片' : '文件' }}</span>{{ file.name }}<button type="button" @click="file = null">×</button></div><div class="compose-row"><label class="attach" title="添加文件">＋<input ref="fileInput" type="file" @change="selectFile"></label><textarea v-model="content" rows="1" placeholder="输入消息，粘贴图片或使用 Markdown…" @paste="paste" @keydown.enter.exact.prevent="send"></textarea><button class="send" title="发送消息">发送</button></div><small>Enter 发送 · Shift + Enter 换行</small></form></section></main>
  <div v-if="profileOpen" class="modal"><section class="profile-modal"><button class="close" @click="profileOpen = false">×</button><p>YOUR PROFILE</p><h2>个人资料</h2><div class="avatar-preview"><img v-if="avatar(user)" :src="avatar(user)"><b v-else>{{ user.username[0] }}</b></div><h3>{{ user.username }}</h3><p class="hint">支持 PNG、JPEG、WebP、GIF，最大 2 MB</p><input ref="avatarInput" class="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="setAvatar($event.target.files[0])"><div class="profile-actions"><button class="primary" @click="avatarInput.click()">选择新头像</button><button v-if="avatar(user)" @click="removeAvatar">移除头像</button></div></section></div>
  <div v-if="adminOpen" class="modal"><section><button class="close" @click="adminOpen = false">×</button><p>ADMINISTRATION</p><h2>管理面板</h2><div class="stats"><span v-for="(value, key) in admin.stats" :key="key"><b>{{ value }}</b>{{ {users:'用户', rooms:'聊天室', messages:'消息', files:'文件'}[key] }}</span></div><h3>用户 <button @click="loadAdmin">刷新</button></h3><div v-for="member in admin.users" :key="member.id" class="member"><span>{{ member.username }} · {{ member.message_count }} 条消息</span><button @click="toggleAdmin(member)">{{ member.is_admin ? '撤销管理员' : '设为管理员' }}</button></div></section></div>
  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
