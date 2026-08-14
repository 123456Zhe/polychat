# 图床后端改通用 S3 兼容 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `polychat-plugin-gallery` 的云存储后端从「七牛官方 SDK」改为「通用 S3 兼容协议」（MinIO JS SDK），支持 MinIO / Cloudflare R2 / 七牛 Kodo 等任意 S3 兼容服务商，线上旧部署零配置改动。

**Architecture:** 插件内把 `qiniu` SDK 的三个操作（上传/删除/签名 URL）等价替换为 `minio` SDK 的 `putObject` / `removeObject` / `presignedGetObject`；配置 `S3_*` 为主、`QINIU_*` 为兼容别名（先读 `S3_*`）；`gallery_images.storage` 标记 `qiniu` → `s3`（server.mjs 启动时表重建迁移，参照 `messages` 迁移先例）。

**Tech Stack:** Node 22.5+（`node:sqlite` / `node:http` / `node:crypto`）、`minio` ^8.0.7（零传递大依赖，esbuild 可打包进 SEA）、`node --test`。

## Global Constraints

- Node >= 22.5，ESM（`"type": "module"`）。
- 依赖：根 `package.json` 删 `"qiniu": "^7.15.2"`，加 `"minio": "^8.0.7"`，`npm install` 更新 lockfile。
- 环境变量：`S3_*` 为主，`QINIU_*` 兼容别名回退（先读 `S3_*`，缺失读 `QINIU_*`）。必填项 = `ACCESS_KEY` / `SECRET_KEY` / `BUCKET` / `ENDPOINT`，缺任一 → 未配置 → 503，错误文案固定为 `S3 模式未配置 S3_* 环境变量`。
- `S3_ENDPOINT` 示例：`https://s3-cn-east-1.qiniucs.com`（七牛）/ `https://<account>.r2.cloudflarestorage.com`（R2）/ `http://minio:9000`（MinIO）。旧 `QINIU_ZONE` 废弃，不再读取。
- `S3_REGION` 默认 `us-east-1`；`S3_DOMAIN`（别名 `QINIU_DOMAIN`）可选——公开桶直连域名/CDN；`S3_PRIVATE`（别名 `QINIU_PRIVATE`）默认 `false`，`true` 时即使设了 `S3_DOMAIN` 也走 presign 签名 URL。
- 存储标记：`gallery_images.storage` 只允许 `'local' | 's3'`；旧 `'qiniu'` 行启动时批量改写为 `'s3'`。插件内判断统一 `row.storage === 's3'`。
- 后端激活：`GALLERY_STORAGE` / `pluginConfig.storage` 取 `'s3'` 或旧值 `'qiniu'` 都激活 S3 后端（向后兼容）。
- 错误文案：上传失败 → `S3 上传失败：<msg>`；缺配置 → `S3 模式未配置 S3_* 环境变量`。
- 前端（`web-client`）不改（不感知 storage 标签）。
- 测试：`node --test test/*.test.mjs`；`NODE_ENV=test`；DB/上传目录在临时目录，测试结束清理。
- 不 push GitHub（subtree 仓库同步留待用户确认，不在本计划内）。

---

### Task 1: 插件 S3 后端改造 + 依赖切换 + 缺配置测试

**Files:**
- Modify: `plugins/polychat-plugin-gallery/index.js`（整体，qiniu → minio）
- Modify: `package.json`（依赖行 24）
- Delete: `test/gallery-qiniu-misconfig.test.mjs`
- Create: `test/gallery-s3-misconfig.test.mjs`
- Test: `test/gallery-s3-misconfig.test.mjs`

**Interfaces:**
- Produces（本插件 setup 作用域内部函数，供本任务内各 handler 使用）：
  - `s3Env(key)` → `string | undefined`（`env['S3_'+key] || env['QINIU_'+key]`）
  - `s3Client()` → `{ bucket, domain, privateBucket, client } | null`（null = 未配置）
  - `s3Key(userId, mime)` → key 字符串 `gallery/<userId>/<ts>-<rand><ext>`
  - `s3PutObject(s3, key, bytes, mime)` → `Promise<void>`
  - `s3RemoveObject(s3, key)` → `Promise<void>`
  - `s3DownloadUrl(s3, key)` → `Promise<string>`
  - `redirectToS3Url(res, key)` → 写 302/503 响应
  - `rowUrl(row)` 变为 async，返回 `Promise<string | null>`
