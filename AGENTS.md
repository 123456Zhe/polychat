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
| Single-file server build | `npm run build:server` → `dist/polychat-server` (Node SEA binary, self-contained) + `dist/polychat-server.cjs` (bundled JS). `npm run build:all` = web:build + build:server |
| Run GUI client | `./run-gui.sh` (needs Python + Flet in `.venv-gui/`) |
| Run TUI client | `./run-tui.sh` |
| Build GUI standalone | `./build-gui.sh` (creates `dist/PolyChat-GUI/`) |
| Build Android app | `./build-android.sh` (needs Android SDK) |
| Docker | `docker compose up -d --build` |

Run tests before committing. `npm test` creates a temporary SQLite DB and cleans up automatically.

## Architecture

- **Server**: `server.mjs` — HTTP server + SQLite (`node:sqlite`) + core API routes. Non-essential features are extracted as plugins in `plugins/polychat-plugin-*/` (unified `polychat-plugin-<name>` naming), loaded by `modules/plugin-loader.js` through the `modules/plugin-registry.js` registry (HTTP routes / WS message types / heartbeat / cleanup / services), and wired through an EventBus (`message:sent`, `dm:sent`). OneBot lives in `plugins/polychat-plugin-onebot/` (was `modules/onebot/`). No framework, no build step for the server.
- **Database**: SQLite with WAL mode, auto-migrates schema on startup (adds columns if missing). DB file at `data/polychat.db`. All tables (incl. plugin-owned ones like `p2p_transfers`, `push_subscriptions`, `app_settings`, `bot_tokens`) stay centrally created here so plugins only move logic, not schema.
- **Web frontend**: Vue 3 + Vite app in `web-client/`. `npm run web:build` outputs production assets to `web/`, which the Node server serves directly. Mobile-responsive with sidebar toggle.
- **Android app**: Capacitor wrapper in `android-app/`. Uses built web assets from `web/`. Build with `./build-android.sh`.
- **GUI client**: `clients/gui.py` — Flet desktop app, shares `clients/chat_api.py` for HTTP logic. Needs `.venv-gui/` virtualenv (created by `build-gui.sh`).
- **TUI client**: `clients/tui.py` — curses terminal client, shares `clients/chat_api.py`.

## Key details

- First registered user automatically becomes admin.
- Server auto-creates `data/`, `data/uploads/`, `data/avatars/`, and `data/backups/` directories.
- Environment variables: `PORT` (default 3000), `HOST` (default `0.0.0.0` — all interfaces, so LAN/public access works out of the box; set `127.0.0.1` to restrict to loopback), `DB_PATH`, `UPLOAD_DIR`, `AVATAR_DIR`, `MAX_FILE_SIZE`, plus plugin-level `DISABLED_PLUGINS` (comma-separated blacklist), `PLUGINS_DIR` (external plugin drop-in dir, default `plugins`), `PLUGINS_CONFIG_PATH` (default `data/plugins.json`). Per-plugin env vars (see README): `BACKUP_ENABLED`/`BACKUP_DIR`/`BACKUP_INTERVAL_HOURS`/`MAX_BACKUPS`, `VAPID_*`, `P2P_*`, `TURN_*`, `ONEBOT_*`.
- Plugins default-enabled; config auto-generated/auto-migrated in `data/plugins.json` on every boot (new plugins added with defaults, removed pruned, config merged key-by-key with manifest `defaultConfig`). Built-ins statically imported → bundled into the single-file/SEA build; external plugins (drop-in dir or npm `polychat-plugin-*`) loaded dynamically (directory deployments only).
- `NODE_ENV=test` suppresses the server from listening (used by tests to bind to a random port).
- `data/` is gitignored — do not commit database or uploaded files.
- File upload limit: 100 MB (configurable). Avatar limit: 2 MB (PNG/JPEG/WebP/GIF only).
- Login rate limiting: 5 attempts per 15 minutes per IP.
- Admin can ban/mute users with configurable duration.
- Users can export chat history and delete their account.
- Health check endpoint: `GET /api/health` (from the `health` plugin).
- Optional automatic SQLite backup (enabled by default, from the `backup` plugin).
- WebSocket realtime: room messages, DM messages, friend events (request/accept/remove), typing indicators, presence. HTTP polling retained as fallback.
- Friend system: bidirectional — sender creates pending request; accept creates reverse row. Must be friends to start a DM conversation.
- DM (private messaging): `dm_conversations` + `dm_members` tables. Messages stored in `messages` table with `dm_id` set and `room_id` null. Supports unread counts, marking as read, edit, retract, and reactions.
- `NODE_ENV=test` disables registration rate limiting so tests can create unlimited accounts from the same IP.
- OneBot v11 gateway at `ws://HOST:PORT/api/onebot/ws?token=<bot_token>` (also `/api` standard path). Bots authenticate with a bot token created by an admin-approved bot request.

