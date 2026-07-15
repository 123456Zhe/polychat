# AGENTS.md

## 项目目标（来自 Codex 会话）

> 分阶段完成 PolyChat 的输入/在线状态、消息置顶与话题串、离线 Web Push、增强文件上传、管理安全、数据管理和运行监控，并逐阶段测试、提交和推送 GitHub

### 已完成阶段

- ✅ **阶段 1**：输入/在线状态 + 消息置顶与话题串 (`cf32265`)
- ✅ **阶段 2**：离线 Web Push (`61c4762`)
- ✅ **阶段 3**：增强文件上传（图片预览、拖拽上传、多图发送）
- ✅ **阶段 4**：管理安全（登录限速、审计日志、管理员封禁/禁言）
- ✅ **阶段 5**：数据管理（导出聊天记录、删除账户与个人数据）
- ✅ **阶段 6**：运行监控（自动备份 SQLite、健康检查端点）

所有阶段已完成。GUI/TUI 客户端和文档已同步更新。

---

## Quick start

```bash
./run-server.sh              # starts Node server on :3000
# or just: node server.mjs
```

No `npm install` required for the server — only built-in Node 22.5+ modules are used. `npm install` is only needed for the web frontend dev/build.

## Commands

| What | Command |
|---|---|
| Start server | `./run-server.sh` or `node server.mjs` |
| Run Node tests | `npm test` (runs `node --test test/*.test.mjs`) |
| Web dev server | `npm run web:dev` (Vite on :5173, proxies `/api` to :3000) |
| Web production build | `npm run web:build` (outputs to `web/`) |
| Run GUI client | `./run-gui.sh` (needs Python + Flet in `.venv-gui/`) |
| Run TUI client | `./run-tui.sh` |
| Build GUI standalone | `./build-gui.sh` (creates `dist/PolyChat-GUI/`) |
| Build Android app | `./build-android.sh` (needs Android SDK) |
| Docker | `docker compose up -d --build` |

Run tests before committing. `npm test` creates a temporary SQLite DB and cleans up automatically.

## Architecture

- **Server**: single file `server.mjs` — HTTP server + SQLite (`node:sqlite`) + all API routes. No framework, no build step for the server.
- **Database**: SQLite with WAL mode, auto-migrates schema on startup (adds columns if missing). DB file at `data/polychat.db`.
- **Web frontend**: Vue 3 + Vite app in `web-client/`. `npm run web:build` outputs production assets to `web/`, which the Node server serves directly. Mobile-responsive with sidebar toggle.
- **Android app**: Capacitor wrapper in `android-app/`. Uses built web assets from `web/`. Build with `./build-android.sh`.
- **GUI client**: `clients/gui.py` — Flet desktop app, shares `clients/chat_api.py` for HTTP logic. Needs `.venv-gui/` virtualenv (created by `build-gui.sh`).
- **TUI client**: `clients/tui.py` — curses terminal client, shares `clients/chat_api.py`.

## Key details

- First registered user automatically becomes admin.
- Server auto-creates `data/`, `data/uploads/`, `data/avatars/`, and `data/backups/` directories.
- Environment variables: `PORT` (default 3000), `HOST` (default 127.0.0.1), `DB_PATH`, `UPLOAD_DIR`, `AVATAR_DIR`, `MAX_FILE_SIZE`, `BACKUP_ENABLED`, `BACKUP_DIR`, `BACKUP_INTERVAL_HOURS`, `MAX_BACKUPS`.
- `NODE_ENV=test` suppresses the server from listening (used by tests to bind to a random port).
- `data/` is gitignored — do not commit database or uploaded files.
- File upload limit: 100 MB (configurable). Avatar limit: 2 MB (PNG/JPEG/WebP/GIF only).
- Login rate limiting: 5 attempts per 15 minutes per IP.
- Admin can ban/mute users with configurable duration.
- Users can export chat history and delete their account.
- Health check endpoint: `GET /api/health`.
- Optional automatic SQLite backup (enabled by default).
