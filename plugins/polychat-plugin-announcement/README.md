# polychat-plugin-announcement

管理员全局公告：`GET/POST/DELETE /api/admin/announcement`。发布/清除时向全体在线用户广播 `announcement` WS 事件，并写入审计日志；内容持久化于 `app_settings`（重启不丢）。