- 本任务后：`STORAGE === 's3' || STORAGE === 'qiniu'` 走 S3 分支；DB 新写入 `storage='s3'`；`test/gallery-qiniu-misconfig.test.mjs` 被删除。

- [ ] **Step 1: 依赖切换**

`package.json` 第 24 行：
```diff
-    "qiniu": "^7.15.2",
+    "minio": "^8.0.7",
```
运行：`npm install`
预期：`package-lock.json` 更新，node_modules 可 `import { Client } from 'minio'`。

- [ ] **Step 2: 改写插件头部（import / 注释 / description）**

`plugins/polychat-plugin-gallery/index.js`：
```diff
-import qiniu from 'qiniu';
+import { Client } from 'minio';
```
```diff
-// 个人图床：本地 / 七牛 Kodo 双后端（GALLERY_* / QINIU_* 环境变量可覆盖）。
+// 个人图床：本地 / S3 兼容双后端（GALLERY_* / S3_* 环境变量可覆盖，QINIU_* 为兼容别名）。
```
```diff
-  description: '个人图床：上传/配额/外链，支持本地与七牛 Kodo 双后端',
+  description: '个人图床：上传/配额/外链，支持本地与 S3 兼容后端（MinIO/R2/七牛等）',
```

- [ ] **Step 3: 替换整个七牛函数段（原 62-110 行）**

把从 `// ── 七牛 Kodo 后端` 注释到 `redirectToQiniuUrl` 结束的整段替换为：

