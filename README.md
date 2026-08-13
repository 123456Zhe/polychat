# PolyChat

![PolyChat icon](assets/polychat-icon.png)

PolyChat 是一个带持久化账号的轻量聊天室，同时提供 Web、Flet 桌面 GUI 和 curses 终端 TUI 客户端。服务端基于 Node.js，使用 `ws` 和 `web-push` 提供实时通信与离线通知，数据保存在 SQLite 中。

## 功能

### 核心功能
- 注册、登录、30 天持久会话，密码使用带随机盐的 scrypt 哈希保存
- SQLite 持久化账号、房间和聊天历史，启用 WAL 模式
- 多聊天室，可由任意已登录用户创建
- Web 端支持标题、列表、引用、代码块、链接、图片、粗体、斜体、删除线等 Markdown
- Web 端通过 KaTeX 支持行内 `$...$` 和块级 `$$...$$` LaTeX；CDN 不可用时显示原始公式
- 输入框旁提供 Markdown/LaTeX 语法速查弹窗（Web 与 Android 均可一键查看）
- Android 端纯文本消息跳过 WebView 渲染管线（`containsMarkdown` 智能检测），长消息列表滚动更流畅
- WebSocket 实时推送：房间消息、私信、好友事件（请求/接受/删除）、输入状态和在线状态；所有客户端保留 HTTP 轮询作为降级方案
- 房间开关与门禁：房主/房间管理员可设置锁定（仅邀请可入）、隐藏（不出现在公开列表）、访问密码、只读（非管理员不可发言）；公开房可开启加入申请，由管理员审批后入房

### 好友与私信
- 好友系统：发送请求→对方接受→双向关系，支持拒绝和删除
- 私信（DM）：好友间可开启私信会话，支持发送、编辑、撤回、表情和未读计数
- Web 端私信显示未读角标、已读回执和实时消息推送
- 仅好友间可发起私信，非好友返回 403

### 文件与媒体
- 登录用户可传输文件；附件持久化保存、鉴权下载，单文件上限 100 MB（可通过 `MAX_FILE_SIZE` 配置）
- 支持大文件分片上传（1 MB 分片）
- **P2P 大文件直传**：私信间通过 WebRTC（STUN 打洞）直连传输，文件字节不经过服务器；打洞失败自动回退服务器分片上传
- Web 端支持多文件选择、拖拽上传和粘贴图片
- 发送前显示图片缩略图预览
- Web 消息框支持直接粘贴截图或剪贴板图片
- **个人图床**：登录用户上传图片（PNG/JPEG/WebP/GIF），按用户配额计量并提供外链；支持本地存储与七牛 Kodo 双后端（`GALLERY_STORAGE` 切换），注销账户时图片一并清理

### 用户与管理
- 账户支持持久化头像；Web 提供账户设置与预览，GUI/TUI 也可上传头像
- Web 端支持跨房间未读角标、页面标题未读数和可选的浏览器桌面通知
- 管理员可封禁/禁言用户（支持设置时长）
- 房主/房间管理员可将成员移出房间，被移出者实时收到 `room_kicked` 事件、自动退出房间并收到通知
- 管理员可发布**全局公告**：一键广播给所有在线用户并显示在顶部横幅（支持 Markdown），公告持久化保存、重启不丢，可在管理面板「公告」页清除
- 登录限速保护（5 次/15 分钟）
- 审计日志记录管理员操作
- 管理员可在机器人面板审批申请、复制 OneBot WebSocket 配置和撤销 Bot Token

### 数据管理
- 用户可导出聊天记录为 JSON 文件
- 用户可删除账号及所有个人数据（需密码确认）
- 自动 SQLite 备份（可选，通过 `BACKUP_ENABLED` 启用）

### 运行监控
- `/api/health` 健康检查端点
- 可选自动备份 SQLite 数据库

### P2P 大文件直传

私信中发送超过 `P2P_MIN_SIZE`（默认 5 MB）的文件时，Web 端会优先尝试**点对点直传**：

