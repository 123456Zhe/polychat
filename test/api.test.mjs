import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporary = mkdtempSync(join(tmpdir(), 'polychat-test-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = join(temporary, 'test.db');
process.env.UPLOAD_DIR = join(temporary, 'uploads');
process.env.AVATAR_DIR = join(temporary, 'avatars');
process.env.FILE_URL_SECRET = 'test-file-secret';
const { server, db, cleanupExpiredData } = await import('../server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  rmSync(temporary, { recursive: true, force: true });
});

async function api(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  return { response, body: await response.json() };
}

async function openSocket(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 2000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return socket;
}

function onebotAction(socket, action, params = {}) {
  const echo = `test-${Date.now()}-${Math.random()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`OneBot ${action} 响应超时`)), 2000);
    const listener = event => {
      const payload = JSON.parse(event.data);
      if (payload.echo !== echo) return;
      clearTimeout(timer);
      socket.removeEventListener('message', listener);
      resolve(payload);
    };
    socket.addEventListener('message', listener);
    socket.send(JSON.stringify({ action, params, echo }));
  });
}

test('注册、登录和持久化聊天完整流程', async () => {
  const registered = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'correct-horse' }) });
  assert.equal(registered.response.status, 201);
  assert.ok(registered.body.token);
  const auth = { authorization: `Bearer ${registered.body.token}` };

  const rooms = await api('/api/rooms', { headers: auth });
  assert.equal(rooms.body.rooms[0].name, '大厅');

  const created = await api('/api/rooms', { method: 'POST', headers: auth, body: JSON.stringify({ name: '技术交流' }) });
  assert.equal(created.response.status, 201);
  const roomId = created.body.room.id;

  const content = '# Markdown\n公式：$E=mc^2$\n<script>alert(1)</script>';
  const sent = await api(`/api/rooms/${roomId}/messages`, { method: 'POST', headers: auth, body: JSON.stringify({ content }) });
  assert.equal(sent.response.status, 201);
  const history = await api(`/api/rooms/${roomId}/messages`, { headers: auth });
  assert.equal(history.body.messages[0].content, content);
  assert.equal(history.body.messages[0].username, 'alice');

  const stored = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('alice');
  assert.ok(!stored.password_hash.includes('correct-horse'));

  const login = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'correct-horse' }) });
  assert.equal(login.response.status, 200);
});

test('拒绝未认证访问和弱密码', async () => {
  const rooms = await api('/api/rooms');
  assert.equal(rooms.response.status, 401);
  const weak = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'bob', password: '123' }) });
  assert.equal(weak.response.status, 400);
});

test('管理员面板只允许管理员查看和管理权限', async () => {
  const adminLogin = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'correct-horse' }) });
  const adminAuth = { authorization: `Bearer ${adminLogin.body.token}` };
  const member = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'member_admin', password: 'member-password' }) });
  const memberAuth = { authorization: `Bearer ${member.body.token}` };

  const denied = await api('/api/admin/overview', { headers: memberAuth });
  assert.equal(denied.response.status, 403);
  const overview = await api('/api/admin/overview', { headers: adminAuth });
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.stats.users >= 2, true);

  const promoted = await api(`/api/admin/users/${member.body.user.id}/admin`, { method: 'PUT', headers: adminAuth, body: JSON.stringify({ is_admin: true }) });
  assert.equal(promoted.body.user.is_admin, true);
});

test('上传、发送和鉴权下载附件', async () => {
  const registered = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'file_user', password: 'file-password' }) });
  const auth = { authorization: `Bearer ${registered.body.token}` };
  const original = Buffer.from('PolyChat file transfer 测试\n');
  const uploaded = await api('/api/files', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: '说明 文档.txt', type: 'text/plain', data: original.toString('base64') })
  });
  assert.equal(uploaded.response.status, 201);
  assert.equal(uploaded.body.file.size, original.length);

  const sent = await api('/api/rooms/1/messages', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ content: '', attachment_id: uploaded.body.file.id })
  });
  assert.equal(sent.response.status, 201);
  assert.equal(sent.body.message.attachment_name, '说明 文档.txt');

  const denied = await fetch(`${base}/api/files/${uploaded.body.file.id}`);
  assert.equal(denied.status, 401);
  const downloaded = await fetch(`${base}/api/files/${uploaded.body.file.id}`, { headers: auth });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), original);
  assert.match(downloaded.headers.get('content-disposition'), /filename\*=UTF-8''/);
  const textInlineAttempt = await fetch(`${base}/api/files/${uploaded.body.file.id}?inline=1`, { headers: auth });
  assert.match(textInlineAttempt.headers.get('content-disposition'), /^attachment;/);
});

test('全局消息事件支持增量通知且不回放旧消息', async () => {
  const first = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'notify_a', password: 'notify-password-a' }) });
  const second = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'notify_b', password: 'notify-password-b' }) });
  const firstAuth = { authorization: `Bearer ${first.body.token}` };
  const secondAuth = { authorization: `Bearer ${second.body.token}` };

  const bootstrap = await api('/api/events?bootstrap=1', { headers: firstAuth });
  assert.deepEqual(bootstrap.body.messages, []);
  const sent = await api('/api/rooms/1/messages', { method: 'POST', headers: secondAuth, body: JSON.stringify({ content: '跨客户端通知' }) });
  const events = await api(`/api/events?after=${bootstrap.body.cursor}`, { headers: firstAuth });
  assert.equal(events.body.messages.length, 1);
  assert.equal(events.body.messages[0].id, sent.body.message.id);
  assert.equal(events.body.messages[0].username, 'notify_b');
  assert.equal(events.body.messages[0].room_name, '大厅');
});

test('WebSocket 实时推送消息和消息更新事件', async () => {
  const registered = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'socket_user', password: 'socket-password' }) });
  const peer = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'socket_peer', password: 'socket-peer-password' }) });
  const auth = { authorization: `Bearer ${registered.body.token}` };
  const socket = new WebSocket(`${base.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(registered.body.token)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 2000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const peerSocket = new WebSocket(`${base.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(peer.body.token)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('第二个 WebSocket 连接超时')), 2000);
    peerSocket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    peerSocket.addEventListener('error', reject, { once: true });
  });
  const nextEvent = type => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`未收到 ${type} 事件`)), 2000);
    const listener = event => {
      const payload = JSON.parse(event.data);
      if (payload.type !== type) return;
      clearTimeout(timer); socket.removeEventListener('message', listener); resolve(payload);
    };
    socket.addEventListener('message', listener);
  });
  const pushed = nextEvent('message');
  const sent = await api('/api/rooms/1/messages', { method: 'POST', headers: auth, body: JSON.stringify({ content: '实时消息' }) });
  assert.equal((await pushed).message_id, sent.body.message.id);
  const updated = nextEvent('message_update');
  await api(`/api/messages/${sent.body.message.id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ content: '实时编辑' }) });
  assert.equal((await updated).message_id, sent.body.message.id);
  const typing = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('未收到 typing 事件')), 2000);
    const listener = event => { const payload = JSON.parse(event.data); if (payload.type !== 'typing') return; clearTimeout(timer); peerSocket.removeEventListener('message', listener); resolve(payload); };
    peerSocket.addEventListener('message', listener);
  });
  socket.send(JSON.stringify({ type: 'typing', room_id: 1, typing: true }));
  assert.equal((await typing).username, 'socket_user');
  socket.close(); peerSocket.close();
});

test('消息历史支持从最新批次开始并向上分页加载', async () => {
  const registered = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'history_user', password: 'history-password' }) });
  const auth = { authorization: `Bearer ${registered.body.token}` };
  const created = await api('/api/rooms', { method: 'POST', headers: auth, body: JSON.stringify({ name: '历史加载测试', is_private: true }) });
  const roomId = created.body.room.id;
  const ids = [];
  for (const content of ['第一条', '第二条', '第三条', '第四条', '第五条']) {
    const sent = await api(`/api/rooms/${roomId}/messages`, { method: 'POST', headers: auth, body: JSON.stringify({ content }) });
    ids.push(sent.body.message.id);
  }

  const latest = await api(`/api/rooms/${roomId}/messages?before=9007199254740991&limit=2`, { headers: auth });
  assert.deepEqual(latest.body.messages.map(message => message.id), ids.slice(-2));
  assert.equal(latest.body.has_more, true);

  const older = await api(`/api/rooms/${roomId}/messages?before=${latest.body.messages[0].id}&limit=2`, { headers: auth });
  assert.deepEqual(older.body.messages.map(message => message.id), ids.slice(1, 3));
  assert.equal(older.body.has_more, true);
});

