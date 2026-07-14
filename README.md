# PolyChat

![PolyChat icon](assets/polychat-icon.png)

PolyChat 是一个带持久化账号的轻量聊天室，同时提供 Web、Flet 桌面 GUI 和 curses 终端 TUI 客户端。服务端只依赖 Node.js 内置模块，数据保存在 SQLite 中。

## 功能

- 注册、登录、30 天持久会话，密码使用带随机盐的 scrypt 哈希保存
- SQLite 持久化账号、房间和聊天历史，启用 WAL 模式
- 多聊天室，可由任意已登录用户创建
- 登录用户可传输文件；附件持久化保存、鉴权下载，单文件上限 10 MB
- Web 消息框支持直接粘贴截图或剪贴板图片，发送前显示缩略图，发送后按消息气泡大小等比例展示
- Web 端支持跨房间未读角标、页面标题未读数和可选的浏览器桌面通知
- 账户支持持久化头像；Web 提供账户设置与预览，GUI/TUI 也可上传头像
- Web 端支持标题、列表、引用、代码块、链接、图片、粗体、斜体、删除线等 Markdown
- Web 端通过 KaTeX 支持行内 `$...$` 和块级 `$$...$$` LaTeX；CDN 不可用时显示原始公式
- Flet GUI 原生渲染 Markdown 与 LaTeX，消息区显示每位用户的头像
- TUI 完整保留 Markdown/LaTeX 文本，支持房间命令和定时拉取新消息
- Web 渲染先转义用户输入，链接只接受 HTTP(S)，避免聊天内容注入脚本

## 环境要求

- Node.js 22.5 或更高版本（使用内置 `node:sqlite`）
- Python 3.10 或更高版本
- GUI 需要 Python 与 Flet；TUI 需要类 Unix 终端的 curses

不需要 `npm install`，也不需要另行安装数据库。

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

### Web 主题与自定义 CSS

登录后点击聊天页顶部的“主题”按钮，可以一键应用内置主题：雾蓝、午夜靛蓝、青绿浅色和 Catppuccin Mocha。选择结果和自定义 CSS 都保存在**当前浏览器的 Local Storage**，不会同步到服务器、数据库或其他用户设备。

在主题面板的“自定义 CSS”框中输入 CSS 会立即预览；点击“保存 CSS”后在刷新页面后仍会保留。“清除自定义 CSS”只移除自己的覆盖规则，保留当前选中的预设主题。变量、所有 PolyChat 选择器、状态类和示例请阅读[自定义 CSS 完整指南](docs/CUSTOM_CSS.md)。

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

自定义 CSS 可以覆盖页面任何选择器；请只粘贴自己信任的规则。若界面不可读，可在主题面板点击“清除自定义 CSS”，或在浏览器开发者工具中删除 Local Storage 里的 `polychat.custom-css`。

## 快速启动

在第一个终端启动服务：

```bash
cd /home/zhe/polychat
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

若要监听局域网地址：

```bash
HOST=0.0.0.0 PORT=3000 ./run-server.sh
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
- `/sendfile ./报告.pdf`：发送文件
- `/getfile 12 ./报告.pdf`：按消息中显示的文件 ID 下载
- `/avatar ./头像.png`：上传当前账号头像
- `/new 房间名`：新建聊天室
- `/clear`：清空当前屏幕消息
- `/help`：显示帮助
- `/quit`：退出

## 测试

```bash
npm test
python3 -m unittest discover -s test -p 'test_client.py'
python3 -m py_compile clients/chat_api.py clients/gui.py clients/tui.py
```

测试使用临时 SQLite 数据库，覆盖注册、登录、鉴权、建房、Markdown/LaTeX 消息持久化与密码非明文存储。

## 构建 GUI

Linux 下使用 Flet 生成独立桌面程序：

```bash
chmod +x build-gui.sh
./build-gui.sh
./dist/PolyChat-GUI/PolyChat-GUI --server http://127.0.0.1:3000
```

GUI 采用 Flet，头像以圆形图片显示，消息区使用 Flet Markdown 组件渲染 Markdown 与 LaTeX，附件可点击下载。`build-gui.sh` 会自动创建项目内的 `.venv-gui` 虚拟环境并安装 Flet，因此不需要向系统 Python 安装任何包。Linux 下构建产物位于 `dist/PolyChat-GUI/`，保留运行所需的多个文件；Linux、Windows 与 macOS 需分别在对应系统上构建。

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

## API 摘要

除注册与登录外，请用浏览器会话 Cookie，或发送 `Authorization: Bearer <token>`。

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/register` | 注册并登录 |
| POST | `/api/login` | 登录 |
| POST | `/api/logout` | 退出 |
| GET | `/api/me` | 当前账号 |
| GET/POST | `/api/rooms` | 列出/创建房间 |
| GET/POST | `/api/rooms/:id/messages` | 拉取/发送消息 |
| GET | `/api/events?after=:id` | 增量获取跨房间消息通知 |
| POST/DELETE | `/api/me/avatar` | 上传/移除当前账号头像 |
| GET | `/api/users/:id/avatar` | 鉴权读取用户头像 |
| POST | `/api/files` | 上传不超过 10 MB 的 Base64 文件 |
| GET | `/api/files/:id` | 鉴权下载文件 |

拉取消息可加 `?after=<消息ID>&limit=100` 实现增量更新。
