import http from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'web');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || join(ROOT, 'data', 'polychat.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(dirname(DB_PATH), 'uploads');
const SESSION_DAYS = 30;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

mkdirSync(join(ROOT, 'data'), { recursive: true });
mkdirSync(UPLOAD_DIR, { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
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
    SELECT users.id, users.username FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > ?
  `).get(token, Date.now()) || null;
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
      const result = db.prepare('INSERT INTO users(username, password_hash) VALUES (?, ?)').run(name, hashPassword(String(password)));
      const token = createSession(Number(result.lastInsertRowid));
      return json(res, 201, { token, user: { id: Number(result.lastInsertRowid), username: name } }, { 'set-cookie': cookie(token) });
    } catch (error) {
      if (error.message.includes('UNIQUE')) return json(res, 409, { error: '用户名已存在' });
      throw error;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const { username = '', password = '' } = await readBody(req);
    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(String(username).trim());
    if (!user || !checkPassword(String(password), user.password_hash)) return json(res, 401, { error: '用户名或密码错误' });
    const token = createSession(user.id);
    return json(res, 200, { token, user: { id: user.id, username: user.username } }, { 'set-cookie': cookie(token) });
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token = tokenOf(req);
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return json(res, 200, { ok: true }, { 'set-cookie': cookie('', true) });
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    const user = requireUser(req, res); if (!user) return;
    return json(res, 200, { user });
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
      res.writeHead(200, {
        'content-type': file.mime_type,
        'content-length': bytes.length,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
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
      users.id AS user_id, users.username, attachments.id AS attachment_id,
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
      users.id AS user_id, users.username, attachments.id AS attachment_id,
      attachments.original_name AS attachment_name, attachments.mime_type AS attachment_type,
      attachments.size AS attachment_size
      FROM messages JOIN users ON users.id = messages.user_id
      LEFT JOIN attachments ON attachments.id = messages.attachment_id WHERE messages.id = ?`).get(result.lastInsertRowid);
    return json(res, 201, { message });
  }

  return json(res, 404, { error: '接口不存在' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
function staticFile(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safe = normalize(relative).replace(/^(\.\.[/\\])+/, '');
  if (!['index.html', 'app.js', 'style.css', 'icon.png'].includes(safe)) return json(res, 404, { error: '页面不存在' });
  try {
    res.writeHead(200, { 'content-type': MIME[extname(safe)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(readFileSync(join(PUBLIC, safe)));
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
