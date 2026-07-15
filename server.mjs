import http from 'node:http';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, appendFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import webpush from 'web-push';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'web');
const KATEX_DIST = join(ROOT, 'node_modules', 'katex', 'dist');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || join(ROOT, 'data', 'polychat.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(dirname(DB_PATH), 'uploads');
const AVATAR_DIR = process.env.AVATAR_DIR || join(dirname(DB_PATH), 'avatars');
const SESSION_DAYS = 30;
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 100 * 1024 * 1024);
const LEGACY_FILE_SIZE = 10 * 1024 * 1024;
const UPLOAD_CHUNK_SIZE = 1024 * 1024;
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const BACKUP_DIR = process.env.BACKUP_DIR || join(dirname(DB_PATH), 'backups');
const BACKUP_INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
const BACKUP_ENABLED = process.env.BACKUP_ENABLED !== 'false';

mkdirSync(join(ROOT, 'data'), { recursive: true });
mkdirSync(UPLOAD_DIR, { recursive: true });
mkdirSync(AVATAR_DIR, { recursive: true });
if (BACKUP_ENABLED) mkdirSync(BACKUP_DIR, { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    avatar_name TEXT,
    avatar_mime TEXT,
    avatar_updated_at INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_by INTEGER REFERENCES users(id),
    is_private INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    attachment_id INTEGER REFERENCES attachments(id),
    reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    thread_root INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    edited_at TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id, id);
  CREATE TABLE IF NOT EXISTS room_members (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'member')),
    PRIMARY KEY(room_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS message_reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    PRIMARY KEY(message_id, user_id, emoji)
  );
  CREATE TABLE IF NOT EXISTS room_pins (
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(room_id, message_id)
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS upload_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    total_size INTEGER NOT NULL,
    received_size INTEGER NOT NULL DEFAULT 0,
    temp_name TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY,
    ip_address TEXT NOT NULL,
    username TEXT,
    success INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address, created_at);
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    target_user_id INTEGER REFERENCES users(id),
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS invite_codes (
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    max_uses INTEGER,
    use_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO rooms(id, name) VALUES (1, '大厅');
`);
if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'attachment_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN attachment_id INTEGER REFERENCES attachments(id)');
}
const roomColumns = new Set(db.prepare('PRAGMA table_info(rooms)').all().map(column => column.name));
if (!roomColumns.has('is_private')) db.exec('ALTER TABLE rooms ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0');
if (!roomColumns.has('announcement')) db.exec('ALTER TABLE rooms ADD COLUMN announcement TEXT');
if (!roomColumns.has('announcement_by')) db.exec('ALTER TABLE rooms ADD COLUMN announcement_by INTEGER REFERENCES users(id)');
if (!roomColumns.has('announcement_updated_at')) db.exec('ALTER TABLE rooms ADD COLUMN announcement_updated_at TEXT');
const messageColumns = new Set(db.prepare('PRAGMA table_info(messages)').all().map(column => column.name));
if (!messageColumns.has('reply_to')) db.exec('ALTER TABLE messages ADD COLUMN reply_to INTEGER REFERENCES messages(id)');
if (!messageColumns.has('edited_at')) db.exec('ALTER TABLE messages ADD COLUMN edited_at TEXT');
if (!messageColumns.has('deleted_at')) db.exec('ALTER TABLE messages ADD COLUMN deleted_at TEXT');
if (!messageColumns.has('thread_root')) db.exec('ALTER TABLE messages ADD COLUMN thread_root INTEGER REFERENCES messages(id) ON DELETE CASCADE');
const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
if (!userColumns.has('is_admin')) db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
if (!userColumns.has('avatar_name')) db.exec('ALTER TABLE users ADD COLUMN avatar_name TEXT');
if (!userColumns.has('avatar_mime')) db.exec('ALTER TABLE users ADD COLUMN avatar_mime TEXT');
if (!userColumns.has('avatar_updated_at')) db.exec('ALTER TABLE users ADD COLUMN avatar_updated_at INTEGER');
if (!userColumns.has('banned_until')) db.exec('ALTER TABLE users ADD COLUMN banned_until INTEGER');
if (!userColumns.has('muted_until')) db.exec('ALTER TABLE users ADD COLUMN muted_until INTEGER');
if (db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get().count === 0) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)').run();
}

let vapidPublicKey = process.env.VAPID_PUBLIC_KEY || db.prepare("SELECT value FROM app_settings WHERE key = 'vapid_public_key'").get()?.value;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || db.prepare("SELECT value FROM app_settings WHERE key = 'vapid_private_key'").get()?.value;
if (!vapidPublicKey || !vapidPrivateKey) {
  const generated = webpush.generateVAPIDKeys();
  vapidPublicKey = generated.publicKey; vapidPrivateKey = generated.privateKey;
  db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES ('vapid_public_key', ?)").run(vapidPublicKey);
  db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES ('vapid_private_key', ?)").run(vapidPrivateKey);
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:polychat@example.com', vapidPublicKey, vapidPrivateKey);

const startTime = Date.now();
let lastBackupTime = null;
let backupError = null;

function performBackup() {
  if (!BACKUP_ENABLED) return;
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(BACKUP_DIR, `polychat-${timestamp}.db`);
    db.exec(`VACUUM INTO '${backupPath}'`);
    lastBackupTime = Date.now();
    backupError = null;
    const backupFiles = readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort();
    const maxBackups = Number(process.env.MAX_BACKUPS || 7);
    while (backupFiles.length > maxBackups) {
      unlinkSync(join(BACKUP_DIR, backupFiles.shift()));
    }
  } catch (e) {
    backupError = e.message;
    console.error('Backup failed:', e.message);
  }
}

if (BACKUP_ENABLED) {
  performBackup();
  setInterval(performBackup, BACKUP_INTERVAL_HOURS * 3600_000);
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => {
    const [key, ...value] = part.trim().split('=');
    return [key, decodeURIComponent(value.join('='))];
  }));
}

function tokenOf(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : parseCookies(req).polychat_session;
}

function currentUser(req) {
  const token = tokenOf(req);
  if (!token) return null;
  return db.prepare(`
    SELECT users.id, users.username, users.is_admin, users.avatar_updated_at, users.banned_until, users.muted_until FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > ?
  `).get(token, Date.now()) || null;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    is_admin: Boolean(user.is_admin),
    avatar_updated_at: user.avatar_updated_at || null,
    avatar_url: user.avatar_updated_at ? `/api/users/${user.id}/avatar?v=${user.avatar_updated_at}` : null,
    banned_until: user.banned_until || null,
    muted_until: user.muted_until || null
  };
}

function validAvatar(bytes, type) {
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (type === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function checkPassword(password, stored) {
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, Date.now() + SESSION_DAYS * 86400_000);
  return token;
}

const LOGIN_RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX = 5;

function getLoginAttempts(ip) {
  const since = new Date(Date.now() - LOGIN_RATE_LIMIT_WINDOW).toISOString();
  return db.prepare('SELECT COUNT(*) AS count FROM login_attempts WHERE ip_address = ? AND created_at > ? AND success = 0').get(ip, since).count;
}

function recordLoginAttempt(ip, username, success) {
  db.prepare('INSERT INTO login_attempts(ip_address, username, success) VALUES (?, ?, ?)').run(ip, username || null, success ? 1 : 0);
}

function isUserBanned(user) {
  if (!user.banned_until) return false;
  if (user.banned_until <= Date.now()) {
    db.prepare('UPDATE users SET banned_until = NULL WHERE id = ?').run(user.id);
    return false;
  }
  return true;
}

function isUserMuted(user) {
  if (!user.muted_until) return false;
  if (user.muted_until <= Date.now()) {
    db.prepare('UPDATE users SET muted_until = NULL WHERE id = ?').run(user.id);
    return false;
  }
  return true;
}

function logAudit(adminId, action, targetUserId = null, details = null) {
  db.prepare('INSERT INTO audit_logs(admin_id, action, target_user_id, details) VALUES (?, ?, ?, ?)').run(adminId, action, targetUserId, details);
}

async function readBody(req, maxLength = 70_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > maxLength) throw Object.assign(new Error('请求内容过大'), { status: 413 });
  }
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw Object.assign(new Error('JSON 格式错误'), { status: 400 }); }
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) { json(res, 401, { error: '请先登录' }); return null; }
  if (isUserBanned(user)) { json(res, 403, { error: '账号已被封禁', banned_until: user.banned_until }); return null; }
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.is_admin) { json(res, 403, { error: '需要管理员权限' }); return null; }
  return user;
}

function roomForUser(roomId, userId) {
  return db.prepare(`SELECT rooms.*, room_members.role FROM rooms
    LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
    WHERE rooms.id = ?`).get(userId, roomId);
}
function requireRoomAccess(req, res, roomId) {
  const user = requireUser(req, res); if (!user) return null;
  const room = roomForUser(roomId, user.id);
  if (!room) { json(res, 404, { error: '聊天室不存在' }); return null; }
  if (room.is_private && !room.role && !user.is_admin) { json(res, 403, { error: '这是私有聊天室' }); return null; }
  return { user, room };
}
function requireRoomManager(req, res, roomId) {
  const context = requireRoomAccess(req, res, roomId); if (!context) return null;
  if (!context.user.is_admin && !['owner', 'admin'].includes(context.room.role)) { json(res, 403, { error: '需要聊天室管理权限' }); return null; }
  return context;
}
function hydrateMessages(messages, viewerId) {
  if (!messages.length) return messages;
  const ids = messages.map(message => message.id);
  const placeholders = ids.map(() => '?').join(',');
  const reactions = db.prepare(`SELECT message_id, emoji, GROUP_CONCAT(user_id) AS users
    FROM message_reactions WHERE message_id IN (${placeholders}) GROUP BY message_id, emoji`).all(...ids);
  const byMessage = new Map();
  for (const reaction of reactions) {
    if (!byMessage.has(reaction.message_id)) byMessage.set(reaction.message_id, []);
    const userIds = reaction.users.split(',').map(Number);
    byMessage.get(reaction.message_id).push({ emoji: reaction.emoji, count: userIds.length, reacted: userIds.includes(viewerId) });
  }
  return messages.map(message => ({ ...message, is_deleted: Boolean(message.deleted_at), reactions: byMessage.get(message.id) || [] }));
}

const sockets = new Set();
function socketCanAccess(socket, roomId) {
  const room = roomForUser(roomId, socket.user.id);
  return room && (!room.is_private || room.role || socket.user.is_admin);
}
function broadcast(event, roomId = null) {
  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === 1 && (roomId == null || socketCanAccess(socket, roomId))) socket.send(payload);
  }
}
function onlineUsers() {
  const users = new Map();
  for (const socket of sockets) users.set(socket.user.id, { id: socket.user.id, username: socket.user.username });
  return [...users.values()];
}
async function pushMessage(roomId, senderId, message) {
  const room = db.prepare('SELECT name, is_private FROM rooms WHERE id = ?').get(roomId);
  if (!room) return;
  const subscriptions = db.prepare(`SELECT push_subscriptions.endpoint, push_subscriptions.p256dh, push_subscriptions.auth
    FROM push_subscriptions JOIN users ON users.id = push_subscriptions.user_id
    LEFT JOIN room_members ON room_members.room_id = ? AND room_members.user_id = users.id
    WHERE users.id != ? AND (? = 0 OR room_members.user_id IS NOT NULL OR users.is_admin = 1)`).all(roomId, senderId, room.is_private);
  const payload = JSON.stringify({
    title: `${message.username} · #${room.name}`,
    body: message.content || (message.attachment_name ? `发送了 ${message.attachment_name}` : '发送了附件'),
    roomId, messageId: message.id, url: `/?room=${roomId}&message=${message.id}`
  });
  await Promise.allSettled(subscriptions.map(async subscription => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 3600, urgency: 'high' });
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(subscription.endpoint);
      else throw error;
    }
  }));
}

