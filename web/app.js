const $ = selector => document.querySelector(selector);
const state = { mode: 'login', user: null, room: null, rooms: [], lastId: 0, timer: null, roomTimer: null, eventTimer: null, eventCursor: null, unread: new Map(), notificationsEnabled: false, pendingFile: null, previewUrl: null, sending: false };

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}

function toast(text) {
  const el = $('#toast'); el.textContent = text; el.classList.add('show');
  clearTimeout(el.timeout); el.timeout = setTimeout(() => el.classList.remove('show'), 2200);
}

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  state.mode = tab.dataset.mode;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
  $('#auth-submit').textContent = state.mode === 'login' ? '登录' : '创建账号';
  $('#password').autocomplete = state.mode === 'login' ? 'current-password' : 'new-password';
  $('#auth-error').textContent = '';
}));

$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#auth-error').textContent = '';
  try {
    const data = await request(`/api/${state.mode}`, { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value }) });
    state.user = data.user; await enterChat();
  } catch (error) { $('#auth-error').textContent = error.message; }
});

async function enterChat() {
  $('#auth').classList.add('hidden'); $('#chat').classList.remove('hidden');
  $('#profile-name').textContent = state.user.username;
  updateAccountAvatars();
  await loadRooms();
  clearInterval(state.roomTimer); state.roomTimer = setInterval(loadRooms, 3000);
  setupNotifications(); await pollEvents(true);
  clearInterval(state.eventTimer); state.eventTimer = setInterval(pollEvents, 2500);
}

async function loadRooms() {
  try {
    const { rooms } = await request('/api/rooms');
    const before = state.rooms.map(room => `${room.id}:${room.name}`).join('|');
    const after = rooms.map(room => `${room.id}:${room.name}`).join('|');
    const selectedId = state.room?.id; state.rooms = rooms;
    if (selectedId) state.room = rooms.find(room => room.id === selectedId) || null;
    if (before !== after) renderRooms();
    if (!state.room && rooms.length) await selectRoom(rooms[0]);
  } catch { /* message polling owns the connection indicator */ }
}

function renderRooms() {
  $('#rooms').replaceChildren(...state.rooms.map(room => {
    const button = document.createElement('button'); button.className = 'room'; button.append(document.createTextNode(room.name));
    button.classList.toggle('active', state.room?.id === room.id);
    const unread = state.unread.get(room.id) || 0;
    if (unread) { const badge = document.createElement('span'); badge.className = 'room-badge'; badge.textContent = unread > 99 ? '99+' : String(unread); button.append(badge); }
    button.addEventListener('click', () => selectRoom(room)); return button;
  }));
}

async function selectRoom(room) {
  state.room = room; state.lastId = 0; state.unread.delete(room.id); updatePageTitle(); renderRooms();
  $('#room-name').textContent = room.name; $('#messages').replaceChildren();
  $('.sidebar').classList.remove('open');
  clearInterval(state.timer); await poll(); state.timer = setInterval(poll, 1800);
}

function setupNotifications() {
  const available = !notificationUnavailableReason();
  state.notificationsEnabled = available && Notification.permission === 'granted' && localStorage.getItem('polychat_notifications') === 'on';
  updateNotificationButton();
}

function notificationUnavailableReason(context = window) {
  if (!('Notification' in context)) return '当前浏览器不支持系统通知';
  if (!context.isSecureContext) return '系统通知需要 HTTPS；当前仍可使用房间未读角标和页面标题提醒';
  return '';
}

function updateNotificationButton() {
  const button = $('#notification-toggle');
  const unavailable = notificationUnavailableReason();
  button.classList.toggle('unavailable', Boolean(unavailable));
  if (unavailable) {
    button.textContent = window.isSecureContext ? '🔕' : '🔒'; button.title = unavailable;
    button.setAttribute('aria-label', unavailable); return;
  }
  button.classList.toggle('active', state.notificationsEnabled); button.textContent = state.notificationsEnabled ? '🔔' : '🔕';
  button.setAttribute('aria-label', state.notificationsEnabled ? '关闭通知' : '开启通知');
  button.title = state.notificationsEnabled ? '桌面通知已开启' : (Notification.permission === 'denied' ? '通知权限已被浏览器阻止' : '开启桌面通知');
}