- **打洞原理**：浏览器端基于 WebRTC DataChannel（`simple-peer` 库），通过 STUN 服务器完成 UDP 打洞，ICE 协商后双方浏览器直接互联，**文件字节不经过服务器**。
- **信令**：offer/answer/ICE 候选通过现有 `/ws` 连接转发（仅传输双方可见），服务器不中转文件内容。
- **完成**：接收方校验 SHA-256 完整性后把文件保存到浏览器 IndexedDB（键为传输 ID），可随时下载；聊天记录中生成带 `p2p_transfer_id` 的直传消息。
- **回退**：接收者离线、拒绝或打洞失败（如对称 NAT 且未配置 TURN）时，自动回退到普通分片上传，文件照常以附件消息发送，始终可达。
- **局限**：P2P 文件仅到达接收者的当前设备；发送方其他设备、OneBot 机器人只能看到直传消息元数据（服务器不存储文件字节）。数据清理可在消息卡片的「删除本机副本」完成。

### 客户端
- Flet GUI 原生渲染 Markdown 与 LaTeX，消息区显示每位用户的头像
- TUI 完整保留 Markdown/LaTeX 文本，支持房间命令和定时拉取新消息
- Web 渲染先转义用户输入，链接只接受 HTTP(S)，避免聊天内容注入脚本

## 环境要求

- Node.js 22.5 或更高版本（使用内置 `node:sqlite`）
- Python 3.10 或更高版本
- GUI 需要 Python 与 Flet；TUI 需要类 Unix 终端的 curses

首次运行需要执行 `npm install` 安装 Node.js 依赖，不需要另行安装数据库。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址（默认所有网卡；只想本机访问可设 `127.0.0.1`） |
| `DB_PATH` | `data/polychat.db` | SQLite 数据库路径 |
| `UPLOAD_DIR` | `data/uploads` | 文件上传目录 |
| `AVATAR_DIR` | `data/avatars` | 头像存储目录 |
| `MAX_FILE_SIZE` | `104857600` (100 MB) | 最大文件大小（字节） |
| `DISABLED_PLUGINS` | 空 | 逗号分隔的插件黑名单（如 `DISABLED_PLUGINS=backup,p2p`），优先于配置文件 |
| `PLUGINS_DIR` | `plugins` | 外部插件投放/安装目录（`polychat-plugin-*` 命名） |
| `PLUGINS_CONFIG_PATH` | `data/plugins.json` | 插件配置文件路径（自动生成 + 自动迁移） |
| `PLUGIN_MARKET_REGISTRY` | 空 | 插件市场自建源 URL（JSON：`[{name,description,repo}]`）；缺省用 GitHub 搜索 `polychat-plugin-*` |

以下变量由对应插件读取（插件默认启用时行为与旧版一致）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `P2P_MIN_SIZE` | `5242880` (5 MB) | 达到该字节数的私信文件尝试 P2P 直传（`p2p` 插件） |
| `TURN_URL` | 空 | TURN 服务器地址（如 `turn:turn.example.com:3478`），对称 NAT 兜底（`p2p` 插件） |
| `TURN_USERNAME` | 空 | TURN 用户名（可选） |
| `TURN_CREDENTIAL` | 空 | TURN 密码（可选） |
| `BACKUP_ENABLED` | `true` | 启用自动备份（`backup` 插件） |
| `BACKUP_DIR` | `data/backups` | 备份目录 |
| `BACKUP_INTERVAL_HOURS` | `24` | 备份间隔（小时） |
| `MAX_BACKUPS` | `7` | 保留备份数量 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 空 | Web Push VAPID 密钥（`web-push` 插件，缺省自动生成并持久化） |
| `VAPID_SUBJECT` | `mailto:polychat@example.com` | Web Push 订阅者标识 |
| `GALLERY_STORAGE` | `local` | 图床存储后端：`local` 本地 / `qiniu` 七牛 Kodo（`gallery` 插件） |
| `GALLERY_QUOTA_MB` | `500` | 每用户图床配额（MB） |
| `QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY` | 空 | 七牛 AK/SK（`gallery` 插件七牛后端，缺任一 `QINIU_*` 则上传返回 503） |
| `QINIU_BUCKET` | 空 | 七牛存储空间名 |
| `QINIU_ZONE` | 空 | 七牛区域：`z0` 华东 / `z1` 华北 / `z2` 华南 / `na0` 北美 / `as0` 新加坡 |
| `QINIU_DOMAIN` | 空 | 七牛访问域名（源站或 CDN，须为 HTTPS） |
| `QINIU_PRIVATE` | `false` | 七牛空间为私有（外链返回带时效的签名 URL） |

## 插件系统

