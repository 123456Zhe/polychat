import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporary = mkdtempSync(join(tmpdir(), 'polychat-gallery-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = join(temporary, 'test.db');
process.env.UPLOAD_DIR = join(temporary, 'uploads');
process.env.AVATAR_DIR = join(temporary, 'avatars');
process.env.FILE_URL_SECRET = 'test-file-secret';
process.env.MAX_FILE_SIZE = String(64 * 1024); // 64KB，便于构造「超大」用例（默认 100MB 太大）
const { server, db } = await import('../server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const api = (path, options = {}) => fetch(`${base}${path}`, { headers: { 'content-type': 'application/json', ...options.headers }, ...options });

// 1x1 真实 PNG 二进制（与 brief 一致）
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
// 注册密码需 8–128 位（server 校验）；brief 里的 'pw' 会被 400 拒绝
const PASSWORD = 'pw12345678';

async function registerUser(username) {
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username, password: PASSWORD }) });
  assert.equal(reg.status, 201);
  return { authorization: `Bearer ${(await reg.json()).token}` };
}

test.after(async () => {
  server.close();
  db.close();
  rmSync(temporary, { recursive: true, force: true });
});

test('gallery 插件注册：/api/plugins 含 gallery，gallery_images 表存在', async () => {
  const auth = await registerUser('gal_a');
  const list = await api('/api/plugins', { headers: auth });
  assert.ok((await list.json()).plugins.some(p => p.name === 'gallery'));
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gallery_images'").get();
  assert.ok(t);
});

test('readBody 实测：二进制 body 抛 400「JSON 格式错误」，图床上传不能直接用 readBody', async () => {
  // 实证：readBody 内部 `raw += chunk`（Buffer 转 utf8 字符串，二进制有损）+ JSON.parse。
  // 对 image/png 原始字节必然 JSON.parse 失败 → 抛 status 400 错误。
  const auth = await registerUser('gal_rb');
  const res = await fetch(`${base}/api/rooms`, {
    method: 'POST', headers: { authorization: auth.authorization, 'content-type': 'image/png' }, body: PNG
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'JSON 格式错误');
});

test('图床上传：本地落盘 201、列表可见；非图片 400；超大 413', async () => {
  const auth = await registerUser('gal_u');

  const up = await api('/api/gallery', {
    method: 'POST', headers: { authorization: auth.authorization, 'content-type': 'image/png' }, body: PNG
  });
  assert.equal(up.status, 201);
  const upBody = await up.json();
  assert.ok(upBody.image.id);
  assert.equal(upBody.image.filename, 'image.png');
  assert.equal(upBody.image.storage, 'local');
  assert.equal(upBody.image.size, PNG.length);

  // 列表可见
  const list = await api('/api/gallery', { headers: auth });
  const listBody = await list.json();
  assert.equal(listBody.images.length, 1);
  assert.equal(listBody.images[0].filename, 'image.png');
  assert.equal(listBody.images[0].size, PNG.length);
  assert.ok(listBody.used_mb >= 0);

  // 文件已落盘到 uploads/gallery/<userId>-<ts>-<rand8>.png
  const storedName = listBody.images[0].stored_name;
  assert.match(storedName, /^\d+-\d+-[0-9a-f]{8}\.png$/);
  assert.ok(existsSync(join(process.env.UPLOAD_DIR, 'gallery', storedName)));

  // 非图片 400
  const bad = await api('/api/gallery', {
    method: 'POST', headers: { authorization: auth.authorization, 'content-type': 'text/plain' }, body: Buffer.from('hello')
  });
  assert.equal(bad.status, 400);

  // 超过单文件大小上限 413（MAX_FILE_SIZE = 64KB）
  const big = await api('/api/gallery', {
    method: 'POST', headers: { authorization: auth.authorization, 'content-type': 'image/png' }, body: Buffer.alloc(64 * 1024 + 1)
  });
  assert.equal(big.status, 413);
});

test('图床列表/删除/文件：外链 200、伪造签名 403、他人 403、删除后 404', async () => {
  const authA = await registerUser('gal_l');
  const authB = await registerUser('gal_lb');

  const up = await api('/api/gallery', {
    method: 'POST', headers: { authorization: authA.authorization, 'content-type': 'image/png' }, body: PNG
  });
  assert.equal(up.status, 201);
  const id = (await up.json()).image.id;

  // 列表：含 url 外链与配额用量
  const list = await api('/api/gallery', { headers: authA });
  const listBody = await list.json();
  const img = listBody.images[0];
  assert.ok(img.url.includes('/api/gallery/'), 'url 应为图床文件链接');
  assert.ok(listBody.quota_mb > 0, '应返回配额 quota_mb');
  assert.ok(listBody.used_mb >= 0, '应返回用量 used_mb');

  // 签名外链可下载
  const fileResp = await fetch(base + img.url);
  assert.equal(fileResp.status, 200);
  assert.equal(fileResp.headers.get('content-type'), 'image/png');

  // 伪造签名 → 403
  const badSig = img.url.replace(/sig=[^&]+/, 'sig=deadbeef');
  const tampered = await fetch(base + badSig);
  assert.equal(tampered.status, 403, '伪造签名应 403');

  // 他人删除 → 403
  const denied = await api(`/api/gallery/${id}`, { method: 'DELETE', headers: authB });
  assert.equal(denied.status, 403, '他人删除应 403');

  // 本人删除 → 200，随后文件 404
  const del = await api(`/api/gallery/${id}`, { method: 'DELETE', headers: authA });
  assert.equal(del.status, 200);
  const gone = await fetch(base + img.url);
  assert.equal(gone.status, 404, '删除后文件应 404');
});

test('注销账户：图床记录与文件一并清理', async () => {
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'gal_del', password: PASSWORD }) });
  assert.equal(reg.status, 201);
  const regBody = await reg.json();
  const auth = { authorization: `Bearer ${regBody.token}` };

  const up = await api('/api/gallery', {
    method: 'POST', headers: { authorization: auth.authorization, 'content-type': 'image/png' }, body: PNG
  });
  assert.equal(up.status, 201);
  const storedName = (await (await api('/api/gallery', { headers: auth })).json()).images[0].stored_name;
  const localPath = join(process.env.UPLOAD_DIR, 'gallery', storedName);
  assert.ok(existsSync(localPath), '上传后本地文件应存在');

  const gone = await api('/api/me', { method: 'DELETE', headers: auth, body: JSON.stringify({ password: PASSWORD }) });
  assert.equal(gone.status, 200);

  const rows = db.prepare('SELECT COUNT(*) AS c FROM gallery_images WHERE user_id = ?').get(regBody.user.id);
  assert.equal(rows.c, 0, '注销后 gallery_images 行应清空');
  assert.ok(!existsSync(localPath), '注销后本地图床文件应删除');
});