async function toggleNotifications() {
  const unavailable = notificationUnavailableReason();
  if (unavailable) return toast(unavailable);
  if (state.notificationsEnabled) {
    state.notificationsEnabled = false; localStorage.setItem('polychat_notifications', 'off'); updateNotificationButton(); return toast('桌面通知已关闭');
  }
  let permission;
  try { permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission; }
  catch { return toast('通知权限请求失败；请确认使用 HTTPS 并检查浏览器网站权限'); }
  if (permission !== 'granted') { updateNotificationButton(); return toast('通知权限未授予；可在浏览器网站设置中开启'); }
  state.notificationsEnabled = true; localStorage.setItem('polychat_notifications', 'on'); updateNotificationButton(); toast('桌面通知已开启');
}

async function pollEvents(bootstrap = false) {
  try {
    const suffix = bootstrap || state.eventCursor == null ? '?bootstrap=1' : `?after=${state.eventCursor}`;
    const { cursor, messages } = await request(`/api/events${suffix}`); state.eventCursor = cursor;
    let changed = false;
    for (const message of messages) {
      if (message.user_id === state.user.id) continue;
      const viewing = state.room?.id === message.room_id && !document.hidden && document.hasFocus();
      if (!viewing) { state.unread.set(message.room_id, (state.unread.get(message.room_id) || 0) + 1); changed = true; }
      if (document.hidden || !document.hasFocus()) showSystemNotification(message);
    }
    if (changed) { renderRooms(); updatePageTitle(); }
  } catch { /* notification polling must not interrupt chat */ }
}

function showSystemNotification(message) {
  if (!state.notificationsEnabled || Notification.permission !== 'granted') return;
  const body = message.content?.replace(/\s+/g, ' ').slice(0, 160) || `发送了文件：${message.attachment_name || '附件'}`;
  const notification = new Notification(`${message.username} · #${message.room_name}`, { body, tag: `polychat-${message.id}` });
  notification.onclick = async () => {
    window.focus(); const room = state.rooms.find(item => item.id === message.room_id);
    if (room) await selectRoom(room); notification.close();
  };
}

function updatePageTitle() {
  const total = [...state.unread.values()].reduce((sum, count) => sum + count, 0);
  document.title = total ? `(${total > 99 ? '99+' : total}) PolyChat` : 'PolyChat';
}

async function poll() {
  if (!state.room) return;
  try {
    const { messages } = await request(`/api/rooms/${state.room.id}/messages?after=${state.lastId}`);
    if (messages.length) {
      const nearBottom = $('#messages').scrollHeight - $('#messages').scrollTop - $('#messages').clientHeight < 150;
      messages.forEach(appendMessage); state.lastId = messages.at(-1).id;
      if (nearBottom) $('#messages').scrollTop = $('#messages').scrollHeight;
    } else if (!state.lastId && !$('#messages').children.length) showEmpty();
    $('#connection').textContent = '● 已连接'; $('#connection').style.color = '';
  } catch (error) { $('#connection').textContent = '● 连接中断'; $('#connection').style.color = '#d43d51'; }
}

function showEmpty() {
  const empty = document.createElement('div'); empty.className = 'empty'; empty.innerHTML = '<div><b>这里还没有消息</b>用 Markdown 或 LaTeX 开启话题吧。</div>'; $('#messages').append(empty);
}

function escapeHtml(text) { return text.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]); }
function inline(text) {
  const tokens = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => `\u0000${tokens.push(`<code>${code}</code>`) - 1}\u0000`);
  text = text.replace(/\$([^$\n]+)\$/g, (_, math) => {
    let html; try { html = window.katex ? katex.renderToString(math, { throwOnError: false }) : `<code>$${math}$</code>`; } catch { html = `<code>$${math}$</code>`; }
    return `\u0000${tokens.push(html) - 1}\u0000`;
  });
  text = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}

