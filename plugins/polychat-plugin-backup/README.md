# polychat-plugin-backup

SQLite 自动备份：按间隔 `VACUUM INTO` 快照并轮转保留。

## 配置

`data/plugins.json` → `backup.config`：

- `intervalHours`（默认 24）备份间隔小时数
- `maxBackups`（默认 7）保留备份数量

环境变量覆盖：`BACKUP_ENABLED=false` 关闭、`BACKUP_DIR`、`BACKUP_INTERVAL_HOURS`、`MAX_BACKUPS`。
