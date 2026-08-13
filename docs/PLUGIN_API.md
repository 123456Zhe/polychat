# PolyChat 插件 API（公共接口）

PolyChat 从 v1.0 起把非核心功能做成插件。任何插件都遵守**统一命名约定**与**一份公共接口契约**，可独立目录、独立仓库、独立版本发布，可被任何人按本契约创建并投放使用。

---

## 1. 命名约定

- 插件目录 / npm 包名：`polychat-plugin-<name>`（如 `polychat-plugin-backup`）。
- 加载器按该前缀自动发现（`plugins/` 目录与 `node_modules`）。
- 插件 `manifest.name` 使用 `<name>`（不带前缀），全局唯一。

## 2. 插件布局

一个插件就是一个独立的 npm 包：

```
polychat-plugin-<name>/
├── package.json     # name: "polychat-plugin-<name>", type: "module", main: "index.js"
├── index.js         # default export：manifest + setup(ctx)
└── README.md        # 功能说明、配置项、env 变量
```

### package.json 要点

```json
{
  "name": "polychat-plugin-<name>",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "exports": { ".": "./index.js" }
}
```

## 3. 插件入口（manifest + setup）

`index.js` 必须 `export default` 一个对象：

```js
export default {
  name: 'demo',                       // 必填，全局唯一（不带 polychat-plugin- 前缀）
  version: '1.0.0',                   // 建议随发布递增（SemVer）
  description: '一句话说明',          // 用于 /api/admin/plugins 列表
  enabledByDefault: true,             // 新部署默认是否启用（默认 true）
  defaultConfig: { threshold: 42 },   // 配置默认值；会被自动并入 data/plugins.json
  setup(ctx) {
    // 在此注册路由 / WS 消息 / 心跳 / 清理钩子，或向核心提供服务
  }
};
```

## 4. ctx（注入的依赖与能力）

插件**绝不 `import` server.mjs**，一切依赖由 `setup(ctx)` 注入：

| 成员 | 类型 | 说明 |
|---|---|---|
| `db` | `DatabaseSync` | 直接执行 SQL（表结构由核心集中创建，含插件所需表） |
| `eventBus` | 事件总线 | `on(event, fn)` / `emit(event, data)`，订阅核心事件 |
| `env` | `process.env` | 读取环境变量做配置覆盖 |
| `server` | `http.Server` | 需要 `server.on('upgrade', …)` 时使用（见 onebot 插件） |
| `registry` | 注册表 | 见下表 |
| `pluginConfig` | object | 本插件合并后的配置（存储值优先，默认值兜底） |
| `json(res, status, body, headers?)` | fn | 写 JSON 响应 |
| `requireUser(req, res)` | fn | 鉴权，未登录写 401；通过返回 user |
| `requireAdmin(req, res)` | fn | 管理员鉴权 |
| `readBody(req, maxLength?)` | fn | 读取并解析 JSON 请求体 |
| `logAudit(adminId, action, targetUserId, details?)` | fn | 写审计日志 |
| `broadcast(event, roomId?)` | fn | WS 广播（全站或某房间） |
| `broadcastDm(conversationId, event)` | fn | WS 广播给私信双方 |
| `sendToUser(userId, event)` / `userOnline(userId)` / `onlineUsers()` | fn | 单用户 WS 推送 / 在线判断 |
| `hydrateMessages(messages, viewerId)` | fn | 消息补充 reactions/mentions/is_deleted |
| `publicUser(user)` | fn | 用户公开 DTO |
| `createNotification(userId, {type,title,content,link,data})` | fn | 站内通知 + WS 推送 |
| `isUserBanned(user)` / `isUserMuted(user)` / `isDmMember(convId, userId)` | fn | 状态判断 |
| `socketCanAccess(socket, roomId)` / `conversationMembers(convId)` | fn | WS/会话辅助 |
| `roomForUser(roomId, userId)` / `validateMentions(text)` | fn | 房间/提及辅助 |
| `root` / `dbPath` / `uploadDir` / `avatarDir` | string | 运行目录与数据目录 |
| `maxFileSize` | number | 上传上限（字节） |
| `publicBaseUrl` | string | 对外可达基址（考虑 0.0.0.0 回退与 PUBLIC_URL） |
| `fileUrlSecret` / `fileUrlTtlMs` | string/number | 签名文件 URL 参数 |

### registry 注册表