test('消息支持回复、编辑、撤回、表情、搜索与私有房间权限', async () => {
  const owner = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'feature_owner', password: 'feature-password-owner' }) });
  const guest = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'feature_guest', password: 'feature-password-guest' }) });
  const ownerAuth = { authorization: `Bearer ${owner.body.token}` }, guestAuth = { authorization: `Bearer ${guest.body.token}` };
  const privateRoom = await api('/api/rooms', { method: 'POST', headers: ownerAuth, body: JSON.stringify({ name: '私有功能测试', is_private: true }) });
  const roomId = privateRoom.body.room.id;
  // A2：私有房对非成员在列表可见（is_private=true），但消息仍不可读
  const listed = await api('/api/rooms', { headers: guestAuth });
  assert.equal(listed.body.rooms.some(room => room.id === roomId), true);
  assert.equal(listed.body.rooms.find(room => room.id === roomId).is_private, true);
  assert.equal((await api(`/api/rooms/${roomId}/messages`, { headers: guestAuth })).response.status, 403);

  const first = await api(`/api/rooms/${roomId}/messages`, { method: 'POST', headers: ownerAuth, body: JSON.stringify({ content: '可搜索的原消息' }) });
  const threadReply = await api(`/api/rooms/${roomId}/messages`, { method: 'POST', headers: ownerAuth, body: JSON.stringify({ content: '话题内回复', thread_root: first.body.message.id }) });
  assert.equal(threadReply.body.message.thread_root, first.body.message.id);
  const thread = await api(`/api/messages/${first.body.message.id}/thread`, { headers: ownerAuth });
  assert.deepEqual(thread.body.messages.map(message => message.content), ['可搜索的原消息', '话题内回复']);
  const mainTimeline = await api(`/api/rooms/${roomId}/messages`, { headers: ownerAuth });
  assert.equal(mainTimeline.body.messages.some(message => message.id === threadReply.body.message.id), false);
  assert.equal((await api(`/api/rooms/${roomId}/pins/${first.body.message.id}`, { method: 'PUT', headers: ownerAuth })).response.status, 200);
  const pins = await api(`/api/rooms/${roomId}/pins`, { headers: ownerAuth });
  assert.equal(pins.body.messages[0].id, first.body.message.id);
  const reply = await api(`/api/rooms/${roomId}/messages`, { method: 'POST', headers: ownerAuth, body: JSON.stringify({ content: '这是回复', reply_to: first.body.message.id }) });
  assert.equal(reply.body.message.reply_to, first.body.message.id);
  assert.equal(reply.body.message.reply_content, '可搜索的原消息');
  const reaction = await api(`/api/messages/${first.body.message.id}/reactions`, { method: 'POST', headers: ownerAuth, body: JSON.stringify({ emoji: '🔥' }) });
  assert.deepEqual(reaction.body.reactions, [{ emoji: '🔥', count: 1, reacted: true }]);
  const edited = await api(`/api/messages/${first.body.message.id}`, { method: 'PUT', headers: ownerAuth, body: JSON.stringify({ content: '可搜索的已编辑消息' }) });
  assert.equal(edited.body.message.content, '可搜索的已编辑消息');
  const found = await api('/api/search?q=已编辑', { headers: ownerAuth });
  assert.equal(found.body.messages[0].id, first.body.message.id);
  await api(`/api/rooms/${roomId}/members`, { method: 'POST', headers: ownerAuth, body: JSON.stringify({ username: 'feature_guest' }) });
  const joined = await api('/api/rooms', { headers: guestAuth });
  assert.equal(joined.body.rooms.some(room => room.id === roomId), true);
  const retracted = await api(`/api/messages/${first.body.message.id}`, { method: 'DELETE', headers: ownerAuth });
  assert.equal(retracted.response.status, 200);
  const history = await api(`/api/rooms/${roomId}/messages`, { headers: ownerAuth });
  assert.equal(history.body.messages.find(message => message.id === first.body.message.id).is_deleted, true);
  const publicDenied = await api('/api/rooms', { method: 'POST', headers: guestAuth, body: JSON.stringify({ name: '普通用户不能建公共房', is_private: false }) });
  assert.equal(publicDenied.response.status, 403);
  const renamed = await api(`/api/rooms/${roomId}`, { method: 'PUT', headers: ownerAuth, body: JSON.stringify({ name: '已改名的私有功能测试' }) });
  assert.equal(renamed.body.room.name, '已改名的私有功能测试');
  const deleted = await api(`/api/rooms/${roomId}`, { method: 'DELETE', headers: ownerAuth });
  assert.equal(deleted.response.status, 200);
});

test('账户头像支持安全上传、展示、历史消息关联和移除', async () => {
  const registered = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'avatar_user', password: 'avatar-password' }) });
  const auth = { authorization: `Bearer ${registered.body.token}` };
  const avatar = readFileSync(new URL('../assets/polychat-icon.png', import.meta.url));

  const uploaded = await api('/api/me/avatar', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ type: 'image/png', data: avatar.toString('base64') })
  });
  assert.equal(uploaded.response.status, 200);
  assert.match(uploaded.body.user.avatar_url, /^\/api\/users\/\d+\/avatar\?v=/);

  const downloaded = await fetch(base + uploaded.body.user.avatar_url, { headers: auth });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), avatar);

  const sent = await api('/api/rooms/1/messages', { method: 'POST', headers: auth, body: JSON.stringify({ content: '带头像的消息' }) });
  assert.equal(sent.body.message.avatar_updated_at, uploaded.body.user.avatar_updated_at);

  const invalid = await api('/api/me/avatar', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ type: 'image/svg+xml', data: Buffer.from('<svg/>').toString('base64') })
  });
  assert.equal(invalid.response.status, 400);

  const removed = await api('/api/me/avatar', { method: 'DELETE', headers: auth });
  assert.equal(removed.body.user.avatar_url, null);
  const missing = await fetch(base + uploaded.body.user.avatar_url, { headers: auth });
  assert.equal(missing.status, 404);
});

test('Web Push VAPID 公钥和订阅可持久化及注销', async () => {
  const registered = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'push_user', password: 'push-user-password' }) });
  const auth = { authorization: `Bearer ${registered.body.token}` };
  const key = await api('/api/push/vapid-public-key', { headers: auth });
  assert.equal(key.response.status, 200);
  assert.match(key.body.publicKey, /^[A-Za-z0-9_-]{80,100}$/);
  const subscription = { endpoint: 'https://push.example.test/subscription-1', keys: { p256dh: 'test-p256dh', auth: 'test-auth' } };
  assert.equal((await api('/api/push/subscriptions', { method: 'POST', headers: auth, body: JSON.stringify(subscription) })).response.status, 200);
  assert.equal(db.prepare('SELECT user_id FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint).user_id, registered.body.user.id);
  assert.equal((await api('/api/push/subscriptions', { method: 'DELETE', headers: auth, body: JSON.stringify({ endpoint: subscription.endpoint }) })).response.status, 200);
  assert.equal(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint), undefined);
});

test('好友请求、接受和好友列表', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'friend_alice', password: 'friend-password-1' }) });
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'friend_bob', password: 'friend-password-2' }) });
  const aliceAuth = { authorization: `Bearer ${alice.body.token}` };
  const bobAuth = { authorization: `Bearer ${bob.body.token}` };

  // Alice sends friend request to Bob
  const request = await api('/api/friends/request', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'friend_bob' }) });
  assert.equal(request.response.status, 201);

  // Cannot send duplicate request
  const dup = await api('/api/friends/request', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'friend_bob' }) });
  assert.equal(dup.response.status, 409);

  // Cannot add self
  const self = await api('/api/friends/request', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'friend_alice' }) });
  assert.equal(self.response.status, 400);

  // Bob sees incoming request
  const bobFriends = await api('/api/friends', { headers: bobAuth });
  assert.equal(bobFriends.body.incoming.length, 1);
  assert.equal(bobFriends.body.incoming[0].username, 'friend_alice');

  // Alice sees outgoing request
  const aliceFriends = await api('/api/friends', { headers: aliceAuth });
  assert.equal(aliceFriends.body.outgoing.length, 1);
  assert.equal(aliceFriends.body.outgoing[0].username, 'friend_bob');

  // Bob declines then re-requests and accepts
  await api(`/api/friends/${alice.body.user.id}/decline`, { method: 'POST', headers: bobAuth });
  await api('/api/friends/request', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'friend_bob' }) });
  await api(`/api/friends/${alice.body.user.id}/accept`, { method: 'POST', headers: bobAuth });

  // Both now see accepted
  const afterAccept = await api('/api/friends', { headers: aliceAuth });
  assert.equal(afterAccept.body.accepted.length >= 1, true);
  assert.ok(afterAccept.body.accepted.some(f => f.username === 'friend_bob'));

  // Remove friend
  await api(`/api/friends/${bob.body.user.id}`, { method: 'DELETE', headers: aliceAuth });
  const afterRemove = await api('/api/friends', { headers: aliceAuth });
  assert.ok(!afterRemove.body.accepted.some(f => f.username === 'friend_bob'));
});

