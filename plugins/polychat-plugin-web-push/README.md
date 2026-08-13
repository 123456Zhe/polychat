# polychat-plugin-web-push

离线 Web Push 推送通知：

- VAPID 密钥管理（env `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`，缺省自动生成并持久化到 `app_settings`）
- 订阅路由：`GET /api/push/vapid-public-key`、`POST/DELETE /api/push/subscriptions`
- 订阅 `message:sent` 事件，房间新消息时给其他成员推送系统通知（含话题回复，与旧行为一致）
