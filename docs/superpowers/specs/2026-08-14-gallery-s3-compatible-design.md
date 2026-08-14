# 设计：图床后端从「七牛 SDK」改为「通用 S3 兼容」

日期：2026-08-14
状态：已获用户确认（2026-08-14）

## 背景与目标

`polychat-plugin-gallery` 目前的云存储后端只支持七牛 Kodo，通过 `qiniu` npm 官方 SDK 实现上传 / 删除 / 签名 URL。用户希望改为 **通用 S3 兼容协议** 接入，达到：

- 不再锁定七牛 —— 以后可换 Cloudflare R2 / MinIO / AWS S3 等任意 S3 兼容服务商，只改配置不改代码
- 线上部署（`root@68.64.177.154:/opt/polychat`，目前只配了 `QINIU_*` 环境变量）**零配置改动**平滑升级

> 实现后确认：旧 `QINIU_*` 部署升级后需补设 `S3_ENDPOINT`（旧 `QINIU_ZONE` 已废弃），补上即恢复 S3 后端。

已确认的三项决策：

1. **目标存储**：通用 S3 兼容（不是只走七牛 S3 网关）
2. **环境变量**：`S3_*` 为主，`QINIU_*` 保留为兼容别名（先读 `S3_*`，缺失回退 `QINIU_*`）
3. **S3 实现**：MinIO JS SDK（`minio` npm 包，v8，当前版本 8.0.7）

## 现状（改动前）

- 插件：`plugins/polychat-plugin-gallery/index.js`（约 200 行）
  - `qiniuMac()`：读 `QINIU_ACCESS_KEY / QINIU_SECRET_KEY / QINIU_BUCKET / QINIU_ZONE / QINIU_DOMAIN`，zone 映射到 `qiniu.zone['Zone_'+zone]`，缺任一即未配置
  - 上传 `FormUploader.put`、删除 `BucketManager.delete`、下载外链 `BucketManager.privateDownloadUrl`（私有空间）或 `https://<domain>/<key>`（公开空间）
  - `storage='qiniu'` 时：列表 `url` 直接返回 Kodo 下载 URL；`GET /api/gallery/:id/file` 302 重定向到下载 URL
  - 清理服务 `gallery-cleanup.deleteObject` 复用 `qiniuDelete`
- 依赖：根 `package.json` `"qiniu": "^7.15.2"`
- Schema：`server.mjs` 集中建表，`gallery_images.storage CHECK(storage IN ('local','qiniu'))`
- 测试：`test/gallery.test.mjs`（本地模式）、`test/gallery-qiniu-misconfig.test.mjs`（缺 `QINIU_*` → 503；zone 未知 → 503）
- 前端：`web-client` 不感知 storage 标签（已核实），无需改动

## 设计

### 1. 配置项

| 新变量 | 旧别名 | 必填 | 说明 |
|---|---|---|---|
| `S3_ACCESS_KEY` | `QINIU_ACCESS_KEY` | 是 | AK |
| `S3_SECRET_KEY` | `QINIU_SECRET_KEY` | 是 | SK |
| `S3_BUCKET` | `QINIU_BUCKET` | 是 | 桶名 |
| `S3_ENDPOINT` | —（新增，无旧值） | 是 | S3 端点，如 `https://s3-cn-east-1.qiniucs.com`、`https://<account>.r2.cloudflarestorage.com`、`https://minio:9000` |
| `S3_REGION` | — | 否 | 默认 `us-east-1`，多数 S3 兼容服务不校验 |
| `S3_DOMAIN` | `QINIU_DOMAIN` | 否 | 公开桶直连域名/CDN，如 `img.zhezhe.online`；不设则用签名 URL |
| `S3_PRIVATE` | `QINIU_PRIVATE` | 否 | 默认 `false`；`true` 时即使设了 `S3_DOMAIN` 也走签名 URL（沿用旧 `QINIU_PRIVATE=true` 的私有桶语义） |

- 读取顺序：先 `S3_*`，缺失回退 `QINIU_*`。缺任一必填项（AK/SK/BUCKET/ENDPOINT）→ 未配置 → 503「S3 模式未配置 S3_* 环境变量」
- 旧 `QINIU_ZONE` 废弃（区域信息已含在 ENDPOINT 中），不再读取

### 2. 存储标记与 Schema 迁移

