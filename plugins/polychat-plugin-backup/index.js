import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

export default {
  name: 'backup',
  version: '1.0.0',
  description: 'SQLite 自动备份：按间隔 VACUUM INTO 快照并轮转保留（BACKUP_* / MAX_BACKUPS 环境变量可覆盖）',
  enabledByDefault: true,
  defaultConfig: { intervalHours: 24, maxBackups: 7 },
  setup(ctx) {
    const { db, env, dbPath, pluginConfig } = ctx;
    if (env.BACKUP_ENABLED === 'false') return; // 插件级开关，与旧行为一致
    const backupDir = env.BACKUP_DIR || join(dirname(dbPath), 'backups');
    const intervalHours = Number(env.BACKUP_INTERVAL_HOURS || pluginConfig.intervalHours);
    const maxBackups = Number(env.MAX_BACKUPS || pluginConfig.maxBackups);
    mkdirSync(backupDir, { recursive: true });

    function performBackup() {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = join(backupDir, `polychat-${timestamp}.db`);
        db.exec(`VACUUM INTO '${backupPath}'`);
        const backupFiles = readdirSync(backupDir).filter(f => f.endsWith('.db')).sort();
        while (backupFiles.length > maxBackups) {
          unlinkSync(join(backupDir, backupFiles.shift()));
        }
      } catch (error) {
        console.error('Backup failed:', error.message);
      }
    }

    performBackup();
    const timer = setInterval(performBackup, intervalHours * 3600_000);
    timer.unref();
    // 停用/卸载时清理定时器。
    return () => clearInterval(timer);
  }
};
