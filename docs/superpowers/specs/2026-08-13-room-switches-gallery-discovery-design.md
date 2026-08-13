# 设计文档：房间开关 + 个人图床 + 局域网发现端点

日期：2026-08-13
状态：已与用户确认（头脑风暴产出）

## 背景与目标

PolyChat 与洛谷机房聊天室项目（LanTalk / Cloud Studio Chat / TouchFish / TouchMouse / NeoChat / Stellarsis）对比后，确定两个方向：**补齐对比缺口** + **深耕机房/竞赛场景**。经需求澄清收敛为三项功能：

1. **房间开关**（核心）：`locked / hidden / password / readonly` 四项开关，并修复"私有房间对非成员不可见、无法发现/加入"的现状问题。
2. **个人图床**（插件 `polychat-plugin-gallery`）：每用户独立相册，配额管理，可生成外链图片 URL。
3. **局域网发现端点**（插件 `polychat-plugin-lan-discovery`）：`GET /api/discovery` 元信息端点，**本轮不做 UDP beacon**（未来客户端预留扩展点）。

结构选型（已确认）：**方案 B**——房间开关进核心（join/发言校验在核心，插件钩子够不着）；图床与发现做成独立插件（符合"非必要功能插件化"既定方向，可独立仓库发布）。

## 范围

### In Scope
- 房间四项开关 + 私有房可见性/加入机制重构（核心 + Web 前端 + 测试）
- 个人图床（核心 schema 集中建表 + 插件路由 + Web UI + 测试）
- `/api/discovery` 端点（插件 + 测试）
- 新插件接入插件体系：`data/plugins.json` 自动迁移、`DISABLED_PLUGINS` 可停用、SEA 单文件静态打包

### Out of Scope（明确不做）
- UDP/multicast beacon（发现功能的服务端广播，留待未来客户端消费）
- 命令面板、贴吧/论坛、关注上线提醒、房间密码外的更细粒度权限（su/777/444 式动作分控）
- 二维码直连、部署包瘦身（用户确认 WebUI 便携度与二进制部署已够用）
- GUI/TUI 客户端（已放弃维护）

---

## §1 房间开关（核心，`server.mjs` + `web-client`）

### 1.1 房间可见性模型（本次核心变更）

现状问题：私有房对非成员**完全不可见**（列表/搜索均不出现），唯一加入途径是 owner/admin 手动添加，无发现/自助加入/邀请入口。

新模型（已确认"私有房可见+可加入"）：

| 开关 | 语义 |
|---|---|
| `is_private`（现有，语义调整） | 列表**显示名称 + 🔒 标记**；非成员可见房名但读不到消息；加入需密码或申请审批 |
| `locked`（新） | 禁止**新成员**加入（现有成员、房间 owner/admin、全局管理员不受影响） |
| `hidden`（新） | 列表/搜索**完全不可见**（房间成员与全局管理员可见；知道 room id 仍可访问）——比私有更私密的一档 |
| `password`（新） | 自助加入的门槛（存哈希，永不返回明文）；房间成员/owner/admin 免密 |
| `readonly`（新） | 非房间 owner/admin 发言返回 403「房间为只读模式」；房间 owner/admin 与全局管理员可发 |

### 1.2 Schema 变更（沿用现有自动迁移模式：`PRAGMA table_info` + `ALTER TABLE ADD COLUMN`）

`rooms` 表新增列：
```sql
locked        INTEGER NOT NULL DEFAULT 0
hidden        INTEGER NOT NULL DEFAULT 0
password_hash TEXT
readonly      INTEGER NOT NULL DEFAULT 0
```

新表（加入申请，schema 集中创建在 `server.mjs`）：
```sql
CREATE TABLE IF NOT EXISTS room_join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL,
  UNIQUE(room_id, user_id)  -- 防重复申请
);
```

### 1.3 可见性 SQL 调整（列表与内容分离）

- `GET /api/rooms`（列表）：过滤条件由
  `is_private = 0 OR 是成员 OR 管理员`
  改为
  `hidden = 0 OR 是成员 OR 管理员`
  → 私有房名对所有登录用户可见（响应含 `is_private` 标记），hidden 房仅成员/管理员可见。查询需额外 LEFT JOIN 取 `locked/hidden/password_hash 存在性(布尔)/readonly` 字段。
- 消息可读性**保持不变**：`GET /api/events`、`/api/search`、`requireRoomAccess` 仍为 `is_private = 0 OR 是成员 OR 管理员` → 非成员看得到私有房门、进不去门里（403）。