test('私信会话创建、消息发送、未读和已读', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'dm_alice', password: 'dm-password-1' }) });
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'dm_bob', password: 'dm-password-2' }) });
  const aliceAuth = { authorization: `Bearer ${alice.body.token}` };
  const bobAuth = { authorization: `Bearer ${bob.body.token}` };

  // Must be friends first
  await api('/api/friends/request', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'dm_bob' }) });
  await api(`/api/friends/${alice.body.user.id}/accept`, { method: 'POST', headers: bobAuth });

  // Cannot DM non-friend
  const charlie = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'dm_charlie', password: 'dm-password-3' }) });
  const charlieAuth = { authorization: `Bearer ${charlie.body.token}` };
  const noFriendDm = await api('/api/dm/conversations', { method: 'POST', headers: charlieAuth, body: JSON.stringify({ username: 'dm_alice' }) });
  assert.equal(noFriendDm.response.status, 403);

  // Cannot DM self
  const selfDm = await api('/api/dm/conversations', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'dm_alice' }) });
  assert.equal(selfDm.response.status, 400);

  // Create DM conversation
  const conv = await api('/api/dm/conversations', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'dm_bob' }) });
  assert.equal(conv.response.status, 201);
  const convId = conv.body.conversation.id;
  assert.ok(conv.body.conversation.peer);

  // Creating again returns existing
  const conv2 = await api('/api/dm/conversations', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'dm_bob' }) });
  assert.equal(conv2.body.conversation.id, convId);

  // Send DM
  const sent = await api(`/api/dm/conversations/${convId}/messages`, { method: 'POST', headers: aliceAuth, body: JSON.stringify({ content: '私信你好' }) });
  assert.equal(sent.response.status, 201);
  assert.equal(sent.body.message.content, '私信你好');

  // Bob reads messages
  const bobMsgs = await api(`/api/dm/conversations/${convId}/messages`, { headers: bobAuth });
  assert.equal(bobMsgs.body.messages.length, 1);
  assert.equal(bobMsgs.body.messages[0].content, '私信你好');

  // Bob sees unread = 1
  const bobConvs = await api('/api/dm/conversations', { headers: bobAuth });
  assert.equal(bobConvs.body.conversations[0].unread, 1);

  // Mark read
  await api(`/api/dm/conversations/${convId}/read`, { method: 'POST', headers: bobAuth, body: JSON.stringify({ message_id: sent.body.message.id }) });
  const bobConvs2 = await api('/api/dm/conversations', { headers: bobAuth });
  assert.equal(bobConvs2.body.conversations[0].unread, 0);

  // Edit DM
  const edited = await api(`/api/dm/messages/${sent.body.message.id}`, { method: 'PUT', headers: aliceAuth, body: JSON.stringify({ content: '已编辑' }) });
  assert.equal(edited.body.message.content, '已编辑');

  // Retract DM
  await api(`/api/dm/messages/${sent.body.message.id}`, { method: 'DELETE', headers: aliceAuth });
  const retracted = await api(`/api/dm/conversations/${convId}/messages`, { headers: bobAuth });
  assert.equal(retracted.body.messages[0].is_deleted, true);

  // DM reactions
  const sent2 = await api(`/api/dm/conversations/${convId}/messages`, { method: 'POST', headers: bobAuth, body: JSON.stringify({ content: '表情测试' }) });
  const reactions = await api(`/api/dm/messages/${sent2.body.message.id}/reactions`, { method: 'POST', headers: aliceAuth, body: JSON.stringify({ emoji: '👍' }) });
  assert.equal(reactions.body.reactions.length, 1);
  assert.equal(reactions.body.reactions[0].emoji, '👍');
});

test('WebSocket 实时推送私信和好友事件', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'ws_dm_alice', password: 'ws-dm-password-1' }) });
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'ws_dm_bob', password: 'ws-dm-password-2' }) });
  const aliceAuth = { authorization: `Bearer ${alice.body.token}` };
  const bobAuth = { authorization: `Bearer ${bob.body.token}` };

  await api('/api/friends/request', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'ws_dm_bob' }) });
  await api(`/api/friends/${alice.body.user.id}/accept`, { method: 'POST', headers: bobAuth });

  const socket = new WebSocket(`${base.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(alice.body.token)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 2000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  const nextEvent = type => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`未收到 ${type} 事件`)), 2000);
    const listener = event => {
      const payload = JSON.parse(event.data);
      if (payload.type !== type) return;
      clearTimeout(timer); socket.removeEventListener('message', listener); resolve(payload);
    };
    socket.addEventListener('message', listener);
  });

  // Create DM and send from Bob, Alice should receive dm_message
  const conv = await api('/api/dm/conversations', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'ws_dm_bob' }) });
  const convId = conv.body.conversation.id;
  const dmEvent = nextEvent('dm_message');
  await api(`/api/dm/conversations/${convId}/messages`, { method: 'POST', headers: bobAuth, body: JSON.stringify({ content: 'ws 私信' }) });
  const received = await dmEvent;
  assert.equal(received.conversation_id, convId);
  assert.equal(received.message.content, 'ws 私信');

  // Room message should also arrive with full payload
  const roomEvent = nextEvent('message');
  await api('/api/rooms/1/messages', { method: 'POST', headers: bobAuth, body: JSON.stringify({ content: 'ws 房间' }) });
  const roomReceived = await roomEvent;
  assert.equal(roomReceived.message.content, 'ws 房间');

  socket.close();
});

test('机器人申请校验、审批和通知 Token 完整流程', async () => {
  const requester = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'bot_requester', password: 'bot-request-password' }) });
  const requesterAuth = { authorization: `Bearer ${requester.body.token}` };
  const adminLogin = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'correct-horse' }) });
  const adminAuth = { authorization: `Bearer ${adminLogin.body.token}` };

  const invalid = await api('/api/bot-requests', { method: 'POST', headers: requesterAuth, body: JSON.stringify({ name: '!', reason: '' }) });
  assert.equal(invalid.response.status, 400);
  const existing = await api('/api/bot-requests', { method: 'POST', headers: requesterAuth, body: JSON.stringify({ name: 'alice', reason: '' }) });
  assert.equal(existing.response.status, 409);

  const submitted = await api('/api/bot-requests', { method: 'POST', headers: requesterAuth, body: JSON.stringify({ name: 'approved_bot', reason: '自动回复' }) });
  assert.equal(submitted.response.status, 201);
  const duplicate = await api('/api/bot-requests', { method: 'POST', headers: requesterAuth, body: JSON.stringify({ name: 'APPROVED_BOT', reason: '' }) });
  assert.equal(duplicate.response.status, 409);

  const requests = await api('/api/admin/bot-requests', { headers: adminAuth });
  const request = requests.body.requests.find(item => item.name === 'approved_bot');
  assert.ok(request);
  const approved = await api(`/api/admin/bot-requests/${request.id}`, { method: 'PUT', headers: adminAuth, body: JSON.stringify({ status: 'approved' }) });
  assert.equal(approved.response.status, 200);

  const notifications = await api('/api/notifications', { headers: requesterAuth });
  const notification = notifications.body.notifications.find(item => item.data?.bot_request_id === request.id);
  assert.equal(notification.type, 'bot_approval');
  assert.match(notification.data.token, /^[A-Za-z0-9_-]+$/);
  const marked = await api(`/api/notifications/${notification.id}/read`, { method: 'PUT', headers: requesterAuth });
  assert.equal(marked.response.status, 200);
  const unread = await api('/api/notifications/unread-count', { headers: requesterAuth });
  assert.equal(unread.body.count, 0);
  const tokens = await api('/api/admin/bot/tokens', { headers: adminAuth });
  assert.ok(tokens.body.tokens.some(item => item.token === notification.data.token));
  const revoked = await api(`/api/admin/bot/tokens/${notification.data.token}`, { method: 'DELETE', headers: adminAuth });
  assert.equal(revoked.response.status, 200);
  const afterRevoke = await api('/api/admin/bot/tokens', { headers: adminAuth });
  assert.ok(!afterRevoke.body.tokens.some(item => item.token === notification.data.token));
});

test('OneBot 遵守消息权限、好友限制和账号处罚状态', async () => {
  const adminLogin = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'correct-horse' }) });
  const adminAuth = { authorization: `Bearer ${adminLogin.body.token}` };
  const bot = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'policy_bot', password: 'policy-bot-password' }) });
  const target = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'policy_target', password: 'policy-target-password' }) });
  const owner = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'policy_owner', password: 'policy-owner-password' }) });
  const botAuth = { authorization: `Bearer ${bot.body.token}` };
  const targetAuth = { authorization: `Bearer ${target.body.token}` };
  const ownerAuth = { authorization: `Bearer ${owner.body.token}` };

  const tokenResult = await api('/api/admin/bot/tokens', {
    method: 'POST', headers: adminAuth, body: JSON.stringify({ user_id: bot.body.user.id, name: 'Policy test' })
  });
  assert.equal(tokenResult.response.status, 201);
  const socket = await openSocket(`${base.replace('http:', 'ws:')}/api/onebot/ws?token=${encodeURIComponent(tokenResult.body.token.token)}`);

  const publicMember = await onebotAction(socket, 'get_group_member_info', { group_id: 1, user_id: target.body.user.id });
  assert.equal(publicMember.status, 'ok');
  assert.equal(publicMember.data.nickname, 'policy_target');
  const publicMembers = await onebotAction(socket, 'get_group_member_list', { group_id: 1 });
  assert.ok(publicMembers.data.some(member => member.user_id === target.body.user.id));

  const privateRoom = await api('/api/rooms', { method: 'POST', headers: ownerAuth, body: JSON.stringify({ name: 'OneBot私密测试', is_private: true }) });
  const secret = await api(`/api/rooms/${privateRoom.body.room.id}/messages`, { method: 'POST', headers: ownerAuth, body: JSON.stringify({ content: '不可越权读取' }) });
  const deniedRead = await onebotAction(socket, 'get_msg', { message_id: secret.body.message.id });
  assert.equal(deniedRead.status, 'failed');
  assert.equal(deniedRead.retcode, 403);
  const deniedGroupSend = await onebotAction(socket, 'send_group_msg', { group_id: privateRoom.body.room.id, message: '不可写入' });
  assert.equal(deniedGroupSend.status, 'failed');
  const deniedHistory = await onebotAction(socket, 'get_group_msg_history', { group_id: privateRoom.body.room.id });
  assert.equal(deniedHistory.status, 'failed');

  const deniedDm = await onebotAction(socket, 'send_private_msg', { user_id: target.body.user.id, message: '非好友消息' });
  assert.equal(deniedDm.status, 'failed');
  assert.equal(deniedDm.retcode, 403);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM dm_members a JOIN dm_members b ON b.conversation_id = a.conversation_id
    WHERE a.user_id = ? AND b.user_id = ?`).get(bot.body.user.id, target.body.user.id).count, 0);

  await api('/api/friends/request', { method: 'POST', headers: botAuth, body: JSON.stringify({ username: 'policy_target' }) });
  await api(`/api/friends/${bot.body.user.id}/accept`, { method: 'POST', headers: targetAuth });
  const allowedDm = await onebotAction(socket, 'send_private_msg', { user_id: target.body.user.id, message: '好友消息' });
  assert.equal(allowedDm.status, 'ok');

  await api(`/api/admin/users/${bot.body.user.id}/mute`, { method: 'PUT', headers: adminAuth, body: JSON.stringify({ duration_hours: 1 }) });
  const muted = await onebotAction(socket, 'send_group_msg', { group_id: 1, message: '禁言消息' });
  assert.equal(muted.status, 'failed');
  assert.equal(muted.retcode, 403);
  await api(`/api/admin/users/${bot.body.user.id}/unmute`, { method: 'PUT', headers: adminAuth });

  const disconnected = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('封禁后 OneBot 连接未断开')), 2000);
    socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  await api(`/api/admin/users/${bot.body.user.id}/ban`, { method: 'PUT', headers: adminAuth, body: JSON.stringify({ duration_hours: 1 }) });
  await disconnected;
});

