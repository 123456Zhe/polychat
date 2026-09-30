import { LOGIN_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW, REGISTER_RATE_MAX, REGISTER_RATE_WINDOW, USERNAME_RE, checkPassword, cookie, createSession, getClientIp, getLoginAttempts, hashPassword, isFingerprintBanned, isIpBanned, logAudit, recordLoginAttempt, requireUser, tokenOf } from '../lib/auth.js';
import { AVATAR_DIR, MAX_AVATAR_SIZE, UPLOAD_DIR } from '../lib/config.js';
import { db } from '../lib/db.js';
import { json, readBody } from '../lib/http.js';
import { publicUser, validAvatar } from '../lib/users.js';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function handleAuthRoutes(req, res, url, registry) {
  if (req.method === 'POST' && url.pathname === '/api/register') {
    const ip = getClientIp(req);
    if (isIpBanned(ip)) return (json(res, 403, { error: '你的 IP 已被封禁' }), true);
    const { username = '', password = '', fingerprint } = await readBody(req);
    const fp = typeof fingerprint === 'string' && fingerprint.length <= 128 ? fingerprint : null;
    if (fp && isFingerprintBanned(fp)) return (json(res, 403, { error: '该设备已被封禁' }), true);
    const name = String(username).trim();
    if (!USERNAME_RE.test(name)) return (json(res, 400, { error: '用户名需为 2–24 位字母、数字、下划线或连字符' }), true);
    if (String(password).length < 8 || String(password).length > 128) return (json(res, 400, { error: '密码需为 8–128 位' }), true);
    if (process.env.NODE_ENV !== 'test') {
      const regSince = new Date(Date.now() - REGISTER_RATE_WINDOW).toISOString();
      const recentRegs = db.prepare('SELECT COUNT(*) AS count FROM registration_attempts WHERE ip_address = ? AND created_at > ?').get(ip, regSince).count;
      if (recentRegs >= REGISTER_RATE_MAX) {
        db.prepare('INSERT OR REPLACE INTO banned_ips(ip_address, banned_until, reason) VALUES (?, NULL, ?)').run(ip, '自动封禁：注册频率过高');
        logAudit(0, 'auto_ban_ip', null, `IP ${ip} 因 ${REGISTER_RATE_WINDOW / 60000} 分钟内注册 ${recentRegs + 1} 个账号被自动封禁`);
        return (json(res, 429, { error: '注册过于频繁，该 IP 已被封禁' }), true);
      }
    }
    try {
      const firstAccount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0;
      const result = db.prepare('INSERT INTO users(username, password_hash, is_admin, last_ip, device_fingerprint) VALUES (?, ?, ?, ?, ?)').run(name, hashPassword(String(password)), firstAccount ? 1 : 0, ip, fp);
      db.prepare('INSERT INTO registration_attempts(ip_address) VALUES (?)').run(ip);
      const token = createSession(Number(result.lastInsertRowid));
      return (json(res, 201, { token, user: publicUser({ id: Number(result.lastInsertRowid), username: name, is_admin: firstAccount }) }, { 'set-cookie': cookie(token) }), true);
    } catch (error) {
      if (error.message.includes('UNIQUE')) return (json(res, 409, { error: '用户名已存在' }), true);
      throw error;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const ip = getClientIp(req);
    const attempts = getLoginAttempts(ip);
    if (attempts >= LOGIN_RATE_LIMIT_MAX) return (json(res, 429, { error: `登录尝试过多，请 ${LOGIN_RATE_LIMIT_WINDOW / 60000} 分钟后再试` }), true);
    const { username = '', password = '', fingerprint } = await readBody(req);
    const fp = typeof fingerprint === 'string' && fingerprint.length <= 128 ? fingerprint : null;
    const user = db.prepare('SELECT id, username, password_hash, is_admin, avatar_updated_at, banned_until, device_fingerprint FROM users WHERE username = ?').get(String(username).trim());
    if (!user || !checkPassword(String(password), user.password_hash)) {
      recordLoginAttempt(ip, String(username).trim(), false);
      return (json(res, 401, { error: '用户名或密码错误' }), true);
    }
    if (!user.is_admin) {
      if (isIpBanned(ip)) return (json(res, 403, { error: '你的 IP 已被封禁' }), true);
      const checkFp = fp || user.device_fingerprint;
      if (checkFp && isFingerprintBanned(checkFp)) return (json(res, 403, { error: '该设备已被封禁' }), true);
    }
    recordLoginAttempt(ip, String(username).trim(), true);
    db.prepare('UPDATE users SET last_ip = ?, device_fingerprint = COALESCE(?, device_fingerprint) WHERE id = ?').run(ip, fp, user.id);
    const token = createSession(user.id);
    return (json(res, 200, { token, user: publicUser(user) }, { 'set-cookie': cookie(token) }), true);
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token = tokenOf(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return (json(res, 200, { ok: true }, { 'set-cookie': cookie('', true) }), true);
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    const user = requireUser(req, res); if (!user) return true;
    return (json(res, 200, { user: publicUser(user) }), true);
  }

  if (req.method === 'GET' && url.pathname === '/api/me/export') {
    const user = requireUser(req, res); if (!user) return true;
    const messages = db.prepare(`
      SELECT messages.id, messages.content, messages.created_at, messages.edited_at, messages.deleted_at,
        rooms.name AS room_name, attachments.original_name AS attachment_name
      FROM messages
      JOIN rooms ON rooms.id = messages.room_id
      LEFT JOIN attachments ON attachments.id = messages.attachment_id
      WHERE messages.user_id = ?
      ORDER BY messages.id
    `).all(user.id);
    const exportData = {
      user: { id: user.id, username: user.username, created_at: user.created_at },
      export_date: new Date().toISOString(),
      message_count: messages.length,
      messages: messages.map(m => ({
        room: m.room_name,
        content: m.content,
        attachment: m.attachment_name || null,
        created_at: m.created_at,
        edited_at: m.edited_at,
        is_deleted: Boolean(m.deleted_at)
      }))
    };
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="polychat-export-${user.id}-${Date.now()}.json"`
    });
    res.end(JSON.stringify(exportData, null, 2));
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/me') {
    const user = requireUser(req, res); if (!user) return true;
    if (user.is_admin) {
      const adminCount = db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get().count;
      if (adminCount <= 1) return (json(res, 400, { error: '不能删除最后一个管理员账号' }), true);
    }
    const { password = '' } = await readBody(req);
    const fullUser = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!checkPassword(String(password), fullUser.password_hash)) return (json(res, 401, { error: '密码错误' }), true);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    db.prepare('UPDATE messages SET content = \'[已删除]\', attachment_id = NULL, deleted_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM attachments WHERE user_id = ?').run(user.id);
    // 图床：清理数据库行 + 本地文件（S3 模式对象经插件清理服务，插件停用时跳过）
    const galleryRows = db.prepare('SELECT id, stored_name, storage FROM gallery_images WHERE user_id = ?').all(user.id);
    db.prepare('DELETE FROM gallery_images WHERE user_id = ?').run(user.id);
    for (const g of galleryRows) {
      if (g.storage === 'local') {
        try { unlinkSync(join(UPLOAD_DIR, 'gallery', g.stored_name)); } catch { /* stale */ }
      }
    }
    const galleryCleanup = registry.service('gallery-cleanup');
    if (galleryCleanup) for (const g of galleryRows.filter(x => x.storage === 's3')) { try { await galleryCleanup.deleteObject(g.stored_name); } catch { /* non-fatal */ } }
    db.prepare('DELETE FROM room_members WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM message_reactions WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(user.id);
    // 审计日志：admin_id / target_user_id 为 NO ACTION 外键，不清理会阻塞删用户；
    // 同时这些记录属于个人数据，随账户注销一并清除。
    db.prepare('DELETE FROM audit_logs WHERE admin_id = ? OR target_user_id = ?').run(user.id, user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    return (json(res, 200, { ok: true }, { 'set-cookie': cookie('', true) }), true);
  }

  if (req.method === 'POST' && url.pathname === '/api/me/avatar') {
    const user = requireUser(req, res); if (!user) return true;
    const { type = '', data = '' } = await readBody(req, 2_900_000);
    const mimeType = String(type).toLowerCase();
    if (typeof data !== 'string' || data.length > Math.ceil(MAX_AVATAR_SIZE / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      return (json(res, 400, { error: '头像数据格式错误或超过 2 MB' }), true);
    }
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > MAX_AVATAR_SIZE || !validAvatar(bytes, mimeType)) {
      return (json(res, 400, { error: '只支持 2 MB 以内的 PNG、JPEG、WebP 或 GIF 图片' }), true);
    }
    const storedName = randomBytes(24).toString('hex');
    writeFileSync(join(AVATAR_DIR, storedName), bytes, { flag: 'wx', mode: 0o600 });
    const previous = db.prepare('SELECT avatar_name FROM users WHERE id = ?').get(user.id);
    const updatedAt = Date.now();
    db.prepare('UPDATE users SET avatar_name = ?, avatar_mime = ?, avatar_updated_at = ? WHERE id = ?')
      .run(storedName, mimeType, updatedAt, user.id);
    if (previous?.avatar_name) { try { unlinkSync(join(AVATAR_DIR, previous.avatar_name)); } catch { /* stale file */ } }
    return (json(res, 200, { user: publicUser({ ...user, avatar_updated_at: updatedAt }) }), true);
  }

  if (req.method === 'DELETE' && url.pathname === '/api/me/avatar') {
    const user = requireUser(req, res); if (!user) return true;
    const previous = db.prepare('SELECT avatar_name FROM users WHERE id = ?').get(user.id);
    db.prepare('UPDATE users SET avatar_name = NULL, avatar_mime = NULL, avatar_updated_at = NULL WHERE id = ?').run(user.id);
    if (previous?.avatar_name) { try { unlinkSync(join(AVATAR_DIR, previous.avatar_name)); } catch { /* stale file */ } }
    return (json(res, 200, { user: publicUser({ ...user, avatar_updated_at: null }) }), true);
  }

  const avatarMatch = url.pathname.match(/^\/api\/users\/(\d+)\/avatar$/);
  if (avatarMatch && req.method === 'GET') {
    if (!requireUser(req, res)) return true;
    const avatar = db.prepare('SELECT avatar_name, avatar_mime FROM users WHERE id = ?').get(Number(avatarMatch[1]));
    if (!avatar?.avatar_name) return (json(res, 404, { error: '用户尚未设置头像' }), true);
    try {
      const bytes = readFileSync(join(AVATAR_DIR, avatar.avatar_name));
      res.writeHead(200, { 'content-type': avatar.avatar_mime, 'content-length': bytes.length,
        'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
      return (res.end(bytes), true);
    } catch { return (json(res, 404, { error: '头像文件不存在' }), true); }
  }

  return false;
}
