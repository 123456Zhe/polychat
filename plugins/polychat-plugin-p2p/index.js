import { randomBytes } from 'node:crypto';

// 私信间 WebRTC P2P 大文件直传：文件字节不经过服务器，失败自动回退分片上传。
// 迁移自 server.mjs：辅助函数、路由与 WS p2p_signal 处理原样搬入本插件。
export default {
  name: 'p2p',
  version: '1.0.0',
  description: '私信 P2P 大文件直传：WebRTC 打洞直传 + 分片上传回退（P2P_* / TURN_* 环境变量可覆盖）',
  enabledByDefault: true,
  defaultConfig: {
    minSize: 5 * 1024 * 1024,
    activeLimit: 10,
    ttlMs: 15 * 60 * 1000,
    connectTimeoutMs: 30_000
  },
  setup(ctx) {
    const { registry, db, json, requireUser, readBody, isUserMuted, sendToUser, userOnline, broadcastDm, hydrateMessages, eventBus, maxFileSize, isDmMember, env, pluginConfig } = ctx;

    const P2P_MIN_SIZE = Number(env.P2P_MIN_SIZE || pluginConfig.minSize);
    const P2P_ACTIVE_LIMIT = Number(pluginConfig.activeLimit);
    const P2P_TTL_MS = Number(pluginConfig.ttlMs);
    const P2P_CONNECT_TIMEOUT_MS = Number(pluginConfig.connectTimeoutMs);
    const TURN_URL = env.TURN_URL || '';
    const TURN_USERNAME = env.TURN_USERNAME || '';
    const TURN_CREDENTIAL = env.TURN_CREDENTIAL || '';

    // ── 辅助函数（迁移自 server.mjs:661-698）──
    function p2pTransfer(id) {
      return db.prepare('SELECT * FROM p2p_transfers WHERE id = ?').get(id);
    }
    function dmPeerOf(conversationId, userId) {
      return db.prepare('SELECT user_id FROM dm_members WHERE conversation_id = ? AND user_id != ?').get(conversationId, userId)?.user_id || null;
    }
    function expireStaleTransfers() {
      db.prepare(`UPDATE p2p_transfers SET status = 'expired', updated_at = CURRENT_TIMESTAMP
        WHERE status IN ('pending', 'accepted') AND (julianday('now') - julianday(created_at)) * 86400000 > ?`).run(P2P_TTL_MS);
    }
    function p2pIceServers() {
      const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
      if (TURN_URL) {
        const turn = { urls: TURN_URL };
        if (TURN_USERNAME) turn.username = TURN_USERNAME;
        if (TURN_CREDENTIAL) turn.credential = TURN_CREDENTIAL;
        servers.push(turn);
      }
      return servers;
    }
    function publicP2p(transfer, peerOnline = false) {
      return {
        id: transfer.id,
        conversation_id: transfer.conversation_id,
        sender_id: transfer.sender_id,
        receiver_id: transfer.receiver_id,
        name: transfer.name,
        type: transfer.mime_type,
        size: transfer.size,
        status: transfer.status,
        sha256: transfer.sha256 || null,
        created_at: transfer.created_at,
        peer_online: peerOnline
      };
    }

    // 与核心 api() 内的 dmMessageColumns 保持一致的列投影（含 p2p 字段）。
    const dmMessageColumns = `messages.id, messages.content, messages.created_at, messages.reply_to, messages.thread_root, messages.edited_at, messages.deleted_at,
      users.id AS user_id, users.username, users.avatar_updated_at, parent.content AS reply_content, parent_user.username AS reply_username, attachments.id AS attachment_id,
      attachments.original_name AS attachment_name, attachments.mime_type AS attachment_type, attachments.size AS attachment_size, attachments.stored_name AS attachment_stored_name,
      p2p_transfers.id AS p2p_transfer_id, p2p_transfers.sender_id AS p2p_sender_id, p2p_transfers.receiver_id AS p2p_receiver_id,
      p2p_transfers.name AS p2p_name, p2p_transfers.mime_type AS p2p_type, p2p_transfers.size AS p2p_size,
      p2p_transfers.sha256 AS p2p_sha256, p2p_transfers.status AS p2p_status`;

    // ── HTTP 路由（迁移自 server.mjs:1650-1732）──
    registry.registerApiRoute('GET', '/api/p2p/config', (req, res) => {
      const user = requireUser(req, res); if (!user) return;
      return json(res, 200, { ice_servers: p2pIceServers(), min_size: P2P_MIN_SIZE, connect_timeout_ms: P2P_CONNECT_TIMEOUT_MS });
    });

    registry.registerApiRoute('POST', '/api/p2p/transfers', async (req, res) => {
      const user = requireUser(req, res); if (!user) return;
      expireStaleTransfers();
      if (isUserMuted(user)) return json(res, 403, { error: '你已被禁言，无法发送文件', muted_until: user.muted_until });
      const { conversation_id, name = '', type = '', size = 0, content = '', reply_to = null } = await readBody(req);
      const convId = Number(conversation_id);
      if (!convId || !isDmMember(convId, user.id)) return json(res, 403, { error: '无权访问该会话' });
      const cleanName = String(name).trim().replace(/[\r\n]/g, '').slice(0, 255);
      if (!cleanName) return json(res, 400, { error: '文件名不能为空' });
      const fileSize = Number(size);
      if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > maxFileSize) return json(res, 400, { error: `文件大小需在 1 字节到 ${maxFileSize} 字节之间` });
      const receiverId = dmPeerOf(convId, user.id);
      if (!receiverId) return json(res, 400, { error: '会话中没有其他成员' });
      const mime = String(type).match(/^[\w.+-]+\/[\w.+-]+$/) ? String(type) : 'application/octet-stream';
      const text = String(content).trim().slice(0, 10_000);
      const replyId = reply_to == null ? null : Number(reply_to);
      if (replyId && !db.prepare('SELECT id FROM messages WHERE id = ? AND dm_id = ?').get(replyId, convId)) return json(res, 400, { error: '回复目标不存在或不在当前会话' });
      const activeCount = db.prepare("SELECT COUNT(*) AS count FROM p2p_transfers WHERE (sender_id = ? OR receiver_id = ?) AND status IN ('pending', 'accepted')").get(user.id, user.id).count;
      if (activeCount >= P2P_ACTIVE_LIMIT) return json(res, 429, { error: '进行中的直传过多，请稍后再试' });
      const id = randomBytes(24).toString('base64url');
      db.prepare('INSERT INTO p2p_transfers(id, conversation_id, sender_id, receiver_id, name, mime_type, size, content, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, convId, user.id, receiverId, cleanName, mime, fileSize, text, replyId);
      const transfer = p2pTransfer(id);
      const peerOnline = userOnline(receiverId);
      sendToUser(receiverId, { type: 'p2p_invite', transfer: publicP2p(transfer), sender_username: user.username });
      return json(res, 201, { transfer: publicP2p(transfer, peerOnline) });
    });

    const transferMatch = /^\/api\/p2p\/transfers\/([A-Za-z0-9_-]+)$/;
    registry.registerApiRoute('GET', transferMatch, (req, res, url) => {
      const user = requireUser(req, res); if (!user) return;
      const transfer = p2pTransfer(url.pathname.match(transferMatch)[1]);
      if (!transfer || !isDmMember(transfer.conversation_id, user.id)) return json(res, 404, { error: '直传不存在' });
      const peerId = user.id === transfer.sender_id ? transfer.receiver_id : transfer.sender_id;
      return json(res, 200, { transfer: publicP2p(transfer, userOnline(peerId)) });
    });

    const actionMatch = /^\/api\/p2p\/transfers\/([A-Za-z0-9_-]+)\/(accept|reject|cancel|complete|fail)$/;
    registry.registerApiRoute('POST', actionMatch, async (req, res, url) => {
      const user = requireUser(req, res); if (!user) return;
      expireStaleTransfers();
      const match = url.pathname.match(actionMatch);
      const transfer = p2pTransfer(match[1]);
      const action = match[2];
      if (!transfer || !isDmMember(transfer.conversation_id, user.id)) return json(res, 404, { error: '直传不存在' });
      const isSender = user.id === transfer.sender_id;
      const isReceiver = user.id === transfer.receiver_id;
      if (action === 'accept' || action === 'reject') {
        if (!isReceiver) return json(res, 403, { error: '只有接收者可以处理直传请求' });
        if (transfer.status !== 'pending') return json(res, 409, { error: '直传状态不允许该操作' });
        const newStatus = action === 'accept' ? 'accepted' : 'rejected';
        db.prepare('UPDATE p2p_transfers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStatus, transfer.id);
        sendToUser(transfer.sender_id, { type: action === 'accept' ? 'p2p_accepted' : 'p2p_rejected', transfer_id: transfer.id });
        return json(res, 200, { transfer: publicP2p(p2pTransfer(transfer.id)) });
      }
      if (action === 'cancel') {
        if (transfer.status !== 'pending' && transfer.status !== 'accepted') return json(res, 409, { error: '直传已结束，无法取消' });
        db.prepare("UPDATE p2p_transfers SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(transfer.id);
        sendToUser(isSender ? transfer.receiver_id : transfer.sender_id, { type: 'p2p_canceled', transfer_id: transfer.id });
        return json(res, 200, { transfer: publicP2p(p2pTransfer(transfer.id)) });
      }
      if (action === 'complete' || action === 'fail') {
        if (transfer.status !== 'accepted') return json(res, 409, { error: '直传状态不允许该操作' });
        const { sha256 = null } = await readBody(req);
        const digest = typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null;
        const newStatus = action === 'complete' ? 'completed' : 'failed';
        db.prepare('UPDATE p2p_transfers SET status = ?, sha256 = COALESCE(?, sha256), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStatus, digest, transfer.id);
        if (action === 'fail') return json(res, 200, { transfer: publicP2p(p2pTransfer(transfer.id)) });
        const result = db.prepare('INSERT INTO messages(dm_id, user_id, content, p2p_transfer_id, reply_to) VALUES (?, ?, ?, ?, ?)').run(transfer.conversation_id, transfer.sender_id, transfer.content, transfer.id, transfer.reply_to);
        const message = db.prepare(`SELECT ${dmMessageColumns} FROM messages JOIN users ON users.id = messages.user_id
          LEFT JOIN messages AS parent ON parent.id = messages.reply_to LEFT JOIN users AS parent_user ON parent_user.id = parent.user_id
          LEFT JOIN attachments ON attachments.id = messages.attachment_id LEFT JOIN p2p_transfers ON p2p_transfers.id = messages.p2p_transfer_id
          WHERE messages.id = ?`).get(result.lastInsertRowid);
        const hydrated = hydrateMessages([message], user.id)[0];
        broadcastDm(transfer.conversation_id, { type: 'dm_message', conversation_id: transfer.conversation_id, message: hydrated });
        eventBus.emit('dm:sent', { conversationId: transfer.conversation_id, message: hydrated, sender: user });
        return json(res, 201, { transfer: publicP2p(p2pTransfer(transfer.id)), message: hydrated });
      }
    });

    // ── WS 消息处理（迁移自 server.mjs:2051-2059）──
    registry.registerWsMessage('p2p_signal', (client, event) => {
      expireStaleTransfers();
      const transfer = p2pTransfer(String(event.transfer_id || ''));
      if (!transfer || transfer.status !== 'accepted') return;
      const targetId = Number(event.to_user_id);
      if (targetId !== transfer.sender_id && targetId !== transfer.receiver_id) return;
      if (client.user.id !== transfer.sender_id && client.user.id !== transfer.receiver_id) return;
      sendToUser(targetId, { type: 'p2p_signal', transfer_id: transfer.id, from_user_id: client.user.id, data: event.data });
    });

    // 过期直传的定时清理（每小时随核心 cleanupExpiredData 一并执行）。
    registry.registerCleanup(expireStaleTransfers);
  }
};
