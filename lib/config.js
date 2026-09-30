import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

// Source directory. In dev (ESM) this file is <project>/lib/config.js, so the
// project root is one level up. In the single-file build (CJS bundle / SEA
// binary) `__dirname` resolves to wherever the artifact lives — data/ and
// web/ are then created/read next to it (same as the original server.mjs).
export const ROOT = typeof __dirname !== 'undefined'
  ? __dirname
  : join(fileURLToPath(new URL('.', import.meta.url)), '..');
export const PUBLIC = join(ROOT, 'web');
export const KATEX_DIST = join(ROOT, 'node_modules', 'katex', 'dist');
export const PORT = Number(process.env.PORT || 3000);
// Listen on all interfaces by default — a chat server is normally meant to be
// reachable from the LAN / public network. Set HOST=127.0.0.1 to restrict to
// loopback only.
export const HOST = process.env.HOST || '0.0.0.0';
export const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
export const DB_PATH = process.env.DB_PATH || join(ROOT, 'data', 'polychat.db');
export const UPLOAD_DIR = process.env.UPLOAD_DIR || join(dirname(DB_PATH), 'uploads');
export const AVATAR_DIR = process.env.AVATAR_DIR || join(dirname(DB_PATH), 'avatars');
export const SESSION_DAYS = 30;
export const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 100 * 1024 * 1024);
export const LEGACY_FILE_SIZE = 10 * 1024 * 1024;
export const UPLOAD_CHUNK_SIZE = 1024 * 1024;
export const FILE_URL_SECRET = process.env.FILE_URL_SECRET || randomBytes(32).toString('hex');
export const FILE_URL_TTL_MS = Number(process.env.FILE_URL_TTL_MS || 7 * 24 * 3600_000);
export const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
export const MAX_AVATAR_SIZE = 2 * 1024 * 1024;

mkdirSync(join(ROOT, 'data'), { recursive: true });
mkdirSync(UPLOAD_DIR, { recursive: true });
mkdirSync(AVATAR_DIR, { recursive: true });
