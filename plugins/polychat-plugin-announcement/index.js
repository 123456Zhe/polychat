export default {
  name: 'announcement',
  version: '1.0.0',
  description: '全局公告：管理员发布/清除面向全体在线用户的公告（持久化于 app_settings）',
  enabledByDefault: true,
  defaultConfig: {},
  setup(ctx) {
    const { registry, db, json, requireUser, requireAdmin, readBody, logAudit, broadcast } = ctx;
    const pathname = '/api/admin/announcement';

    registry.registerApiRoute('GET', pathname, (req, res) => {
      const user = requireUser(req, res); if (!user) return;
      const row = db.prepare("SELECT value FROM app_settings WHERE key = 'global_announcement'").get();
      return json(res, 200, { announcement: row ? JSON.parse(row.value) : null });
    });

    registry.registerApiRoute('POST', pathname, async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      const { content } = await readBody(req);
      const text = String(content || '').trim();
      if (!text) return json(res, 400, { error: '公告内容不能为空' });
      const announcement = { content: text, admin_name: admin.username, created_at: new Date().toISOString() };
      db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES ('global_announcement', ?)").run(JSON.stringify(announcement));
      logAudit(admin.id, 'announcement', null, '发布全局公告');
      broadcast({ type: 'announcement', global: true, ...announcement });
      return json(res, 200, { announcement });
    });

    registry.registerApiRoute('DELETE', pathname, async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      db.prepare("DELETE FROM app_settings WHERE key = 'global_announcement'").run();
      logAudit(admin.id, 'announcement_clear', null, '清除全局公告');
      broadcast({ type: 'announcement', global: true, content: null });
      return json(res, 200, { ok: true });
    });
  }
};