### 1.4 新增端点

| 方法/路径 | 权限 | 行为 |
|---|---|---|
| `PATCH /api/rooms/:id/settings` | 房间 owner/admin（`requireRoomManager`） | body `{locked?, hidden?, password?, readonly?}`（`password` 传字符串设置/清除，空串=清除）。写 `logAudit`，WS 广播 `room_settings`，响应 200 |
| `POST /api/rooms/:id/join` | 登录用户 | body `{password?}`。已是成员→200。`locked`→403「房间已锁定」。设密码且未提供/错误→403「密码错误」。密码正确→插入 member（role='member'）→200。私有房且未设密码→403「请申请加入」。公共房未设密码→直接加入为 member→200（Web 端公共房不显示"加入"按钮，该路径供 API/未来客户端用） |
| `POST /api/rooms/:id/join-request` | 登录用户 | 创建 pending 申请（`room_join_requests`），通知房间 owner/admin（`createNotification`），响应 201。重复 pending 申请→409；`locked`→403「房间已锁定，仅接受邀请」 |
| `GET /api/rooms/:id/join-requests` | 房间 owner/admin | 列出该房间 pending 申请（含申请人用户名） |
| `POST /api/rooms/:id/join-requests/:userId/approve` | 房间 owner/admin | 置 approved + 插入 member（role='member'）+ 通知申请人，响应 200 |
| `POST /api/rooms/:id/join-requests/:userId/reject` | 房间 owner/admin | 置 rejected + 通知申请人，响应 200 |

加入私有房的两条路径：有密码 → `POST /join {password}` 直接进入；无密码 → `POST /join-request` 申请、owner/admin 审批后进入。

### 1.5 消息发送守卫

发送端点（HTTP 与 WS 两条路径）在现有 `isUserMuted` 检查旁增加：
- `readonly` 房且角色非 owner/admin/全局管理员 → 403「房间为只读模式」

### 1.6 WS 事件

- 房间设置变更 → `broadcast({ type: 'room_settings', room_id, settings })`
- 列表变更 → 复用 `broadcast({ type: 'rooms' })`
- 加入/审批 → 复用 `rooms` 事件 + 通知系统

### 1.7 Web 前端（`web-client/src/App.vue` + `style.css`）

- **房间列表**：私有房显示 🔒 标记（桌面 + 移动端）
- **进入私有房（非成员）**：密码弹窗（`POST /join`）/「申请加入」按钮（`POST /join-request`）；pending 状态显示"等待审批"
- **房主面板**：新增"房间设置"区块——4 个开关 + 密码输入（桌面房间操作区 + 移动端 `roomActionsOpen` 底部 sheet）
- **审批列表**：房主面板"加入申请"列表（通过/拒绝按钮）
- **只读房**：输入框禁用 + 提示"房间为只读模式"
- 通知中心收到申请/审批结果通知（复用现有通知系统）

### 1.8 测试（新增 ~10 条，`test/api.test.mjs`）

1. 列表：非成员可见私有房名（含 is_private 标记）、不可见 hidden 房；成员可见 hidden 房
2. 私有房消息：非成员读消息/事件 403
3. 密码：错误 403、正确 200 且成为成员、空密码房直接 200
4. 申请加入：创建 201 → owner 审批 → 申请人成为成员并收通知；重复申请 409
5. locked：非成员 join 403、owner 加人仍可
6. readonly：非管理员发言 403、房间 owner 可发
7. settings：仅 owner/admin 可用（member 403）、非管理员 403、审计日志记录
8. WS：`room_settings` 广播

---

## §2 个人图床（插件 `polychat-plugin-gallery`）

### 2.1 Schema（核心集中建表）

```sql
CREATE TABLE IF NOT EXISTS gallery_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  stored_name TEXT NOT NULL,   -- local 模式：本地文件名；qiniu 模式：对象 key
  storage TEXT NOT NULL DEFAULT 'local' CHECK(storage IN ('local', 'qiniu')),
  created_at INTEGER NOT NULL
);
```

### 2.2 插件清单（`plugins/polychat-plugin-gallery/`，manifest 模式同 health）

- `name: 'gallery'`，`enabledByDefault: true`
- `defaultConfig: { quota_mb: 500, storage: 'local' }`（env 覆盖：`GALLERY_QUOTA_MB`、`GALLERY_STORAGE`）
- 依赖 ctx：`db / json / requireUser / readBody / uploadDir / maxFileSize / publicBaseUrl / logAudit`；qiniu 模式另读 `env`