```js
    // ── S3 兼容后端（storage=s3，服务端中转上传）────────────────────────
    // 配置：S3_* 为主，QINIU_* 为兼容别名（先读 S3_*，缺失回退 QINIU_*），
    // 缺任一必填项（AK/SK/BUCKET/ENDPOINT）即视为未配置（返回 null，调用方回 503
    // 「S3 模式未配置 S3_* 环境变量」）。ENDPOINT 形如
    // `https://s3-cn-east-1.qiniucs.com`（七牛）/ `https://<account>.r2.cloudflarestorage.com`（R2）/
    // `http://minio:9000`（MinIO）。旧 QINIU_ZONE 已废弃（区域信息含在 ENDPOINT 中）。
    function s3Env(key) { return env[`S3_${key}`] || env[`QINIU_${key}`] || undefined; }
    function s3Client() {
      const ak = s3Env('ACCESS_KEY'), sk = s3Env('SECRET_KEY');
      const bucket = s3Env('BUCKET'), endpoint = s3Env('ENDPOINT');
      if (!ak || !sk || !bucket || !endpoint) return null;
      const url = new URL(/^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`);
      const region = s3Env('REGION') || 'us-east-1';
      return {
        bucket,
        domain: s3Env('DOMAIN'),
        privateBucket: s3Env('PRIVATE') === 'true',
        client: new Client({
          endPoint: url.hostname,
          port: url.port ? Number(url.port) : (url.protocol === 'http:' ? 80 : 443),
          useSSL: url.protocol === 'https:',
          accessKey: ak,
          secretKey: sk,
          region
        })
      };
    }
    function s3Key(userId, mime) {
      return `gallery/${userId}/${Date.now()}-${randomBytes(4).toString('hex')}${extOf(mime)}`;
    }
    async function s3PutObject(s3, key, bytes, mime) {
      await s3.client.putObject(s3.bucket, key, bytes, { 'Content-Type': mime });
    }
    async function s3RemoveObject(s3, key) {
      await s3.client.removeObject(s3.bucket, key);
    }
    // 下载外链：S3_PRIVATE=true 或未设 S3_DOMAIN → presign 1 小时签名 URL（公开/私有桶通吃）；
    // 否则（公开桶 + S3_DOMAIN）直接 `https://<domain>/<key>`（CDN 直连，沿用旧 QINIU_DOMAIN 行为）。
    async function s3DownloadUrl(s3, key) {
      if (s3.privateBucket || !s3.domain) return s3.client.presignedGetObject(s3.bucket, key, 3600);
      const domain = /^https?:\/\//i.test(s3.domain) ? s3.domain : `https://${s3.domain}`;
      return `${domain.replace(/\/+$/, '')}/${key}`;
    }
    async function redirectToS3Url(res, key) {
      const s3 = s3Client();
      if (!s3) return json(res, 503, { error: 'S3 模式未配置 S3_* 环境变量' });
      res.writeHead(302, { location: await s3DownloadUrl(s3, key), 'cache-control': 'no-store' });
      return res.end();
    }
```

- [ ] **Step 4: 替换 rowUrl 与清理服务**

原 rowUrl（39-46 行）改为 async：

```js
    // 列表外链：本地后端返回服务器签名中转链接；S3 后端返回下载 URL
    //（公开桶 CDN 直连 https://<domain>/<key>，或 presign 签名 URL）。
    async function rowUrl(row) {
      if (row.storage === 's3') {
        const s3 = s3Client();
        if (!s3) return null;
        return s3DownloadUrl(s3, row.stored_name);
      }
      return buildGalleryUrl(row);
    }
```

原清理服务（112-121 行）替换为：

```js
    // 清理服务：账户注销时核心经 registry.service('gallery-cleanup') 安全调用
    //（插件停用时服务不存在，核心跳过 S3 对象删除；本地文件由核心直接 unlink）。
    // 复用上面的 s3RemoveObject。
    registry.provide('gallery-cleanup', {
      deleteObject: async (key) => {
        const s3 = s3Client();
        if (!s3) return; // S3 未配置 → 无可删，静默返回
        await s3RemoveObject(s3, key);
      }
    });
```

- [ ] **Step 5: 改上传 handler（原 131-144 行）**

```diff
-      if (STORAGE === 'qiniu') {
-        const q = qiniuMac();
-        if (!q) return json(res, 503, { error: '七牛模式未配置 QINIU_* 环境变量' });
-        const key = qiniuKey(user.id, mime);
+      if (STORAGE === 's3' || STORAGE === 'qiniu') {
+        const s3 = s3Client();
+        if (!s3) return json(res, 503, { error: 'S3 模式未配置 S3_* 环境变量' });
+        const key = s3Key(user.id, mime);
         try {
-          await uploadToQiniu(q, key, bytes);
+          await s3PutObject(s3, key, bytes, mime);
         } catch (e) {
-          return json(res, 500, { error: `七牛上传失败：${e.message || e}` });
+          return json(res, 500, { error: `S3 上传失败：${e.message || e}` });
         }
         const result = db.prepare('INSERT INTO gallery_images(user_id, filename, mime, size, stored_name, storage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
-          .run(user.id, `image${extOf(mime)}`, mime, bytes.length, key, 'qiniu', Date.now());
+          .run(user.id, `image${extOf(mime)}`, mime, bytes.length, key, 's3', Date.now());
         logAudit(user.id, 'gallery_upload', null, `图片 id ${Number(result.lastInsertRowid)}`);
-        return json(res, 201, { image: { id: Number(result.lastInsertRowid), filename: `image${extOf(mime)}`, mime, size: bytes.length, storage: 'qiniu' } });
+        return json(res, 201, { image: { id: Number(result.lastInsertRowid), filename: `image${extOf(mime)}`, mime, size: bytes.length, storage: 's3' } });
       }
```

- [ ] **Step 6: 改列表 handler 的 rowUrl 调用（原 161 行）**

```diff
-        images: rows.map(r => ({ id: r.id, filename: r.filename, mime: r.mime, size: r.size, storage: r.storage, created_at: r.created_at, stored_name: r.stored_name, url: rowUrl(r) })),
+        images: await Promise.all(rows.map(async r => ({ id: r.id, filename: r.filename, mime: r.mime, size: r.size, storage: r.storage, created_at: r.created_at, stored_name: r.stored_name, url: await rowUrl(r) }))),
```

- [ ] **Step 7: 改删除 handler（原 174-177 行）**

```diff
-      if (row.storage === 'qiniu') {
-        const q = qiniuMac();
-        if (!q) return json(res, 503, { error: '七牛模式未配置 QINIU_* 环境变量' });
-        try { await qiniuDelete(q, row.stored_name); } catch { /* 桶内对象可能已不存在，DB 记录照删 */ }
+      if (row.storage === 's3') {
+        const s3 = s3Client();
+        if (!s3) return json(res, 503, { error: 'S3 模式未配置 S3_* 环境变量' });
+        try { await s3RemoveObject(s3, row.stored_name); } catch { /* 桶内对象可能已不存在，DB 记录照删 */ }
       } else {
```

- [ ] **Step 8: 改文件端点重定向（原 194 行）**

```diff
-      if (row.storage === 'qiniu') return redirectToQiniuUrl(res, row.stored_name);
+      if (row.storage === 's3') return redirectToS3Url(res, row.stored_name);
```

- [ ] **Step 9: 删除旧测试文件，新建 S3 缺配置测试**

`git rm test/gallery-qiniu-misconfig.test.mjs`，新建 `test/gallery-s3-misconfig.test.mjs`：

```js
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
```

- [ ] **Step 10: 跑全量测试**

运行：`npm test`
预期：全部通过，其中新文件 3 项通过（缺配置 503 / 别名缺 ENDPOINT 503 / 不可达 500）；`gallery.test.mjs`（本地模式）不受影响；无任何文件引用 `qiniu` 包导致 import 失败。

- [ ] **Step 11: 提交**

```bash
git add package.json package-lock.json plugins/polychat-plugin-gallery/index.js test/gallery-s3-misconfig.test.mjs
git rm test/gallery-qiniu-misconfig.test.mjs
git commit -m "feat(gallery): 图床云存储后端改为通用 S3 兼容（minio SDK，S3_* 为主 QINIU_* 别名）"
```

---

### Task 2: gallery_images 表迁移（storage 'qiniu' → 's3'）

**Files:**
- Modify: `server.mjs:255`（CREATE TABLE 的 CHECK）+ 迁移代码块插到 `server.mjs` 建表之后（约 258 行）
- Create: `test/gallery-s3-migration.test.mjs`

**Interfaces:**
- Consumes: 无（独立于插件代码）
- Produces: 启动时保证 `gallery_images.storage` 只有 `'local' | 's3'`；`sqlite_master` 中该表 SQL 含 `'s3'` 不含 `'qiniu'`
- 说明：Task 1 已删 `qiniu` 依赖，但迁移代码不 import `qiniu`，本任务与 Task 1 可先后独立合入。

- [ ] **Step 1: 建表语句改新 CHECK**

`server.mjs:255`：
```diff
-    storage TEXT NOT NULL DEFAULT 'local' CHECK(storage IN ('local', 'qiniu')),
+    storage TEXT NOT NULL DEFAULT 'local' CHECK(storage IN ('local', 's3')),
```

- [ ] **Step 2: 在建表 exec 之后追加迁移代码**

在 `server.mjs` 第 258 行（`gallery_images` 建表 `db.exec` 块结束）之后插入（参照上方 `messages` 表重建先例，第 294-313 行）：

```js
// gallery_images.storage 支持 's3'（图床后端通用 S3 兼容化）；旧 'qiniu' 行统一改写为 's3'。
// CHECK 约束无法 ALTER，故整表重建（模式与上方 messages 迁移一致）。
if (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='gallery_images'").get().sql.includes("'qiniu'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`CREATE TABLE gallery_images_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    stored_name TEXT NOT NULL,
    storage TEXT NOT NULL DEFAULT 'local' CHECK(storage IN ('local', 's3')),
    created_at INTEGER NOT NULL
  )`);
  db.exec(`INSERT INTO gallery_images_new(id, user_id, filename, mime, size, stored_name, storage, created_at)
    SELECT id, user_id, filename, mime, size, stored_name, CASE WHEN storage='qiniu' THEN 's3' ELSE storage END, created_at FROM gallery_images`);
  db.exec('DROP TABLE gallery_images');
  db.exec('ALTER TABLE gallery_images_new RENAME TO gallery_images');
  db.exec('PRAGMA foreign_keys = ON');
}
```

- [ ] **Step 3: 写迁移测试**

新建 `test/gallery-s3-migration.test.mjs`：

```js
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
  pre.exec(`CREATE TABLE gallery_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
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
});
```

- [ ] **Step 4: 跑测试**

运行：`node --test test/gallery-s3-migration.test.mjs && npm test`
预期：迁移测试 1 项通过；全量测试不回归（fresh DB 不触发迁移）。

- [ ] **Step 5: 提交**

```bash
git add server.mjs test/gallery-s3-migration.test.mjs
git commit -m "feat(db): gallery_images.storage 迁移 qiniu→s3（表重建，CHECK 扩为 local/s3）"
```

---

### Task 3: 文档与插件元数据更新

**Files:**
- Modify: `README.md:106-112`（环境变量表）
- Modify: `plugins/polychat-plugin-gallery/README.md`（全文）
- Modify: `plugins/polychat-plugin-gallery/package.json`（version / description / keywords）

**Interfaces:**
- Consumes: Task 1 的最终变量名与语义（`S3_*` + `QINIU_*` 别名、`storage` 值 `s3`、错误文案）
- Produces: 文档与线上部署配置指引一致

- [ ] **Step 1: 根 README 环境变量表替换**

`README.md` 第 106-112 行 7 行替换为：

```markdown
| `GALLERY_STORAGE` | `local` | 图床存储后端：`local` 本地 / `s3` S3 兼容（`gallery` 插件；旧值 `qiniu` 兼容） |
| `GALLERY_QUOTA_MB` | `500` | 每用户图床配额（MB） |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | 空 | S3 AK/SK（`gallery` 插件 S3 后端，缺任一必填项则上传返回 503；`QINIU_ACCESS_KEY`/`QINIU_SECRET_KEY` 为兼容别名） |
| `S3_BUCKET` | 空 | S3 桶名（别名 `QINIU_BUCKET`） |
| `S3_ENDPOINT` | 空 | S3 端点，如 `https://s3-cn-east-1.qiniucs.com`（七牛）、`https://<account>.r2.cloudflarestorage.com`（R2）、`http://minio:9000`（MinIO） |
| `S3_REGION` | `us-east-1` | S3 区域（多数 S3 兼容服务不校验） |
| `S3_DOMAIN` | 空 | 公开桶直连域名/CDN（别名 `QINIU_DOMAIN`） |
| `S3_PRIVATE` | `false` | S3 桶为私有，外链返回签名 URL（别名 `QINIU_PRIVATE`） |
```

- [ ] **Step 2: 插件 README 全文替换**

`plugins/polychat-plugin-gallery/README.md` 替换为：

```markdown
# polychat-plugin-gallery

个人图床插件：图片上传 / 配额 / 外链，支持本地与 S3 兼容双后端。

- `storage: local`（默认）—— 图片落盘到 `data/uploads/gallery/`，经 `/api/gallery/...` 外链访问
- `storage: s3` —— 上传到任意 S3 兼容对象存储（MinIO / Cloudflare R2 / 七牛 Kodo 等），
  公开桶外链走 CDN 域名直连，私有桶返回 presign 签名 URL
- 每用户配额 `quota_mb`（默认 500MB），按用户累计占用计费

配置项（`data/plugins.json` 或 `GALLERY_*` / `S3_*` 环境变量）：
- `quota_mb`：每用户配额（MB），默认 `500`
- `storage`：后端类型，`local` | `s3`，默认 `local`

S3 环境变量（`S3_*` 为主，`QINIU_*` 兼容回退，线上旧部署可零改动升级）：
- `S3_ACCESS_KEY` / `S3_SECRET_KEY`（必填，别名 `QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY`）
- `S3_BUCKET`（必填，别名 `QINIU_BUCKET`）
- `S3_ENDPOINT`（必填，如 `https://s3-cn-east-1.qiniucs.com`）
- `S3_REGION`（默认 `us-east-1`）
- `S3_DOMAIN`（可选，公开桶 CDN/直连域名，别名 `QINIU_DOMAIN`）
- `S3_PRIVATE`（可选，`true` 时外链走签名 URL，别名 `QINIU_PRIVATE`）

## 开发状态

- 已注册为内置插件（`/api/plugins` 列表可见），`gallery_images` 表已建
- 上传（local 落盘 / S3 中转）/ 配额 / 外链 / 删除已实现；真实 S3 端到端手动冒烟
```

- [ ] **Step 3: 插件 package.json 元数据**

`plugins/polychat-plugin-gallery/package.json`：
```diff
-  "version": "1.0.0",
-  "description": "PolyChat 插件：个人图床，上传/配额/外链，支持本地与七牛 Kodo 双后端",
+  "version": "1.1.0",
+  "description": "PolyChat 插件：个人图床，上传/配额/外链，支持本地与 S3 兼容后端（MinIO/R2/七牛等）",
```
```diff
-  "keywords": ["polychat", "polychat-plugin", "gallery", "image", "qiniu"],
+  "keywords": ["polychat", "polychat-plugin", "gallery", "image", "s3", "minio", "object-storage"],
```

- [ ] **Step 4: 检查残留引用 + 提交**

运行：`grep -rn "qiniu\|QINIU" README.md plugins/ docs/PLUGINS.md | grep -v "兼容\|别名\|旧值\|QINIU_ACCESS_KEY.*QINIU_SECRET_KEY"`
预期：仅剩「兼容别名 / 旧值」说明性引用（如 `QINIU_BUCKET` 别名列、`QINIU_DOMAIN` 别名列、插件 README 的别名说明），无功能代码残留。

```bash
git add README.md plugins/polychat-plugin-gallery/README.md plugins/polychat-plugin-gallery/package.json
git commit -m "docs(gallery): 图床文档与插件元数据改为 S3 兼容（含 QINIU_* 别名说明）"
```

---

### Task 4: 构建与冒烟验证

**Files:** 无源码改动（如构建暴露问题则回改对应任务文件）

**Interfaces:**
- Consumes: Task 1-3 全部改动
- Produces: `npm test` 全绿、`web:build` 干净、`build:all` 产物可启动（minio 打入 SEA）

- [ ] **Step 1: 全量测试**

运行：`npm test`
预期：全部通过（gallery 本地模式 + S3 缺配置 3 项 + 迁移 1 项 + 其余既有测试）。

- [ ] **Step 2: Web 构建**

运行：`npm run web:build`
预期：`vite build` 成功，无报错。

- [ ] **Step 3: 服务端单文件构建**

运行：`npm run build:server`
预期：`dist/polychat-server`（SEA）与 `dist/polychat-server.cjs` 生成成功，esbuild 无 `qiniu` 解析错误、minio 成功打入 bundle。

- [ ] **Step 4: dist 冒烟**

```bash
cd "$(mktemp -d)" && node /home/zhe/polychat/dist/polychat-server.cjs &
# 等启动后：
curl -s http://127.0.0.1:3000/api/health          # 200
curl -s -X POST http://127.0.0.1:3000/api/register -H 'content-type: application/json' -d '{"username":"smoke_s3","password":"pw12345678"}'   # 201 取 token
curl -s -X POST http://127.0.0.1:3000/api/gallery -H "authorization: Bearer $TOKEN" -H 'content-type: image/png' --data-binary @1px.png   # 无 S3_* 配置 → 503「S3 模式未配置」
```
预期：health 200；未配置 S3 → 上传 503；本地模式（`GALLERY_STORAGE` 缺省）上传/列表/删除正常。测试进程 `kill` 清理。

- [ ] **Step 5: 汇总（无单独提交）**

若构建/冒烟发现问题，回改对应任务文件并补提交；否则无提交。向用户汇报验证结果，并说明：
- 线上升级路径（用户自行执行）：重启容器后 `QINIU_*` 别名直接生效；需要走 S3 路径时给容器补 `S3_ENDPOINT=https://s3-cn-east-1.qiniucs.com`（按实际区域）。
- subtree 仓库 `123456Zhe/polychat-plugin-gallery` 的同步是否要做（需用户确认后另行操作）。

---

## Self-Review 记录

- **Spec 覆盖**：配置项表 → Task 1 Step 3（s3Env/s3Client）；storage 标记与迁移 → Task 2；插件逻辑 → Task 1 Step 2-8；测试 → Task 1 Step 9-10、Task 2 Step 3-4；文档 → Task 3；验证 → Task 4。✓
- **占位符扫描**：无 TBD/TODO/“待实现”字样，全部步骤含具体代码与命令。✓
- **类型一致性**：`s3Client()` 返回 `{bucket, domain, privateBucket, client}` 在 rowUrl/上传/删除/清理/重定向五处一致使用；`s3Env(key)` 统一拼接 `S3_${key}`/`QINIU_${key}`（`S3_ENDPOINT`→`s3Env('ENDPOINT')`，`S3_PRIVATE`→`s3Env('PRIVATE')`，`S3_REGION`→`s3Env('REGION')`）；错误文案统一 `S3 模式未配置 S3_* 环境变量` / `S3 上传失败：<msg>`。✓
