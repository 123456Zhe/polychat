import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporary = mkdtempSync(join(tmpdir(), 'polychat-test-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = join(temporary, 'test.db');
process.env.UPLOAD_DIR = join(temporary, 'uploads');
process.env.AVATAR_DIR = join(temporary, 'avatars');
const { server, db } = await import('../server.mjs');
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
  const hidden = await api('/api/rooms', { headers: guestAuth });
  assert.equal(hidden.body.rooms.some(room => room.id === roomId), false);
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