非核心功能已独立为插件（统一命名 `polychat-plugin-<name>`，目录 `plugins/`，公共接口见 [docs/PLUGIN_API.md](docs/PLUGIN_API.md)）：

| 插件 | 功能 | 停用影响 |
|---|---|---|
| `backup` | SQLite 自动备份 | 失去定时备份 |
| `health` | `GET /api/health` | 健康检查 404（CI 冒烟依赖它，默认保留） |
| `announcement` | 全局公告 | 失去全体公告 |
| `web-push` | 离线 Web Push 推送 | 失去离线提醒（站内实时不受影响） |
| `p2p` | 私信 P2P 大文件直传 | 大文件回退为服务器分片上传 |
| `onebot` | OneBot 机器人网关 | 失去 Bot 接入 |
| `gallery` | 个人图床（本地/七牛双后端） | 失去图床上传与外链 |
| `lan-discovery` | `GET /api/discovery` 局域网发现 | 失去发现端点（404） |

- **默认全部启用**，API 表面不变；按部署裁剪用 `DISABLED_PLUGINS=backup,p2p`。
- 插件配置自动生成并自动迁移于 `data/plugins.json`（新增插件自动补默认、旧配置逐键合并、删除条目剪除），老项目升级零手工。
- **WebUI 插件管理**（管理面板「插件」页签）：从市场/GitHub URL/上传 zip 安装、启用/停用、卸载，均**热加载无需重启**（管理员操作）。
- 内置插件静态打包进单文件/SEA；外部插件（git clone 进 `plugins/` 或 `npm install polychat-plugin-*`）在目录部署下自动发现加载。
- 每个插件是独立 GitHub 仓库（`123456Zhe/polychat-plugin-<name>`），主仓库用 git subtree 同步（见 docs/PLUGINS.md）。
- 管理员可 `GET /api/admin/plugins` 查看插件名称/版本/状态。

## Web 前端开发

Web UI 已独立为 `web-client/` 中的 Vue 3 + Vite 工程。开发模式会在 `5173` 端口启动，并将 `/api` 请求代理到本机服务端：

```bash
npm install
npm run web:dev
```

生产构建会输出到 `web/`，由 Node 服务直接托管：

```bash
npm run web:build
```

## 机器人接入

管理员在 Web 管理面板的“机器人”页审批申请后，可以直接复制 Bot Token、带凭据的 OneBot v11 WebSocket 地址或配置 JSON。正向 WebSocket 端点为 `/api/onebot/ws`（兼容标准 `/api` 路径）；撤销 Token 会立即断开对应机器人连接。

### Web 主题与自定义 CSS

登录后点击聊天页顶部的"主题"按钮，可以一键应用内置主题：雾蓝、午夜靛蓝、青绿浅色、Catppuccin Mocha 和琥珀玫瑰。选择结果和自定义 CSS 都保存在**当前浏览器的 Local Storage**，不会同步到服务器、数据库或其他用户设备。

在主题面板的"自定义 CSS"框中输入 CSS 会立即预览；点击"保存 CSS"后在刷新页面后仍会保留。"清除自定义 CSS"只移除自己的覆盖规则，保留当前选中的预设主题。变量、所有 PolyChat 选择器、状态类和示例请阅读[自定义 CSS 完整指南](docs/CUSTOM_CSS.md)。

下面是几个可直接粘贴的示例：

```css
/* 更改侧边栏与强调色 */
.chat > aside { background: #0f172a; }
.send, .profile-actions .primary { background: #0ea5e9; }
```

```css
/* 紧凑消息布局 */
.messages { padding: 14px 24px; }
.messages article { margin-bottom: 9px; }
.bubble { border-radius: 3px 12px 12px; }
```

```css
/* 高对比阅读模式 */
.markdown { font-size: 16px; line-height: 1.85; color: #111827; }
.bubble { border-color: #64748b; background: #ffffff; }
```

自定义 CSS 可以覆盖页面任何选择器；请只粘贴自己信任的规则。若界面不可读，可在主题面板点击"清除自定义 CSS"，或在浏览器开发者工具中删除 Local Storage 里的 `polychat.custom-css`。

## 快速启动

在第一个终端启动服务：

```bash
cd /home/zhe/polychat
npm install # 首次运行
./run-server.sh
```

然后任选客户端：

