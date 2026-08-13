# PolyChat 修复计划

本文件供主 agent 和其他 agent 协作使用。已完成项目保留记录，未完成项目按优先级排列。

## 已完成

- [x] `/api/files/:id` 附件访问控制：上传者、管理员、可访问房间成员或 DM 成员可下载。
- [x] Android 默认服务器改为 `https://chat.zhezhe.online`。
- [x] Android 默认禁止明文 HTTP。
- [x] 仅在 `TRUST_PROXY=true` 时解析 `X-Forwarded-For`。
- [x] 公共 `/api/health` 移除数据库路径、用户数、消息数和备份错误。
- [x] HTTPS session cookie 增加 `Secure`。
- [x] 私信服务器分片上传显示文件名、上传方式、百分比和完成状态。
- [x] Android 上传使用服务端返回的 `chunk_size`，默认仍为 1 MiB。

相关提交：`292b0b9`、`26d4a1c`。

## P0 发布安全

- [x] 轮换 Android release keystore；从工作树和 CI 中移除旧私钥。
- [x] release 使用 CI Secret 或本地 `keystore.properties`；debug/release 分离签名。
- [x] 应用默认使用 `chat.zhezhe.online` HTTPS/WSS；公网反向代理需按部署环境核验 HTTPS/WSS 转发和真实客户端 IP 配置。

## P1 私信文件可靠性

- [x] 多文件分别显示上传状态和错误；失败时保留可重试文件、正文和回复目标。
- [x] P2P 失败回退分片时明确提示原因，不静默切换。
- [x] 核验代理允许 Base64 JSON 分片请求，`client_max_body_size` 至少设置为 2 MiB（Caddy `reverse-proxy` 默认不限制请求体）。
- [x] 增加 20 MB、100 MB、代理 413、断点续传和取消上传测试。

## P1 信息泄露与数据生命周期

- [x] 将 OneBot 公共文件 URL 改为短期签名 URL 或受保护下载，并保持机器人兼容。
- [x] 定期清理过期 session、登录/注册尝试、上传 session 和孤儿 `.part` 文件。
- [x] 增加附件权限矩阵测试：公共房间、私有房间、DM、第三方用户、撤回消息；并修复私有房间附件越权下载。

## P2 性能与维护

- [ ] Web 动态加载 KaTeX、P2P 和管理面板，降低约 633 KB 首屏 JS。
- [ ] Android release 启用 R8，补充 Hilt/Retrofit/kotlinx serialization 规则验证。
- [ ] 逐步拆分 `server.mjs` 的认证、上传、房间、DM 和管理路由。
- [ ] 补 P2P 接受/拒绝/超时/ICE 失败及回退路径的自动化测试。

## 验证要求

- 服务端：`npm test`。
- Web：`npm run web:build`。
- 语法：`node --check server.mjs`、`git diff --check`。
- Android：在具备 Android SDK 的环境执行 `./gradlew assembleDebug`/release 构建。