## Session work log

### This session (插件系统：非必要功能独立为插件)
- **目标**：项目更小、更易部署 —— server.mjs 2104 → 1895 行（约 210 行逻辑迁出为插件）；默认部署方式零变化（单文件 SEA / Docker / `node server.mjs`），内置插件静态打包自包含。
- **插件框架**：`modules/plugin-registry.js`（`createPluginRegistry`：`registerApiRoute`/`registerWsMessage`/`registerHeartbeat`/`registerCleanup`/`provide`/`service`）；`modules/plugin-loader.js`（配置加载/迁移、发现、`setupPlugins` 同步加载内置、`setupExternalPlugins` 异步加载外部）。统一命名 `polychat-plugin-<name>`，插件 = 独立 npm 包（package.json/index.js/README），公开接口见 `docs/PLUGIN_API.md`，第三方模板 `templates/polychat-plugin-template/`，可插件化功能清单与迁移说明 `docs/PLUGINS.md`。
- **自动配置/迁移**：`data/plugins.json` 首次启动自动生成、每次启动自动迁移（新插件补默认、删除条目剪除、config 与 `defaultConfig` 逐键合并）；`DISABLED_PLUGINS=backup,p2p` 黑名单快速停用（优先于配置文件）；`PLUGINS_DIR`/`PLUGINS_CONFIG_PATH` 可换目录。老项目升级：内置 6 插件默认全开 + 原 env 变量照常生效 + Schema 集中自动迁移 → 零手工。
- **提取的 6 个插件**：`backup`（定时备份）、`health`（`/api/health`）、`announcement`（全局公告）、`web-push`（VAPID + 订阅 + 订阅 `message:sent` 推送）、`p2p`（路由 + WS `p2p_signal` + `dm:sent` + cleanup，`isDmMember` 留在核心供附件权限共用并注入 ctx）、`onebot`（`modules/onebot/` git mv 到 `plugins/polychat-plugin-onebot/`，入口改为插件 manifest，`attach`/`startReverse`/`heartbeat` 内聚，核心经 `registry.service('onebot')?.disconnectUser()` 安全调用）。
- **server.mjs 集成**：api() 404 前插件路由分发（核心优先）；WS 消息 `typing` 保留核心、其余查 `registry.wsHandlers`；心跳循环 `registry.heartbeatFns`；`cleanupExpiredData()` 追加 `registry.cleanupFns`；`message:sent` 事件改为无条件发射（含 `threadRoot`，OneBot 已有守卫，web-push 借此推送）；新增 `GET /api/admin/plugins` 管理员只读列表；`loadExternalPlugins()` 导出供测试/运维。
- **验证**：31/31 Node 测试通过（25 旧 + 新增 `test/plugins.test.mjs` 5 项：配置迁移/停用不注册/管理员列表/外部插件投放+内置优先；`test/plugins-disabled.test.mjs` 1 项：黑名单）；`web:build` 干净；`build:all` 成功（bundle 5.2mb + SEA 128MB）；.cjs 与 SEA 二进制启动实测 health/p2p/push/announcement/admin-plugins 全通，`DISABLED_PLUGINS=health,p2p` 对应 404。
- **后续可做（Tier 2）**：审计日志/管理封禁/限速再插件化（需核心加钩子，见 docs/PLUGINS.md）；插件拆分独立 git 仓库 + 发布 npm（等确认远程地址）。

