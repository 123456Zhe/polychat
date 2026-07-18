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
- ✅ **阶段 7**：好友系统（好友请求、接受/拒绝、删除、双向关系）
- ✅ **阶段 8**：私信系统（DM 会话、消息发送/编辑/撤回/表情、未读计数、已读回执、WebSocket 实时推送）

所有阶段已完成。GUI/TUI/Web 客户端和文档已同步更新。

---

## Quick start

```bash
npm install                  # first run only
./run-server.sh              # starts Node server on :3000
# or just: node server.mjs
```

Run `npm install` once before starting the server or building the web frontend. SQLite itself is provided by Node 22.5+ through `node:sqlite`.

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

- **Server**: `server.mjs` — HTTP server + SQLite (`node:sqlite`) + core API routes. Realtime bots/AI live in the `modules/onebot/` package, loaded via `setupOnebot()` and wired through an EventBus (`message:sent`, `dm:sent`). No framework, no build step for the server.
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
- WebSocket realtime: room messages, DM messages, friend events (request/accept/remove), typing indicators, presence. HTTP polling retained as fallback.
- Friend system: bidirectional — sender creates pending request; accept creates reverse row. Must be friends to start a DM conversation.
- DM (private messaging): `dm_conversations` + `dm_members` tables. Messages stored in `messages` table with `dm_id` set and `room_id` null. Supports unread counts, marking as read, edit, retract, and reactions.
- `NODE_ENV=test` disables registration rate limiting so tests can create unlimited accounts from the same IP.
- OneBot v11 gateway at `ws://HOST:PORT/api/onebot/ws?token=<bot_token>` (also `/api` standard path). Bots authenticate with a bot token created by an admin-approved bot request.

## Session work log

### This session (OneBot modularization)
- Extracted all OneBot/bot logic out of `server.mjs` into `modules/onebot/`:
  - `utils.js` — `onebotTS`, `onebotSegments`, `onebotMessageText`, `onebotGetOrCreateDm`
  - `actions.js` — `createOnebotActionHandler` (the `handleOnebotAction` switch)
  - `ws.js` — `createOnebotWs` (own `WebSocketServer`, upgrade auth via `bot_tokens`, heartbeat)
  - `events.js` — `registerOnebotEventListeners` (EventBus `message:sent` / `dm:sent` → bot broadcasts)
  - `index.js` — `setupOnebot(ctx)` wiring everything
- `server.mjs` now calls `setupOnebot(...)` after `http.createServer`, passes deps via ctx, and emits `message:sent` / `dm:sent` at the human message-send endpoints.
- Removed broken `AI_USER_ID` references: `[at:ai]` handling in `resolveMentions`, `ai` field in `/api/health`, and the dangling `/api/ai/info` endpoint. AI is now a user-created bot approved by admins.
- All 13 Node tests pass; server boots cleanly and OneBot WS rejects connections without a token (returns 401).

### Previously implemented
- Notification system: `notifications` table, `createNotification()`, WS push, REST API (unread count, mark-read, read-all), and bell UI in `web-client/src/App.vue`.
- Bot request/approval flow: `bot_requests` table, `POST /api/bot-requests`, `GET /api/admin/bot-requests`, `PUT /api/admin/bot-requests/:id` (auto-creates user + bot token + notifies applicant).
- `@` mention system: validation in `validateMentions`, red badge, desktop notification prefix `@你`, `mentionedUnread` tracking, `/api/rooms/:id/mentionables` endpoint.
- Admin panel tabs (users/security/bots) and notification bell UI are wired into `web-client/src/App.vue`.

### Status
- Module extraction DONE. Client-side notification bell + admin bots tab DONE. OneBot protocol fixes (standard field alignment) DONE.
- All server Node tests pass (15/15); web-client builds cleanly.
- OneBot security fixes are committed and deployed; the current bot configuration UX changes remain uncommitted.

### This session (bot configuration UX)
- Admin bot workspace shows the forward OneBot endpoint, request history, issued tokens, and copy/revoke actions.
- Approval notifications provide one-click Token, WebSocket URL, and configuration JSON copying.
- Revoking a Bot Token immediately disconnects the associated OneBot connection.

### This session (client wiring + protocol)
- Web client `App.vue`: removed `aiUser` / `/api/ai/info` / `[at:ai]` suggestion.
- Notification bell + dropdown: `loadNotifications`, `loadNotifCount`, `markNotifRead`, `markAllNotifRead`, `pushNotification` (driven by `notification` WS event).
- Admin panel: 3-tab layout (用户 / 安全 / 机器人); users tab, security tab (IP/device bans), bots tab with `submitBotRequest` + `reviewBotRequest` (approve/reject bot-requests).
- style.css: `notif-bell` / `notif-dropdown` / `notif-item`, `admin-tabs`, `bot-request` styles.
- OneBot `modules/onebot/ws.js`: now also accepts standard `/api` path; sends `heartbeat` meta_event on connect.
- End-to-end verified: register → submit bot-request (201) → auth-gated notification/bot-request endpoints return 401 without token → OneBot WS returns 401 for bad/missing token.
