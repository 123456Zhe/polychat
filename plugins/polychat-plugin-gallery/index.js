import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import qiniu from 'qiniu';

// 个人图床：本地 / 七牛 Kodo 双后端（GALLERY_* / QINIU_* 环境变量可覆盖）。
export default {
  name: 'gallery',
  version: '1.0.0',
  description: '个人图床：上传/配额/外链，支持本地与七牛 Kodo 双后端',
  enabledByDefault: true,
  defaultConfig: { quota_mb: 500, storage: 'local' },
  setup(ctx) {
    const { registry, db, json, requireUser, readBody, maxFileSize, uploadDir, env, pluginConfig, logAudit, fileUrlSecret, fileUrlTtlMs, verifyPublicFileUrl } = ctx;

    const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    const QUOTA_BYTES = Number(env.GALLERY_QUOTA_MB || pluginConfig.quota_mb) * 1024 * 1024;
    const STORAGE = env.GALLERY_STORAGE || pluginConfig.storage;
    const GALLERY_DIR = join(uploadDir, 'gallery');
    const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

    function galleryDir() { mkdirSync(GALLERY_DIR, { recursive: true }); return GALLERY_DIR; }
    function usedBytes(userId) {
      return db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM gallery_images WHERE user_id = ?').get(userId).used;
    }
    function extOf(mime) { return MIME_EXT[mime]; }

    // 与核心 signPublicFileUrl 相同的 HMAC-SHA256 签名（fileUrlSecret），但路径指向本插件的文件端点。
    // 默认 base='' 返回相对路径（与 avatar_url 等 API 约定一致，客户端按自身 origin 访问），
    // 避免 publicBaseUrl 与真实访问地址不一致导致外链失效。
    function buildGalleryUrl(row, base = '') {
      const expires = Date.now() + fileUrlTtlMs;
      const sig = createHmac('sha256', fileUrlSecret).update(`${row.stored_name}:${expires}`).digest('hex');
      return `${base.replace(/\/+$/, '')}/api/gallery/${row.id}/file?expires=${expires}&sig=${sig}`;
    }

    // 列表外链：本地后端返回服务器签名中转链接；七牛后端直接返回 Kodo 下载 URL
    //（公开空间 https://<domain>/<key>，私有空间为带 deadline 的签名 URL）。
    function rowUrl(row) {
      if (row.storage === 'qiniu') {
        const q = qiniuMac();
        if (!q) return null;
        return qiniuDownloadUrl(q, row.stored_name);
      }
      return buildGalleryUrl(row);
    }

    // readBody 只接受 JSON：`raw += chunk`（Buffer 转 utf8 字符串，二进制有损）后 JSON.parse，
    // 对图片原始字节必然抛 400「JSON 格式错误」。因此上传走原始流读取（Buffer.concat），
    // 上限 maxFileSize 防超限（超限抛 status 413，由服务端统一转为 413 响应）。
    async function readRawBody(req, maxLength = maxFileSize) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxLength) throw Object.assign(new Error('请求内容过大'), { status: 413 });
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    }

    // ── 七牛 Kodo 后端（storage=qiniu，服务端中转上传）────────────────────────
    // 缺任一 QINIU_* 环境变量即视为未配置（返回 null，调用方回 503「七牛模式未配置
    // QINIU_* 环境变量」）。zone 取 qiniu.zone['Zone_' + zone]：Zone_z0 华东 /
    // Zone_z1 华北 / Zone_z2 华南 / Zone_na0 北美 / Zone_as0 新加坡；
    // zone 未命中同样按未配置处理（503 fail fast），避免静默走 uc 查区。
    // useHttpsDomain: true —— 上传/删除强制 HTTPS（默认 http 明文不可接受）。
    function qiniuMac() {
      const ak = env.QINIU_ACCESS_KEY, sk = env.QINIU_SECRET_KEY;
      const bucket = env.QINIU_BUCKET, zone = env.QINIU_ZONE;
      const domain = env.QINIU_DOMAIN;
      if (!ak || !sk || !bucket || !zone || !domain) return null;
      const zoneConfig = qiniu.zone[`Zone_${zone}`];
      if (!zoneConfig) return null;
      const mac = new qiniu.auth.digest.Mac(ak, sk);
      const config = new qiniu.conf.Config({ useHttpsDomain: true });
      config.zone = zoneConfig;
      return { mac, bucket, config, domain, privateBucket: env.QINIU_PRIVATE === 'true' };
    }
    function qiniuKey(userId, mime) {
      return `gallery/${userId}/${Date.now()}-${randomBytes(4).toString('hex')}${extOf(mime)}`;
    }
    function uploadToQiniu(q, key, bytes) {
      const putPolicy = new qiniu.rs.PutPolicy({ scope: `${q.bucket}:${key}`, expires: 3600 });
      const token = putPolicy.uploadToken(q.mac);
      return new Promise((resolve, reject) => {
        new qiniu.form_up.FormUploader(q.config).put(token, key, bytes, new qiniu.form_up.PutExtra(), (err, resp) => err ? reject(err) : resolve(resp));
      });
    }
    function qiniuDelete(q, key) {
      return new Promise((resolve, reject) => {
        new qiniu.rs.BucketManager(q.mac, q.config).delete(q.bucket, key, (err, resp) => err ? reject(err) : resolve(resp));
      });
    }
    // 下载外链：公开空间 `https://<domain>/<key>`；私有空间（QINIU_PRIVATE=true）
    // 用 BucketManager.privateDownloadUrl 生成带 deadline 的签名 URL（单位秒）。
    function qiniuDownloadUrl(q, key) {
      const domain = /^https?:\/\//i.test(q.domain) ? q.domain : `https://${q.domain}`;
      if (q.privateBucket) {
        const deadline = Math.floor(Date.now() / 1000) + 3600;
        return new qiniu.rs.BucketManager(q.mac, q.config).privateDownloadUrl(domain, key, deadline);
      }
      return `${domain}/${key}`;
    }
    function redirectToQiniuUrl(res, key) {
      const q = qiniuMac();
      if (!q) return json(res, 503, { error: '七牛模式未配置 QINIU_* 环境变量' });
      res.writeHead(302, { location: qiniuDownloadUrl(q, key), 'cache-control': 'no-store' });
      return res.end();
    }

    // 清理服务：账户注销时核心经 registry.service('gallery-cleanup') 安全调用
    //（插件停用时服务不存在，核心跳过七牛对象删除；本地文件由核心直接 unlink）。
    // 复用上面的 qiniuDelete（BucketManager.delete，useHttpsDomain 强制 HTTPS）。
    registry.provide('gallery-cleanup', {
      deleteObject: async (key) => {
        const q = qiniuMac();
        if (!q) return; // 七牛未配置 → 无可删，静默返回
        await qiniuDelete(q, key);
      }
    });

    registry.registerApiRoute('POST', '/api/gallery', async (req, res) => {
      const user = requireUser(req, res); if (!user) return;
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!IMAGE_MIME.has(mime)) return json(res, 400, { error: '仅支持 PNG/JPEG/WebP/GIF 图片' });
      const bytes = await readRawBody(req);
      if (!bytes.length) return json(res, 400, { error: '空文件' });
      if (bytes.length > maxFileSize) return json(res, 413, { error: '超过单文件大小上限' });
      if (usedBytes(user.id) + bytes.length > QUOTA_BYTES) return json(res, 413, { error: '超出图床配额' });
      if (STORAGE === 'qiniu') {
        const q = qiniuMac();
        if (!q) return json(res, 503, { error: '七牛模式未配置 QINIU_* 环境变量' });
        const key = qiniuKey(user.id, mime);
        try {
          await uploadToQiniu(q, key, bytes);
        } catch (e) {
          return json(res, 500, { error: `七牛上传失败：${e.message || e}` });
        }
        const result = db.prepare('INSERT INTO gallery_images(user_id, filename, mime, size, stored_name, storage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(user.id, `image${extOf(mime)}`, mime, bytes.length, key, 'qiniu', Date.now());
        logAudit(user.id, 'gallery_upload', null, `图片 id ${Number(result.lastInsertRowid)}`);
        return json(res, 201, { image: { id: Number(result.lastInsertRowid), filename: `image${extOf(mime)}`, mime, size: bytes.length, storage: 'qiniu' } });
      }
      const storedName = `${user.id}-${Date.now()}-${randomBytes(4).toString('hex')}${extOf(mime)}`;
      writeFileSync(join(galleryDir(), storedName), bytes, { flag: 'wx', mode: 0o600 });
      const result = db.prepare('INSERT INTO gallery_images(user_id, filename, mime, size, stored_name, storage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, `image${extOf(mime)}`, mime, bytes.length, storedName, 'local', Date.now());
      logAudit(user.id, 'gallery_upload', null, `图片 id ${Number(result.lastInsertRowid)}`);
      return json(res, 201, { image: { id: Number(result.lastInsertRowid), filename: `image${extOf(mime)}`, mime, size: bytes.length, storage: 'local' } });
    });

    // B3 完整列表：分页 + 配额用量 + 签名外链 url（stored_name 保留，B2 既有测试依赖）
    registry.registerApiRoute('GET', '/api/gallery', async (req, res, url) => {
      const user = requireUser(req, res); if (!user) return;
      const offset = Math.max(Number(url.searchParams.get('offset') || 0) || 0, 0);
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50) || 50, 1), 100);
      const rows = db.prepare('SELECT * FROM gallery_images WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(user.id, limit, offset);
      const used = db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM gallery_images WHERE user_id = ?').get(user.id).used;
      return json(res, 200, {
        images: rows.map(r => ({ id: r.id, filename: r.filename, mime: r.mime, size: r.size, storage: r.storage, created_at: r.created_at, stored_name: r.stored_name, url: rowUrl(r) })),
        quota_mb: QUOTA_BYTES / 1024 / 1024, used_mb: used / 1024 / 1024
      });
    });

    // 参数化路由：核心分发对字符串 pattern 做精确匹配，`:id` 需用 RegExp（handler 内再解析 id）
    const galleryItemMatch = /^\/api\/gallery\/\d+$/;
    registry.registerApiRoute('DELETE', galleryItemMatch, async (req, res, url) => {
      const user = requireUser(req, res); if (!user) return;
      const id = Number(url.pathname.match(/\/api\/gallery\/(\d+)$/)[1]);
      const row = db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(id);
      if (!row) return json(res, 404, { error: '图片不存在' });
      if (row.user_id !== user.id && !user.is_admin) return json(res, 403, { error: '无权删除他人图片' });
      if (row.storage === 'qiniu') {
        const q = qiniuMac();
        if (!q) return json(res, 503, { error: '七牛模式未配置 QINIU_* 环境变量' });
        try { await qiniuDelete(q, row.stored_name); } catch { /* 桶内对象可能已不存在，DB 记录照删 */ }
      } else {
        try { unlinkSync(join(galleryDir(), row.stored_name)); } catch { /* stale */ }
      }
      db.prepare('DELETE FROM gallery_images WHERE id = ?').run(id);
      logAudit(user.id, 'gallery_delete', null, `图片 id ${id}`);
      return json(res, 200, { ok: true });
    });

    const galleryFileMatch = /^\/api\/gallery\/\d+\/file$/;
    registry.registerApiRoute('GET', galleryFileMatch, async (req, res, url) => {
      const id = Number(url.pathname.match(/\/api\/gallery\/(\d+)\/file$/)[1]);
      const expires = Number(url.searchParams.get('expires') || 0);
      const sig = url.searchParams.get('sig') || '';
      const row = db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(id);
      if (!row) return json(res, 404, { error: '图片不存在' });
      if (!verifyPublicFileUrl(row.stored_name, expires, sig)) return json(res, 403, { error: '链接无效或已过期' });
      if (row.storage === 'qiniu') return redirectToQiniuUrl(res, row.stored_name);
      try {
        const bytes = readFileSync(join(galleryDir(), row.stored_name));
        res.writeHead(200, { 'content-type': row.mime, 'content-length': bytes.length, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' });
        return res.end(bytes);
      } catch { return json(res, 404, { error: '文件数据不存在' }); }
    });
  }
};