test('OneBot 机器人能读取图片和附件', async () => {
  const adminLogin = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'correct-horse' }) });
  const adminAuth = { authorization: `Bearer ${adminLogin.body.token}` };
  const sender = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'img_sender', password: 'img-sender-password' }) });
  const senderAuth = { authorization: `Bearer ${sender.body.token}` };
  const bot = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'img_bot', password: 'img-bot-password' }) });

  const tokenResult = await api('/api/admin/bot/tokens', {
    method: 'POST', headers: adminAuth, body: JSON.stringify({ user_id: bot.body.user.id, name: 'Image bot' })
  });
  assert.equal(tokenResult.response.status, 201);
  const socket = await openSocket(`${base.replace('http:', 'ws:')}/api/onebot/ws?token=${encodeURIComponent(tokenResult.body.token.token)}`);
  try {

  const nextBotMessage = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('未收到机器人 message 事件')), 2000);
    const listener = event => {
      const payload = JSON.parse(event.data);
      if (payload.post_type !== 'message' || payload.message_type !== 'group') return;
      clearTimeout(timer); socket.removeEventListener('message', listener); resolve(payload);
    };
    socket.addEventListener('message', listener);
  });

  // 1) 实时推送：图片消息应转为 image 段，且 file 为可免登录下载的绝对能力 URL
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const uploaded = await api('/api/files', {
    method: 'POST', headers: senderAuth,
    body: JSON.stringify({ name: 'pixel.png', type: 'image/png', data: png.toString('base64') })
  });
  assert.equal(uploaded.response.status, 201);

  const botEvent = nextBotMessage();
  const sent = await api('/api/rooms/1/messages', {
    method: 'POST', headers: senderAuth,
    body: JSON.stringify({ content: '', attachment_id: uploaded.body.file.id })
  });
  assert.equal(sent.response.status, 201);
  const received = await botEvent;
  const imageSeg = received.message.find(seg => seg.type === 'image');
  assert.ok(imageSeg, '图片应转为 image 段');
  assert.match(imageSeg.data.file, /^https?:\/\/.+\/api\/public\/files\/[A-Za-z0-9]+\?expires=\d+&sig=[a-f0-9]+$/);
  const fetched = await fetch(imageSeg.data.file);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.headers.get('content-type'), 'image/png');
  assert.match(fetched.headers.get('content-disposition'), /^inline;/);
  assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), png);

  // 2) get_msg 返回 image 段（修复前会退化成 file 段）
  const got = await onebotAction(socket, 'get_msg', { message_id: sent.body.message.id });
  assert.equal(got.status, 'ok');
  const gotImg = got.data.message.find(seg => seg.type === 'image');
  assert.ok(gotImg, 'get_msg 应返回 image 段');
  assert.match(gotImg.data.file, /\/api\/public\/files\/[A-Za-z0-9]+\?expires=\d+&sig=[a-f0-9]+$/);

  // 3) get_group_msg_history 同样返回 image 段
  const history = await onebotAction(socket, 'get_group_msg_history', { group_id: 1 });
  const histMsg = history.data.messages.find(m => m.message_id === sent.body.message.id);
  assert.ok(histMsg, '历史中应能找到该消息');
  assert.ok(histMsg.message.some(seg => seg.type === 'image'), '历史消息应含 image 段');

  // 4) 非图片附件 → file 段 + 文件名 + 可下载 URL
  const textFile = Buffer.from('PolyChat bot file 测试\n');
  const uploadedText = await api('/api/files', {
    method: 'POST', headers: senderAuth,
    body: JSON.stringify({ name: '机器人说明.txt', type: 'text/plain', data: textFile.toString('base64') })
  });
  const sentText = await api('/api/rooms/1/messages', {
    method: 'POST', headers: senderAuth,
    body: JSON.stringify({ content: '', attachment_id: uploadedText.body.file.id })
  });
  const gotText = await onebotAction(socket, 'get_msg', { message_id: sentText.body.message.id });
  const fileSeg = gotText.data.message.find(seg => seg.type === 'file');
  assert.ok(fileSeg, '非图片附件应为 file 段');
  assert.equal(fileSeg.data.name, '机器人说明.txt');
  assert.match(fileSeg.data.file, /^https?:\/\/.+\/api\/public\/files\/[A-Za-z0-9]+\?expires=\d+&sig=[a-f0-9]+$/);
  const fetchedText = await fetch(fileSeg.data.file);
  assert.equal(fetchedText.status, 200);
  assert.deepEqual(Buffer.from(await fetchedText.arrayBuffer()), textFile);

  // 5) 未知 stored_name → 404
  const tampered = fileSeg.data.file.replace(/sig=[a-f0-9]+/, 'sig=0');
  assert.equal((await fetch(tampered)).status, 403);
  const missingName = '000000000000000000000000000000000000000000000000';
  const expires = Date.now() + 60_000;
  const sig = createHmac('sha256', 'test-file-secret').update(`${missingName}:${expires}`).digest('hex');
  const missing = await fetch(`${base}/api/public/files/${missingName}?expires=${expires}&sig=${sig}`);
  assert.equal(missing.status, 404);

  } finally {
    socket.close();
  }
});

test('P2P 直传：配置、创建、审批、信令转发与完成消息', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'p2p_alice', password: 'p2p-password-1' }) });
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'p2p_bob', password: 'p2p-password-2' }) });
  const charlie = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'p2p_charlie', password: 'p2p-password-3' }) });
  const aliceAuth = { authorization: `Bearer ${alice.body.token}` };
  const bobAuth = { authorization: `Bearer ${bob.body.token}` };
  const charlieAuth = { authorization: `Bearer ${charlie.body.token}` };

  await api('/api/friends/request', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'p2p_bob' }) });
  await api(`/api/friends/${alice.body.user.id}/accept`, { method: 'POST', headers: bobAuth });
  const conv = await api('/api/dm/conversations', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'p2p_bob' }) });
  const convId = conv.body.conversation.id;

  // /api/p2p/config 需要登录，且返回 STUN 列表与 P2P 阈值
  const cfg = await api('/api/p2p/config');
  assert.equal(cfg.response.status, 401);
  const cfg2 = await api('/api/p2p/config', { headers: aliceAuth });
  assert.equal(cfg2.response.status, 200);
  assert.ok(cfg2.body.ice_servers.length >= 1);
  assert.equal(cfg2.body.ice_servers[0].urls.includes('stun:stun.l.google.com:19302'), true);
  assert.equal(typeof cfg2.body.min_size, 'number');

  // 非会话成员不能创建直传
  const nonMember = await api('/api/p2p/transfers', { method: 'POST', headers: charlieAuth, body: JSON.stringify({ conversation_id: convId, name: 'x.bin', size: 1024, type: 'application/octet-stream' }) });
  assert.equal(nonMember.response.status, 403);

  // 接收者离线时 peer_online=false，状态 pending，并携带文字内容
  const created = await api('/api/p2p/transfers', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ conversation_id: convId, name: 'big.iso', size: 6 * 1024 * 1024, type: 'application/octet-stream', content: '测试直传' }) });
  assert.equal(created.response.status, 201);
  const transferId = created.body.transfer.id;
  assert.equal(created.body.transfer.peer_online, false);
  assert.equal(created.body.transfer.status, 'pending');
  assert.equal(created.body.transfer.name, 'big.iso');

  // 非成员不能查看
  const getForbidden = await api(`/api/p2p/transfers/${transferId}`, { headers: charlieAuth });
  assert.equal(getForbidden.response.status, 404);

  // 只有接收者可以 accept，且只能在 pending 状态
  const senderAccept = await api(`/api/p2p/transfers/${transferId}/accept`, { method: 'POST', headers: aliceAuth });
  assert.equal(senderAccept.response.status, 403);
  const accepted = await api(`/api/p2p/transfers/${transferId}/accept`, { method: 'POST', headers: bobAuth });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.transfer.status, 'accepted');
  const acceptTwice = await api(`/api/p2p/transfers/${transferId}/accept`, { method: 'POST', headers: bobAuth });
  assert.equal(acceptTwice.response.status, 409);

  // complete 由任意成员调用：仅接受合法 sha256，原子插入带 p2p_transfer_id 的 DM 消息
  const complete = await api(`/api/p2p/transfers/${transferId}/complete`, { method: 'POST', headers: bobAuth, body: JSON.stringify({ sha256: 'abc' }) });
  assert.equal(complete.response.status, 201);
  assert.equal(complete.body.transfer.status, 'completed');
  assert.equal(complete.body.transfer.sha256, null); // 非法 sha256 被忽略
  assert.equal(complete.body.message.p2p_transfer_id, transferId);
  assert.equal(complete.body.message.content, '测试直传');
  assert.equal(complete.body.message.user_id, alice.body.user.id);
  assert.equal(complete.body.message.p2p_name, 'big.iso');
  assert.equal(complete.body.message.p2p_size, 6 * 1024 * 1024);

  // 会话历史中能看到该 P2P 消息（双方可见）
  const bobHistory = await api(`/api/dm/conversations/${convId}/messages`, { headers: bobAuth });
  assert.equal(bobHistory.body.messages.some(m => m.p2p_transfer_id === transferId), true);

  // 已完成后不能再次 complete
  const completeAgain = await api(`/api/p2p/transfers/${transferId}/complete`, { method: 'POST', headers: bobAuth, body: JSON.stringify({ sha256: 'a'.repeat(64) }) });
  assert.equal(completeAgain.response.status, 409);
});