### 2.3 存储后端（新增：本地 vs 七牛 Kodo）

`GALLERY_STORAGE` 决定存储后端，两套后端共用同一套路由与配额逻辑：

| 模式 | 说明 |
|---|---|
| `local`（默认） | 文件落盘 `data/gallery/`（沿用原设计），外链走核心签名 URL |
| `qiniu` | 服务端接收图片 → 生成 upload token → 上传至七牛 Kodo → DB 记对象 key；下载走 `QINIU_DOMAIN` 公开 URL |

**qiniu 模式配置（环境变量，前缀规范同 `BACKUP_*`/`VAPID_*`）：**

| 变量 | 必填 | 说明 |
|---|---|---|
| `GALLERY_STORAGE` | 否 | `local`（默认）或 `qiniu` |
| `QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY` | qiniu 时必填 | 七牛密钥（控制台 → 密钥管理） |
| `QINIU_BUCKET` | qiniu 时必填 | 空间名（图床用**公开读**空间） |
| `QINIU_ZONE` | qiniu 时必填 | 地域：`z0` 华东 / `z1` 华北 / `z2` 华南 / `na0` 北美 / `as0` 东南亚 |
| `QINIU_DOMAIN` | qiniu 时必填 | 下载域名：测试域名 `<bucket>.cdn-<zone>.qiniucs.com` 或自定义 CDN 域名（推荐——测试域名有有效期与防盗链限制） |
| `QINIU_PRIVATE` | 否 | `false`（默认，公开空间）；`true`（私有空间时外链改用七牛签名 URL，服务端生成带 deadline 的下载链接） |

对象 key 命名：`gallery/<userId>/<timestamp>-<random>.<ext>`（按用户分目录，避免重名覆盖）。

依赖：新增 `qiniu` npm 包（纯 JS，需在 `build:all` 验证 SEA 打包；备选：七牛 S3 兼容端点 + `@aws-sdk/client-s3`，包更重，不采用）。`GALLERY_STORAGE=qiniu` 但未配置 `QINIU_*` 时，上传返回 503 并给出明确错误提示。

### 2.4 路由（`registry.registerApiRoute`）

| 方法/路径 | 行为 |
|---|---|
| `POST /api/gallery` | 上传图片（multipart 或原始 bytes，复用核心上传解析）。校验：单图 ≤ `maxFileSize`、mime 为图片（PNG/JPEG/WebP/GIF）；配额：该用户 `gallery_images.size` 总和 + 新图 > `quota_mb*1024*1024` → 413。`storage=local` 落盘 `data/gallery/`；`storage=qiniu` 服务端中转直传 Kodo，DB 记 key |
| `GET /api/gallery` | 我的图床列表（分页 `?offset=&limit=`，默认 50），每项含 id/filename/mime/size/created_at/storage/url；响应含 `quota_mb / used_mb`。`url`：local 用签名 URL；qiniu 公开空间用 `https://<QINIU_DOMAIN>/<key>`；私有空间用七牛签名 URL |
| `DELETE /api/gallery/:id` | 本人或全局管理员；删除 DB 行 + 物理文件（local）或 Kodo 对象（qiniu，`BucketManager.delete(key)`）；404 若不存在 |
| `GET /api/gallery/:id/file` | local：返回图片 bytes（签名/本人鉴权）；qiniu：302 重定向到对应下载 URL |

### 2.5 外链 URL

- `local`：核心签名文件 URL（`fileUrlSecret`/`fileUrlTtlMs`，有 TTL）
- `qiniu` 公开空间：`https://<QINIU_DOMAIN>/<key>`——**永久外链，无 TTL**，可直接 `<img src>` 引用/贴聊天/贴吧博客（图床典型用法）
- `qiniu` 私有空间（`QINIU_PRIVATE=true`）：服务端 SDK 生成带 deadline 的签名下载 URL

### 2.6 Web UI

- 移动端「我的」页新增「我的图床」入口；桌面端资料区入口
- 图床页：网格预览（缩略图）、用量条（used/quota）、复制外链按钮、删除按钮、上传按钮（支持粘贴/拖拽，复用现有上传交互）
- qiniu 模式下"复制外链"复制的是七牛 URL（永久外链）
- 图床图片可一键"发送到聊天"（插入 `![](...)` 到输入框）

