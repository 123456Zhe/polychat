import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

// 个人图床：本地 / 七牛 Kodo 双后端（GALLERY_* / QINIU_* 环境变量可覆盖）。
export default {
  name: 'gallery',
  version: '1.0.0',
  description: '个人图床：上传/配额/外链，支持本地与七牛 Kodo 双后端',
  enabledByDefault: true,
  defaultConfig: { quota_mb: 500, storage: 'local' },
  setup(ctx) {
    const { registry, db, json, requireUser, readBody, maxFileSize, uploadDir, env, pluginConfig, logAudit } = ctx;

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

    registry.registerApiRoute('POST', '/api/gallery', async (req, res) => {
      const user = requireUser(req, res); if (!user) return;
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!IMAGE_MIME.has(mime)) return json(res, 400, { error: '仅支持 PNG/JPEG/WebP/GIF 图片' });
      const bytes = await readRawBody(req);
      if (!bytes.length) return json(res, 400, { error: '空文件' });
      if (bytes.length > maxFileSize) return json(res, 413, { error: '超过单文件大小上限' });
      if (usedBytes(user.id) + bytes.length > QUOTA_BYTES) return json(res, 413, { error: '超出图床配额' });
      if (STORAGE === 'qiniu') return json(res, 503, { error: '七牛模式未配置（缺 QINIU_* 环境变量）' }); // B4 替换
      const storedName = `${user.id}-${Date.now()}-${randomBytes(4).toString('hex')}${extOf(mime)}`;
      writeFileSync(join(galleryDir(), storedName), bytes, { flag: 'wx', mode: 0o600 });
      const result = db.prepare('INSERT INTO gallery_images(user_id, filename, mime, size, stored_name, storage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, `image${extOf(mime)}`, mime, bytes.length, storedName, 'local', Date.now());
      logAudit(user.id, 'gallery_upload', Number(result.lastInsertRowid));
      return json(res, 201, { image: { id: Number(result.lastInsertRowid), filename: `image${extOf(mime)}`, mime, size: bytes.length, storage: 'local' } });
    });

    // B2 最小列表（brief 测试要求 GET 可见）；B3 扩展为删除 + 签名外链
    registry.registerApiRoute('GET', '/api/gallery', async (req, res) => {
      const user = requireUser(req, res); if (!user) return;
      const images = db.prepare('SELECT id, filename, mime, size, stored_name, storage, created_at FROM gallery_images WHERE user_id = ? ORDER BY id DESC').all(user.id);
      return json(res, 200, { images, used_mb: usedBytes(user.id) / (1024 * 1024) });
    });
  }
};
