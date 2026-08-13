# PolyChat 插件化功能清单与迁移说明

本文列出全部**可插件化**的功能及其提取状态，并说明老项目升级到插件架构时如何自动迁移。

## 一、功能清单（Tier 划分）

### Tier 1 —— 已提取为插件（本期完成）

| 插件 | 功能 | 原代码位置（server.mjs 迁移前） | 依赖能力面 |
|---|---|---|---|
| `backup` | SQLite 自动备份（VACUUM INTO + 轮转） | 339-366 | 定时器、env |
| `health` | `GET /api/health` | 741-749 | HTTP 路由 |
| `announcement` | 全局公告（GET/POST/DELETE + WS 广播 + 审计） | 879-903 | HTTP 路由、broadcast、logAudit |
| `web-push` | Web Push（VAPID + 订阅路由 + 发消息推送） | 329-337、699-719、1079-1097、1541 | HTTP 路由、`message:sent` 事件 |
| `p2p` | 私信 P2P 大文件直传 | 661-698、1650-1732、2051-2059 | HTTP 路由、WS 消息、`dm:sent` 事件、cleanup |
| `onebot` | OneBot v11 机器人网关（原 `modules/onebot/`） | — | 独立 WS 服务、`message:sent`/`dm:sent`、服务提供（`disconnectUser`） |

### Tier 2 —— 可插件化，需核心先加钩子（未做，框架已预留能力面）

| 功能 | 卡点 | 需要的钩子 |
|---|---|---|
| 管理员审计日志（`logAudit` + `/api/admin/audit-logs`） | `logAudit` 被核心 16 处调用 | 审计事件钩子（eventBus 事件或拦截器） |
| 管理封禁/禁言/拉黑 IP/设备 | 封禁状态被核心 `requireUser`/WS 升级/消息发送校验 | 核心保留校验、仅迁移管理路由；`registry.service()` 已支持 |
| 登录/注册限速 | 与注册/登录处理器交织 | 认证钩子 |
| 通知中心（站内） | 被大量核心功能（踢人、机器人审批等）调用 | 偏核心，不建议迁移 |

### 核心 —— 不插件化

认证/会话、房间、消息、附件/上传、私信、好友、在线/typing、搜索、邀请码、头像、签名文件 URL、静态资源服务（含 KaTeX vendor）。

**Schema 集中管理**：所有表（含 `p2p_transfers`、`push_subscriptions`、`app_settings`、`bot_tokens` 等插件用表）仍由 `server.mjs` 集中 `CREATE TABLE IF NOT EXISTS` + `ALTER` 迁移。好处：插件开关不丢数据；核心消息 SELECT 无需对插件表做条件 JOIN。插件只搬走"逻辑"（路由/WS/定时器/辅助函数/env 读取）。

## 二、老项目升级：自动迁移步骤（无需手工）

1. **拉取新代码**：`git pull`（`modules/onebot/` → `plugins/polychat-plugin-onebot/`，其余功能提取到 `plugins/polychat-plugin-*/`）。
2. **重启**：`npm install && ./run-server.sh`（或重建单文件 `npm run build:all`）。
3. 启动时自动完成：
   - 内置 6 插件**默认全部启用**，路由/WS/心跳/备份与旧版**完全一致**；
   - `data/plugins.json` 首次启动自动生成，之后自动迁移（新增插件补默认、旧配置逐键合并、删除条目剪除）；
   - 原有 env 变量照常生效：`BACKUP_*`/`MAX_BACKUPS`/`VAPID_*`/`P2P_*`/`TURN_*`/`ONEBOT_*`/`PUBLIC_URL`；
   - Schema 照旧自动迁移（幂等），数据零丢失。
4. 可选：用 `DISABLED_PLUGINS=backup,p2p` 按部署裁剪功能（黑名单优先于配置文件）。

## 三、插件目录结构

```
plugins/
├── polychat-plugin-backup/        # 内置插件（也可整体拆成独立 git 仓库 / 发布 npm）
├── polychat-plugin-health/
├── polychat-plugin-announcement/
├── polychat-plugin-web-push/
├── polychat-plugin-p2p/
└── polychat-plugin-onebot/
modules/
├── plugin-registry.js             # 注册表（createPluginRegistry）
└── plugin-loader.js               # 配置自动迁移 + 内置/外部插件加载
docs/
├── PLUGIN_API.md                  # 公共插件接口契约（第三方创建插件指南）
└── PLUGINS.md                     # 本文档
templates/
└── polychat-plugin-template/      # 第三方插件脚手架
```

## 四、为什么不做"构建期排除插件"

SEA 单文件 128MB 的绝大部分是 Node 运行时 + web 静态资源（129 个文件 + KaTeX 字体），插件 JS 仅占几十 KB。运行时 `DISABLED_PLUGINS` 已满足裁剪需求，构建期排除对二进制体积几乎无收益，还会让单文件构建复杂化，故不做。