test('P2P 直传：WebSocket 信令仅转发给传输双方且需已接受', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'p2p_ws_alice', password: 'p2p-ws-password-1' }) });
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'p2p_ws_bob', password: 'p2p-ws-password-2' }) });
  const charlie = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'p2p_ws_charlie', password: 'p2p-ws-password-3' }) });
  const aliceAuth = { authorization: `Bearer ${alice.body.token}` };
  const bobAuth = { authorization: `Bearer ${bob.body.token}` };
  const charlieAuth = { authorization: `Bearer ${charlie.body.token}` };

  await api('/api/friends/request', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'p2p_ws_bob' }) });
  await api(`/api/friends/${alice.body.user.id}/accept`, { method: 'POST', headers: bobAuth });
  const conv = await api('/api/dm/conversations', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'p2p_ws_bob' }) });
  const convId = conv.body.conversation.id;

  const wsUrl = `${base.replace('http:', 'ws:')}/ws?token=`;
  const aliceSocket = await openSocket(wsUrl + encodeURIComponent(alice.body.token));
  const bobSocket = await openSocket(wsUrl + encodeURIComponent(bob.body.token));
  const charlieSocket = await openSocket(wsUrl + encodeURIComponent(charlie.body.token));

  const nextEvent = (socket, type, ms = 2000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`未收到 ${type} 事件`)), ms);
    const listener = event => {
      const payload = JSON.parse(event.data);
      if (payload.type !== type) return;
      clearTimeout(timer);
      socket.removeEventListener('message', listener);
      resolve(payload);
    };
    socket.addEventListener('message', listener);
  });

  // pending 状态下信令不转发（Bob 不应收到）
  const pendingCreated = await api('/api/p2p/transfers', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ conversation_id: convId, name: 'sig.bin', size: 2048, type: 'application/octet-stream' }) });
  const pendingId = pendingCreated.body.transfer.id;
  aliceSocket.send(JSON.stringify({ type: 'p2p_signal', transfer_id: pendingId, to_user_id: bob.body.user.id, data: { hello: 'early' } }));
  const early = await Promise.race([
    nextEvent(bobSocket, 'p2p_signal', 400).then(() => 'received').catch(() => 'quiet'),
    new Promise(resolve => setTimeout(() => resolve('quiet'), 450)),
  ]);
  assert.equal(early, 'quiet');

  // 接受后发送方收到 p2p_accepted
  const inviteAccepted = nextEvent(aliceSocket, 'p2p_accepted');
  await api(`/api/p2p/transfers/${pendingId}/accept`, { method: 'POST', headers: bobAuth });
  assert.equal((await inviteAccepted).transfer_id, pendingId);

  // 创建第二个传输，接受后发送信令验证转发到 Bob
  const created2 = await api('/api/p2p/transfers', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ conversation_id: convId, name: 'sig2.bin', size: 2048, type: 'application/octet-stream' }) });
  const id2 = created2.body.transfer.id;
  await api(`/api/p2p/transfers/${id2}/accept`, { method: 'POST', headers: bobAuth });
  const bobSignal = nextEvent(bobSocket, 'p2p_signal');
  aliceSocket.send(JSON.stringify({ type: 'p2p_signal', transfer_id: id2, to_user_id: bob.body.user.id, data: { offer: 'sdp' } }));
  const got = await bobSignal;
  assert.equal(got.transfer_id, id2);
  assert.equal(got.from_user_id, alice.body.user.id);
  assert.equal(got.data.offer, 'sdp');

  // 非成员（charlie）发送信令被服务器丢弃：Bob 收不到，且无法把信令发给非成员
  const charlieSent = nextEvent(bobSocket, 'p2p_signal', 300).then(() => 'received').catch(() => 'quiet');
  charlieSocket.send(JSON.stringify({ type: 'p2p_signal', transfer_id: id2, to_user_id: bob.body.user.id, data: { evil: true } }));
  assert.equal(await charlieSent, 'quiet');

  const aliceGotFromCharlie = nextEvent(aliceSocket, 'p2p_signal', 300).then(() => 'received').catch(() => 'quiet');
  aliceSocket.send(JSON.stringify({ type: 'p2p_signal', transfer_id: id2, to_user_id: charlie.body.user.id, data: { leak: true } }));
  assert.equal(await aliceGotFromCharlie, 'quiet');

  aliceSocket.close(); bobSocket.close(); charlieSocket.close();
});

test('P2P 直传：取消、拒绝与活跃数量上限', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'p2p_lim_alice', password: 'p2p-lim-password-1' }) });
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'p2p_lim_bob', password: 'p2p-lim-password-2' }) });
  const aliceAuth = { authorization: `Bearer ${alice.body.token}` };
  const bobAuth = { authorization: `Bearer ${bob.body.token}` };

  await api('/api/friends/request', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'p2p_lim_bob' }) });
  await api(`/api/friends/${alice.body.user.id}/accept`, { method: 'POST', headers: bobAuth });
  const conv = await api('/api/dm/conversations', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ username: 'p2p_lim_bob' }) });
  const convId = conv.body.conversation.id;

  // 拒绝流程
  const r = await api('/api/p2p/transfers', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ conversation_id: convId, name: 'r.bin', size: 1024, type: 'application/octet-stream' }) });
  const rejected = await api(`/api/p2p/transfers/${r.body.transfer.id}/reject`, { method: 'POST', headers: bobAuth });
  assert.equal(rejected.body.transfer.status, 'rejected');

  // 取消流程（任一方）
  const c = await api('/api/p2p/transfers', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ conversation_id: convId, name: 'c.bin', size: 1024, type: 'application/octet-stream' }) });
  const canceled = await api(`/api/p2p/transfers/${c.body.transfer.id}/cancel`, { method: 'POST', headers: aliceAuth });
  assert.equal(canceled.body.transfer.status, 'canceled');
  const cancelDone = await api(`/api/p2p/transfers/${c.body.transfer.id}/cancel`, { method: 'POST', headers: aliceAuth });
  assert.equal(cancelDone.response.status, 409);

  // 每用户活跃（pending/accepted）上限 10
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const res = await api('/api/p2p/transfers', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ conversation_id: convId, name: `limit-${i}.bin`, size: 1024, type: 'application/octet-stream' }) });
    assert.equal(res.response.status, 201);
    ids.push(res.body.transfer.id);
  }
  const over = await api('/api/p2p/transfers', { method: 'POST', headers: aliceAuth, body: JSON.stringify({ conversation_id: convId, name: 'over.bin', size: 1024, type: 'application/octet-stream' }) });
  assert.equal(over.response.status, 429);
});

test('房主移除成员：被踢者收到 room_kicked 事件与通知', async () => {
  const owner = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'kick_owner', password: 'kick-password-1' }) });
  const guest = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'kick_guest', password: 'kick-password-2' }) });
  const ownerAuth = { authorization: `Bearer ${owner.body.token}` }, guestAuth = { authorization: `Bearer ${guest.body.token}` };
  const created = await api('/api/rooms', { method: 'POST', headers: ownerAuth, body: JSON.stringify({ name: '踢人测试房间', is_private: true }) });
  const roomId = created.body.room.id;
  await api(`/api/rooms/${roomId}/members`, { method: 'POST', headers: ownerAuth, body: JSON.stringify({ username: 'kick_guest' }) });
  assert.equal((await api('/api/rooms', { headers: guestAuth })).body.rooms.some(room => room.id === roomId), true);

  const guestSocket = new WebSocket(`${base.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(guest.body.token)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('被踢者 WebSocket 连接超时')), 2000);
    guestSocket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    guestSocket.addEventListener('error', reject, { once: true });
  });
  const nextGuestEvent = type => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`未收到 ${type} 事件`)), 2000);
    const listener = event => {
      const payload = JSON.parse(event.data);
      if (payload.type !== type) return;
      clearTimeout(timer); guestSocket.removeEventListener('message', listener); resolve(payload);
    };
    guestSocket.addEventListener('message', listener);
  });
  const kicked = nextGuestEvent('room_kicked');
  const notified = nextGuestEvent('notification');
  const removed = await api(`/api/rooms/${roomId}/members/${guest.body.user.id}`, { method: 'DELETE', headers: ownerAuth });
  assert.equal(removed.response.status, 200);
  const kickedPayload = await kicked;
  assert.equal(kickedPayload.room_id, roomId);
  assert.equal(kickedPayload.room_name, '踢人测试房间');
  const notifPayload = await notified;
  assert.equal(notifPayload.notification.type, 'room');
  assert.equal(notifPayload.notification.title, '你已被移出房间');
  // A2：被踢后房间列表仍可见（私有房对所有人可见），但消息访问被拒绝
  assert.equal((await api('/api/rooms', { headers: guestAuth })).body.rooms.some(room => room.id === roomId), true);
  assert.equal((await api(`/api/rooms/${roomId}/messages`, { headers: guestAuth })).response.status, 403);
  // 陌生人对该房间没有管理权限
  const stranger = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'kick_stranger', password: 'kick-password-3' }) });
  const denied = await api(`/api/rooms/${roomId}/members/${stranger.body.user.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${stranger.body.token}` } });
  assert.equal(denied.response.status, 403);
  guestSocket.close();
});

test('管理员全局公告：广播全体在线、普通用户无权限、可查询与清除', async () => {
  const adminLogin = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'correct-horse' }) });
  const adminAuth = { authorization: `Bearer ${adminLogin.body.token}` };
  const member = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'announce_member', password: 'announce-password' }) });
  const memberAuth = { authorization: `Bearer ${member.body.token}` };

  // 普通用户不能发布/清除
  assert.equal((await api('/api/admin/announcement', { method: 'POST', headers: memberAuth, body: JSON.stringify({ content: 'x' }) })).response.status, 403);
  assert.equal((await api('/api/admin/announcement', { method: 'DELETE', headers: memberAuth })).response.status, 403);

  const memberSocket = new WebSocket(`${base.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(member.body.token)}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('成员 WebSocket 连接超时')), 2000);
    memberSocket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    memberSocket.addEventListener('error', reject, { once: true });
  });
  const nextAnnouncement = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('未收到全局公告事件')), 2000);
    const listener = event => {
      const payload = JSON.parse(event.data);
      if (payload.type !== 'announcement' || !payload.global) return;
      clearTimeout(timer); memberSocket.removeEventListener('message', listener); resolve(payload);
    };
    memberSocket.addEventListener('message', listener);
  });

  // 发布 → 在线成员收到全局公告事件
  const pushed = nextAnnouncement();
  const published = await api('/api/admin/announcement', { method: 'POST', headers: adminAuth, body: JSON.stringify({ content: '服务器将于今晚维护' }) });
  assert.equal(published.response.status, 200);
  assert.equal(published.body.announcement.content, '服务器将于今晚维护');
  const pushedPayload = await pushed;
  assert.equal(pushedPayload.content, '服务器将于今晚维护');
  assert.equal(pushedPayload.admin_name, 'alice');

  // 所有登录用户可查询
  const read = await api('/api/admin/announcement', { headers: memberAuth });
  assert.equal(read.body.announcement.content, '服务器将于今晚维护');
  // 空内容拒绝
  assert.equal((await api('/api/admin/announcement', { method: 'POST', headers: adminAuth, body: JSON.stringify({ content: '  ' }) })).response.status, 400);

  // 清除 → 收到清除事件，查询为空
  const cleared = nextAnnouncement();
  assert.equal((await api('/api/admin/announcement', { method: 'DELETE', headers: adminAuth })).response.status, 200);
  assert.equal((await cleared).content, null);
  assert.equal((await api('/api/admin/announcement', { headers: memberAuth })).body.announcement, null);
  memberSocket.close();
});

