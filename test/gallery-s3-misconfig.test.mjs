import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 缺配置 503 用例独立成文件：STORAGE 在插件 setup 时读 env（GALLERY_STORAGE），
// 同一进程内不可中途切换，因此本文件在 import server.mjs 之前设 GALLERY_STORAGE=qiniu
//（旧 selector 值，同时验证 S3 后端对旧值的向后兼容），且刻意不设任何 S3_* / QINIU_* 环境变量
//（真实 S3 端到端留给手动冒烟）。
const temporary = mkdtempSync(join(tmpdir(), 'polychat-gallery-s3-'));
process.env.NODE_ENV = 'test';
process.env.GALLERY_STORAGE = 'qiniu'; // 旧值仍应激活 S3 后端
// 注意：此处不设 S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET / S3_ENDPOINT
process.env.DB_PATH = join(temporary, 'test.db');
process.env.UPLOAD_DIR = join(temporary, 'uploads');
process.env.AVATAR_DIR = join(temporary, 'avatars');
process.env.FILE_URL_SECRET = 'test-file-secret';
process.env.MAX_FILE_SIZE = String(64 * 1024);
const { server, db } = await import('../server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const api = (path, options = {}) => fetch(`${base}${path}`, { headers: { 'content-type': 'application/json', ...options.headers }, ...options });

// 1x1 真实 PNG 二进制（与 gallery.test.mjs 一致）
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
const PASSWORD = 'pw12345678';

test.after(async () => {
  server.close();
  db.close();
  rmSync(temporary, { recursive: true, force: true });
});

test('图床 S3 模式：缺 S3_*/QINIU_* 配置上传 503 且错误明确', async () => {
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'gal_s3_misconfig', password: PASSWORD }) });
  assert.equal(reg.status, 201);
  const auth = { authorization: `Bearer ${(await reg.json()).token}` };
  const up = await api('/api/gallery', {
    method: 'POST', headers: { authorization: auth.authorization, 'content-type': 'image/png' }, body: PNG
  });
  assert.equal(up.status, 503);
  assert.equal((await up.json()).error, 'S3 模式未配置 S3_* 环境变量');
});

test('图床 S3 模式：QINIU_* 别名齐全但缺 ENDPOINT 也按未配置处理（503 fail fast）', async () => {
  // s3Client() 读取的是活 env（process.env），运行时设置即可生效；别名被读取。
  process.env.QINIU_ACCESS_KEY = 'ak';
  process.env.QINIU_SECRET_KEY = 'sk';
  process.env.QINIU_BUCKET = 'test-bucket';
  // 刻意不设 QINIU_ENDPOINT / S3_ENDPOINT
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'gal_s3_alias', password: PASSWORD }) });
  assert.equal(reg.status, 201);
  const auth = { authorization: `Bearer ${(await reg.json()).token}` };
  const up = await api('/api/gallery', {
    method: 'POST', headers: { authorization: auth.authorization, 'content-type': 'image/png' }, body: PNG
  });
  assert.equal(up.status, 503);
  assert.equal((await up.json()).error, 'S3 模式未配置 S3_* 环境变量');
});

test('图床 S3 模式：配置齐全但 ENDPOINT 不可达 → 上传 500', async () => {
  process.env.S3_ACCESS_KEY = 'ak';
  process.env.S3_SECRET_KEY = 'sk';
  process.env.S3_BUCKET = 'test-bucket';
  process.env.S3_ENDPOINT = 'http://127.0.0.1:1'; // 连接立即被拒（minio 可能重试，总耗时 <3s）
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'gal_s3_unreach', password: PASSWORD }) });
  assert.equal(reg.status, 201);
  const auth = { authorization: `Bearer ${(await reg.json()).token}` };
  const up = await api('/api/gallery', {
    method: 'POST', headers: { authorization: auth.authorization, 'content-type': 'image/png' }, body: PNG
  });
  assert.equal(up.status, 500);
  assert.match((await up.json()).error, /^S3 上传失败/);
});
