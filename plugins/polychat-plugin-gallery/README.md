# polychat-plugin-gallery

个人图床插件：图片上传 / 配额 / 外链，支持本地与七牛 Kodo 双后端。

- `storage: local`（默认）—— 图片落盘到 `data/uploads/gallery/`，经 `/api/gallery/...` 外链访问
- `storage: qiniu` —— 上传到七牛 Kodo，外链走 CDN 域名
- 每用户配额 `quota_mb`（默认 500MB），按用户累计占用计费

配置项（`data/plugins.json` 或 `GALLERY_*` / `QINIU_*` 环境变量）：
- `quota_mb`：每用户配额（MB），默认 `500`
- `storage`：后端类型，`local` | `qiniu`，默认 `local`

## 开发状态

- Task B1：已注册为内置插件（`/api/plugins` 列表可见），`gallery_images` 表已建
- Task B2-B4：上传（local 落盘）/ 配额、外链、七牛 Kodo 后端（进行中）