### This session (单文件服务端打包)
- **目标**：解决部署麻烦 —— 把服务端打成单个可执行文件，目标机无需装 Node、无需拷贝项目目录。
- **实现**（`scripts/build-server.mjs` + `server.mjs` 小改 + `embedded-assets.cjs` 占位）：
  - esbuild 把 `server.mjs` + `modules/onebot/` + `ws` + `web-push` 全部打进单个 CJS 文件（`build/server.cjs`，devDeps 增加 `esbuild`、`postject`）。
  - **静态资源内嵌**：esbuild 虚拟插件拦截 `./embedded-assets.cjs`，生成 `web/`（129 个文件）+ KaTeX vendor（css/js/60 字体）的 base64 映射注入 bundle；`server.mjs` 顶部 `import embeddedAssets from './embedded-assets.cjs'`（dev/测试读占位文件 → `null` → 照旧读磁盘，`staticFile` 内嵌映射优先、磁盘回退）。
  - **Node SEA**：`--experimental-sea-config` 生成 blob → 复制 `process.execPath` → postject 注入 → 输出 `dist/polychat-server`（Linux 可执行，约 128MB，含 Node 运行时）；同时保留 `dist/polychat-server.cjs`（单文件 JS 版）。
  - 关键坑：SEA 入口只能按 CJS 加载（ESM 输出报 `Unexpected token 'export'`）；CJS 下 esbuild 把 `import.meta.url` 编成 `{}` → 会崩，`server.mjs` 改为 `typeof __dirname !== 'undefined' ? __dirname : fileURLToPath(...)` 双系统兼容，并用 `logOverride: { 'empty-import-meta': 'silent' }` 消警告；SEA 需全量 bundle（运行期 `require('ws')` 会 `ERR_UNKNOWN_BUILTIN_MODULE`）。
  - 新 npm scripts：`build:server`、`build:all`（= web:build + build:server）。`build/`、`dist/` 已在 gitignore。
- **验证**：独立空目录部署实测——单文件启动自动建 `data/`，`/api/health`、注册/登录/建房/发消息/拉消息、WebSocket 实时广播（`message` 事件）、重启持久化、内嵌静态资源（index.html、`/assets/*.js`、`/vendor/katex.min.js` 与字体）、404 均通过；`dist/polychat-server.cjs` 也能直接 `node` 跑；`npm test` 25/25 通过（dev 磁盘回退未受影响）。构建注意事项：二进制内含构建时 Node，须在部署同平台构建。
- **GitHub Release 一体化发布**：`.github/workflows/build-signed-apk.yml` 改名 `.github/workflows/build-release.yml`（`build-android.yml` 调试 workflow 不变）。手动触发输入版本号后并行跑 4 类 job：`apk`（签名 APK，上传 artifact `android-apk`）；`server`（**matrix 3 平台** ubuntu/macos/windows，各用 setup-node 24 → `npm ci` → `web:build` → `build:server`，把二进制 mv 成 `polychat-server-linux`/`-macos`/`-win.exe` 后**先启动做冒烟自检** health/index/vendor-katex，`shell:bash` 保证三平台可跑，`fail-fast:false`，按平台传独立 artifact；`polychat-server.cjs` 只在 linux artifact 传一份避免 merge 冲突）；`release`（`needs:[apk,server]`，download-artifact `merge-multiple` 合并 4 个 artifact → heredoc 生成含三平台部署/安全提示的 Release 正文 → `softprops/action-gh-release` 一次上传 apk + 3 平台二进制 + cjs）。正文用 `__VERSION__` 占位 + `sed` 替换，避免 `${{ }}` 出现在 heredoc 内。postject 的 WASM 以 base64 内嵌在 JS（无外部 .wasm），跨平台可行。已本地验证：YAML 解析、9 个 run 脚本 `bash -n`、正文渲染全部通过。