test('分片上传支持断点续传、取消和 413 请求限制', async () => {
  const user = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'chunk_user', password: 'chunk-password' }) });
  const auth = { authorization: `Bearer ${user.body.token}` };
  const totalSize = 2 * 1024 * 1024 + 123;
  const init = await api('/api/uploads', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'resume.bin', type: 'application/octet-stream', size: totalSize }) });
  assert.equal(init.response.status, 201);
  const uploadId = init.body.upload.id;
  const chunkSize = init.body.upload.chunk_size;
  assert.equal(chunkSize, 1024 * 1024);

  const first = Buffer.alloc(chunkSize, 0x41);
  const firstRes = await api(`/api/uploads/${uploadId}/chunks`, { method: 'PUT', headers: auth, body: JSON.stringify({ offset: 0, data: first.toString('base64') }) });
  assert.equal(firstRes.response.status, 200);
  assert.equal(firstRes.body.upload.offset, chunkSize);
  const duplicate = await api(`/api/uploads/${uploadId}/chunks`, { method: 'PUT', headers: auth, body: JSON.stringify({ offset: 0, data: first.toString('base64') }) });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.offset, chunkSize);

  const second = Buffer.alloc(123, 0x42);
  const secondRes = await api(`/api/uploads/${uploadId}/chunks`, { method: 'PUT', headers: auth, body: JSON.stringify({ offset: chunkSize, data: second.toString('base64') }) });
  assert.equal(secondRes.response.status, 200);
  assert.equal(secondRes.body.upload.offset, chunkSize + 123);
  const thirdRes = await api(`/api/uploads/${uploadId}/chunks`, { method: 'PUT', headers: auth, body: JSON.stringify({ offset: chunkSize + 123, data: Buffer.alloc(chunkSize, 0x43).toString('base64') }) });
  assert.equal(thirdRes.response.status, 201);
  assert.equal(thirdRes.body.completed, true);
  assert.ok(thirdRes.body.file.id);
  assert.equal(db.prepare('SELECT id FROM upload_sessions WHERE id = ?').get(uploadId), undefined);

  const bigInit = await api('/api/uploads', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'large.bin', type: 'application/octet-stream', size: 1024 }) });
  const oversize = Buffer.alloc(2 * 1024 * 1024, 0x43).toString('base64');
  const tooBig = await fetch(`${base}/api/uploads/${bigInit.body.upload.id}/chunks`, { method: 'PUT', headers: auth, body: JSON.stringify({ offset: 0, data: oversize }) });
  assert.equal(tooBig.status, 413);

  const hundred = await api('/api/uploads', { method: 'POST', headers: auth, body: JSON.stringify({ name: '100m.bin', type: 'application/octet-stream', size: 100 * 1024 * 1024 }) });
  assert.equal(hundred.response.status, 201);
  assert.equal(hundred.body.upload.size, 100 * 1024 * 1024);

  const cancelInit = await api('/api/uploads', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'cancel.bin', type: 'application/octet-stream', size: 1024 }) });
  const cancelId = cancelInit.body.upload.id;
  const cancelTemp = db.prepare('SELECT temp_name FROM upload_sessions WHERE id = ?').get(cancelId).temp_name;
  assert.equal(existsSync(join(process.env.UPLOAD_DIR, cancelTemp)), true);
  assert.equal((await api(`/api/uploads/${cancelId}`, { method: 'DELETE', headers: auth })).response.status, 200);
  assert.equal(existsSync(join(process.env.UPLOAD_DIR, cancelTemp)), false);
  const afterCancel = await api(`/api/uploads/${cancelId}/chunks`, { method: 'PUT', headers: auth, body: JSON.stringify({ offset: 0, data: Buffer.alloc(10).toString('base64') }) });
  assert.equal(afterCancel.response.status, 404);
});

test('20 MB 文件可通过分片上传并作为私信附件发送', async () => {
  const sender = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'dm20_sender', password: 'dm20-password-1' }) });
  const receiver = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'dm20_receiver', password: 'dm20-password-2' }) });
  const senderAuth = { authorization: `Bearer ${sender.body.token}` };
  await api('/api/friends/request', { method: 'POST', headers: senderAuth, body: JSON.stringify({ username: 'dm20_receiver' }) });
  await api(`/api/friends/${sender.body.user.id}/accept`, { method: 'POST', headers: { authorization: `Bearer ${receiver.body.token}` } });
  const conv = await api('/api/dm/conversations', { method: 'POST', headers: senderAuth, body: JSON.stringify({ username: 'dm20_receiver' }) });

  const payload = Buffer.alloc(20 * 1024 * 1024, 0x5a);
  const init = await api('/api/uploads', { method: 'POST', headers: senderAuth, body: JSON.stringify({ name: 'large20.bin', type: 'application/octet-stream', size: payload.length }) });
  const upload = init.body.upload;
  let uploadedId = null;
  for (let offset = 0; offset < payload.length; offset += upload.chunk_size) {
    const part = payload.subarray(offset, Math.min(offset + upload.chunk_size, payload.length));
    const res = await api(`/api/uploads/${upload.id}/chunks`, { method: 'PUT', headers: senderAuth, body: JSON.stringify({ offset, data: part.toString('base64') }) });
    assert.ok(res.response.status === 200 || res.response.status === 201);
    if (res.body.completed) uploadedId = res.body.file.id;
  }
  assert.ok(uploadedId);
  const sent = await api(`/api/dm/conversations/${conv.body.conversation.id}/messages`, { method: 'POST', headers: senderAuth, body: JSON.stringify({ content: '', attachment_id: uploadedId }) });
  assert.equal(sent.response.status, 201);
});

