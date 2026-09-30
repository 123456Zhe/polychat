import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';
import { json, parseCookies } from './http.js';
import { SESSION_DAYS, TRUST_PROXY, FILE_URL_SECRET, FILE_URL_TTL_MS } from './config.js';

export function tokenOf(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : parseCookies(req).polychat_session;
}

export function currentUser(req) {
  const token = tokenOf(req);
  if (!token) return null;
  return db.prepare(`
    SELECT users.id, users.username, users.is_admin, users.avatar_updated_at, users.banned_until, users.muted_until, users.device_fingerprint FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > ?
  `).get(token, Date.now()) || null;
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function checkPassword(password, stored) {
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, Date.now() + SESSION_DAYS * 86400_000);
  return token;
}

export const LOGIN_RATE_LIMIT_WINDOW = 15 * 60 * 1000;
export const LOGIN_RATE_LIMIT_MAX = 5;
export const REGISTER_RATE_WINDOW = 60 * 60 * 1000; // 1 小时
export const REGISTER_RATE_MAX = 5; // 每小时最多注册 5 个账号
export const USERNAME_RE = /^[\p{L}\p{N}_-]{2,24}$/u;

export function getLoginAttempts(ip) {
  const since = new Date(Date.now() - LOGIN_RATE_LIMIT_WINDOW).toISOString();
  return db.prepare('SELECT COUNT(*) AS count FROM login_attempts WHERE ip_address = ? AND created_at > ? AND success = 0').get(ip, since).count;
}

export function recordLoginAttempt(ip, username, success) {
  db.prepare('INSERT INTO login_attempts(ip_address, username, success) VALUES (?, ?, ?)').run(ip, username || null, success ? 1 : 0);
}

export function isUserBanned(user) {
  if (!user.banned_until) return false;
  if (user.banned_until <= Date.now()) {
    db.prepare('UPDATE users SET banned_until = NULL WHERE id = ?').run(user.id);
    return false;
  }
  return true;
}

export function isUserMuted(user) {
  if (!user.muted_until) return false;
  if (user.muted_until <= Date.now()) {
    db.prepare('UPDATE users SET muted_until = NULL WHERE id = ?').run(user.id);
    return false;
  }
  return true;
}

export function logAudit(adminId, action, targetUserId = null, details = null) {
  db.prepare('INSERT INTO audit_logs(admin_id, action, target_user_id, details) VALUES (?, ?, ?, ?)').run(adminId, action, targetUserId, details);
}

export function getClientIp(req) {
  if (TRUST_PROXY) return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  return req.socket.remoteAddress || 'unknown';
}

export function signPublicFileUrl(storedName, base = '') {
  const expires = Date.now() + FILE_URL_TTL_MS;
  const sig = createHmac('sha256', FILE_URL_SECRET).update(`${storedName}:${expires}`).digest('hex');
  return `${base.replace(/\/+$/, '')}/api/public/files/${storedName}?expires=${expires}&sig=${sig}`;
}

export function verifyPublicFileUrl(storedName, expires, sig) {
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = createHmac('sha256', FILE_URL_SECRET).update(`${storedName}:${expires}`).digest('hex');
  if (typeof sig !== 'string' || sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export function isIpBanned(ip) {
  const record = db.prepare('SELECT banned_until FROM banned_ips WHERE ip_address = ?').get(ip);
  if (!record) return false;
  if (record.banned_until && record.banned_until <= Date.now()) {
    db.prepare('DELETE FROM banned_ips WHERE ip_address = ?').run(ip);
    return false;
  }
  return true;
}

export function isFingerprintBanned(fingerprint) {
  if (!fingerprint) return false;
  const record = db.prepare('SELECT banned_until FROM banned_fingerprints WHERE fingerprint = ?').get(fingerprint);
  if (!record) return false;
  if (record.banned_until && record.banned_until <= Date.now()) {
    db.prepare('DELETE FROM banned_fingerprints WHERE fingerprint = ?').run(fingerprint);
    return false;
  }
  return true;
}

export function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) { json(res, 401, { error: '请先登录' }); return null; }
  if (isUserBanned(user)) { json(res, 403, { error: '账号已被封禁', banned_until: user.banned_until }); return null; }
  if (!user.is_admin) {
    const ip = getClientIp(req);
    if (isIpBanned(ip)) { json(res, 403, { error: '你的 IP 已被封禁' }); return null; }
    if (user.device_fingerprint && isFingerprintBanned(user.device_fingerprint)) { json(res, 403, { error: '该设备已被封禁' }); return null; }
  }
  return user;
}

export function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.is_admin) { json(res, 403, { error: '需要管理员权限' }); return null; }
  return user;
}

export function cookie(token, clear = false) {
  const age = clear ? 0 : SESSION_DAYS * 86400;
  const secure = process.env.NODE_ENV === 'production' || process.env.PUBLIC_URL?.startsWith('https://');
  return `polychat_session=${clear ? '' : encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
}