```bash
# Web：浏览器访问 http://127.0.0.1:3000

# 桌面 GUI
./run-gui.sh

# 终端 TUI
./run-tui.sh
```

GUI 登录页和 TUI 启动提示都可直接输入服务器 IP、`IP:端口` 或完整 URL；只输入 IP 时会自动使用 `http://IP:3000`，成功登录后会记住该地址。

连接远程服务时：

```bash
./run-gui.sh --server http://服务器地址:3000
./run-tui.sh --server http://服务器地址:3000
```

默认已监听所有网卡（`0.0.0.0`），局域网/公网设备直接访问 `http://服务器IP:3000` 即可；只想本机访问时：

```bash
HOST=127.0.0.1 PORT=3000 ./run-server.sh
```

公开部署时应在服务前放置 Nginx/Caddy 并启用 HTTPS。SQLite 文件默认位于 `data/polychat.db`，可通过 `DB_PATH` 指定其他位置。上传文件默认保存在数据库同目录的 `uploads/`，可通过 `UPLOAD_DIR` 单独指定。

## Markdown 与 LaTeX 示例

````markdown
# 讨论标题

这是 **重点**、*斜体* 和 `inline code`。

> 引用一段话

```python
print("hello")
```

行内公式：$E=mc^2$

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
````

## TUI 命令

- `↑` / `↓` 或鼠标滚轮：逐行滚动消息历史
- `Page Up` / `Page Down`：整页滚动
- `Home` / `End`：跳到历史开头/最新消息；右侧滚动条显示当前位置
- `/rooms`：列出聊天室及编号
- `/room 2`：进入编号为 2 的聊天室
- `/new 房间名`：新建聊天室
- `/newprivate 房间名`：新建私有聊天室
- `/rename 新名称`：重命名当前聊天室
- `/delete-room`：删除当前聊天室
- `/invite 用户名 [admin]`：邀请成员
- `/kick 用户名`：移除成员
- `/reply 消息ID 内容`：回复消息
- `/react 消息ID 表情`：添加表情反应
- `/edit 消息ID 新内容`：编辑消息
- `/retract 消息ID`：撤回消息
- `/search 关键词`：搜索消息
- `/sendfile ./报告.pdf`：发送文件
- `/getfile 12 ./报告.pdf`：按消息中显示的文件 ID 下载
- `/avatar ./头像.png`：上传当前账号头像
- `/friends`：查看好友列表
- `/addfriend 用户名`：发送好友请求
- `/accept 用户名`：接受好友请求
- `/delfriend 用户名`：删除好友
- `/dm 用户名`：进入私信会话
- `/dmback`：返回聊天室列表
- `/export [文件名]`：导出聊天记录
- `/delete-account`：删除账号
- `/clear`：清空当前屏幕消息
- `/help`：显示帮助
- `/quit`：退出

## 测试

```bash
npm test
python3 -m unittest discover -s test -p 'test_client.py'
python3 -m py_compile clients/chat_api.py clients/gui.py clients/tui.py
```

测试使用临时 SQLite 数据库，覆盖注册、登录、鉴权、建房、Markdown/LaTeX 消息持久化、密码非明文存储、好友请求/接受/删除、私信发送/编辑/撤回/表情/未读/已读以及 WebSocket 实时推送。

## 构建 GUI

Linux 下使用 Flet 生成独立桌面程序：

```bash
chmod +x build-gui.sh
./build-gui.sh
./dist/PolyChat-GUI/PolyChat-GUI --server http://127.0.0.1:3000
```

GUI 采用 Flet，头像以圆形图片显示，消息区使用 Flet Markdown 组件渲染 Markdown 与 LaTeX，附件可点击下载。`build-gui.sh` 会自动创建项目内的 `.venv-gui` 虚拟环境并安装 Flet，因此不需要向系统 Python 安装任何包。Linux 下构建产物位于 `dist/PolyChat-GUI/`，保留运行所需的多个文件；Linux、Windows 与 macOS 需分别在对应系统上构建。

## 构建 Android

Android 客户端是独立的原生工程（Kotlin + Jetpack Compose + Material 3），位于 `android-app/`。构建需要 JDK 17+ 和 Android SDK：

```bash
./build-android.sh        # 或 cd android-app && ./gradlew assembleDebug
# APK 输出: android-app/app/build/outputs/apk/debug/app-debug.apk
```