test('过期数据清理删除会话、上传会话和孤儿 .part 文件', async () => {
  const now = Date.now();
  const userId = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id;
  const orphan = join(process.env.UPLOAD_DIR, '.upload-orphan.part');
  writeFileSync(orphan, Buffer.from('x'), { flag: 'wx' });
  db.prepare("INSERT INTO upload_sessions(id, user_id, original_name, mime_type, total_size, temp_name, received_size, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run('expired-upload', userId, 'old.bin', 'application/octet-stream', 1, '.upload-expired.part', 0, now - 1000);
  writeFileSync(join(process.env.UPLOAD_DIR, '.upload-expired.part'), Buffer.alloc(0), { flag: 'wx' });
  db.prepare('INSERT INTO login_attempts(ip_address, username, success, created_at) VALUES (?, ?, ?, ?)').run('10.0.0.99', 'ghost', 0, now - 8 * 24 * 3600_000);
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)').run('expired-session', userId, now - 1000);

  cleanupExpiredData();

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM upload_sessions WHERE id = 'expired-upload'").get().count, 0);
  assert.equal(existsSync(join(process.env.UPLOAD_DIR, '.upload-expired.part')), false);
  assert.equal(existsSync(orphan), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM login_attempts WHERE ip_address = '10.0.0.99'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE token = 'expired-session'").get().count, 0);
});

test('附件权限矩阵：公共房、私有房、DM 与撤回后不可下载', async () => {
  const owner = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'matrix_owner', password: 'matrix-password-1' }) });
  const member = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'matrix_member', password: 'matrix-password-2' }) });
  const stranger = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'matrix_stranger', password: 'matrix-password-3' }) });
  const dmPeer = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'matrix_peer', password: 'matrix-password-4' }) });
  const ownerAuth = { authorization: `Bearer ${owner.body.token}` };
  const memberAuth = { authorization: `Bearer ${member.body.token}` };
  const strangerAuth = { authorization: `Bearer ${stranger.body.token}` };
  const dmPeerAuth = { authorization: `Bearer ${dmPeer.body.token}` };
  const get = (id, auth) => fetch(`${base}/api/files/${id}`, { headers: auth });
  const upload = async name => (await api('/api/files', { method: 'POST', headers: ownerAuth, body: JSON.stringify({ name, type: 'text/plain', data: Buffer.from(name).toString('base64') }) })).body.file;

  const publicFile = await upload('public.txt');
  await api('/api/rooms/1/messages', { method: 'POST', headers: ownerAuth, body: JSON.stringify({ content: '', attachment_id: publicFile.id }) });
  assert.equal((await get(publicFile.id, ownerAuth)).status, 200);
  assert.equal((await get(publicFile.id, strangerAuth)).status, 200);

  const privateRoom = await api('/api/rooms', { method: 'POST', headers: ownerAuth, body: JSON.stringify({ name: '矩阵私有房', is_private: true }) });
  await api(`/api/rooms/${privateRoom.body.room.id}/members`, { method: 'POST', headers: ownerAuth, body: JSON.stringify({ username: 'matrix_member' }) });
  const privateFile = await upload('private.txt');
  await api(`/api/rooms/${privateRoom.body.room.id}/messages`, { method: 'POST', headers: ownerAuth, body: JSON.stringify({ content: '', attachment_id: privateFile.id }) });
  assert.equal((await get(privateFile.id, memberAuth)).status, 200);
  assert.equal((await get(privateFile.id, strangerAuth)).status, 404);

  await api('/api/friends/request', { method: 'POST', headers: ownerAuth, body: JSON.stringify({ username: 'matrix_peer' }) });
  await api(`/api/friends/${owner.body.user.id}/accept`, { method: 'POST', headers: dmPeerAuth });
  const conv = await api('/api/dm/conversations', { method: 'POST', headers: ownerAuth, body: JSON.stringify({ username: 'matrix_peer' }) });
  assert.ok(conv.body.conversation.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM dm_members WHERE conversation_id = ? AND user_id = ?').get(conv.body.conversation.id, stranger.body.user.id).count, 0);
  const dmFile = await upload('dm.txt');
  const dmMessage = await api(`/api/dm/conversations/${conv.body.conversation.id}/messages`, { method: 'POST', headers: ownerAuth, body: JSON.stringify({ content: '', attachment_id: dmFile.id }) });
  assert.equal(dmMessage.response.status, 201);
  assert.equal((await get(dmFile.id, dmPeerAuth)).status, 200);
  assert.equal((await get(dmFile.id, strangerAuth)).status, 404);

  const retracted = await api(`/api/dm/messages/${dmMessage.body.message.id}`, { method: 'DELETE', headers: ownerAuth });
  assert.equal(retracted.response.status, 200);
  assert.equal((await get(dmFile.id, ownerAuth)).status, 404);
  assert.equal((await get(dmFile.id, dmPeerAuth)).status, 404);
});

test('房间开关：新列与加入申请表存在（迁移生效）', async () => {
  const cols = db.prepare('PRAGMA table_info(rooms)').all().map(c => c.name);
  for (const c of ['locked', 'hidden', 'password_hash', 'readonly']) assert.ok(cols.includes(c), `rooms 缺列 ${c}`);
  const joinTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='room_join_requests'").get();
  assert.ok(joinTable, '缺少 room_join_requests 表');
});

test('房间列表：私有房非成员可见（🔒）、hidden 房仅成员可见', async () => {
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'bob_list', password: 'bob-list-password' }) });
  const authB = { authorization: `Bearer ${bob.body.token}` };
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'alice_list', password: 'alice-list-password' }) });
  const authA = { authorization: `Bearer ${alice.body.token}` };

  const priv = await api('/api/rooms', { method: 'POST', headers: authA, body: JSON.stringify({ name: '私有房列表', is_private: true }) });
  // 非管理员不能创建公共房：hidden 房改由管理员 alice 创建；A3 的 settings 端点未实现，直接改库置 hidden=1
  const adminLogin = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'correct-horse' }) });
  const adminAuth = { authorization: `Bearer ${adminLogin.body.token}` };
  const hidden = await api('/api/rooms', { method: 'POST', headers: adminAuth, body: JSON.stringify({ name: '隐藏房列表' }) });
  db.prepare('UPDATE rooms SET hidden = 1 WHERE id = ?').run(hidden.body.room.id);

  const listB = await api('/api/rooms', { headers: authB });
  const names = listB.body.rooms.map(r => r.name);
  assert.ok(names.includes('私有房列表'), '非成员应看到私有房名');
  assert.ok(!names.includes('隐藏房列表'), '非成员不应看到 hidden 房');

  // 已是成员 → hidden 房可见
  await api(`/api/rooms/${hidden.body.room.id}/members`, { method: 'POST', headers: adminAuth, body: JSON.stringify({ username: 'bob_list' }) });
  const listB2 = await api('/api/rooms', { headers: authB });
  assert.ok(listB2.body.rooms.some(r => r.name === '隐藏房列表'), '成员应看到 hidden 房');
  const privItem = listB2.body.rooms.find(r => r.name === '私有房列表');
  assert.equal(privItem.is_private, true);
});

test('房间设置：owner 可设四开关+密码，member 403，密码哈希不落明文', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'alice_set', password: 'correct-horse' }) });
  const authA = { authorization: `Bearer ${alice.body.token}` };
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'bob_set', password: 'correct-horse' }) });
  const authB = { authorization: `Bearer ${bob.body.token}` };
  // 非管理员只能建私有房；owner 权限即可设置开关
  const room = await api('/api/rooms', { method: 'POST', headers: authA, body: JSON.stringify({ name: '设置房', is_private: true }) });
  assert.equal(room.response.status, 201);
  const id = room.body.room.id;

  let aliceSocket, bobSocket;
  try {
    // WS 广播：按房间广播——成员（owner alice）收到 room_settings，非成员 bob 不收到
    aliceSocket = new WebSocket(`${base.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(alice.body.token)}`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('alice WebSocket 连接超时')), 2000);
      aliceSocket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      aliceSocket.addEventListener('error', reject, { once: true });
    });
    bobSocket = new WebSocket(`${base.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(bob.body.token)}`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('bob WebSocket 连接超时')), 2000);
      bobSocket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      bobSocket.addEventListener('error', reject, { once: true });
    });

    const nextSettings = socket => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('未收到 room_settings 事件')), 2000);
      const listener = event => {
        const payload = JSON.parse(event.data);
        if (payload.type !== 'room_settings' || payload.room_id !== id) return;
        clearTimeout(timer); socket.removeEventListener('message', listener); resolve(payload);
      };
      socket.addEventListener('message', listener);
    });
    let bobGotSettings = false;
    bobSocket.addEventListener('message', event => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'room_settings' && payload.room_id === id) bobGotSettings = true;
    });

    const waiting = nextSettings(aliceSocket);
    const r = await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: authA, body: JSON.stringify({ locked: true, readonly: true, password: 'secret' }) });
    assert.equal(r.response.status, 200);
    assert.equal(r.body.settings.room_id, id);
    assert.equal(r.body.settings.locked, true);
    assert.equal(r.body.settings.readonly, true);
    assert.equal(r.body.settings.has_password, true);
    const settingsEvent = await waiting;
    assert.equal(settingsEvent.locked, true);
    assert.equal(settingsEvent.has_password, true);

    // 非成员 bob 不应收到按房间广播的 room_settings（已在上面等 alice 收到事件，广播必然已发出）
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(bobGotSettings, false, '非成员不应收到 room_settings 广播');

    const row = db.prepare('SELECT password_hash, locked, readonly FROM rooms WHERE id = ?').get(id);
    assert.equal(row.locked, 1);
    assert.equal(row.readonly, 1);
    assert.ok(row.password_hash !== 'secret' && row.password_hash.length > 20, '密码应存哈希而非明文');

    const denied = await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: authB, body: JSON.stringify({ locked: false }) });
    assert.equal(denied.response.status, 403);
  } finally {
    aliceSocket?.close();
    bobSocket?.close();
  }

  const clear = await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: authA, body: JSON.stringify({ password: '' }) });
  assert.equal(clear.response.status, 200);
  assert.equal(clear.body.settings.has_password, false);
});

test('房间设置：公共房仅全局管理员可修改，非管理员 room-admin 403', async () => {
  const adminLogin = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'correct-horse' }) });
  const adminAuth = { authorization: `Bearer ${adminLogin.body.token}` };
  const member = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'pubset_member', password: 'correct-horse' }) });
  const memberAuth = { authorization: `Bearer ${member.body.token}` };
  const room = await api('/api/rooms', { method: 'POST', headers: adminAuth, body: JSON.stringify({ name: '公共设置房' }) });
  assert.equal(room.response.status, 201);
  const id = room.body.room.id;
  // 提为公共房 room-admin
  const added = await api(`/api/rooms/${id}/members`, { method: 'POST', headers: adminAuth, body: JSON.stringify({ username: 'pubset_member', role: 'admin' }) });
  assert.equal(added.response.status, 200);
  // 非全局管理员的 room-admin 不能改公共房设置
  const denied = await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: memberAuth, body: JSON.stringify({ locked: true }) });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.error, '只有管理员可以修改公共聊天室设置');
  // 全局管理员可以修改
  const ok = await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: adminAuth, body: JSON.stringify({ locked: true }) });
  assert.equal(ok.response.status, 200);
  assert.equal(ok.body.settings.locked, true);
});

