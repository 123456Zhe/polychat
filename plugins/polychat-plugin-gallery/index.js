import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { Client } from 'minio';

// 个人图床：本地 / S3 兼容双后端（GALLERY_* / S3_* 环境变量可覆盖，QINIU_* 为兼容别名）。
export default {
  name: 'gallery',
  version: '1.1.0',
  description: '个人图床：上传/配额/外链，支持本地与 S3 兼容后端（MinIO/R2/七牛等）',
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

    registry.registerApiRoute('POST', '/api/gallery', async (req, res) => {
      const user = requireUser(req, res); if (!user) return;
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!IMAGE_MIME.has(mime)) return json(res, 400, { error: '仅支持 PNG/JPEG/WebP/GIF 图片' });
      const bytes = await readRawBody(req);
      if (!bytes.length) return json(res, 400, { error: '空文件' });
      if (bytes.length > maxFileSize) return json(res, 413, { error: '超过单文件大小上限' });
      if (usedBytes(user.id) + bytes.length > QUOTA_BYTES) return json(res, 413, { error: '超出图床配额' });
      if (STORAGE === 's3' || STORAGE === 'qiniu') {
        const s3 = s3Client();
        if (!s3) return json(res, 503, { error: 'S3 模式未配置 S3_* 环境变量' });
        const key = s3Key(user.id, mime);
        try {
          await s3PutObject(s3, key, bytes, mime);
        } catch (e) {
          return json(res, 500, { error: `S3 上传失败：${e.message || e}` });
        }
        const result = db.prepare('INSERT INTO gallery_images(user_id, filename, mime, size, stored_name, storage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(user.id, `image${extOf(mime)}`, mime, bytes.length, key, 's3', Date.now());
        logAudit(user.id, 'gallery_upload', null, `图片 id ${Number(result.lastInsertRowid)}`);
        return json(res, 201, { image: { id: Number(result.lastInsertRowid), filename: `image${extOf(mime)}`, mime, size: bytes.length, storage: 's3' } });
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
        images: await Promise.all(rows.map(async r => ({ id: r.id, filename: r.filename, mime: r.mime, size: r.size, storage: r.storage, created_at: r.created_at, stored_name: r.stored_name, url: await rowUrl(r) }))),
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
      if (row.storage === 's3') {
        const s3 = s3Client();
        if (!s3) return json(res, 503, { error: 'S3 模式未配置 S3_* 环境变量' });
        try { await s3RemoveObject(s3, row.stored_name); } catch { /* 桶内对象可能已不存在，DB 记录照删 */ }
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
      if (row.storage === 's3') return redirectToS3Url(res, row.stored_name);
      try {
        const bytes = readFileSync(join(galleryDir(), row.stored_name));
        res.writeHead(200, { 'content-type': row.mime, 'content-length': bytes.length, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' });
        return res.end(bytes);
      } catch { return json(res, 404, { error: '文件数据不存在' }); }
    });
  }
};