### This session (借鉴 LanTalk：房主踢人通知 / 全局公告 / Markdown 速查 / 智能检测)
- **房主踢人增强**（服务端 `server.mjs`）：`DELETE /api/rooms/:id/members/:userId` 移除成员后给被踢者推送 `room_kicked` WS 事件（`room_id` + `room_name`）+ 创建「你已被移出房间」通知；Web 端 `handleSocketEvent` 收到 `room_kicked` 后自动退出该房间并 toast 提示（`backToMobileHome()`）。
- **管理员全局公告**：新增 `GET/POST/DELETE /api/admin/announcement`（GET 登录用户可读，POST/DELETE 需 `requireAdmin`），公告持久化到 `app_settings`（key=`global_announcement`，重启不丢），发布/清除均 `logAudit` + `broadcast({type:'announcement', global:true, ...})`（不带 roomId → 全体在线）。Web 端：桌面/移动各 3 处顶部横幅（🔊 系统公告，支持 Markdown + × 本地关闭），管理面板新增第 4 个「公告」tab（textarea 发布 / 预览 / 清除）。
- **Markdown 语法速查**：Web composer 双端（桌面+移动、房间+私信共 4 处）新增「MD」按钮 → `.modal` 速查表（14 行：标题/粗体/斜体/删除线/行内代码/代码块/链接/图片/引用/列表/表格/`$`/`$$`/@提及）；Android `ChatScreen` composer 新增 HelpOutline 按钮 → `ModalBottomSheet` 速查表（`mdCheatRows`）。
- **Markdown 智能检测（Android）**：`MarkdownWebView.kt` 新增 `containsMarkdown()`（行内 `**`/`*`/`~~`/`` ` ``/`[]()`/`[at:]`/`$`/表格 + 块级复用 `MARKDOWN_BLOCK`），`MessageBubble` 纯文本消息直接渲染 `Text`，跳过昂贵的每消息 WebView 管线（mentions 非空仍走 WebView）。
- 顺带修复：Web `time()` 兼容 ISO 时间戳（此前全局公告显示 "Invalid Date"）。
- 验证：新增 2 组测试（踢人 `room_kicked`+通知 / 全局公告权限+广播+持久化+清除），21/21 Node 测试通过；`web:build` 干净；桌面+移动（390×844）浏览器实测：MD 速查弹窗 14 行、公告横幅发布/清除/实时跨客户端推送、踢人 toast 与自动退出、通知中心未读。

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

### This session (原生 Android App 重写)
- 放弃 Capacitor 壳（原壳连登录都不可用：无 server.url 导致 /api 请求打到设备 localhost），用 Kotlin + Jetpack Compose + Material 3 原生重写。
- 工程：`android-app/` 独立 Gradle 工程（AGP 8.5.2 / Kotlin 2.0.21 / Compose BOM 2024.10 / minSdk 24 / targetSdk 36），32 个 Kotlin 文件约 4150 行，Hilt DI + Retrofit(kotlinx-serialization) + OkHttp WebSocket + DataStore + Coil。
- 功能：认证/房间/DM/好友/分片上传/图片预览/**Markdown+LaTeX 渲染**/通知中心/在线+typing/5 套主题/管理面板。P2P 与 OneBot 面板延后（P2P 消息只读提示）。
- **LaTeX 渲染方案**：消息正文用 WebView 加载 `assets/markdown.html`（内联 marked+KaTeX+DOMPurify，vendor 1MB 含全部字体），JS bridge 回传高度驱动 Compose；气泡外壳（头像/时间/附件/菜单）仍是原生 Compose。公式/表格/@提及/XSS 消毒已在 Node 环境验证通过。
- 服务器地址可配置（默认 `http://68.64.177.154:3000`，network_security_config 放行明文）；认证用 Bearer token（不依赖 cookie）；WS 用 `?token=`。
- 构建：本机无 Android SDK，`./gradlew assembleDebug` 需在 Android Studio 或 GitHub Actions（workflow 已改为纯 Gradle，去掉 npm/Capacitor 步骤）。
- 清理：删除 Capacitor 的 `package.json`/`capacitor.config.json`/旧 README；`.gitignore` 改为忽略 `.gradle/`/`build/`/`local.properties`（原生源码提交）；`build-android.sh`/根 README 已更新。