test('加入房间：密码错 403、对 200 并成为成员、locked 403、无密码私有房引导申请、公共房直接加入', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'alice_j', password: 'secret-pass' }) });
  const authA = { authorization: `Bearer ${alice.body.token}` };
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'bob_j', password: 'secret-pass' }) });
  const authB = { authorization: `Bearer ${bob.body.token}` };
  const room = await api('/api/rooms', { method: 'POST', headers: authA, body: JSON.stringify({ name: '密码房', is_private: true }) });
  assert.equal(room.response.status, 201);
  const id = room.body.room.id;
  const setPwd = await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: authA, body: JSON.stringify({ password: 'secret-pass' }) });
  assert.equal(setPwd.response.status, 200);

  const wrong = await api(`/api/rooms/${id}/join`, { method: 'POST', headers: authB, body: JSON.stringify({ password: 'wrong-pass' }) });
  assert.equal(wrong.response.status, 403);
  assert.equal(wrong.body.error, '房间密码错误');
  const readDenied = await api(`/api/rooms/${id}/messages`, { headers: authB });
  assert.equal(readDenied.response.status, 403, '未加入成员仍不可读私有房消息');

  const ok = await api(`/api/rooms/${id}/join`, { method: 'POST', headers: authB, body: JSON.stringify({ password: 'secret-pass' }) });
  assert.equal(ok.response.status, 200);
  assert.equal(ok.body.member.role, 'member');
  const readOk = await api(`/api/rooms/${id}/messages`, { headers: authB });
  assert.equal(readOk.response.status, 200);

  // 已是成员 → 200
  const again = await api(`/api/rooms/${id}/join`, { method: 'POST', headers: authB, body: JSON.stringify({ password: 'secret-pass' }) });
  assert.equal(again.response.status, 200);

  // locked：第三人无法加入
  const carol = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'carol_j', password: 'secret-pass' }) });
  const authC = { authorization: `Bearer ${carol.body.token}` };
  await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: authA, body: JSON.stringify({ locked: true }) });
  const locked = await api(`/api/rooms/${id}/join`, { method: 'POST', headers: authC, body: JSON.stringify({ password: 'secret-pass' }) });
  assert.equal(locked.response.status, 403);
  assert.equal(locked.body.error, '房间已锁定，仅接受邀请');

  // 无密码私有房：非成员 → 403 引导申请
  const dave = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'dave_j', password: 'secret-pass' }) });
  const authD = { authorization: `Bearer ${dave.body.token}` };
  const evelyn = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'evelyn_j', password: 'secret-pass' }) });
  const authE = { authorization: `Bearer ${evelyn.body.token}` };
  const priv = await api('/api/rooms', { method: 'POST', headers: authD, body: JSON.stringify({ name: '私有申请房', is_private: true }) });
  assert.equal(priv.response.status, 201);
  const privId = priv.body.room.id;
  const noPwd = await api(`/api/rooms/${privId}/join`, { method: 'POST', headers: authE, body: JSON.stringify({}) });
  assert.equal(noPwd.response.status, 403);
  assert.equal(noPwd.body.error, '私有房间需申请加入');

  // 公共房未设密码：非成员直接加入 200
  const adminLogin = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'correct-horse' }) });
  const adminAuth = { authorization: `Bearer ${adminLogin.body.token}` };
  const pub = await api('/api/rooms', { method: 'POST', headers: adminAuth, body: JSON.stringify({ name: '公共加入房' }) });
  assert.equal(pub.response.status, 201);
  const pubId = pub.body.room.id;
  const pubJoin = await api(`/api/rooms/${pubId}/join`, { method: 'POST', headers: authE, body: JSON.stringify({}) });
  assert.equal(pubJoin.response.status, 200);
  assert.equal(pubJoin.body.member.role, 'member');
});

test('加入申请：申请→审批→成为成员并收通知；重复 409；非管理员 403', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'alice_rq', password: 'secret-pass' }) });
  const authA = { authorization: `Bearer ${alice.body.token}` };
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'bob_rq', password: 'secret-pass' }) });
  const authB = { authorization: `Bearer ${bob.body.token}` };
  const room = await api('/api/rooms', { method: 'POST', headers: authA, body: JSON.stringify({ name: '申请房', is_private: true }) });
  const id = room.body.room.id;

  const req1 = await api(`/api/rooms/${id}/join-request`, { method: 'POST', headers: authB });
  assert.equal(req1.response.status, 201);
  const req2 = await api(`/api/rooms/${id}/join-request`, { method: 'POST', headers: authB });
  assert.equal(req2.response.status, 409, '重复申请应 409');

  const list = await api(`/api/rooms/${id}/join-requests`, { headers: authA });
  assert.equal(list.body.requests.length, 1);
  assert.equal(list.body.requests[0].username, 'bob_rq');

  const nonManager = await api(`/api/rooms/${id}/join-requests`, { headers: authB });
  assert.equal(nonManager.response.status, 403, '成员无审批权限');

  const approve = await api(`/api/rooms/${id}/join-requests/${bob.body.user.id}/approve`, { method: 'POST', headers: authA });
  assert.equal(approve.response.status, 200);
  const readOk = await api(`/api/rooms/${id}/messages`, { headers: authB });
  assert.equal(readOk.response.status, 200, '审批后成为成员可读');
  const notif = await api('/api/notifications/unread-count', { headers: authB });
  assert.ok(Number(notif.body.count) >= 1, '申请人应收到通知');
});

test('只读房：member 发言 403，owner 可发', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'alice_ro', password: 'secret-pass' }) });
  const authA = { authorization: `Bearer ${alice.body.token}` };
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'bob_ro', password: 'secret-pass' }) });
  const authB = { authorization: `Bearer ${bob.body.token}` };
  const room = await api('/api/rooms', { method: 'POST', headers: authA, body: JSON.stringify({ name: '只读房', is_private: true }) });
  assert.equal(room.response.status, 201);
  const id = room.body.room.id;
  const set = await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: authA, body: JSON.stringify({ readonly: true }) });
  assert.equal(set.response.status, 200);
  await api(`/api/rooms/${id}/members`, { method: 'POST', headers: authA, body: JSON.stringify({ username: 'bob_ro' }) });

  const denied = await api(`/api/rooms/${id}/messages`, { method: 'POST', headers: authB, body: JSON.stringify({ content: 'hi' }) });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.error, '房间为只读模式');
  const allowed = await api(`/api/rooms/${id}/messages`, { method: 'POST', headers: authA, body: JSON.stringify({ content: 'announcement' }) });
  assert.equal(allowed.response.status, 201);
});

test('加入申请：reject 收"被拒绝"通知并可重新申请、404 无申请、locked 403、公共房 400', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'alice_rq2', password: 'secret-pass' }) });
  const authA = { authorization: `Bearer ${alice.body.token}` };
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'bob_rq2', password: 'secret-pass' }) });
  const authB = { authorization: `Bearer ${bob.body.token}` };

  // 公共房申请 → 400（公共房需全局管理员创建）
  const adminLogin = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'correct-horse' }) });
  const adminAuth = { authorization: `Bearer ${adminLogin.body.token}` };
  const pub = await api('/api/rooms', { method: 'POST', headers: adminAuth, body: JSON.stringify({ name: '公共申请房2' }) });
  assert.equal(pub.response.status, 201);
  const pubReq = await api(`/api/rooms/${pub.body.room.id}/join-request`, { method: 'POST', headers: authB });
  assert.equal(pubReq.response.status, 400);
  assert.equal(pubReq.body.error, '公共房间可直接加入，无需申请');

  // locked 私有房申请 → 403
  const lockedRoom = await api('/api/rooms', { method: 'POST', headers: authA, body: JSON.stringify({ name: '锁定申请房', is_private: true }) });
  const lockedId = lockedRoom.body.room.id;
  await api(`/api/rooms/${lockedId}/settings`, { method: 'PATCH', headers: authA, body: JSON.stringify({ locked: true }) });
  const lockedReq = await api(`/api/rooms/${lockedId}/join-request`, { method: 'POST', headers: authB });
  assert.equal(lockedReq.response.status, 403);

  // 无申请审批 → 404
  const noReq = await api(`/api/rooms/${lockedId}/join-requests/99999/approve`, { method: 'POST', headers: authA });
  assert.equal(noReq.response.status, 404);

  // reject：申请人收"被拒绝"通知，之后可重新申请（UPDATE 回 pending），重复 pending 仍 409
  const priv = await api('/api/rooms', { method: 'POST', headers: authA, body: JSON.stringify({ name: '拒绝申请房', is_private: true }) });
  const id = priv.body.room.id;
  const req1 = await api(`/api/rooms/${id}/join-request`, { method: 'POST', headers: authB });
  assert.equal(req1.response.status, 201);
  const reject = await api(`/api/rooms/${id}/join-requests/${bob.body.user.id}/reject`, { method: 'POST', headers: authA });
  assert.equal(reject.response.status, 200);
  const notifs = await api('/api/notifications', { headers: authB });
  assert.equal(notifs.body.notifications[0].title, '加入申请被拒绝');
  const reapply = await api(`/api/rooms/${id}/join-request`, { method: 'POST', headers: authB });
  assert.equal(reapply.response.status, 201, '被拒后应可重新申请');
  const list = await api(`/api/rooms/${id}/join-requests`, { headers: authA });
  assert.equal(list.body.requests.length, 1, '重新申请后回到 pending 列表');
  assert.equal(list.body.requests[0].username, 'bob_rq2');
  const dup = await api(`/api/rooms/${id}/join-request`, { method: 'POST', headers: authB });
  assert.equal(dup.response.status, 409);
  assert.equal(dup.body.error, '已提交过申请，等待审批');
});
