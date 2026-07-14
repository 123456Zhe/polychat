import http from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'web');
const KATEX_DIST = join(ROOT, 'node_modules', 'katex', 'dist');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || join(ROOT, 'data', 'polychat.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(dirname(DB_PATH), 'uploads');
const AVATAR_DIR = process.env.AVATAR_DIR || join(dirname(DB_PATH), 'avatars');
const SESSION_DAYS = 30;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;

mkdirSync(join(ROOT, 'data'), { recursive: true });
mkdirSync(UPLOAD_DIR, { recursive: true });
mkdirSync(AVATAR_DIR, { recursive: true });
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id, id);
  INSERT OR IGNORE INTO rooms(id, name) VALUES (1, '大厅');
`);
if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'attachment_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN attachment_id INTEGER REFERENCES attachments(id)');
}
const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
if (!userColumns.has('is_admin')) db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
if (!userColumns.has('avatar_name')) db.exec('ALTER TABLE users ADD COLUMN avatar_name TEXT');
if (!userColumns.has('avatar_mime')) db.exec('ALTER TABLE users ADD COLUMN avatar_mime TEXT');
if (!userColumns.has('avatar_updated_at')) db.exec('ALTER TABLE users ADD COLUMN avatar_updated_at INTEGER');
if (db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get().count === 0) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)').run();
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
    SELECT users.id, users.username, users.is_admin, users.avatar_updated_at FROM sessions
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
    avatar_url: user.avatar_updated_at ? `/api/users/${user.id}/avatar?v=${user.avatar_updated_at}` : null
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
  if (!user) json(res, 401, { error: '请先登录' });
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.is_admin) { json(res, 403, { error: '需要管理员权限' }); return null; }
  return user;
}

function cookie(token, clear = false) {
  const age = clear ? 0 : SESSION_DAYS * 86400;
  return `polychat_session=${clear ? '' : encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}`;
}

async function api(req, res, url) {
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
    const { username = '', password = '' } = await readBody(req);
    const user = db.prepare('SELECT id, username, password_hash, is_admin, avatar_updated_at FROM users WHERE username = ?').get(String(username).trim());
    if (!user || !checkPassword(String(password), user.password_hash)) return json(res, 401, { error: '用户名或密码错误' });
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

  if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
    if (!requireAdmin(req, res)) return;
    const stats = {
      users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
      rooms: db.prepare('SELECT COUNT(*) AS count FROM rooms').get().count,
      messages: db.prepare('SELECT COUNT(*) AS count FROM messages').get().count,
      files: db.prepare('SELECT COUNT(*) AS count FROM attachments').get().count,
    };
    const users = db.prepare(`SELECT users.id, users.username, users.is_admin, users.created_at,
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
    return json(res, 200, { user: publicUser({ ...target, is_admin: Boolean(is_admin) }) });
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

  if (req.method === 'GET' && url.pathname === '/api/rooms') {
    if (!requireUser(req, res)) return;
    const rooms = db.prepare(`SELECT rooms.id, rooms.name, rooms.created_at,
      (SELECT COUNT(*) FROM messages WHERE messages.room_id = rooms.id) AS message_count
      FROM rooms ORDER BY rooms.id`).all();
    return json(res, 200, { rooms });
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    if (!requireUser(req, res)) return;
    const after = Math.max(0, Number(url.searchParams.get('after') || 0));
    if (url.searchParams.get('bootstrap') === '1') {
      const latest = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM messages').get();
      return json(res, 200, { cursor: latest.id, messages: [] });
    }
    const messages = db.prepare(`SELECT messages.id, messages.room_id, rooms.name AS room_name,
      messages.user_id, users.username, messages.content,
      attachments.original_name AS attachment_name
      FROM messages JOIN rooms ON rooms.id = messages.room_id
      JOIN users ON users.id = messages.user_id
      LEFT JOIN attachments ON attachments.id = messages.attachment_id
      WHERE messages.id > ? ORDER BY messages.id LIMIT 200`).all(after);
    return json(res, 200, { cursor: messages.length ? messages.at(-1).id : after, messages });
  }

  if (req.method === 'POST' && url.pathname === '/api/rooms') {
    const user = requireUser(req, res); if (!user) return;
    const { name = '' } = await readBody(req);
    const roomName = String(name).trim();
    if (roomName.length < 1 || roomName.length > 30) return json(res, 400, { error: '房间名需为 1–30 位' });
    try {
      const result = db.prepare('INSERT INTO rooms(name, created_by) VALUES (?, ?)').run(roomName, user.id);
      return json(res, 201, { room: { id: Number(result.lastInsertRowid), name: roomName } });
    } catch (error) {
      if (error.message.includes('UNIQUE')) return json(res, 409, { error: '房间已存在' });
      throw error;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/files') {
    const user = requireUser(req, res); if (!user) return;
    const { name = '', type = '', data = '' } = await readBody(req, 14_100_000);
    const originalName = String(name).replace(/[\r\n]/g, '').trim();
    const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(String(type)) ? String(type) : 'application/octet-stream';
    if (!originalName || originalName.length > 255) return json(res, 400, { error: '文件名需为 1–255 个字符' });
    if (typeof data !== 'string' || data.length > Math.ceil(MAX_FILE_SIZE / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      return json(res, 400, { error: '文件数据格式错误或超过 10 MB' });
    }
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > MAX_FILE_SIZE) return json(res, 400, { error: '文件需为 1 字节至 10 MB' });
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

  const messageMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/messages$/);
  if (messageMatch && req.method === 'GET') {
    if (!requireUser(req, res)) return;
    const roomId = Number(messageMatch[1]);
    const after = Math.max(0, Number(url.searchParams.get('after') || 0));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
    if (!db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId)) return json(res, 404, { error: '房间不存在' });
    const messages = db.prepare(`SELECT messages.id, messages.content, messages.created_at,
      users.id AS user_id, users.username, users.avatar_updated_at, attachments.id AS attachment_id,
      attachments.original_name AS attachment_name, attachments.mime_type AS attachment_type,
      attachments.size AS attachment_size
      FROM messages JOIN users ON users.id = messages.user_id
      LEFT JOIN attachments ON attachments.id = messages.attachment_id
      WHERE room_id = ? AND messages.id > ? ORDER BY messages.id LIMIT ?`).all(roomId, after, limit);
    return json(res, 200, { messages });
  }

  if (messageMatch && req.method === 'POST') {
    const user = requireUser(req, res); if (!user) return;
    const roomId = Number(messageMatch[1]);
    const { content = '', attachment_id = null } = await readBody(req);
    const text = String(content).trim();
    const attachmentId = attachment_id == null ? null : Number(attachment_id);
    if ((!text && !attachmentId) || text.length > 10_000) return json(res, 400, { error: '消息或附件不能为空，文字最多 10000 个字符' });
    if (!db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId)) return json(res, 404, { error: '房间不存在' });
    if (attachmentId && !db.prepare('SELECT id FROM attachments WHERE id = ? AND user_id = ?').get(attachmentId, user.id)) {
      return json(res, 400, { error: '附件不存在或不属于当前账号' });
    }
    const result = db.prepare('INSERT INTO messages(room_id, user_id, content, attachment_id) VALUES (?, ?, ?, ?)').run(roomId, user.id, text, attachmentId);
    const message = db.prepare(`SELECT messages.id, messages.content, messages.created_at,
      users.id AS user_id, users.username, users.avatar_updated_at, attachments.id AS attachment_id,
      attachments.original_name AS attachment_name, attachments.mime_type AS attachment_type,
      attachments.size AS attachment_size
      FROM messages JOIN users ON users.id = messages.user_id
      LEFT JOIN attachments ON attachments.id = messages.attachment_id WHERE messages.id = ?`).get(result.lastInsertRowid);
    return json(res, 201, { message });
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
  if (!['index.html', 'app.js', 'style.css', 'icon.png'].includes(safe)) return json(res, 404, { error: '页面不存在' });
  try {
    const body = readFileSync(join(PUBLIC, safe));
    const cacheControl = safe === 'index.html' ? 'no-cache' : 'public, max-age=3600';
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

if (process.env.NODE_ENV !== 'test') {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  server.listen(PORT, HOST, () => console.log(`PolyChat: http://${HOST}:${PORT}`));
}