| 方法 | 说明 |
|---|---|
| `registerApiRoute(method, pattern, handler)` | 注册 HTTP 路由。`pattern` 为精确字符串或 RegExp；`handler(req, res, url)` 需自行调用 `json()` 并返回；命中即拦截（核心路由优先） |
| `registerWsMessage(type, handler)` | 注册 WS 消息类型。`handler(client, event)`；`client.user` 为登录用户 |
| `registerHeartbeat(fn)` | 每 30s 心跳时调用（socket ping 之外） |
| `registerCleanup(fn)` | 每小时清理（`cleanupExpiredData()`）时调用 |
| `provide(name, service)` / `service(name)` | 插件对外提供服务（核心用 `registry.service('onebot')?.disconnectUser(id)` 之类安全调用） |

### 事件总线（eventBus）

核心目前发射：

| 事件 | 载荷 | 说明 |
|---|---|---|
| `message:sent` | `{ roomId, message, sender, threadRoot }` | 房间新消息（含话题回复，`threadRoot` 由订阅方过滤） |
| `dm:sent` | `{ conversationId, message, sender }` | 私信新消息（含 P2P 完成消息） |

订阅示例（web-push 插件模式）：

```js
eventBus.on('message:sent', ({ roomId, message, sender }) => {
  // message 已 hydrate，含 id/content/username/attachment_name 等
});
```

## 5. 配置：自动生成 + 自动迁移

- 每次启动把发现的插件自动登记进 `data/plugins.json`（可用 `PLUGINS_CONFIG_PATH` 换路径）。
- **自动迁移**：新增插件自动补 `{ enabled: enabledByDefault, config: 默认值 }`；删除的插件条目剪除；已有 `config` 与 `defaultConfig` 逐键合并（存储值优先，新增键补默认）→ 老项目升级零手工。
- **快速停用**：`DISABLED_PLUGINS=backup,p2p`（逗号分隔黑名单，优先于配置文件）。
- 插件内部可再读自己的 env（如 `BACKUP_ENABLED=false`、`VAPID_*`、`P2P_*`、`TURN_*`、`ONEBOT_*`），行为与内置时一致。

```jsonc
// data/plugins.json
{
  "version": 1,
  "plugins": {
    "backup": { "enabled": true, "config": { "intervalHours": 24, "maxBackups": 7 } },
    "p2p":    { "enabled": true, "config": { "minSize": 5242880, "activeLimit": 10, "ttlMs": 900000, "connectTimeoutMs": 30000 } }
  }
}
```

## 6. 三种加载来源（内置 > 目录 > npm，同名内置优先）

| 来源 | 位置 | 加载 | 适用部署 |
|---|---|---|---|
| 内置 | 仓库 `plugins/polychat-plugin-*` | 静态 import，打包进单文件/SEA | 全部（默认零配置） |
| 目录投放 | `PLUGINS_DIR`（默认 `plugins/`） | 启动时动态 `import()` | 目录部署（`node server.mjs` / `dist/polychat-server.cjs`） |
| npm 安装 | `node_modules/polychat-plugin-*` | 启动时动态 `import()` | 目录部署 |

**限制**：外部插件（目录/npm）需要真实文件系统，SEA 单文件二进制不含它们（内置插件已完整打包）。

## 7. 给第三方：创建一个插件

1. 复制本仓库 `templates/polychat-plugin-template/`（或按上面的布局新建）。
2. 填 `name` / `version` / `description` / `defaultConfig` / `setup(ctx)`。
3. 本地投放：放入服务器的 `plugins/polychat-plugin-<name>/`，重启即被自动发现、自动登记配置。
4. 发布：推独立 git 仓库 + 发布 npm `polychat-plugin-<name>`，部署方 `npm install polychat-plugin-<name>` 即可。
5. 查看：管理员 `GET /api/admin/plugins` 可看到名称/版本/启用状态。

## 8. 内置插件清单

| name | 说明 | 配置/环境变量 |
|---|---|---|
| `backup` | SQLite 自动备份 | `intervalHours`/`maxBackups`，env `BACKUP_ENABLED`/`BACKUP_DIR`/`BACKUP_INTERVAL_HOURS`/`MAX_BACKUPS` |
| `health` | `GET /api/health` | — |
| `announcement` | 全局公告 | — |
| `web-push` | 离线 Web Push | env `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` |
| `p2p` | 私信 P2P 大文件直传 | `minSize`/`activeLimit`/`ttlMs`/`connectTimeoutMs`，env `P2P_MIN_SIZE`/`TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL` |
| `onebot` | OneBot v11 机器人网关 | env `ONEBOT_REVERSE_URL`/`ONEBOT_BOT_TOKEN`/`ONEBOT_ACCESS_TOKEN`/`PUBLIC_URL` |
