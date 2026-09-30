import { USERNAME_RE, hashPassword, logAudit, requireAdmin } from '../lib/auth.js';
import { db } from '../lib/db.js';
import { json, readBody } from '../lib/http.js';
import { createNotification, publicUser } from '../lib/users.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { installPluginFromUrl, installPluginFromUpload, uninstallPlugin, setPluginEnabled, listMarketPlugins, installed } from '../modules/plugin-loader.js';

export async function handleAdminRoutes(req, res, url, registry, pluginCtx) {
  if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
    if (!requireAdmin(req, res)) return true;
    const stats = {
      users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
      rooms: db.prepare('SELECT COUNT(*) AS count FROM rooms').get().count,
      messages: db.prepare('SELECT COUNT(*) AS count FROM messages').get().count,
      files: db.prepare('SELECT COUNT(*) AS count FROM attachments').get().count,
    };
    const users = db.prepare(`SELECT users.id, users.username, users.is_admin, users.created_at, users.banned_until, users.muted_until, users.last_ip, users.device_fingerprint,
      (SELECT COUNT(*) FROM messages WHERE messages.user_id = users.id) AS message_count
      FROM users ORDER BY users.id`).all();
    return (json(res, 200, { stats, users }), true);
  }

  // 插件状态可见性：管理员只读查看已加载/已停用插件（配置入口见 data/plugins.json）
  if (req.method === 'GET' && url.pathname === '/api/admin/plugins') {
    if (!requireAdmin(req, res)) return true;
    return (json(res, 200, { plugins: registry.listPlugins() }), true);
  }

  // 插件状态公开查询：Web 端据此禁用未启用插件的 UI（如 onebot 停用 → 机器人管理页）
  if (req.method === 'GET' && url.pathname === '/api/plugins') {
    const plugins = registry.listPlugins().map(({ name, version, description, enabled, source, install_method }) => ({ name, version, description, enabled, source, install_method }));
    return (json(res, 200, { plugins }), true);
  }

  // 插件客户端资产清单：Web 端据此动态加载插件的 CSS/JS
  if (req.method === 'GET' && url.pathname === '/api/plugins/client-assets') {
    return (json(res, 200, { assets: registry.getClientAssets() }), true);
  }

  // 插件客户端文件服务：GET /api/plugins/:name/client/:file
  const pluginClientMatch = url.pathname.match(/^\/api\/plugins\/([A-Za-z0-9_-]+)\/client\/(.+)$/);
  if (pluginClientMatch && req.method === 'GET') {
    const [, pluginName, fileName] = pluginClientMatch;
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '');
    if (safeName !== fileName || !safeName) return (json(res, 400, { error: '无效文件名' }), true);
    const pluginEntry = installed.get(pluginName);
    if (!pluginEntry || !pluginEntry.modulePath) return (json(res, 404, { error: '插件不存在' }), true);
    const filePath = join(pluginEntry.modulePath, 'client', safeName);
    try {
      const content = readFileSync(filePath);
      const ext = safeName.split('.').pop();
      const types = { js: 'application/javascript', css: 'text/css', html: 'text/html', json: 'application/json', png: 'image/png', svg: 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' });
      return (res.end(content), true);
    } catch { return (json(res, 404, { error: '文件不存在' }), true); }
  }

  // 插件市场：GitHub 上的 polychat-plugin-* 仓库（或 PLUGIN_MARKET_REGISTRY 自建源）
  if (req.method === 'GET' && url.pathname === '/api/admin/plugins/market') {
    if (!requireAdmin(req, res)) return true;
    try {
      return (json(res, 200, { plugins: await listMarketPlugins() }), true);
    } catch (error) {
      return (json(res, 502, { error: error.message }), true);
    }
  }

  // 从 URL 安装插件（GitHub 仓库 / 直链 zip）—— 热加载，无需重启
  if (req.method === 'POST' && url.pathname === '/api/admin/plugins/install') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    try {
      const result = await installPluginFromUrl(pluginCtx, registry, await readBody(req));
      logAudit(admin.id, 'install_plugin', null, `安装插件 ${result.name}`);
      return (json(res, 201, result), true);
    } catch (error) {
      return (json(res, 400, { error: error.message }), true);
    }
  }

  // 上传 zip 安装插件（raw body，文件名走查询参数）
  if (req.method === 'POST' && url.pathname === '/api/admin/plugins/install/upload') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (bytes.length > 50 * 1024 * 1024) return (json(res, 413, { error: '插件包过大（上限 50 MB）' }), true);
      const result = await installPluginFromUpload(pluginCtx, registry, bytes, { filename: url.searchParams.get('filename') || '' });
      logAudit(admin.id, 'install_plugin', null, `上传安装插件 ${result.name}`);
      return (json(res, 201, result), true);
    } catch (error) {
      return (json(res, 400, { error: error.message }), true);
    }
  }

  // 卸载外部插件（热卸载；内置插件拒绝）
  const pluginDeleteMatch = url.pathname.match(/^\/api\/admin\/plugins\/([A-Za-z0-9_-]+)$/);
  if (pluginDeleteMatch && req.method === 'DELETE') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    try {
      const body = await readBody(req);
      await uninstallPlugin(pluginCtx, registry, pluginDeleteMatch[1], { delete_config: Boolean(body?.delete_config) });
      logAudit(admin.id, 'uninstall_plugin', null, `卸载插件 ${pluginDeleteMatch[1]}`);
      return (json(res, 200, { ok: true }), true);
    } catch (error) {
      return (json(res, 400, { error: error.message }), true);
    }
  }

  // 启用/停用插件（热生效，无需重启）
  const pluginEnabledMatch = url.pathname.match(/^\/api\/admin\/plugins\/([A-Za-z0-9_-]+)\/enabled$/);
  if (pluginEnabledMatch && req.method === 'PATCH') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    try {
      const body = await readBody(req);
      const result = await setPluginEnabled(pluginCtx, registry, pluginEnabledMatch[1], Boolean(body?.enabled));
      logAudit(admin.id, result.enabled ? 'enable_plugin' : 'disable_plugin', null, `${result.enabled ? '启用' : '停用'}插件 ${pluginEnabledMatch[1]}`);
      return (json(res, 200, result), true);
    } catch (error) {
      return (json(res, 400, { error: error.message }), true);
    }
  }

  const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/admin$/);
  if (adminUserMatch && req.method === 'PUT') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const targetId = Number(adminUserMatch[1]);
    const { is_admin = false } = await readBody(req);
    const target = db.prepare('SELECT id, username, is_admin, avatar_updated_at FROM users WHERE id = ?').get(targetId);
    if (!target) return (json(res, 404, { error: '用户不存在' }), true);
    if (!is_admin && target.is_admin && db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get().count <= 1) {
      return (json(res, 400, { error: '至少需要保留一名管理员' }), true);
    }
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, targetId);
    logAudit(admin.id, is_admin ? 'grant_admin' : 'revoke_admin', targetId);
    return (json(res, 200, { user: publicUser({ ...target, is_admin: Boolean(is_admin) }) }), true);
  }

  const adminBanMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/ban$/);
  if (adminBanMatch && req.method === 'PUT') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const targetId = Number(adminBanMatch[1]);
    const { duration_hours = 24 } = await readBody(req);
    const target = db.prepare('SELECT id, username, is_admin, avatar_updated_at, banned_until FROM users WHERE id = ?').get(targetId);
    if (!target) return (json(res, 404, { error: '用户不存在' }), true);
    if (target.is_admin) return (json(res, 400, { error: '不能封禁管理员' }), true);
    const bannedUntil = Date.now() + Number(duration_hours) * 3600_000;
    db.prepare('UPDATE users SET banned_until = ? WHERE id = ?').run(bannedUntil, targetId);
    registry.service('onebot')?.disconnectUser(targetId);
    logAudit(admin.id, 'ban_user', targetId, `封禁 ${duration_hours} 小时`);
    return (json(res, 200, { user: publicUser({ ...target, banned_until: bannedUntil }) }), true);
  }

  const adminUnbanMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/unban$/);
  if (adminUnbanMatch && req.method === 'PUT') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const targetId = Number(adminUnbanMatch[1]);
    const target = db.prepare('SELECT id, username, is_admin, avatar_updated_at, banned_until FROM users WHERE id = ?').get(targetId);
    if (!target) return (json(res, 404, { error: '用户不存在' }), true);
    db.prepare('UPDATE users SET banned_until = NULL WHERE id = ?').run(targetId);
    logAudit(admin.id, 'unban_user', targetId);
    return (json(res, 200, { user: publicUser({ ...target, banned_until: null }) }), true);
  }

  const adminMuteMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/mute$/);
  if (adminMuteMatch && req.method === 'PUT') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const targetId = Number(adminMuteMatch[1]);
    const { duration_hours = 1 } = await readBody(req);
    const target = db.prepare('SELECT id, username, is_admin, avatar_updated_at, muted_until FROM users WHERE id = ?').get(targetId);
    if (!target) return (json(res, 404, { error: '用户不存在' }), true);
    if (target.is_admin) return (json(res, 400, { error: '不能禁言管理员' }), true);
    const mutedUntil = Date.now() + Number(duration_hours) * 3600_000;
    db.prepare('UPDATE users SET muted_until = ? WHERE id = ?').run(mutedUntil, targetId);
    logAudit(admin.id, 'mute_user', targetId, `禁言 ${duration_hours} 小时`);
    return (json(res, 200, { user: publicUser({ ...target, muted_until: mutedUntil }) }), true);
  }

  const adminUnmuteMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/unmute$/);
  if (adminUnmuteMatch && req.method === 'PUT') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const targetId = Number(adminUnmuteMatch[1]);
    const target = db.prepare('SELECT id, username, is_admin, avatar_updated_at, muted_until FROM users WHERE id = ?').get(targetId);
    if (!target) return (json(res, 404, { error: '用户不存在' }), true);
    db.prepare('UPDATE users SET muted_until = NULL WHERE id = ?').run(targetId);
    logAudit(admin.id, 'unmute_user', targetId);
    return (json(res, 200, { user: publicUser({ ...target, muted_until: null }) }), true);
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/audit-logs') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const logs = db.prepare(`
      SELECT audit_logs.*, admins.username AS admin_name, targets.username AS target_name
      FROM audit_logs
      LEFT JOIN users AS admins ON admins.id = audit_logs.admin_id
      LEFT JOIN users AS targets ON targets.id = audit_logs.target_user_id
      ORDER BY audit_logs.id DESC LIMIT 100
    `).all();
    return (json(res, 200, { logs }), true);
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/banned-ips') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const ips = db.prepare(`SELECT banned_ips.*, admins.username AS admin_name
      FROM banned_ips LEFT JOIN users AS admins ON admins.id = banned_ips.created_by
      ORDER BY banned_ips.created_at DESC`).all();
    return (json(res, 200, { ips }), true);
  }

  if (req.method === 'PUT' && url.pathname === '/api/admin/banned-ips/ban') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const { ip, duration_hours, reason } = await readBody(req);
    if (!ip || typeof ip !== 'string') return (json(res, 400, { error: '需要指定 IP 地址' }), true);
    const bannedUntil = duration_hours ? Date.now() + Number(duration_hours) * 3600_000 : null;
    db.prepare('INSERT OR REPLACE INTO banned_ips(ip_address, banned_until, reason, created_by) VALUES (?, ?, ?, ?)').run(ip, bannedUntil, reason || null, admin.id);
    logAudit(admin.id, 'ban_ip', null, `IP ${ip}${duration_hours ? ` 封禁 ${duration_hours} 小时` : ' 永久封禁'}${reason ? `：${reason}` : ''}`);
    return (json(res, 200, { ok: true }), true);
  }

  if (req.method === 'PUT' && url.pathname === '/api/admin/banned-ips/unban') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const { ip } = await readBody(req);
    if (!ip || typeof ip !== 'string') return (json(res, 400, { error: '需要指定 IP 地址' }), true);
    db.prepare('DELETE FROM banned_ips WHERE ip_address = ?').run(ip);
    logAudit(admin.id, 'unban_ip', null, `IP ${ip} 已解封`);
    return (json(res, 200, { ok: true }), true);
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/banned-fingerprints') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const fps = db.prepare(`SELECT banned_fingerprints.*, admins.username AS admin_name
      FROM banned_fingerprints LEFT JOIN users AS admins ON admins.id = banned_fingerprints.created_by
      ORDER BY banned_fingerprints.created_at DESC`).all();
    return (json(res, 200, { fingerprints: fps }), true);
  }

  if (req.method === 'PUT' && url.pathname === '/api/admin/banned-fingerprints/ban') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const { fingerprint, duration_hours, reason } = await readBody(req);
    if (!fingerprint || typeof fingerprint !== 'string') return (json(res, 400, { error: '需要指定设备指纹' }), true);
    const bannedUntil = duration_hours ? Date.now() + Number(duration_hours) * 3600_000 : null;
    db.prepare('INSERT OR REPLACE INTO banned_fingerprints(fingerprint, banned_until, reason, created_by) VALUES (?, ?, ?, ?)').run(fingerprint, bannedUntil, reason || null, admin.id);
    logAudit(admin.id, 'ban_fingerprint', null, `设备 ${fingerprint.slice(0, 8)}...${bannedUntil ? ` 封禁 ${duration_hours} 小时` : ' 永久封禁'}${reason ? `：${reason}` : ''}`);
    return (json(res, 200, { ok: true }), true);
  }

  if (req.method === 'PUT' && url.pathname === '/api/admin/banned-fingerprints/unban') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const { fingerprint } = await readBody(req);
    if (!fingerprint || typeof fingerprint !== 'string') return (json(res, 400, { error: '需要指定设备指纹' }), true);
    db.prepare('DELETE FROM banned_fingerprints WHERE fingerprint = ?').run(fingerprint);
    logAudit(admin.id, 'unban_fingerprint', null, `设备 ${fingerprint.slice(0, 8)}... 已解封`);
    return (json(res, 200, { ok: true }), true);
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/bot/tokens') {
    if (!requireAdmin(req, res)) return true;
    const tokens = db.prepare(`SELECT bot_tokens.token, bot_tokens.name, bot_tokens.created_at,
      users.id AS user_id, users.username FROM bot_tokens
      JOIN users ON users.id = bot_tokens.user_id ORDER BY bot_tokens.created_at DESC`).all();
    return (json(res, 200, { tokens }), true);
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/bot/tokens') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const { user_id, name = '' } = await readBody(req);
    if (!user_id || typeof user_id !== 'number') return (json(res, 400, { error: '需要指定 user_id' }), true);
    const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(user_id);
    if (!target) return (json(res, 404, { error: '用户不存在' }), true);
    const token = randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO bot_tokens(token, user_id, name) VALUES (?, ?, ?)').run(token, user_id, String(name).trim() || `Bot for ${target.username}`);
    logAudit(admin.id, 'create_bot_token', user_id, `创建 Bot Token: ${name || target.username}`);
    return (json(res, 201, { token: { token, user_id, name: String(name).trim() || `Bot for ${target.username}` } }), true);
  }

  const botTokenDeleteMatch = url.pathname.match(/^\/api\/admin\/bot\/tokens\/([A-Za-z0-9_-]+)$/);
  if (botTokenDeleteMatch && req.method === 'DELETE') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const token = botTokenDeleteMatch[1];
    const row = db.prepare('SELECT user_id FROM bot_tokens WHERE token = ?').get(token);
    if (!row) return (json(res, 404, { error: 'Token 不存在' }), true);
    db.prepare('DELETE FROM bot_tokens WHERE token = ?').run(token);
    registry.service('onebot')?.disconnectUser(row.user_id);
    logAudit(admin.id, 'delete_bot_token', row.user_id);
    return (json(res, 200, { ok: true }), true);
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/bot-requests') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const requests = db.prepare(`SELECT bot_requests.*, users.username FROM bot_requests
      JOIN users ON users.id = bot_requests.user_id ORDER BY bot_requests.created_at DESC`).all();
    return (json(res, 200, { requests }), true);
  }

  const botReqApproveMatch = url.pathname.match(/^\/api\/admin\/bot-requests\/(\d+)$/);
  if (botReqApproveMatch && req.method === 'PUT') {
    const admin = requireAdmin(req, res); if (!admin) return true;
    const { status = 'rejected' } = await readBody(req);
    if (!['approved', 'rejected'].includes(status)) return (json(res, 400, { error: '状态必须为 approved 或 rejected' }), true);
    const reqId = Number(botReqApproveMatch[1]);
    const row = db.prepare('SELECT * FROM bot_requests WHERE id = ?').get(reqId);
    if (!row || row.status !== 'pending') return (json(res, 404, { error: '申请不存在或已处理' }), true);
    if (status === 'approved') {
      if (!USERNAME_RE.test(row.name)) return (json(res, 400, { error: '机器人名称格式无效，请拒绝该旧申请后重新提交' }), true);
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(row.name)) return (json(res, 409, { error: '机器人名称已被使用' }), true);
      const pwd = randomBytes(16).toString('hex');
      const r = db.prepare('INSERT INTO users(username, password_hash) VALUES (?, ?)').run(row.name, hashPassword(pwd));
      const userId = Number(r.lastInsertRowid);
      const token = randomBytes(24).toString('base64url');
      db.prepare('INSERT INTO bot_tokens(token, user_id, name) VALUES (?, ?, ?)').run(token, userId, row.name);
      db.prepare('UPDATE bot_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime(\'now\') WHERE id = ?').run('approved', admin.id, reqId);
      logAudit(admin.id, 'approve_bot', userId, `批准机器人创建: ${row.name}`);
      createNotification(row.user_id, { type: 'bot_approval', title: '机器人审批通过', content: `您的机器人「${row.name}」已通过审批`, data: { bot_request_id: reqId, status: 'approved', token } });
    } else {
      db.prepare('UPDATE bot_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime(\'now\') WHERE id = ?').run('rejected', admin.id, reqId);
      logAudit(admin.id, 'reject_bot', row.user_id, `拒绝机器人创建: ${row.name}`);
      createNotification(row.user_id, { type: 'bot_approval', title: '机器人审批未通过', content: `您的机器人「${row.name}」未通过审批`, data: { bot_request_id: reqId, status: 'rejected' } });
    }
    return (json(res, 200, { ok: true }), true);
  }

  return false;
}
