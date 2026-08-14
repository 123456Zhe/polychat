# polychat-plugin-gallery

个人图床插件：图片上传 / 配额 / 外链，支持本地与 S3 兼容双后端。

- `storage: local`（默认）—— 图片落盘到 `data/uploads/gallery/`，经 `/api/gallery/...` 外链访问
- `storage: s3` —— 上传到任意 S3 兼容对象存储（MinIO / Cloudflare R2 / 七牛 Kodo 等），
  公开桶外链走 CDN 域名直连，私有桶返回 presign 签名 URL
- 每用户配额 `quota_mb`（默认 500MB），按用户累计占用计费

配置项（`data/plugins.json` 或 `GALLERY_*` / `S3_*` 环境变量）：
- `quota_mb`：每用户配额（MB），默认 `500`
- `storage`：后端类型，`local` | `s3`，默认 `local`

S3 环境变量（`S3_*` 为主，`QINIU_*` 兼容回退，线上旧部署可零改动升级）：
- `S3_ACCESS_KEY` / `S3_SECRET_KEY`（必填，别名 `QINIU_ACCESS_KEY` / `QINIU_SECRET_KEY`）
- `S3_BUCKET`（必填，别名 `QINIU_BUCKET`）
- `S3_ENDPOINT`（必填，如 `https://s3-cn-east-1.qiniucs.com`）
- `S3_REGION`（默认 `us-east-1`）
- `S3_DOMAIN`（可选，公开桶 CDN/直连域名，别名 `QINIU_DOMAIN`）
- `S3_PRIVATE`（可选，`true` 时外链走签名 URL，别名 `QINIU_PRIVATE`）

## 开发状态

- 已注册为内置插件（`/api/plugins` 列表可见），`gallery_images` 表已建
- 上传（local 落盘 / S3 中转）/ 配额 / 外链 / 删除已实现；真实 S3 端到端手动冒烟