function markdown(source) {
  const escaped = escapeHtml(source.replace(/\r/g, '')); const blocks = []; let text = escaped;
  text = text.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, lang, code) => `\u0001${blocks.push(`<pre data-language="${lang.trim()}"><code>${code.replace(/^\n|\n$/g, '')}</code></pre>`) - 1}\u0001`);
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    let rendered; try { rendered = window.katex ? katex.renderToString(math, { displayMode: true, throwOnError: false }) : `<code>$$${math}$$</code>`; } catch { rendered = `<code>$$${math}$$</code>`; }
    return `\u0001${blocks.push(`<div class="math-block">${rendered}</div>`) - 1}\u0001`;
  });
  const lines = text.split('\n'); const out = []; let list = false;
  for (const line of lines) {
    if (/^\u0001\d+\u0001$/.test(line.trim())) { if (list) { out.push('</ul>'); list = false; } out.push(line.trim()); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)/); const item = line.match(/^[-*]\s+(.+)/);
    if (item) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(item[1])}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (heading) out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
    else if (line.startsWith('&gt; ')) out.push(`<blockquote>${inline(line.slice(5))}</blockquote>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('').replace(/\u0001(\d+)\u0001/g, (_, i) => blocks[Number(i)]);
}

function appendMessage(message) {
  $('#messages').querySelector('.empty')?.remove();
  const article = document.createElement('article'); article.className = 'message';
  const hue = [...message.username].reduce((n, c) => n + c.codePointAt(0), 0) % 360;
  const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.style.setProperty('--avatar', `hsl(${hue} 60% 52%)`);
  if (message.avatar_updated_at) { const image = document.createElement('img'); image.src = `/api/users/${message.user_id}/avatar?v=${message.avatar_updated_at}`; image.alt = `${message.username} 的头像`; avatar.append(image); }
  else avatar.textContent = message.username[0].toUpperCase();
  const body = document.createElement('div'); const head = document.createElement('div'); head.className = 'message-head';
  const name = document.createElement('strong'); name.textContent = message.username;
  const time = document.createElement('time'); const date = new Date(message.created_at.replace(' ', 'T') + 'Z'); time.textContent = date.toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  const content = document.createElement('div'); content.className = 'markdown'; content.innerHTML = markdown(message.content || '');
  head.append(name, time); body.append(head);
  if (message.content) body.append(content);
  if (message.attachment_id) {
    const inlineTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    if (inlineTypes.has(message.attachment_type)) {
      const wrap = document.createElement('div'); wrap.className = 'image-message';
      const imageLink = document.createElement('a'); imageLink.href = `/api/files/${message.attachment_id}?inline=1`; imageLink.target = '_blank'; imageLink.rel = 'noopener';
      const image = document.createElement('img'); image.className = 'message-image'; image.src = imageLink.href; image.alt = message.attachment_name; image.loading = 'lazy';
      image.addEventListener('load', () => { const list = $('#messages'); if (list.scrollHeight - list.scrollTop - list.clientHeight < image.clientHeight + 180) list.scrollTop = list.scrollHeight; });
      imageLink.append(image);
      const footer = document.createElement('div'); const label = document.createElement('span'); label.textContent = `${message.attachment_name} · ${formatSize(message.attachment_size)}`;
      const download = document.createElement('a'); download.href = `/api/files/${message.attachment_id}`; download.download = message.attachment_name; download.textContent = '下载原图';
      footer.append(label, download); wrap.append(imageLink, footer); body.append(wrap);
    } else {
      const card = document.createElement('a'); card.className = 'file-card'; card.href = `/api/files/${message.attachment_id}`; card.target = '_blank'; card.rel = 'noopener'; card.download = message.attachment_name;
      const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = '↧';
      const info = document.createElement('div'); const fileName = document.createElement('strong'); fileName.textContent = message.attachment_name;
      const meta = document.createElement('small'); meta.textContent = `${formatSize(message.attachment_size)} · 点击下载`;
      info.append(fileName, meta); card.append(icon, info); body.append(card);
    }
  }
  article.append(avatar, body); $('#messages').append(article);
}

$('#composer').addEventListener('submit', async event => {
  event.preventDefault(); const input = $('#message-input'); const content = input.value.trim();
  if ((!content && !state.pendingFile) || !state.room || state.sending) return;
  state.sending = true; $('.send').disabled = true;
  try {
    let attachmentId = null;
    if (state.pendingFile) attachmentId = (await uploadFile(state.pendingFile)).id;
    const { message } = await request(`/api/rooms/${state.room.id}/messages`, { method:'POST', body:JSON.stringify({ content, attachment_id: attachmentId }) });
    input.value = ''; clearSelectedFile(); resizeInput();
    if (message.id > state.lastId) { appendMessage(message); state.lastId = message.id; $('#messages').scrollTop = $('#messages').scrollHeight; }
  } catch (error) { $('#attachment-status').textContent = state.pendingFile ? `${formatSize(state.pendingFile.size)} · 上传失败，可重试` : ''; toast(error.message); }
  finally { state.sending = false; $('.send').disabled = false; }
});
$('#message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#composer').requestSubmit(); } });
function resizeInput() { const el = $('#message-input'); el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 170)}px`; }
$('#message-input').addEventListener('input', resizeInput);
function formatSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
function setAvatar(image, initial, user) {
  initial.textContent = user.username.slice(0, 1).toUpperCase();
  if (user.avatar_url) { image.src = user.avatar_url; image.hidden = false; initial.hidden = true; }
  else { image.removeAttribute('src'); image.hidden = true; initial.hidden = false; }
}
function updateAccountAvatars() {
  setAvatar($('#avatar-image'), $('#avatar-initial'), state.user);
  setAvatar($('#account-avatar-image'), $('#account-avatar-initial'), state.user);
  $('#account-name').textContent = state.user.username;
  $('#remove-avatar').disabled = !state.user.avatar_url;
}
function openAccount() { updateAccountAvatars(); $('#avatar-status').textContent = ''; $('#account-modal').classList.remove('hidden'); }
function closeAccount() { $('#account-modal').classList.add('hidden'); }
async function uploadAvatar(file) {
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!file || !allowed.includes(file.type)) return toast('只支持 PNG、JPEG、WebP 或 GIF 图片');
  if (!file.size || file.size > 2 * 1024 * 1024) return toast('头像需为 1 字节至 2 MB');
  $('#avatar-status').textContent = '正在上传头像…';
  try {
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('读取头像失败')); reader.readAsDataURL(file); });
    const { user } = await request('/api/me/avatar', { method:'POST', body:JSON.stringify({ type:file.type, data:String(dataUrl).split(',', 2)[1] }) });
    state.user = user; updateAccountAvatars(); $('#avatar-status').textContent = '头像已更新'; toast('头像已更新');
  } catch (error) { $('#avatar-status').textContent = error.message; }
}
function selectFile(file, source = '等待发送') {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) return toast('单个文件不能超过 10 MB');
  if (!file.size) return toast('不能发送空文件');
  state.pendingFile = file; $('#attachment-name').textContent = file.name;
  $('#attachment-status').textContent = `${formatSize(file.size)} · ${source}`;
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
  $('#attachment-thumbnail').classList.toggle('hidden', !state.previewUrl);
  $('#attachment-preview .file-icon').classList.toggle('hidden', Boolean(state.previewUrl));
  if (state.previewUrl) $('#attachment-thumbnail').src = state.previewUrl;
  $('#attachment-preview').classList.remove('hidden');
}
function clearSelectedFile() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null; $('#attachment-thumbnail').removeAttribute('src');
  $('#attachment-thumbnail').classList.add('hidden'); $('#attachment-preview .file-icon').classList.remove('hidden');
  state.pendingFile = null; $('#file-input').value = ''; $('#attachment-preview').classList.add('hidden');
  $('#attachment-status').textContent = '';
}
async function uploadFile(file) {
  $('#attachment-status').textContent = `${formatSize(file.size)} · 正在读取`;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('读取文件失败')); reader.readAsDataURL(file);
  });
  const payload = JSON.stringify({ name: file.name, type: file.type || 'application/octet-stream', data: String(dataUrl).split(',', 2)[1] });
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/files'); xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.upload.onprogress = event => { if (event.lengthComputable) $('#attachment-status').textContent = `${formatSize(file.size)} · 上传 ${Math.round(event.loaded / event.total * 100)}%`; };
    xhr.onload = () => { let body = {}; try { body = JSON.parse(xhr.responseText); } catch { /* handled below */ } if (xhr.status >= 200 && xhr.status < 300) resolve(body.file); else reject(new Error(body.error || `上传失败 (${xhr.status})`)); };
    xhr.onerror = () => reject(new Error('上传连接中断')); xhr.send(payload);
  });
}
$('#attach-file').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', event => selectFile(event.target.files[0]));
$('#remove-attachment').addEventListener('click', clearSelectedFile);
for (const name of ['dragenter', 'dragover']) $('#composer').addEventListener(name, event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; $('#composer').classList.add('dragover'); });
for (const name of ['dragleave', 'drop']) $('#composer').addEventListener(name, event => { event.preventDefault(); $('#composer').classList.remove('dragover'); if (name === 'drop') selectFile(event.dataTransfer.files[0]); });
$('#composer').addEventListener('paste', event => {
  const item = [...(event.clipboardData?.items || [])].find(candidate => candidate.kind === 'file' && candidate.type.startsWith('image/'));
  if (!item) return;
  const image = item.getAsFile(); if (!image) return;
  event.preventDefault();
  const subtype = image.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  selectFile(new File([image], `clipboard-${stamp}.${subtype}`, { type:image.type, lastModified:Date.now() }), '来自剪贴板');
  toast('已添加剪贴板图片，按发送即可上传');
});
$('#new-room').addEventListener('click', async () => { const name = prompt('新聊天室名称'); if (!name) return; try { await request('/api/rooms', { method:'POST', body:JSON.stringify({ name }) }); await loadRooms(); } catch (e) { toast(e.message); } });
$('#avatar').addEventListener('click', openAccount);
$('#close-account').addEventListener('click', closeAccount);
$('#account-modal').addEventListener('click', event => { if (event.target === $('#account-modal')) closeAccount(); });
$('#choose-avatar').addEventListener('click', () => $('#avatar-input').click());
$('#avatar-input').addEventListener('change', event => { uploadAvatar(event.target.files[0]); event.target.value = ''; });
$('#remove-avatar').addEventListener('click', async () => {
  $('#avatar-status').textContent = '正在移除…';
  try { const { user } = await request('/api/me/avatar', { method:'DELETE' }); state.user = user; updateAccountAvatars(); $('#avatar-status').textContent = '头像已移除'; }
  catch (error) { $('#avatar-status').textContent = error.message; }
});
$('#notification-toggle').addEventListener('click', toggleNotifications);
function markCurrentRoomRead() {
  if (!state.room || document.hidden || !document.hasFocus() || !state.unread.has(state.room.id)) return;
  state.unread.delete(state.room.id); renderRooms(); updatePageTitle();
}
document.addEventListener('visibilitychange', markCurrentRoomRead);
window.addEventListener('focus', markCurrentRoomRead);
$('#logout').addEventListener('click', async () => { await request('/api/logout', { method:'POST' }); location.reload(); });
$('#sidebar-toggle').addEventListener('click', () => $('.sidebar').classList.toggle('open'));

(async () => { try { const { user } = await request('/api/me'); state.user = user; await enterChat(); } catch { /* show login */ } })();
