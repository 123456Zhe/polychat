<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import katex from 'katex';
import icon from '../../assets/polychat-icon.png';

const user = ref(null), rooms = ref([]), room = ref(null), messages = ref([]), content = ref('');
const mode = ref('login'), credentials = ref({ username: '', password: '' }), error = ref(''), toast = ref('');
const file = ref(null), adminOpen = ref(false), admin = ref({ stats: {}, users: [] }), notificationOn = ref(false);
let messageTimer, roomTimer, eventTimer, lastId = 0, eventCursor = null;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const isAdmin = computed(() => user.value?.is_admin);

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}
function notify(text) { toast.value = text; setTimeout(() => toast.value = '', 2200); }
function escape(text) { return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function markdown(source = '') {
  let text = escape(source); const blocks = [];
  text = text.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, lang, code) => `\u0000${blocks.push(`<pre><code>${code}</code></pre>`) - 1}\u0000`);
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => `\u0000${blocks.push(`<div class="math">${katex.renderToString(math, { displayMode: true, throwOnError: false })}</div>`) - 1}\u0000`);
  text = text.replace(/\$([^$\n]+)\$/g, (_, math) => katex.renderToString(math, { throwOnError: false }));
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  text = text.replace(/\n/g, '<br>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => blocks[Number(index)]);
}
function time(value) { return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function size(value = 0) { return value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`; }
function avatar(member) { return member?.avatar_updated_at ? `/api/users/${member.id || member.user_id}/avatar?v=${member.avatar_updated_at}` : ''; }
function clearTimers() { clearInterval(messageTimer); clearInterval(roomTimer); clearInterval(eventTimer); }
function fileData(selected) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(selected); }); }

async function authenticate() { error.value = ''; try { user.value = (await api(`/api/${mode.value}`, { method: 'POST', body: JSON.stringify(credentials.value) })).user; await enter(); } catch (e) { error.value = e.message; } }
async function enter() { await loadRooms(); roomTimer = setInterval(loadRooms, 3000); eventTimer = setInterval(events, 2500); notificationOn.value = Notification.permission === 'granted'; }
async function loadRooms() { try { const result = await api('/api/rooms'); rooms.value = result.rooms; if (!room.value && rooms.value.length) await choose(rooms.value[0]); } catch {} }
async function choose(item) { room.value = item; messages.value = []; lastId = 0; await poll(); clearInterval(messageTimer); messageTimer = setInterval(poll, 1800); }
async function poll() { if (!room.value) return; try { const result = await api(`/api/rooms/${room.value.id}/messages?after=${lastId}`); if (result.messages.length) { messages.value.push(...result.messages); lastId = result.messages.at(-1).id; await nextTick(); document.querySelector('.messages')?.scrollTo({ top: 1e9 }); } } catch {} }
async function events() { try { const result = await api(`/api/events${eventCursor == null ? '?bootstrap=1' : `?after=${eventCursor}`}`); eventCursor = result.cursor; for (const message of result.messages) if (message.user_id !== user.value.id && notificationOn.value && document.hidden) new Notification(`${message.username} · #${message.room_name}`, { body: message.content || '发送了附件' }); } catch {} }
async function toggleNotifications() { if (!window.isSecureContext) return notify('浏览器通知需要 HTTPS'); const permission = await Notification.requestPermission(); notificationOn.value = permission === 'granted'; notify(notificationOn.value ? '桌面通知已开启' : '通知权限未授予'); }
async function send() { if (!room.value || (!content.value.trim() && !file.value)) return; try { let attachmentId = null; if (file.value) { const uploaded = await api('/api/files', { method: 'POST', body: JSON.stringify({ name: file.value.name, type: file.value.type || 'application/octet-stream', data: await fileData(file.value) }) }); attachmentId = uploaded.file.id; } const result = await api(`/api/rooms/${room.value.id}/messages`, { method: 'POST', body: JSON.stringify({ content: content.value, attachment_id: attachmentId }) }); messages.value.push(result.message); lastId = result.message.id; content.value = ''; file.value = null; } catch (e) { notify(e.message); } }
async function copy(message) { try { await navigator.clipboard.writeText(message.content || ''); notify('已复制完整 Markdown'); } catch { notify('复制失败'); } }
async function newRoom() { const name = prompt('聊天室名称'); if (!name) return; try { await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) }); await loadRooms(); } catch (e) { notify(e.message); } }
async function loadAdmin() { try { admin.value = await api('/api/admin/overview'); } catch (e) { notify(e.message); } }
async function toggleAdmin(member) { try { await api(`/api/admin/users/${member.id}/admin`, { method: 'PUT', body: JSON.stringify({ is_admin: !member.is_admin }) }); await loadAdmin(); } catch (e) { notify(e.message); } }
async function logout() { await api('/api/logout', { method: 'POST' }); clearTimers(); location.reload(); }
onMounted(async () => { try { user.value = (await api('/api/me')).user; await enter(); } catch {} }); onBeforeUnmount(clearTimers);
</script>

