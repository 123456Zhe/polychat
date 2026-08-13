# polychat-plugin-onebot

OneBot v11 机器人网关（迁移自 `modules/onebot/`）：

- 独立 WebSocket 服务：`ws://HOST:PORT/api/onebot/ws?token=<bot_token>`（也接受 `/api` 路径），Bot 用管理端签发的 token 认证
- 订阅 `message:sent` / `dm:sent`，把群/私信消息转成 OneBot 标准事件推送给在线 Bot；支持读图/附件、发送群/私信
- 核心在封禁用户 / 吊销 token 时经 `registry.service('onebot')?.disconnectUser(userId)` 断开对应 Bot

环境变量：`ONEBOT_REVERSE_URL`、`ONEBOT_BOT_TOKEN`、`ONEBOT_ACCESS_TOKEN`、`PUBLIC_URL`（见 `reverse.js` / `ws.js`）。