function cookie(token, clear = false) {
  const age = clear ? 0 : SESSION_DAYS * 86400;
  return `polychat_session=${clear ? '' : encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}`;
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const messageCount = db.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
    const uptimeMs = Date.now() - startTime;
    return json(res, 200, {
      status: 'ok',
      version: '1.0.0',
      uptime_ms: uptimeMs,
      uptime_human: `${Math.floor(uptimeMs / 86400000)}d ${Math.floor((uptimeMs % 86400000) / 3600000)}h ${Math.floor((uptimeMs % 3600000) / 60000)}m`,
      database: { path: DB_PATH, users: userCount, messages: messageCount },
      backup: { enabled: BACKUP_ENABLED, last_backup: lastBackupTime, error: backupError }
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/register') {
    const { username = '', password = '' } = await readBody(req);
    const name = String(username).trim();
    if (!/^[\p{L}\p{N}_-]{2,24}$/u.test(name)) return json(res, 400, { error: '用户名需为 2–24 位字母、数字、下划线或连字符' });
    if (String(password).length < 8 || String(password).length > 128) return json(res, 400, { error: '密码需为 8–128 位' });
    try {
      const firstAccount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count === 0;
      const result = db.prepare('INSERT INTO users(username, password_hash, is_admin) VALUES (?, ?, ?)').run(name, hashPassword(String(password)), firstAccount ? 1 : 0);
      const token = createSession(Number(result.lastInsertRowid));
      return json(res, 201, { token, user: publicUser({ id: Number(result.lastInsertRowid), username: name, is_admin: firstAccount }) }, { 'set-cookie': cookie(token) });
    } catch (error) {
      if (error.message.includes('UNIQUE')) return json(res, 409, { error: '用户名已存在' });
      throw error;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const attempts = getLoginAttempts(ip);
    if (attempts >= LOGIN_RATE_LIMIT_MAX) return json(res, 429, { error: `登录尝试过多，请 ${LOGIN_RATE_LIMIT_WINDOW / 60000} 分钟后再试` });
    const { username = '', password = '' } = await readBody(req);
    const user = db.prepare('SELECT id, username, password_hash, is_admin, avatar_updated_at, banned_until FROM users WHERE username = ?').get(String(username).trim());
    if (!user || !checkPassword(String(password), user.password_hash)) {
      recordLoginAttempt(ip, String(username).trim(), false);
      return json(res, 401, { error: '用户名或密码错误' });
    }
    if (isUserBanned(user)) return json(res, 403, { error: '账号已被封禁', banned_until: user.banned_until });
    recordLoginAttempt(ip, String(username).trim(), true);
    const token = createSession(user.id);
    return json(res, 200, { token, user: publicUser(user) }, { 'set-cookie': cookie(token) });
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token = tokenOf(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return json(res, 200, { ok: true }, { 'set-cookie': cookie('', true) });
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    const user = requireUser(req, res); if (!user) return;
    return json(res, 200, { user: publicUser(user) });
  }

  if (req.method === 'GET' && url.pathname === '/api/me/export') {
    const user = requireUser(req, res); if (!user) return;
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
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/me') {
    const user = requireUser(req, res); if (!user) return;
    if (user.is_admin) {
      const adminCount = db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get().count;
      if (adminCount <= 1) return json(res, 400, { error: '不能删除最后一个管理员账号' });
    }
    const { password = '' } = await readBody(req);
    const fullUser = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!checkPassword(String(password), fullUser.password_hash)) return json(res, 401, { error: '密码错误' });
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    db.prepare('UPDATE messages SET content = \'[已删除]\', attachment_id = NULL, deleted_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM attachments WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM room_members WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM message_reactions WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    return json(res, 200, { ok: true }, { 'set-cookie': cookie('', true) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
    if (!requireAdmin(req, res)) return;
    const stats = {
      users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
      rooms: db.prepare('SELECT COUNT(*) AS count FROM rooms').get().count,
      messages: db.prepare('SELECT COUNT(*) AS count FROM messages').get().count,
      files: db.prepare('SELECT COUNT(*) AS count FROM attachments').get().count,
    };
    const users = db.prepare(`SELECT users.id, users.username, users.is_admin, users.created_at, users.banned_until, users.muted_until,
      (SELECT COUNT(*) FROM messages WHERE messages.user_id = users.id) AS message_count
      FROM users ORDER BY users.id`).all();
    return json(res, 200, { stats, users });
  }

  const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/admin$/);
  if (adminUserMatch && req.method === 'PUT') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const targetId = Number(adminUserMatch[1]);
    const { is_admin = false } = await readBody(req);
    const target = db.prepare('SELECT id, username, is_admin, avatar_updated_at FROM users WHERE id = ?').get(targetId);
    if (!target) return json(res, 404, { error: '用户不存在' });
    if (!is_admin && target.is_admin && db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get().count <= 1) {
      return json(res, 400, { error: '至少需要保留一名管理员' });
    }
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, targetId);
    logAudit(admin.id, is_admin ? 'grant_admin' : 'revoke_admin', targetId);
    return json(res, 200, { user: publicUser({ ...target, is_admin: Boolean(is_admin) }) });
  }

  const adminBanMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/ban$/);
  if (adminBanMatch && req.method === 'PUT') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const targetId = Number(adminBanMatch[1]);
    const { duration_hours = 24 } = await readBody(req);
    const target = db.prepare('SELECT id, username, is_admin, avatar_updated_at, banned_until FROM users WHERE id = ?').get(targetId);
    if (!target) return json(res, 404, { error: '用户不存在' });
    if (target.is_admin) return json(res, 400, { error: '不能封禁管理员' });
    const bannedUntil = Date.now() + Number(duration_hours) * 3600_000;
    db.prepare('UPDATE users SET banned_until = ? WHERE id = ?').run(bannedUntil, targetId);
    logAudit(admin.id, 'ban_user', targetId, `封禁 ${duration_hours} 小时`);
    return json(res, 200, { user: publicUser({ ...target, banned_until: bannedUntil }) });
  }

  const adminUnbanMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/unban$/);
  if (adminUnbanMatch && req.method === 'PUT') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const targetId = Number(adminUnbanMatch[1]);
    const target = db.prepare('SELECT id, username, is_admin, avatar_updated_at, banned_until FROM users WHERE id = ?').get(targetId);
    if (!target) return json(res, 404, { error: '用户不存在' });
    db.prepare('UPDATE users SET banned_until = NULL WHERE id = ?').run(targetId);
    logAudit(admin.id, 'unban_user', targetId);
    return json(res, 200, { user: publicUser({ ...target, banned_until: null }) });
  }

  const adminMuteMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/mute$/);
  if (adminMuteMatch && req.method === 'PUT') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const targetId = Number(adminMuteMatch[1]);
    const { duration_hours = 1 } = await readBody(req);
    const target = db.prepare('SELECT id, username, is_admin, avatar_updated_at, muted_until FROM users WHERE id = ?').get(targetId);
    if (!target) return json(res, 404, { error: '用户不存在' });
    if (target.is_admin) return json(res, 400, { error: '不能禁言管理员' });
    const mutedUntil = Date.now() + Number(duration_hours) * 3600_000;
    db.prepare('UPDATE users SET muted_until = ? WHERE id = ?').run(mutedUntil, targetId);
    logAudit(admin.id, 'mute_user', targetId, `禁言 ${duration_hours} 小时`);
    return json(res, 200, { user: publicUser({ ...target, muted_until: mutedUntil }) });
  }

  const adminUnmuteMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/unmute$/);
  if (adminUnmuteMatch && req.method === 'PUT') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const targetId = Number(adminUnmuteMatch[1]);
    const target = db.prepare('SELECT id, username, is_admin, avatar_updated_at, muted_until FROM users WHERE id = ?').get(targetId);
    if (!target) return json(res, 404, { error: '用户不存在' });
    db.prepare('UPDATE users SET muted_until = NULL WHERE id = ?').run(targetId);
    logAudit(admin.id, 'unmute_user', targetId);
    return json(res, 200, { user: publicUser({ ...target, muted_until: null }) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/audit-logs') {
    const admin = requireAdmin(req, res); if (!admin) return;
    const logs = db.prepare(`
      SELECT audit_logs.*, admins.username AS admin_name, targets.username AS target_name
      FROM audit_logs
      LEFT JOIN users AS admins ON admins.id = audit_logs.admin_id
      LEFT JOIN users AS targets ON targets.id = audit_logs.target_user_id
      ORDER BY audit_logs.id DESC LIMIT 100
    `).all();
    return json(res, 200, { logs });
  }

  if (req.method === 'POST' && url.pathname === '/api/me/avatar') {
    const user = requireUser(req, res); if (!user) return;
    const { type = '', data = '' } = await readBody(req, 2_900_000);
    const mimeType = String(type).toLowerCase();
    if (typeof data !== 'string' || data.length > Math.ceil(MAX_AVATAR_SIZE / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      return json(res, 400, { error: '头像数据格式错误或超过 2 MB' });
    }
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > MAX_AVATAR_SIZE || !validAvatar(bytes, mimeType)) {
      return json(res, 400, { error: '只支持 2 MB 以内的 PNG、JPEG、WebP 或 GIF 图片' });
    }
    const storedName = randomBytes(24).toString('hex');
    writeFileSync(join(AVATAR_DIR, storedName), bytes, { flag: 'wx', mode: 0o600 });
    const previous = db.prepare('SELECT avatar_name FROM users WHERE id = ?').get(user.id);
    const updatedAt = Date.now();
    db.prepare('UPDATE users SET avatar_name = ?, avatar_mime = ?, avatar_updated_at = ? WHERE id = ?')
      .run(storedName, mimeType, updatedAt, user.id);
    if (previous?.avatar_name) { try { unlinkSync(join(AVATAR_DIR, previous.avatar_name)); } catch { /* stale file */ } }
    return json(res, 200, { user: publicUser({ ...user, avatar_updated_at: updatedAt }) });
  }

  if (req.method === 'DELETE' && url.pathname === '/api/me/avatar') {
    const user = requireUser(req, res); if (!user) return;
    const previous = db.prepare('SELECT avatar_name FROM users WHERE id = ?').get(user.id);
    db.prepare('UPDATE users SET avatar_name = NULL, avatar_mime = NULL, avatar_updated_at = NULL WHERE id = ?').run(user.id);
    if (previous?.avatar_name) { try { unlinkSync(join(AVATAR_DIR, previous.avatar_name)); } catch { /* stale file */ } }
    return json(res, 200, { user: publicUser({ ...user, avatar_updated_at: null }) });
  }

  const avatarMatch = url.pathname.match(/^\/api\/users\/(\d+)\/avatar$/);
  if (avatarMatch && req.method === 'GET') {
    if (!requireUser(req, res)) return;
    const avatar = db.prepare('SELECT avatar_name, avatar_mime FROM users WHERE id = ?').get(Number(avatarMatch[1]));
    if (!avatar?.avatar_name) return json(res, 404, { error: '用户尚未设置头像' });
    try {
      const bytes = readFileSync(join(AVATAR_DIR, avatar.avatar_name));
      res.writeHead(200, { 'content-type': avatar.avatar_mime, 'content-length': bytes.length,
        'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
      return res.end(bytes);
    } catch { return json(res, 404, { error: '头像文件不存在' }); }
  }

  if (req.method === 'GET' && url.pathname === '/api/push/vapid-public-key') {
    if (!requireUser(req, res)) return;
    return json(res, 200, { publicKey: vapidPublicKey });
  }
  if (req.method === 'POST' && url.pathname === '/api/push/subscriptions') {
    const user = requireUser(req, res); if (!user) return;
    const { endpoint = '', keys = {} } = await readBody(req, 10_000);
    const target = String(endpoint), p256dh = String(keys.p256dh || ''), auth = String(keys.auth || '');
    if (!/^https:\/\//.test(target) || target.length > 2000 || !p256dh || p256dh.length > 500 || !auth || auth.length > 500) return json(res, 400, { error: '推送订阅格式无效' });
    db.prepare(`INSERT INTO push_subscriptions(endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, updated_at = CURRENT_TIMESTAMP`).run(target, user.id, p256dh, auth);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'DELETE' && url.pathname === '/api/push/subscriptions') {
    const user = requireUser(req, res); if (!user) return;
    const { endpoint = '' } = await readBody(req, 4_000);
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(String(endpoint), user.id);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/rooms') {
    const user = requireUser(req, res); if (!user) return;
    const rooms = db.prepare(`SELECT rooms.id, rooms.name, rooms.created_at, rooms.is_private, room_members.role,
      rooms.announcement, rooms.announcement_by, rooms.announcement_updated_at,
      announcers.username AS announcement_username,
      (SELECT COUNT(*) FROM messages WHERE messages.room_id = rooms.id) AS message_count
      FROM rooms LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
      LEFT JOIN users AS announcers ON announcers.id = rooms.announcement_by
      WHERE rooms.is_private = 0 OR room_members.user_id IS NOT NULL OR ? = 1 ORDER BY rooms.id`).all(user.id, user.is_admin ? 1 : 0);
    return json(res, 200, { rooms });
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    const user = requireUser(req, res); if (!user) return;
    const after = Math.max(0, Number(url.searchParams.get('after') || 0));
    if (url.searchParams.get('bootstrap') === '1') {
      const latest = db.prepare(`SELECT COALESCE(MAX(messages.id), 0) AS id FROM messages JOIN rooms ON rooms.id = messages.room_id
        LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
        WHERE rooms.is_private = 0 OR room_members.user_id IS NOT NULL OR ? = 1`).get(user.id, user.is_admin ? 1 : 0);
      return json(res, 200, { cursor: latest.id, messages: [] });
    }
    const messages = db.prepare(`SELECT messages.id, messages.room_id, rooms.name AS room_name,
      messages.user_id, users.username, messages.content,
      attachments.original_name AS attachment_name
      FROM messages JOIN rooms ON rooms.id = messages.room_id
      JOIN users ON users.id = messages.user_id
      LEFT JOIN attachments ON attachments.id = messages.attachment_id
      LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
      WHERE messages.id > ? AND (rooms.is_private = 0 OR room_members.user_id IS NOT NULL OR ? = 1) ORDER BY messages.id LIMIT 200`).all(user.id, after, user.is_admin ? 1 : 0);
    return json(res, 200, { cursor: messages.length ? messages.at(-1).id : after, messages });
  }

  if (req.method === 'POST' && url.pathname === '/api/rooms') {
    const user = requireUser(req, res); if (!user) return;
    const { name = '', is_private = false } = await readBody(req);
    if (!is_private && !user.is_admin) return json(res, 403, { error: '只有管理员可以创建公共聊天室；请创建私有聊天室或联系管理员' });
    const roomName = String(name).trim();
    if (roomName.length < 1 || roomName.length > 30) return json(res, 400, { error: '房间名需为 1–30 位' });
    try {
      const result = db.prepare('INSERT INTO rooms(name, created_by, is_private) VALUES (?, ?, ?)').run(roomName, user.id, is_private ? 1 : 0);
      const id = Number(result.lastInsertRowid);
      db.prepare("INSERT INTO room_members(room_id, user_id, role) VALUES (?, ?, 'owner')").run(id, user.id);
      broadcast({ type: 'rooms' });
      return json(res, 201, { room: { id, name: roomName, is_private: Boolean(is_private), role: 'owner' } });
    } catch (error) {
      if (error.message.includes('UNIQUE')) return json(res, 409, { error: '房间已存在' });
      throw error;
    }
  }

  const roomManageMatch = url.pathname.match(/^\/api\/rooms\/(\d+)$/);
  if (roomManageMatch && req.method === 'PUT') {
    const roomId = Number(roomManageMatch[1]);
    const context = requireRoomManager(req, res, roomId); if (!context) return;
    if (!context.room.is_private && !context.user.is_admin) return json(res, 403, { error: '只有管理员可以管理公共聊天室' });
    const { name = '' } = await readBody(req); const roomName = String(name).trim();
    if (!roomName || roomName.length > 30) return json(res, 400, { error: '房间名需为 1–30 位' });
    try { db.prepare('UPDATE rooms SET name = ? WHERE id = ?').run(roomName, roomId); }
    catch (error) { if (error.message.includes('UNIQUE')) return json(res, 409, { error: '房间名已存在' }); throw error; }
    broadcast({ type: 'rooms' });
    return json(res, 200, { room: { ...context.room, name: roomName, is_private: Boolean(context.room.is_private) } });
  }
  if (roomManageMatch && req.method === 'DELETE') {
    const roomId = Number(roomManageMatch[1]);
    if (roomId === 1) return json(res, 400, { error: '大厅不能删除' });
    const context = requireRoomManager(req, res, roomId); if (!context) return;
    if (!context.room.is_private && !context.user.is_admin) return json(res, 403, { error: '只有管理员可以删除公共聊天室' });
    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    broadcast({ type: 'rooms' });
    return json(res, 200, { ok: true });
  }

  const announcementMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/announcement$/);
  if (announcementMatch && req.method === 'PUT') {
    const roomId = Number(announcementMatch[1]);
    const context = requireRoomManager(req, res, roomId); if (!context) return;
    const { content = '' } = await readBody(req);
    const text = String(content).trim();
    if (!text || text.length > 2000) return json(res, 400, { error: '公告内容需为 1–2000 位' });
    db.prepare('UPDATE rooms SET announcement = ?, announcement_by = ?, announcement_updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(text, context.user.id, roomId);
    broadcast({ type: 'announcement', room_id: roomId });
    return json(res, 200, { ok: true });
  }
  if (announcementMatch && req.method === 'DELETE') {
    const roomId = Number(announcementMatch[1]);
    const context = requireRoomManager(req, res, roomId); if (!context) return;
    db.prepare('UPDATE rooms SET announcement = NULL, announcement_by = NULL, announcement_updated_at = NULL WHERE id = ?').run(roomId);
    broadcast({ type: 'announcement', room_id: roomId });
    return json(res, 200, { ok: true });
  }

  const roomMemberMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/members$/);
  if (roomMemberMatch && req.method === 'GET') {
    const context = requireRoomManager(req, res, Number(roomMemberMatch[1])); if (!context) return;
    const members = db.prepare(`SELECT users.id, users.username, room_members.role FROM room_members JOIN users ON users.id = room_members.user_id WHERE room_id = ? ORDER BY role, username`).all(context.room.id);
    return json(res, 200, { members });
  }
  if (roomMemberMatch && req.method === 'POST') {
    const context = requireRoomManager(req, res, Number(roomMemberMatch[1])); if (!context) return;
    const { username = '', role = 'member' } = await readBody(req);
    const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(String(username).trim());
    if (!target) return json(res, 404, { error: '用户不存在' });
    const memberRole = role === 'admin' ? 'admin' : 'member';
    db.prepare('INSERT INTO room_members(room_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(room_id, user_id) DO UPDATE SET role = excluded.role').run(context.room.id, target.id, memberRole);
    broadcast({ type: 'rooms' });
    return json(res, 200, { member: { ...target, role: memberRole } });
  }
  const roomMemberDelete = url.pathname.match(/^\/api\/rooms\/(\d+)\/members\/(\d+)$/);
  if (roomMemberDelete && req.method === 'DELETE') {
    const context = requireRoomManager(req, res, Number(roomMemberDelete[1])); if (!context) return;
    const targetId = Number(roomMemberDelete[2]);
    if (targetId === context.room.created_by) return json(res, 400, { error: '不能移除房主' });
    db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(context.room.id, targetId);
    broadcast({ type: 'rooms' });
    return json(res, 200, { ok: true });
  }

  const inviteCodeListMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/invite-codes$/);
  if (inviteCodeListMatch && req.method === 'GET') {
    const context = requireRoomManager(req, res, Number(inviteCodeListMatch[1])); if (!context) return;
    const codes = db.prepare('SELECT invite_codes.*, users.username AS created_by_name FROM invite_codes LEFT JOIN users ON users.id = invite_codes.created_by WHERE invite_codes.room_id = ? ORDER BY invite_codes.id DESC').all(context.room.id);
    return json(res, 200, { codes });
  }
  if (inviteCodeListMatch && req.method === 'POST') {
    const context = requireRoomManager(req, res, Number(inviteCodeListMatch[1])); if (!context) return;
    const { max_uses = null, duration_hours = null } = await readBody(req);
    const code = randomBytes(4).toString('hex');
    const expiresAt = duration_hours ? Date.now() + Number(duration_hours) * 3600_000 : null;
    const maxUses = max_uses ? Number(max_uses) : null;
    db.prepare('INSERT INTO invite_codes(room_id, code, created_by, max_uses, expires_at) VALUES (?, ?, ?, ?, ?)').run(context.room.id, code, context.user.id, maxUses, expiresAt);
    return json(res, 201, { code: { id: db.prepare('SELECT last_insert_rowid() AS id').get().id, code, max_uses: maxUses, use_count: 0, expires_at: expiresAt, created_by_name: context.user.username } });
  }
  const inviteCodeDeleteMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/invite-codes\/(\d+)$/);
  if (inviteCodeDeleteMatch && req.method === 'DELETE') {
    const context = requireRoomManager(req, res, Number(inviteCodeDeleteMatch[1])); if (!context) return;
    db.prepare('DELETE FROM invite_codes WHERE id = ? AND room_id = ?').run(Number(inviteCodeDeleteMatch[2]), context.room.id);
    return json(res, 200, { ok: true });
  }

  const inviteJoinMatch = url.pathname.match(/^\/api\/invite\/([a-f0-9]+)$/);
  if (inviteJoinMatch && req.method === 'POST') {
    const user = requireUser(req, res); if (!user) return;
    const codeStr = inviteJoinMatch[1];
    const invite = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(codeStr);
    if (!invite) return json(res, 404, { error: '邀请码无效' });
    if (invite.expires_at && invite.expires_at <= Date.now()) return json(res, 400, { error: '邀请码已过期' });
    if (invite.max_uses && invite.use_count >= invite.max_uses) return json(res, 400, { error: '邀请码已达到使用次数上限' });
    db.prepare('UPDATE invite_codes SET use_count = use_count + 1 WHERE id = ?').run(invite.id);
    db.prepare('INSERT OR IGNORE INTO room_members(room_id, user_id, role) VALUES (?, ?, ?)').run(invite.room_id, user.id, 'member');
    const room = db.prepare('SELECT id, name FROM rooms WHERE id = ?').get(invite.room_id);
    broadcast({ type: 'rooms' });
    return json(res, 200, { ok: true, room });
  }

  if (req.method === 'GET' && url.pathname === '/api/users/search') {
    const user = requireUser(req, res); if (!user) return;
    const q = url.searchParams.get('q') || '';
    if (q.length < 1) return json(res, 200, { users: [] });
    const users = db.prepare('SELECT id, username FROM users WHERE username LIKE ? ORDER BY username LIMIT 20').all(`%${q}%`);
    return json(res, 200, { users });
  }

  if (req.method === 'POST' && url.pathname === '/api/uploads') {
    const user = requireUser(req, res); if (!user) return;
    const { name = '', type = '', size = 0 } = await readBody(req);
    const originalName = String(name).replace(/[\r\n]/g, '').trim();
    const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(String(type)) ? String(type) : 'application/octet-stream';
    const totalSize = Number(size);
    if (!originalName || originalName.length > 255) return json(res, 400, { error: '文件名需为 1–255 个字符' });
    if (!Number.isInteger(totalSize) || totalSize < 1 || totalSize > MAX_FILE_SIZE) return json(res, 400, { error: `文件需为 1 字节至 ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB` });
    const id = randomBytes(24).toString('base64url'), tempName = `.upload-${randomBytes(24).toString('hex')}.part`;
    writeFileSync(join(UPLOAD_DIR, tempName), Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    db.prepare('INSERT INTO upload_sessions(id, user_id, original_name, mime_type, total_size, temp_name, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, user.id, originalName, mimeType, totalSize, tempName, Date.now() + 24 * 3600_000);
    return json(res, 201, { upload: { id, offset: 0, size: totalSize, chunk_size: UPLOAD_CHUNK_SIZE } });
  }
  const uploadMatch = url.pathname.match(/^\/api\/uploads\/([A-Za-z0-9_-]+)$/);
  if (uploadMatch && req.method === 'GET') {
    const user = requireUser(req, res); if (!user) return;
    const upload = db.prepare('SELECT id, original_name AS name, mime_type AS type, total_size AS size, received_size AS offset, expires_at FROM upload_sessions WHERE id = ? AND user_id = ?').get(uploadMatch[1], user.id);
    if (!upload || upload.expires_at <= Date.now()) return json(res, 404, { error: '上传会话不存在或已过期' });
    return json(res, 200, { upload: { ...upload, chunk_size: UPLOAD_CHUNK_SIZE } });
  }
  if (uploadMatch && req.method === 'DELETE') {
    const user = requireUser(req, res); if (!user) return;
    const upload = db.prepare('SELECT temp_name FROM upload_sessions WHERE id = ? AND user_id = ?').get(uploadMatch[1], user.id);
    if (upload) { try { unlinkSync(join(UPLOAD_DIR, upload.temp_name)); } catch { /* already gone */ } db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(uploadMatch[1]); }
    return json(res, 200, { ok: true });
  }
  const uploadChunkMatch = url.pathname.match(/^\/api\/uploads\/([A-Za-z0-9_-]+)\/chunks$/);
  if (uploadChunkMatch && req.method === 'PUT') {
    const user = requireUser(req, res); if (!user) return;
    const upload = db.prepare('SELECT * FROM upload_sessions WHERE id = ? AND user_id = ?').get(uploadChunkMatch[1], user.id);
    if (!upload || upload.expires_at <= Date.now()) return json(res, 404, { error: '上传会话不存在或已过期' });
    const { offset = -1, data = '' } = await readBody(req, 1_500_000);
    if (Number(offset) !== upload.received_size) return json(res, 409, { error: '分片偏移量不匹配', offset: upload.received_size });
    if (typeof data !== 'string' || data.length > Math.ceil(UPLOAD_CHUNK_SIZE / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return json(res, 400, { error: '分片数据格式错误' });
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > UPLOAD_CHUNK_SIZE || upload.received_size + bytes.length > upload.total_size) return json(res, 400, { error: '分片大小无效' });
    appendFileSync(join(UPLOAD_DIR, upload.temp_name), bytes);
    const received = upload.received_size + bytes.length;
    if (received < upload.total_size) {
      db.prepare('UPDATE upload_sessions SET received_size = ?, expires_at = ? WHERE id = ?').run(received, Date.now() + 24 * 3600_000, upload.id);
      return json(res, 200, { upload: { id: upload.id, offset: received, size: upload.total_size, chunk_size: UPLOAD_CHUNK_SIZE } });
    }
    const storedName = randomBytes(24).toString('hex');
    renameSync(join(UPLOAD_DIR, upload.temp_name), join(UPLOAD_DIR, storedName));
    const result = db.prepare('INSERT INTO attachments(user_id, original_name, stored_name, mime_type, size) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, upload.original_name, storedName, upload.mime_type, upload.total_size);
    db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(upload.id);
    const id = Number(result.lastInsertRowid);
    return json(res, 201, { completed: true, file: { id, name: upload.original_name, type: upload.mime_type, size: upload.total_size, url: `/api/files/${id}` } });
  }

  if (req.method === 'POST' && url.pathname === '/api/files') {
    const user = requireUser(req, res); if (!user) return;
    const { name = '', type = '', data = '' } = await readBody(req, 14_100_000);
    const originalName = String(name).replace(/[\r\n]/g, '').trim();
    const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(String(type)) ? String(type) : 'application/octet-stream';
    if (!originalName || originalName.length > 255) return json(res, 400, { error: '文件名需为 1–255 个字符' });
    if (typeof data !== 'string' || data.length > Math.ceil(LEGACY_FILE_SIZE / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      return json(res, 400, { error: '文件数据格式错误或超过 10 MB' });
    }
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > LEGACY_FILE_SIZE) return json(res, 400, { error: '兼容上传接口限制为 10 MB，请使用分片上传接口发送更大文件' });
    const storedName = randomBytes(24).toString('hex');
    writeFileSync(join(UPLOAD_DIR, storedName), bytes, { flag: 'wx', mode: 0o600 });
    const result = db.prepare(`INSERT INTO attachments(user_id, original_name, stored_name, mime_type, size)
      VALUES (?, ?, ?, ?, ?)`).run(user.id, originalName, storedName, mimeType, bytes.length);
    const id = Number(result.lastInsertRowid);
    return json(res, 201, { file: { id, name: originalName, type: mimeType, size: bytes.length, url: `/api/files/${id}` } });
  }

  const fileMatch = url.pathname.match(/^\/api\/files\/(\d+)$/);
  if (fileMatch && req.method === 'GET') {
    if (!requireUser(req, res)) return;
    const file = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(fileMatch[1]));
    if (!file) return json(res, 404, { error: '文件不存在' });
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
      return res.end(bytes);
    } catch { return json(res, 404, { error: '文件数据不存在' }); }
  }

  if (req.method === 'GET' && url.pathname === '/api/search') {
    const user = requireUser(req, res); if (!user) return;
    const q = String(url.searchParams.get('q') || '').trim();
    const roomId = Number(url.searchParams.get('room_id') || 0);
    if (q.length < 1 || q.length > 100) return json(res, 400, { error: '搜索关键词需为 1–100 个字符' });
    if (roomId && !requireRoomAccess(req, res, roomId)) return;
    const conditions = [`messages.deleted_at IS NULL`, `messages.content LIKE ?`, `(rooms.is_private = 0 OR room_members.user_id IS NOT NULL OR ? = 1)`];
    const values = [`%${q.replace(/[\\%_]/g, '\\$&')}%`, user.is_admin ? 1 : 0];
    if (roomId) { conditions.push('messages.room_id = ?'); values.push(roomId); }
    const rows = db.prepare(`SELECT messages.id, messages.room_id, rooms.name AS room_name, messages.content, messages.created_at,
      users.id AS user_id, users.username, users.avatar_updated_at, messages.reply_to, messages.edited_at, messages.deleted_at
      FROM messages JOIN rooms ON rooms.id = messages.room_id JOIN users ON users.id = messages.user_id
      LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
      WHERE ${conditions.join(' AND ')} ORDER BY messages.id DESC LIMIT 100`).all(user.id, ...values);
    return json(res, 200, { messages: hydrateMessages(rows, user.id) });
  }

  const threadMatch = url.pathname.match(/^\/api\/messages\/(\d+)\/thread$/);
  if (threadMatch && req.method === 'GET') {
    const rootId = Number(threadMatch[1]);
    const root = db.prepare('SELECT room_id FROM messages WHERE id = ? AND thread_root IS NULL').get(rootId);
    if (!root) return json(res, 404, { error: '话题不存在' });
    const context = requireRoomAccess(req, res, root.room_id); if (!context) return;
    const rows = db.prepare(`SELECT messages.id, messages.room_id, messages.content, messages.created_at, messages.reply_to, messages.thread_root, messages.edited_at, messages.deleted_at,
      users.id AS user_id, users.username, users.avatar_updated_at, parent.content AS reply_content, parent_user.username AS reply_username,
      attachments.id AS attachment_id, attachments.original_name AS attachment_name, attachments.mime_type AS attachment_type, attachments.size AS attachment_size
      FROM messages JOIN users ON users.id = messages.user_id LEFT JOIN messages AS parent ON parent.id = messages.reply_to
      LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id LEFT JOIN attachments ON attachments.id = messages.attachment_id
      WHERE messages.id = ? OR messages.thread_root = ? ORDER BY messages.id LIMIT 500`).all(rootId, rootId);
    return json(res, 200, { messages: hydrateMessages(rows, context.user.id) });
  }

  const pinCollectionMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/pins$/);
  if (pinCollectionMatch && req.method === 'GET') {
    const roomId = Number(pinCollectionMatch[1]); const context = requireRoomAccess(req, res, roomId); if (!context) return;
    const rows = db.prepare(`SELECT messages.id, messages.room_id, messages.content, messages.created_at, messages.edited_at, messages.deleted_at,
      users.id AS user_id, users.username, users.avatar_updated_at, room_pins.created_at AS pinned_at
      FROM room_pins JOIN messages ON messages.id = room_pins.message_id JOIN users ON users.id = messages.user_id
      WHERE room_pins.room_id = ? ORDER BY room_pins.created_at DESC`).all(roomId);
    return json(res, 200, { messages: hydrateMessages(rows, context.user.id) });
  }
  const pinMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/pins\/(\d+)$/);
  if (pinMatch && req.method === 'PUT') {
    const roomId = Number(pinMatch[1]), messageId = Number(pinMatch[2]); const context = requireRoomManager(req, res, roomId); if (!context) return;
    if (!db.prepare('SELECT 1 FROM messages WHERE id = ? AND room_id = ?').get(messageId, roomId)) return json(res, 404, { error: '消息不存在' });
    db.prepare('INSERT OR IGNORE INTO room_pins(room_id, message_id, pinned_by) VALUES (?, ?, ?)').run(roomId, messageId, context.user.id);
    broadcast({ type: 'pins', room_id: roomId }, roomId); return json(res, 200, { ok: true });
  }
  if (pinMatch && req.method === 'DELETE') {
    const roomId = Number(pinMatch[1]), messageId = Number(pinMatch[2]); const context = requireRoomManager(req, res, roomId); if (!context) return;
    db.prepare('DELETE FROM room_pins WHERE room_id = ? AND message_id = ?').run(roomId, messageId);
    broadcast({ type: 'pins', room_id: roomId }, roomId); return json(res, 200, { ok: true });
  }

  const messageMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/messages$/);
  if (messageMatch && req.method === 'GET') {
    const roomId = Number(messageMatch[1]);
    const context = requireRoomAccess(req, res, roomId); if (!context) return;
    const after = Math.max(0, Number(url.searchParams.get('after') || 0));
    const before = Math.max(0, Number(url.searchParams.get('before') || 0));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
    if (!db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId)) return json(res, 404, { error: '房间不存在' });
    const query = `SELECT messages.id, messages.content, messages.created_at,
      users.id AS user_id, users.username, users.avatar_updated_at, messages.reply_to, messages.thread_root, messages.edited_at, messages.deleted_at,
      parent.content AS reply_content, parent_user.username AS reply_username, attachments.id AS attachment_id,
      attachments.original_name AS attachment_name, attachments.mime_type AS attachment_type,
      attachments.size AS attachment_size
      FROM messages JOIN users ON users.id = messages.user_id
      LEFT JOIN messages AS parent ON parent.id = messages.reply_to
      LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id
      LEFT JOIN attachments ON attachments.id = messages.attachment_id`;
    if (before > 0) {
      const rows = db.prepare(`${query} WHERE messages.room_id = ? AND messages.thread_root IS NULL AND messages.id < ? ORDER BY messages.id DESC LIMIT ?`).all(roomId, before, limit + 1);
      const hasMore = rows.length > limit;
      return json(res, 200, { messages: hydrateMessages(rows.slice(0, limit).reverse(), context.user.id), has_more: hasMore });
    }
    const rows = db.prepare(`${query} WHERE messages.room_id = ? AND messages.thread_root IS NULL AND messages.id > ? ORDER BY messages.id LIMIT ?`).all(roomId, after, limit + 1);
    const hasMore = rows.length > limit;
    return json(res, 200, { messages: hydrateMessages(rows.slice(0, limit), context.user.id), has_more: hasMore });
  }

  if (messageMatch && req.method === 'POST') {
    const roomId = Number(messageMatch[1]);
    const context = requireRoomAccess(req, res, roomId); if (!context) return;
    const user = context.user;
    if (isUserBanned(user)) return json(res, 403, { error: '账号已被封禁', banned_until: user.banned_until });
    if (isUserMuted(user)) return json(res, 403, { error: '你已被禁言，无法发送消息', muted_until: user.muted_until });
    const { content = '', attachment_id = null, reply_to = null, thread_root = null } = await readBody(req);
    const text = String(content).trim();
    const attachmentId = attachment_id == null ? null : Number(attachment_id);
    if ((!text && !attachmentId) || text.length > 10_000) return json(res, 400, { error: '消息或附件不能为空，文字最多 10000 个字符' });
    if (attachmentId && !db.prepare('SELECT id FROM attachments WHERE id = ? AND user_id = ?').get(attachmentId, user.id)) {
      return json(res, 400, { error: '附件不存在或不属于当前账号' });
    }
    const replyId = reply_to == null ? null : Number(reply_to);
    if (replyId && !db.prepare('SELECT id FROM messages WHERE id = ? AND room_id = ?').get(replyId, roomId)) return json(res, 400, { error: '回复目标不存在或不在当前聊天室' });
    const threadRoot = thread_root == null ? null : Number(thread_root);
    if (threadRoot && !db.prepare('SELECT id FROM messages WHERE id = ? AND room_id = ? AND thread_root IS NULL').get(threadRoot, roomId)) return json(res, 400, { error: '话题根消息不存在' });
    const result = db.prepare('INSERT INTO messages(room_id, user_id, content, attachment_id, reply_to, thread_root) VALUES (?, ?, ?, ?, ?, ?)').run(roomId, user.id, text, attachmentId, replyId, threadRoot);
    const message = db.prepare(`SELECT messages.id, messages.content, messages.created_at, messages.reply_to, messages.thread_root, messages.edited_at, messages.deleted_at,
      users.id AS user_id, users.username, users.avatar_updated_at, parent.content AS reply_content, parent_user.username AS reply_username, attachments.id AS attachment_id,
      attachments.original_name AS attachment_name, attachments.mime_type AS attachment_type,
      attachments.size AS attachment_size
      FROM messages JOIN users ON users.id = messages.user_id
      LEFT JOIN messages AS parent ON parent.id = messages.reply_to LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id
      LEFT JOIN attachments ON attachments.id = messages.attachment_id WHERE messages.id = ?`).get(result.lastInsertRowid);
    broadcast({ type: threadRoot ? 'thread_message' : 'message', room_id: roomId, message_id: Number(result.lastInsertRowid), thread_root: threadRoot }, roomId);
    void pushMessage(roomId, user.id, message).catch(error => console.error('Web Push failed:', error.message));
    return json(res, 201, { message: hydrateMessages([message], user.id)[0] });
  }

  const singleMessageMatch = url.pathname.match(/^\/api\/messages\/(\d+)$/);
  if (singleMessageMatch && req.method === 'GET') {
    const messageId = Number(singleMessageMatch[1]);
    const row = db.prepare(`SELECT messages.id, messages.room_id, messages.content, messages.created_at, messages.reply_to, messages.thread_root, messages.edited_at, messages.deleted_at,
      users.id AS user_id, users.username, users.avatar_updated_at, parent.content AS reply_content, parent_user.username AS reply_username,
      attachments.id AS attachment_id, attachments.original_name AS attachment_name, attachments.mime_type AS attachment_type, attachments.size AS attachment_size
      FROM messages JOIN users ON users.id = messages.user_id LEFT JOIN messages AS parent ON parent.id = messages.reply_to
      LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id LEFT JOIN attachments ON attachments.id = messages.attachment_id WHERE messages.id = ?`).get(messageId);
    if (!row) return json(res, 404, { error: '消息不存在' });
    const context = requireRoomAccess(req, res, row.room_id); if (!context) return;
    return json(res, 200, { message: hydrateMessages([row], context.user.id)[0] });
  }
  if (singleMessageMatch && req.method === 'PUT') {
    const user = requireUser(req, res); if (!user) return;
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(singleMessageMatch[1]));
    if (!message) return json(res, 404, { error: '消息不存在' });
    const context = requireRoomAccess(req, res, message.room_id); if (!context) return;
    if (message.user_id !== user.id) return json(res, 403, { error: '只能编辑自己的消息' });
    const { content = '' } = await readBody(req); const text = String(content).trim();
    if (!text || text.length > 10_000) return json(res, 400, { error: '消息需为 1–10000 个字符' });
    db.prepare('UPDATE messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').run(text, message.id);
    broadcast({ type: 'message_update', room_id: message.room_id, message_id: message.id }, message.room_id);
    return json(res, 200, { ok: true, message: hydrateMessages([db.prepare(`SELECT messages.id, messages.content, messages.created_at, messages.reply_to, messages.edited_at, messages.deleted_at,
      users.id AS user_id, users.username, users.avatar_updated_at FROM messages JOIN users ON users.id = messages.user_id WHERE messages.id = ?`).get(message.id)], user.id)[0] });
  }
  if (singleMessageMatch && req.method === 'DELETE') {
    const user = requireUser(req, res); if (!user) return;
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(singleMessageMatch[1]));
    if (!message) return json(res, 404, { error: '消息不存在' });
    const context = requireRoomAccess(req, res, message.room_id); if (!context) return;
    if (message.user_id !== user.id && !user.is_admin && !['owner', 'admin'].includes(context.room.role)) return json(res, 403, { error: '没有撤回此消息的权限' });
    db.prepare("UPDATE messages SET content = '', attachment_id = NULL, deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(message.id);
    broadcast({ type: 'message_update', room_id: message.room_id, message_id: message.id }, message.room_id);
    return json(res, 200, { ok: true });
  }
  const reactionMatch = url.pathname.match(/^\/api\/messages\/(\d+)\/reactions$/);
  if (reactionMatch && req.method === 'POST') {
    const user = requireUser(req, res); if (!user) return;
    const message = db.prepare('SELECT room_id FROM messages WHERE id = ?').get(Number(reactionMatch[1]));
    if (!message || !requireRoomAccess(req, res, message.room_id)) return;
    const { emoji = '' } = await readBody(req); const value = String(emoji);
    if (!value || value.length > 24 || !/\p{Extended_Pictographic}/u.test(value)) return json(res, 400, { error: '表情格式无效' });
    const exists = db.prepare('SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(Number(reactionMatch[1]), user.id, value);
    if (exists) db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(Number(reactionMatch[1]), user.id, value);
    else db.prepare('INSERT INTO message_reactions(message_id, user_id, emoji) VALUES (?, ?, ?)').run(Number(reactionMatch[1]), user.id, value);
    broadcast({ type: 'message_update', room_id: message.room_id, message_id: Number(reactionMatch[1]) }, message.room_id);
    return json(res, 200, { reactions: hydrateMessages([{ id: Number(reactionMatch[1]) }], user.id)[0].reactions });
  }

  return json(res, 404, { error: '接口不存在' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
function staticFile(res, pathname) {
  let vendorFile = null;
  if (pathname === '/vendor/katex.min.css') vendorFile = join(KATEX_DIST, 'katex.min.css');
  else if (pathname === '/vendor/katex.min.js') vendorFile = join(KATEX_DIST, 'katex.min.js');
  else if (/^\/vendor\/fonts\/KaTeX_[A-Za-z0-9_-]+\.(woff2?|ttf)$/.test(pathname)) {
    vendorFile = join(KATEX_DIST, pathname.slice('/vendor/'.length));
  }
  if (vendorFile) {
    try {
      const body = readFileSync(vendorFile);
      res.writeHead(200, { 'content-type': MIME[extname(vendorFile)] || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' });
      return res.end(body);
    } catch { return json(res, 404, { error: '页面不存在' }); }
  }
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safe = normalize(relative).replace(/^(\.\.[/\\])+/, '');
  const file = resolve(PUBLIC, safe);
  if (!file.startsWith(`${PUBLIC}/`) || !/^(index\.html|sw\.js|assets\/[A-Za-z0-9._-]+\.(?:js|css|png|woff2?|ttf))$/.test(safe)) return json(res, 404, { error: '页面不存在' });
  try {
    const body = readFileSync(file);
    const cacheControl = safe === 'index.html' || safe === 'sw.js' ? 'no-cache' : 'public, max-age=31536000, immutable';
    res.writeHead(200, { 'content-type': MIME[extname(safe)] || 'application/octet-stream', 'cache-control': cacheControl });
    res.end(body);
  } catch { json(res, 404, { error: '页面不存在' }); }
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET') staticFile(res, url.pathname);
    else json(res, 405, { error: '方法不支持' });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '服务器内部错误' });
  }
});

const webSocketServer = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') return socket.destroy();
  const token = url.searchParams.get('token');
  if (token && !req.headers.authorization) req.headers.authorization = `Bearer ${token}`;
  const user = currentUser(req);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  if (isUserBanned(user)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  webSocketServer.handleUpgrade(req, socket, head, client => {
    client.user = user;
    client.isAlive = true;
    sockets.add(client);
    client.send(JSON.stringify({ type: 'presence_snapshot', users: onlineUsers() }));
    broadcast({ type: 'presence', user_id: user.id, username: user.username, online: true });
    client.on('pong', () => { client.isAlive = true; });
    client.on('message', raw => {
      try {
        const event = JSON.parse(String(raw));
        if (event.type !== 'typing') return;
        const roomId = Number(event.room_id);
        if (!roomId || !socketCanAccess(client, roomId)) return;
        const payload = JSON.stringify({ type: 'typing', room_id: roomId, user_id: user.id, username: user.username, typing: Boolean(event.typing) });
        for (const peer of sockets) if (peer !== client && peer.readyState === 1 && socketCanAccess(peer, roomId)) peer.send(payload);
      } catch { /* ignore malformed client messages */ }
    });
    client.on('close', () => {
      sockets.delete(client);
      if (![...sockets].some(peer => peer.user.id === user.id)) broadcast({ type: 'presence', user_id: user.id, username: user.username, online: false });
    });
    client.send(JSON.stringify({ type: 'ready' }));
  });
});
const heartbeat = setInterval(() => {
  for (const socket of sockets) {
    if (!socket.isAlive) { socket.terminate(); sockets.delete(socket); continue; }
    socket.isAlive = false;
    socket.ping();
  }
}, 30_000);
heartbeat.unref();

if (process.env.NODE_ENV !== 'test') {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  server.listen(PORT, HOST, () => console.log(`PolyChat: http://${HOST}:${PORT}`));
}