<template>
  <main v-if="!user" class="auth"><section><img :src="icon"><p>MARKDOWN · LATEX · EVERYWHERE</p><h1>欢迎来到 PolyChat</h1><div class="tabs"><button :class="{active: mode === 'login'}" @click="mode = 'login'">登录</button><button :class="{active: mode === 'register'}" @click="mode = 'register'">注册</button></div><form @submit.prevent="authenticate"><input v-model="credentials.username" placeholder="用户名" required><input v-model="credentials.password" type="password" placeholder="密码" required><small>{{ error }}</small><button> {{ mode === 'login' ? '登录' : '创建账号' }} </button></form></section></main>
  <main v-else class="chat"><aside><header><img :src="icon">PolyChat</header><button class="new" @click="newRoom">＋ 新建聊天室</button><nav><button v-for="item in rooms" :key="item.id" :class="{active: room?.id === item.id}" @click="choose(item)"># {{ item.name }}</button></nav><footer><img v-if="avatar(user)" :src="avatar(user)"><b v-else>{{ user.username[0] }}</b><span>{{ user.username }}<small>在线</small></span><button @click="logout">退出</button></footer></aside>
    <section class="conversation"><header><div><h2># {{ room?.name || '大厅' }}</h2><small>支持 Markdown 与 LaTeX</small></div><button v-if="isAdmin" @click="adminOpen = true; loadAdmin()">⚙ 管理</button><button @click="toggleNotifications">{{ notificationOn ? '🔔' : '🔕' }}</button></header><div class="messages"><article v-for="message in messages" :key="message.id"><img v-if="avatar(message)" :src="avatar(message)"><b v-else>{{ message.username[0] }}</b><div><header><strong>{{ message.username }}</strong><small>{{ time(message.created_at) }}</small><button @click="copy(message)">复制 Markdown</button></header><div v-if="message.content" class="markdown" v-html="markdown(message.content)"></div><template v-if="message.attachment_id"><img v-if="imageTypes.has(message.attachment_type)" class="attachment-image" :src="`/api/files/${message.attachment_id}?inline=1`"><a v-else :href="`/api/files/${message.attachment_id}`">📎 {{ message.attachment_name }} · {{ size(message.attachment_size) }}</a></template></div></article></div><form class="composer" @submit.prevent="send"><textarea v-model="content" placeholder="输入消息… 支持 Markdown 和 $LaTex$"></textarea><label>📎 <input type="file" @change="file = $event.target.files[0]"></label><span v-if="file">{{ file.name }}</span><button>发送</button></form></section></main>
  <div v-if="adminOpen" class="modal"><section><button class="close" @click="adminOpen = false">×</button><p>ADMINISTRATION</p><h2>管理面板</h2><div class="stats"><span v-for="(value, key) in admin.stats" :key="key"><b>{{ value }}</b>{{ {users:'用户', rooms:'聊天室', messages:'消息', files:'文件'}[key] }}</span></div><h3>用户 <button @click="loadAdmin">刷新</button></h3><div v-for="member in admin.users" :key="member.id" class="member"><span>{{ member.username }} · {{ member.message_count }} 条消息</span><button @click="toggleAdmin(member)">{{ member.is_admin ? '撤销管理员' : '设为管理员' }}</button></div></section></div>
  <div v-if="toast" class="toast">{{ toast }}</div>
</template>