- 新写入 `gallery_images.storage = 's3'`
- 启动迁移（`server.mjs`，参照 `messages` 表重建先例，第 294-313 行）：
  1. 检测 `gallery_images` 的 CHECK 是否已含 `'s3'`（用 `sqlite_master` 的 SQL 文本判断）
  2. 未含则重建表：`PRAGMA foreign_keys = OFF` → 建 `gallery_images_new`（CHECK `('local','s3')`，保留 `user_id REFERENCES users(id) ON DELETE CASCADE`）→ `INSERT ... SELECT` 时把 `storage='qiniu'` 改写成 `'s3'` → `DROP` 旧表 → `RENAME`
  3. `PRAGMA foreign_keys = ON` 恢复
- 迁移后 DB 中只有 `local` / `s3` 两个标记；插件代码统一判断 `storage === 's3'`

### 3. 插件逻辑改造（`plugins/polychat-plugin-gallery/index.js`）

- 依赖：根 `package.json` 删 `qiniu`，加 `minio`（^8.0.7）
- 函数替换：
  - `qiniuMac()` → `s3Client()`：读 `S3_*`（回退 `QINIU_*`）构造 `new Client({ endPoint, port, useSSL, accessKey, secretKey, region })`；ENDPOINT 解析 host/port/https
  - 上传：`FormUploader.put` → `client.putObject(bucket, key, bytes, { 'Content-Type': mime })`
  - 删除：`BucketManager.delete` → `client.removeObject(bucket, key)`
  - 下载外链 `qiniuDownloadUrl` → `s3DownloadUrl`：
    - `S3_PRIVATE=true` → 始终 `client.presignedGetObject(bucket, key, 3600)`（签名 URL，兼容旧私有桶语义）
    - 否则设了 `S3_DOMAIN` → `https://<domain>/<key>`（公开桶 CDN 直连，沿用现有行为）
    - 否则 → `client.presignedGetObject(bucket, key, 3600)`（1 小时签名 URL，公开/私有桶通吃）
- 所有 `row.storage === 'qiniu'` 判断改为 `=== 's3'`（旧行已迁移）
- 错误文案：`七牛模式未配置 QINIU_* 环境变量` → `S3 模式未配置 S3_* 环境变量`
- 插件 `description`、注释更新（`qiniu` → `s3` / S3 兼容）

### 4. 测试

改造 `test/gallery-qiniu-misconfig.test.mjs`（保留文件名或更名 `gallery-s3-misconfig.test.mjs`，倾向更名）：

1. 无任何 `S3_*` / `QINIU_*` 配置 → 上传 503「S3 模式未配置」
2. 只配 `QINIU_*` 别名但缺 ENDPOINT（`QINIU_ACCESS_KEY` 等齐全）→ 503（验证别名被读取且必填项齐全才放行）
3. 配置齐全但 `S3_ENDPOINT` 指向不可达地址（如 `http://127.0.0.1:1`）→ 上传 500「S3 上传失败」（连接拒绝）

`test/gallery.test.mjs`（本地模式）应不受影响。

### 5. 文档

- 根 `README.md` 环境变量表：`QINIU_*` 条目改为 `S3_*`（附别名说明与 `S3_ENDPOINT` 示例）
- `plugins/polychat-plugin-gallery/README.md` 同步
- `docs/PLUGINS.md` 如有提及同步

### 6. 前端

不改。`web-client` 不感知 storage 标签（已核实 `App.vue` 无相关引用）。

## 验证清单

- `npm test` 全绿（含改造后的 misconfig 测试 3 条 + 本地模式 gallery 测试）
- `npm run web:build` 干净
- `npm run build:all` 成功，SEA 二进制与 `.cjs` 启动冒烟：`/api/health` 200、未配置 S3 → 图床上传 503、本地模式上传/列表/删除正常
- 线上部署建议（用户自行执行，不在本次范围内）：重启容器后 `QINIU_*` 别名继续生效，可用七牛 S3 网关端点 `https://s3-cn-east-1.qiniucs.com`（或按实际区域）补一个 `S3_ENDPOINT` 即可验证 S3 路径

## 不做的事（YAGNI）

- 不做浏览器直传（STS/临时凭证），保持服务端中转
- 不做多桶/分片上传（图片 ≤ 100MB，单 PUT 足够）
- 不把审计日志/管理功能插件化（Tier 2，与本任务无关）