### 2.7 测试（新增 ~6 条）

1. 上传 200 + 列表含该项 + 外链 URL 200
2. 非图片 mime → 400；超大 → 413（`maxFileSize`）
3. 配额：超过 `quota_mb` → 413
4. 删除：本人 200 + 文件消失 + URL 404；他人 403；管理员可删
5. 签名 URL：过期/伪造 token → 403/404
6. `GALLERY_STORAGE=qiniu` 但缺 `QINIU_*` → 上传 503 且错误信息明确（测试不依赖真实七牛网络；qiniu 端到端冒烟留给有真实密钥的手动验证）

---

## §3 局域网发现端点（插件 `polychat-plugin-lan-discovery`）

### 3.1 插件清单

- `name: 'lan-discovery'`，`enabledByDefault: true`，`defaultConfig: {}`
- 依赖 ctx：`registry / json / db / env / onlineUsers`

### 3.2 端点

`GET /api/discovery`（登录用户）→ 200：
```json
{
  "name": "PolyChat",            // env.POLYCHAT_NAME 或默认
  "version": "1.0.0",            // 从 package.json
  "host": "0.0.0.0",             // env.HOST
  "port": 3000,                  // env.PORT
  "rooms": 12,                   // rooms 表计数
  "online": 3,                   // onlineUsers 数量
  "uptime_ms": 123456,
  "features": ["rooms", "dm", "friends", "upload", "p2p", "push", "onebot", "gallery"]
}
```

### 3.3 未来扩展（本轮不做）

UDP/multicast beacon 预留：插件可在 manifest/README 注明"v2 计划在 heartbeat 中发送 UDP 广播"，供未来客户端（Android/GUI 恢复自动发现）消费。本轮仅端点，无网络发送。

### 3.4 测试（新增 1-2 条）

1. 登录用户 `GET /api/discovery` 200 且字段齐全（name/version/port/rooms/online/uptime/features）
2. `DISABLED_PLUGINS=lan-discovery` 或停用后 → 404（与 health 同套路）

---

## 验收标准

- `npm test` 全绿（预计 25 + 新增 ~16 条）
- `web:build` 干净；`build:all`（SEA 单文件）成功，两个新插件被静态打包且 `dist/polychat-server` 启动后 `/api/gallery`、`/api/discovery` 可用
- `data/plugins.json` 首次启动自动生成含 gallery/lan-discovery 默认配置；`DISABLED_PLUGINS=gallery` 后对应路由 404
- 手动冒烟：私有房 🔒 可见→密码加入/申请审批全流程、四项开关生效、只读房禁言、图床上传/外链贴聊天、`/api/discovery` 字段正确
- （可选，有真实七牛密钥时）`GALLERY_STORAGE=qiniu` 端到端冒烟：上传进 Kodo、`QINIU_DOMAIN` 外链可访问、删除后对象消失

## 风险与注意事项

- **列表 SQL 变更影响面**：`GET /api/rooms` 语义变化（私有房可见）需同步检查依赖该列表的 Web 逻辑（房间列表渲染、移动端聊天页）。
- **password 语义边界**：password 只约束"加入"动作；公共房非成员本就能读消息，设密码仅阻止"加入为成员"——文档需向用户说明公共房设密码的实际效果有限。
- **签名 URL 过期**：外链图片带 TTL，长期外链（贴吧/博客）可能过期，README 注明。
- **gallery 文件清理**：用户注销账户时需删除其图床文件/对象（复用现有 `DELETE /api/me` 账户删除的清理逻辑，追加 `gallery_images` 清理；qiniu 模式下逐个 `BucketManager.delete`）。
- **qiniu 测试域名限制**：七牛测试域名有有效期与防盗链限制，正式使用建议绑定自定义 CDN 域名；`QINIU_PRIVATE` 与公开空间需一致，否则外链 403。
- **插件黑名单**：`DISABLED_PLUGINS` 应能独立停用 gallery / lan-discovery 而不影响其它功能。

## 参考

- 插件模式：`plugins/polychat-plugin-health/`（registerApiRoute 最小示例）、`plugins/polychat-plugin-p2p/`（复杂路由 + db 使用）
- 插件 API：`docs/PLUGIN_API.md`
- 对比来源：洛谷机房聊天室项目（LanTalk / Cloud Studio Chat / TouchFish / TouchMouse / NeoChat / Stellarsis）