也可直接用 Android Studio 打开 `android-app/` 目录运行。推送到 GitHub 后 CI（`.github/workflows/build-android.yml`）会自动构建并上传 APK artifact。

Android 端支持与 Web 端一致的核心功能（房间/DM/好友/文件/Markdown+LaTeX 渲染/通知中心/5 套主题/管理面板），默认连接 `https://chat.zhezhe.online`，可在「我的 → 服务器地址」中修改。详见 `android-app/README.md`。

## Docker Compose 部署

服务端、Web 和持久化数据可直接用 Compose 部署：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f polychat
```

默认映射宿主机 `3000` 端口，SQLite 数据库与附件保存在项目的 `data/` 目录。升级代码后重新执行 `docker compose up -d --build`，数据库和附件不会被镜像构建覆盖。

### 服务器部署与数据迁移

在服务器上安装 Docker 并克隆公开仓库：

```bash
curl -fsSL https://get.docker.com | sh
git clone https://github.com/123456Zhe/polychat.git /opt/polychat
mkdir -p /opt/polychat/data/uploads
```

在原 PolyChat 电脑上，从仍在运行的 WAL 数据库创建一致性快照，然后上传数据库和附件：

```bash
cd /home/zhe/polychat
rm -f /tmp/polychat-migrate.db
node --input-type=module -e \
  'import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync("data/polychat.db"); db.exec("VACUUM INTO '\''/tmp/polychat-migrate.db'\''"); db.close()'
scp /tmp/polychat-migrate.db root@服务器IP:/opt/polychat/data/polychat.db
scp -r data/uploads/. root@服务器IP:/opt/polychat/data/uploads/
rm -f /tmp/polychat-migrate.db
```

回到服务器，修正容器内 `node` 用户的写入权限并启动：

```bash
chown -R 1000:1000 /opt/polychat/data
cd /opt/polychat
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 polychat
curl -I http://127.0.0.1:3000/
```

需要从公网直接使用 HTTP 时，放行 TCP 3000 端口，例如 `ufw allow 3000/tcp`。公开服务建议尽快增加 HTTPS。

浏览器系统通知 API 只在 HTTPS（以及本机开发用的 `localhost`）安全上下文中可用。公网 HTTP 下房间未读角标和页面标题提醒仍可工作，但桌面通知必须先为域名配置受信任的 HTTPS 证书。

## 单文件服务端

不想在目标机器上安装 Node.js / 拷贝整个项目？可以把服务端打包成**一个独立的可执行文件**（Node SEA 单文件应用）：

```bash
npm run web:build        # 先构建 Web 前端（只在 web/ 有改动时需要）
npm run build:server     # 打包单文件（自动内嵌 web/ 与 KaTeX 静态资源）
npm run build:all        # 或一次完成上面两步
```

构建产物（`dist/` 与中间文件 `build/` 均已被 gitignore）：

| 产物 | 说明 |
|---|---|
| `dist/polychat-server` | **独立可执行二进制**（Linux），目标机无需安装 Node；复制这一个文件即可部署 |
| `dist/polychat-server.cjs` | 单文件 JS 版，仍需 Node ≥ 22.5（用于调试 / CI） |

部署只需一个文件：

```bash
# 把 dist/polychat-server 复制到任意目录（Linux 可直接运行；Windows 为 .exe）
scp dist/polychat-server root@服务器:/opt/polychat-server
ssh root@服务器 'chmod +x /opt/polychat-server && cd /opt && PORT=3000 ./polychat-server'
```

默认监听所有网卡（`0.0.0.0`），局域网/公网直接访问 `http://服务器IP:3000`；只需本机访问时加 `HOST=127.0.0.1`。

- 首次运行自动在**可执行文件旁边**创建 `data/`（SQLite、uploads、avatars、backups），与开发模式同一套行为。
- Web 界面、KaTeX 公式字体等静态资源已全部内嵌，无需携带 `web/` 或 `node_modules`。
- 二进制内含构建时使用的 Node 运行时：请在**与部署目标相同平台**（并尽量相同 Node 大版本）上构建；Linux / Windows / macOS 需分别构建。
- 升级时重新构建并覆盖二进制即可，`data/` 目录保持不变。

### 通过 GitHub Release 发布

