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
