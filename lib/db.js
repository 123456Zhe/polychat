import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './config.js';

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
  CREATE TABLE IF NOT EXISTS room_join_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at INTEGER NOT NULL,
    UNIQUE(room_id, user_id)
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
  CREATE TABLE IF NOT EXISTS registration_attempts (
    id INTEGER PRIMARY KEY,
    ip_address TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO rooms(id, name) VALUES (1, '大厅');
  CREATE TABLE IF NOT EXISTS banned_ips (
    ip_address TEXT PRIMARY KEY,
    banned_until INTEGER,
    reason TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS banned_fingerprints (
    fingerprint TEXT PRIMARY KEY,
    banned_until INTEGER,
    reason TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, friend_id)
  );
  CREATE TABLE IF NOT EXISTS dm_conversations (
    id INTEGER PRIMARY KEY,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS dm_members (
    conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_id INTEGER,
    PRIMARY KEY(conversation_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS p2p_transfers (
    id TEXT PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id),
    receiver_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    sha256 TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'completed', 'rejected', 'canceled', 'expired', 'failed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS gallery_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    stored_name TEXT NOT NULL,
    storage TEXT NOT NULL DEFAULT 'local' CHECK(storage IN ('local', 's3')),
    created_at INTEGER NOT NULL
  );
`);
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
db.exec(`CREATE TABLE IF NOT EXISTS bot_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
// minigame_scores：minigames 插件记胜场（五子棋 / 数字炸弹）
db.exec(`CREATE TABLE IF NOT EXISTS minigame_scores (
  game TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game, user_id)
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_minigame_scores_game ON minigame_scores(game, score DESC)');
if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'attachment_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN attachment_id INTEGER REFERENCES attachments(id)');
}
const roomColumns = new Set(db.prepare('PRAGMA table_info(rooms)').all().map(column => column.name));
if (!roomColumns.has('is_private')) db.exec('ALTER TABLE rooms ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0');
if (!roomColumns.has('announcement')) db.exec('ALTER TABLE rooms ADD COLUMN announcement TEXT');
if (!roomColumns.has('announcement_by')) db.exec('ALTER TABLE rooms ADD COLUMN announcement_by INTEGER REFERENCES users(id)');
if (!roomColumns.has('announcement_updated_at')) db.exec('ALTER TABLE rooms ADD COLUMN announcement_updated_at TEXT');
if (!roomColumns.has('locked')) db.exec('ALTER TABLE rooms ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
if (!roomColumns.has('hidden')) db.exec('ALTER TABLE rooms ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
if (!roomColumns.has('password_hash')) db.exec('ALTER TABLE rooms ADD COLUMN password_hash TEXT');
if (!roomColumns.has('readonly')) db.exec('ALTER TABLE rooms ADD COLUMN readonly INTEGER NOT NULL DEFAULT 0');
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
if (!userColumns.has('last_ip')) db.exec('ALTER TABLE users ADD COLUMN last_ip TEXT');
if (!userColumns.has('device_fingerprint')) db.exec('ALTER TABLE users ADD COLUMN device_fingerprint TEXT');
const messageColumns2 = new Set(db.prepare('PRAGMA table_info(messages)').all().map(column => column.name));
if (!messageColumns2.has('dm_id')) db.exec('ALTER TABLE messages ADD COLUMN dm_id INTEGER REFERENCES dm_conversations(id) ON DELETE CASCADE');
// SQLite builds used here do not support ALTER COLUMN, so rebuild messages to make room_id nullable (DMs have no room).
if (db.prepare("SELECT \"notnull\" FROM pragma_table_info('messages') WHERE name='room_id'").get().notnull) {
  const cols = db.prepare('PRAGMA table_info(messages)').all();
  const definitions = cols.map(column => {
    let def = `${column.name} ${column.type}`;
    if (column.name === 'room_id') def += ' REFERENCES rooms(id) ON DELETE CASCADE';
    else if (column.name === 'user_id') def += ' REFERENCES users(id)';
    else if (column.name === 'attachment_id') def += ' REFERENCES attachments(id) ON DELETE SET NULL';
    else if (column.name === 'reply_to') def += ' REFERENCES messages(id) ON DELETE SET NULL';
    else if (column.name === 'thread_root') def += ' REFERENCES messages(id) ON DELETE CASCADE';
    else if (column.name === 'dm_id') def += ' REFERENCES dm_conversations(id) ON DELETE CASCADE';
    if (column.pk) def += ' PRIMARY KEY';
    else if (column.name !== 'room_id' && column.notnull) def += ' NOT NULL';
    if (column.dflt_value != null) def += ` DEFAULT ${column.dflt_value}`;
    return def;
  });
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`CREATE TABLE messages_new (${definitions.join(', ')})`);
  db.exec(`INSERT INTO messages_new(${cols.map(c => c.name).join(', ')}) SELECT ${cols.map(c => c.name).join(', ')} FROM messages`);
  db.exec('DROP TABLE messages');
  db.exec('ALTER TABLE messages_new RENAME TO messages');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id, id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_dm_id ON messages(dm_id, id)');
}
if (!db.prepare('PRAGMA table_info(messages)').all().some(column => column.name === 'p2p_transfer_id')) {
  db.exec('ALTER TABLE messages ADD COLUMN p2p_transfer_id INTEGER REFERENCES p2p_transfers(id)');
}
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_messages_dm_id'").get()) {
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_dm_id ON messages(dm_id, id)');
}
const dmMemberColumns = new Set(db.prepare('PRAGMA table_info(dm_members)').all().map(column => column.name));
if (!dmMemberColumns.has('last_read_id')) db.exec('ALTER TABLE dm_members ADD COLUMN last_read_id INTEGER');
if (db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get().count === 0) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)').run();
}
db.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  link TEXT,
  data TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, id DESC)');
db.exec(`CREATE TABLE IF NOT EXISTS bot_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT
)`);
