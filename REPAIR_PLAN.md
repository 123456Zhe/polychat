# PolyChat 修复计划

本文件用于跨 agent 协作，按优先级记录待办、实施边界和验证要求。

## P0 安全与发布阻断

- [ ] 移除并轮换 Android release keystore；密码改为 CI secret/本地配置，debug/release 分离。
- [ ] 修复 `/api/files/:id` 附件访问控制：仅上传者、可访问房间成员或 DM 成员可下载。
- [ ] Android 默认服务器改为 `https://chat.zhezhe.online`；生产构建禁止任意明文 HTTP。
- [ ] 仅在配置了可信反向代理时解析 `X-Forwarded-For`，避免 IP 限速/封禁绕过。

## P1 私信文件可靠性

- [ ] 保留 1 MiB 分片大小；Android 使用服务端返回的 `chunk_size`。
- [ ] P2P 失败回退分片时显示文件名、上传方式、进度、完成/失败状态。
- [ ] 多文件分别显示状态；失败时保留可重试的文件和正文。
- [ ] 核验 `chat.zhezhe.online` 反向代理允许 Base64 JSON 分片请求（至少 2 MiB）。

## P1 信息泄露

- [ ] 公共健康检查移除数据库绝对路径、统计和备份错误，详细信息移到管理员接口。
- [ ] 公共文件 URL 改为短期签名或受保护下载（需兼容 OneBot）。
- [ ] HTTPS session cookie 增加 `Secure`。

## P2 质量与性能

- [ ] 补附件权限、P2P 回退、上传失败恢复和代理 413 测试。
- [ ] 定期清理过期 session、登录记录、上传 session 和孤儿 `.part` 文件。
- [ ] Web 动态加载 KaTeX/P2P/管理面板；Android release 启用 R8。
- [ ] 逐步拆分 `server.mjs` 的领域路由。

## 当前实施顺序

1. P0 服务端权限/IP/健康检查与 Android HTTPS 默认值。
2. P1 私信分片上传可视化与 Android chunk 协商。
3. 测试、构建和线上反向代理配置核验。

