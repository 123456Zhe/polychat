import { canAccessAttachment } from '../lib/access.js';
import { requireUser, verifyPublicFileUrl } from '../lib/auth.js';
import { INLINE_IMAGE_TYPES, LEGACY_FILE_SIZE, MAX_FILE_SIZE, UPLOAD_CHUNK_SIZE, UPLOAD_DIR } from '../lib/config.js';
import { db } from '../lib/db.js';
import { json, readBody } from '../lib/http.js';
import { appendFileSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function handleFileRoutes(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/uploads') {
    const user = requireUser(req, res); if (!user) return true;
    const { name = '', type = '', size = 0 } = await readBody(req);
    const originalName = String(name).replace(/[\r\n]/g, '').trim();
    const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(String(type)) ? String(type) : 'application/octet-stream';
    const totalSize = Number(size);
    if (!originalName || originalName.length > 255) return (json(res, 400, { error: '文件名需为 1–255 个字符' }), true);
    if (!Number.isInteger(totalSize) || totalSize < 1 || totalSize > MAX_FILE_SIZE) return (json(res, 400, { error: `文件需为 1 字节至 ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB` }), true);
    const id = randomBytes(24).toString('base64url'), tempName = `.upload-${randomBytes(24).toString('hex')}.part`;
    writeFileSync(join(UPLOAD_DIR, tempName), Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    db.prepare('INSERT INTO upload_sessions(id, user_id, original_name, mime_type, total_size, temp_name, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, user.id, originalName, mimeType, totalSize, tempName, Date.now() + 24 * 3600_000);
    return (json(res, 201, { upload: { id, offset: 0, size: totalSize, chunk_size: UPLOAD_CHUNK_SIZE } }), true);
  }

  const uploadMatch = url.pathname.match(/^\/api\/uploads\/([A-Za-z0-9_-]+)$/);
  if (uploadMatch && req.method === 'GET') {
    const user = requireUser(req, res); if (!user) return true;
    const upload = db.prepare('SELECT id, original_name AS name, mime_type AS type, total_size AS size, received_size AS offset, expires_at FROM upload_sessions WHERE id = ? AND user_id = ?').get(uploadMatch[1], user.id);
    if (!upload || upload.expires_at <= Date.now()) return (json(res, 404, { error: '上传会话不存在或已过期' }), true);
    return (json(res, 200, { upload: { ...upload, chunk_size: UPLOAD_CHUNK_SIZE } }), true);
  }

  if (uploadMatch && req.method === 'DELETE') {
    const user = requireUser(req, res); if (!user) return true;
    const upload = db.prepare('SELECT temp_name FROM upload_sessions WHERE id = ? AND user_id = ?').get(uploadMatch[1], user.id);
    if (upload) { try { unlinkSync(join(UPLOAD_DIR, upload.temp_name)); } catch { /* already gone */ } db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(uploadMatch[1]); }
    return (json(res, 200, { ok: true }), true);
  }

  const uploadChunkMatch = url.pathname.match(/^\/api\/uploads\/([A-Za-z0-9_-]+)\/chunks$/);
  if (uploadChunkMatch && req.method === 'PUT') {
    const user = requireUser(req, res); if (!user) return true;
    const upload = db.prepare('SELECT * FROM upload_sessions WHERE id = ? AND user_id = ?').get(uploadChunkMatch[1], user.id);
    if (!upload || upload.expires_at <= Date.now()) return (json(res, 404, { error: '上传会话不存在或已过期' }), true);
    const { offset = -1, data = '' } = await readBody(req, 1_500_000);
    if (Number(offset) !== upload.received_size) return (json(res, 409, { error: '分片偏移量不匹配', offset: upload.received_size }), true);
    if (typeof data !== 'string' || data.length > Math.ceil(UPLOAD_CHUNK_SIZE / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return (json(res, 400, { error: '分片数据格式错误' }), true);
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > UPLOAD_CHUNK_SIZE || upload.received_size + bytes.length > upload.total_size) return (json(res, 400, { error: '分片大小无效' }), true);
    appendFileSync(join(UPLOAD_DIR, upload.temp_name), bytes);
    const received = upload.received_size + bytes.length;
    if (received < upload.total_size) {
      db.prepare('UPDATE upload_sessions SET received_size = ?, expires_at = ? WHERE id = ?').run(received, Date.now() + 24 * 3600_000, upload.id);
      return (json(res, 200, { upload: { id: upload.id, offset: received, size: upload.total_size, chunk_size: UPLOAD_CHUNK_SIZE } }), true);
    }
    const storedName = randomBytes(24).toString('hex');
    renameSync(join(UPLOAD_DIR, upload.temp_name), join(UPLOAD_DIR, storedName));
    const result = db.prepare('INSERT INTO attachments(user_id, original_name, stored_name, mime_type, size) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, upload.original_name, storedName, upload.mime_type, upload.total_size);
    db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(upload.id);
    const id = Number(result.lastInsertRowid);
    return (json(res, 201, { completed: true, file: { id, name: upload.original_name, type: upload.mime_type, size: upload.total_size, url: `/api/files/${id}` } }), true);
  }

  if (req.method === 'POST' && url.pathname === '/api/files') {
    const user = requireUser(req, res); if (!user) return true;
    const { name = '', type = '', data = '' } = await readBody(req, 14_100_000);
    const originalName = String(name).replace(/[\r\n]/g, '').trim();
    const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(String(type)) ? String(type) : 'application/octet-stream';
    if (!originalName || originalName.length > 255) return (json(res, 400, { error: '文件名需为 1–255 个字符' }), true);
    if (typeof data !== 'string' || data.length > Math.ceil(LEGACY_FILE_SIZE / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      return (json(res, 400, { error: '文件数据格式错误或超过 10 MB' }), true);
    }
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > LEGACY_FILE_SIZE) return (json(res, 400, { error: '兼容上传接口限制为 10 MB，请使用分片上传接口发送更大文件' }), true);
    const storedName = randomBytes(24).toString('hex');
    writeFileSync(join(UPLOAD_DIR, storedName), bytes, { flag: 'wx', mode: 0o600 });
    const result = db.prepare(`INSERT INTO attachments(user_id, original_name, stored_name, mime_type, size)
      VALUES (?, ?, ?, ?, ?)`).run(user.id, originalName, storedName, mimeType, bytes.length);
    const id = Number(result.lastInsertRowid);
    return (json(res, 201, { file: { id, name: originalName, type: mimeType, size: bytes.length, url: `/api/files/${id}` } }), true);
  }

  const fileMatch = url.pathname.match(/^\/api\/files\/(\d+)$/);
  if (fileMatch && req.method === 'GET') {
    const viewer = requireUser(req, res); if (!viewer) return true;
    const file = canAccessAttachment(Number(fileMatch[1]), viewer);
    if (!file) return (json(res, 404, { error: '文件不存在' }), true);
    try {
      const bytes = readFileSync(join(UPLOAD_DIR, file.stored_name));
      const inline = url.searchParams.get('inline') === '1' && INLINE_IMAGE_TYPES.has(file.mime_type);
      res.writeHead(200, {
        'content-type': file.mime_type,
        'content-length': bytes.length,
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff'
      });
      return (res.end(bytes), true);
    } catch { return (json(res, 404, { error: '文件数据不存在' }), true); }
  }

  const publicFileMatch = url.pathname.match(/^\/api\/public\/files\/([A-Za-z0-9]+)$/);
  if (publicFileMatch && req.method === 'GET') {
    const expires = Number(url.searchParams.get('expires') || 0);
    const sig = url.searchParams.get('sig') || '';
    if (!verifyPublicFileUrl(publicFileMatch[1], expires, sig)) return (json(res, 403, { error: '文件链接无效或已过期' }), true);
    const file = db.prepare('SELECT * FROM attachments WHERE stored_name = ?').get(publicFileMatch[1]);
    if (!file) return (json(res, 404, { error: '文件不存在' }), true);
    try {
      const bytes = readFileSync(join(UPLOAD_DIR, file.stored_name));
      const inline = INLINE_IMAGE_TYPES.has(file.mime_type);
      res.writeHead(200, {
        'content-type': file.mime_type,
        'content-length': bytes.length,
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff'
      });
      return (res.end(bytes), true);
    } catch { return (json(res, 404, { error: '文件数据不存在' }), true); }
  }

  return false;
}
