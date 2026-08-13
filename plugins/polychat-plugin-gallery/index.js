// 个人图床：本地 / 七牛 Kodo 双后端（GALLERY_* / QINIU_* 环境变量可覆盖）。
export default {
  name: 'gallery',
  version: '1.0.0',
  description: '个人图床：上传/配额/外链，支持本地与七牛 Kodo 双后端',
  enabledByDefault: true,
  defaultConfig: { quota_mb: 500, storage: 'local' },
  setup(ctx) {
    // 路由在 Task B2-B4 添加
  }
};
