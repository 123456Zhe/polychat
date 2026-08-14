import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 启动前用旧 schema 预建 gallery_images 表 + 一条 storage='qiniu' 记录，
// 验证 server.mjs 启动迁移把它改写为 's3' 且 CHECK 扩展为 ('local','s3')。
const temporary = mkdtempSync(join(tmpdir(), 'polychat-gallery-migration-'));
const dbPath = join(temporary, 'test.db');
{
  const pre = new DatabaseSync(dbPath);
  // 预建阶段模拟旧部署；node:sqlite 默认开启外键，显式关闭以便在无 users 表时插入旧记录
  pre.exec('PRAGMA foreign_keys = OFF');
  pre.exec(`CREATE TABLE gallery_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    stored_name TEXT NOT NULL,
    storage TEXT NOT NULL DEFAULT 'local' CHECK(storage IN ('local', 'qiniu')),
    created_at INTEGER NOT NULL
  )`);
  pre.exec(`INSERT INTO gallery_images(user_id, filename, mime, size, stored_name, storage, created_at)
    VALUES (1, 'a.png', 'image/png', 10, 'gallery/1/old', 'qiniu', 0)`);
  pre.close();
}
process.env.NODE_ENV = 'test';
process.env.DB_PATH = dbPath;
process.env.UPLOAD_DIR = join(temporary, 'uploads');
process.env.AVATAR_DIR = join(temporary, 'avatars');
process.env.FILE_URL_SECRET = 'test-file-secret';
const { server, db } = await import('../server.mjs');

test.after(async () => {
  server.close();
  db.close();
  rmSync(temporary, { recursive: true, force: true });
});

test('gallery_images 迁移：storage 旧值 qiniu 改写为 s3，数据保留，CHECK 扩展', () => {
  const row = db.prepare('SELECT * FROM gallery_images WHERE id = 1').get();
  assert.equal(row.storage, 's3');
  assert.equal(row.stored_name, 'gallery/1/old'); // 数据保留
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='gallery_images'").get().sql;
  assert.ok(sql.includes("'s3'"));
  assert.ok(!sql.includes("'qiniu'"));
  assert.ok(sql.includes('REFERENCES users(id) ON DELETE CASCADE'));
});
