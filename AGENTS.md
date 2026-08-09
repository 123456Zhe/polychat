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

### This session (功能提示与可视化引导)
- 为 Web 端添加全面功能提示与可视化引导（`web-client/src/App.vue` + `style.css`，无新增依赖）：
  - **首次使用引导 Tour**：登录后自动弹出可跳过的 spotlight 分步引导（localStorage `polychat.tour-done` 持久化，完成后不再自动弹出），桌面 7 步高亮「新建聊天室/房间与私信列表/顶栏/输入框/消息操作/帮助按钮」，移动端 7 步（启动时自动回到首页）高亮底部 Tab 与 ＋ 按钮。
  - **功能指南面板**：顶栏新增 `?` 帮助按钮（移动端「我的」页新增「功能指南」入口），分类列出 7 组 31 项全部功能（聊天与消息、文件与直传、好友与私信、房间管理、个性化与通知、账户与数据、管理员），常用功能带「去试试」快捷按钮（建房/加好友/私信/主题/资料/导出），可一键重放引导。
  - **Tooltip 增强**：为顶栏全部按钮补齐 `title` 提示。
  - 引导实现细节：自研轻量 spotlight（`getBoundingClientRect` + box-shadow 挖孔 + 说明气泡）；`scrollIntoView({behavior:'instant'})` 规避 `.messages-scroll` 平滑滚动导致的高亮错位；引导期间监听 scroll 事件重定位；移动端提示卡自适应（目标在下半屏时提示卡移到顶部，避免遮挡）。
- 验证：19/19 Node 测试通过，`web:build` 干净；桌面 + 移动视口（390×844）浏览器实测全流程（自动触发/跳过/上下一步/完成/重放/去试试/高亮与提示卡无重叠）。

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

### This session (P2P 大文件直传)
- 私信间 WebRTC P2P 直传（`simple-peer` 封装，STUN 打洞，可选 TURN），文件字节不经过服务器，失败自动回退分片上传。
- 服务端：`p2p_transfers` 表 + `messages.p2p_transfer_id` 列；`/api/p2p/config`、`/api/p2p/transfers`（create/get/accept/reject/cancel/complete/fail）；WS `p2p_signal` 仅向传输双方转发且需已接受；`sendToUser()`/`userOnline()` 辅助函数。
- 客户端：`web-client/src/p2p.js`（simple-peer 引擎 + IndexedDB 存储 + 64KB 分块/流控/SHA-256）；`App.vue` 集成发送路径（≥`P2P_MIN_SIZE` 且对方在线先试 P2P）、接收确认弹窗、进度条、`p2p_transfer_id` 消息卡片（下载/删除本机副本）。
- Web DM 文件发送统一改用分片上传（`uploadFileChunked`），修复了此前 >10 MB 文件无法从 Web 发送的问题。
- 新增 3 个 P2P 测试（配置/生命周期/完成消息、WS 信令权限、取消/拒绝/活跃上限）；18/18 测试通过，`web:build` 干净。

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

### This session (移动端全新 UI)
- 手机（≤768px）切换到一套全新的原生 App 风格 UI，桌面端（>768px）保持现状，逻辑层（script setup）零改动。
- 模板：`App.vue` 按 `isMobile` 分支渲染 `<main class="chat">`（桌面）vs `<main class="m-app">`（移动端）；`isMobile` 断点 700→768。
- 移动端信息架构：底部 Tab 栏（聊天/联系人/我的）+ 聊天列表页 → 全屏聊天页（无 Tab，带 ‹ 返回）；聊天页顶栏只留 返回/标题/•••，房间/私信操作收进底部 sheet（`roomActionsOpen`）。
- 消息操作：`message-menu` 在移动端由气泡内下拉 → `position:fixed` 底部 action sheet（box-shadow 100vmax 伪遮罩）；`.bubble.own` 自己的消息靠右 + 主题色底（`color-mix`）。
- 弹层移动端化：`.modal`/`.notif-dropdown`/`.thread-panel` 统一转底部 sheet（顶部圆角 + safe-area）。
- 样式：`style.css` 末尾新增 `@media (max-width:768px)` 块（约 160 行），移动端复用 `.bubble`/`.composer`/`.markdown`/`.modal` 等现有类名 → 5 套主题预设的硬编码 CSS 覆盖自动命中；新增 `.m-*` 布局类文字用 `color:inherit`（跟随 :root，深色主题自动适配）。
- 修复：`index.html` viewport 加 `viewport-fit=cover`（激活 safe-area env()）、新增 `manifest.json` + icon-192/512（iOS 可安装 PWA → Web Push 生效）。
- 新增状态：`mobileTab`（'chats'|'contacts'|'me'）、`roomActionsOpen`、`backToMobileHome()`/`switchMobileTab()`。
- 验证：`web:build` 干净、18/18 Node 测试通过、移动视口（390/750/1280）浏览器实测——登录/注册、Tab 切换、进房间/发消息（带回复引用）、emoji 插入、••• 底部菜单、深色主题颜色、好友搜索加好友、通知中心、退出登录全流程通过。