仓库的 `.github/workflows/build-release.yml` 会在手动触发时（输入版本号）并行构建 **签名 APK + 单文件服务端二进制**，并把两者发布到同一个 GitHub Release。服务端二进制用 matrix 在 **Linux / macOS / Windows** 三个平台分别构建（各内含对应平台的 Node 运行时），Release 正文自带部署与安全提示（三平台部署命令、备用 `polychat-server.cjs`、APK 安装说明等）。

## API 摘要

除注册与登录外，请用浏览器会话 Cookie，或发送 `Authorization: Bearer <token>`。

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/register` | 注册并登录 |
| POST | `/api/login` | 登录（限速 5 次/15 分钟） |
| POST | `/api/logout` | 退出 |
| GET | `/api/me` | 当前账号 |
| GET | `/api/me/export` | 导出聊天记录为 JSON |
| DELETE | `/api/me` | 删除账号（需密码确认） |
| GET/POST | `/api/rooms` | 列出/创建房间 |
| GET/POST | `/api/rooms/:id/messages` | 拉取/发送消息 |
| GET | `/api/events?after=:id` | 增量获取跨房间消息通知 |
| POST/DELETE | `/api/me/avatar` | 上传/移除当前账号头像 |
| GET | `/api/users/:id/avatar` | 鉴权读取用户头像 |
| GET | `/api/friends` | 查看好友列表（含待处理请求） |
| POST | `/api/friends/request` | 发送好友请求（需用户名） |
| POST | `/api/friends/:id/accept` | 接受好友请求 |
| POST | `/api/friends/:id/decline` | 拒绝好友请求 |
| DELETE | `/api/friends/:id` | 删除好友 |
| GET | `/api/dm/conversations` | 列出私信会话 |
| POST | `/api/dm/conversations` | 创建私信会话（需用户名，必须是好友） |
| GET | `/api/dm/conversations/:id/messages` | 拉取私信消息 |
| POST | `/api/dm/conversations/:id/messages` | 发送私信 |
| PUT | `/api/dm/messages/:id` | 编辑私信 |
| DELETE | `/api/dm/messages/:id` | 撤回私信 |
| POST | `/api/dm/messages/:id/reactions` | 私信添加表情 |
| POST | `/api/dm/conversations/:id/read` | 标记私信已读 |
| GET | `/api/p2p/config` | P2P 配置（ICE/STUN、TURN、最小直传阈值） |
| POST | `/api/p2p/transfers` | 发起 P2P 直传请求 |
| GET | `/api/p2p/transfers/:id` | 查询直传状态 |
| POST | `/api/p2p/transfers/:id/accept` | 接收者接受直传 |
| POST | `/api/p2p/transfers/:id/reject` | 接收者拒绝直传 |
| POST | `/api/p2p/transfers/:id/cancel` | 取消直传 |
| POST | `/api/p2p/transfers/:id/complete` | 标记完成（校验 SHA-256 后生成直传消息） |
| POST | `/api/p2p/transfers/:id/fail` | 标记失败 |
| POST | `/api/files` | 上传 Base64 文件 |
| POST | `/api/uploads` | 创建分片上传会话 |
| GET | `/api/uploads/:id` | 获取上传会话状态 |
| PUT | `/api/uploads/:id/chunks` | 上传文件分片 |
| DELETE | `/api/uploads/:id` | 取消上传会话 |
| GET | `/api/files/:id` | 鉴权下载文件 |
| GET | `/api/health` | 健康检查 |
| GET | `/api/admin/overview` | 管理面板概览 |
| PUT | `/api/admin/users/:id/admin` | 切换管理员状态 |
| PUT | `/api/admin/users/:id/ban` | 封禁用户 |
| PUT | `/api/admin/users/:id/unban` | 解封用户 |
| PUT | `/api/admin/users/:id/mute` | 禁言用户 |
| PUT | `/api/admin/users/:id/unmute` | 解除禁言 |
| GET | `/api/admin/audit-logs` | 查看审计日志 |
| GET/POST/DELETE | `/api/admin/announcement` | 全局公告：查询（登录用户）/发布/清除（管理员） |

拉取消息可加 `?after=<消息ID>&limit=100` 实现增量更新。私信会话列表返回未读数，拉取消息后可调用 `/api/dm/conversations/:id/read` 标记已读。WebSocket 地址为 `ws://host:port/ws?token=<token>`，连接后自动接收房间消息、私信和好友事件的实时推送。
