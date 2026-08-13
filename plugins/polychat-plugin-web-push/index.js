import webpush from 'web-push';

export default {
  name: 'web-push',
  version: '1.0.0',
  description: '离线 Web Push 推送：VAPID 密钥管理 + 订阅注册/注销 + 房间新消息离线通知',
  enabledByDefault: true,
  defaultConfig: {},
  setup(ctx) {
    const { registry, db, json, requireUser, readBody, eventBus } = ctx;

    // VAPID 密钥：环境变量优先，否则持久化到 app_settings（首次自动生成）。
    let vapidPublicKey = process.env.VAPID_PUBLIC_KEY || db.prepare("SELECT value FROM app_settings WHERE key = 'vapid_public_key'").get()?.value;
    let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || db.prepare("SELECT value FROM app_settings WHERE key = 'vapid_private_key'").get()?.value;
    if (!vapidPublicKey || !vapidPrivateKey) {
      const generated = webpush.generateVAPIDKeys();
      vapidPublicKey = generated.publicKey;
      vapidPrivateKey = generated.privateKey;
      db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES ('vapid_public_key', ?)").run(vapidPublicKey);
      db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES ('vapid_private_key', ?)").run(vapidPrivateKey);
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:polychat@example.com', vapidPublicKey, vapidPrivateKey);

    registry.registerApiRoute('GET', '/api/push/vapid-public-key', (req, res) => {
      if (!requireUser(req, res)) return;
      return json(res, 200, { publicKey: vapidPublicKey });
    });

    registry.registerApiRoute('POST', '/api/push/subscriptions', async (req, res) => {
      const user = requireUser(req, res); if (!user) return;
      const { endpoint = '', keys = {} } = await readBody(req, 10_000);
      const target = String(endpoint), p256dh = String(keys.p256dh || ''), auth = String(keys.auth || '');
      if (!/^https:\/\//.test(target) || target.length > 2000 || !p256dh || p256dh.length > 500 || !auth || auth.length > 500) return json(res, 400, { error: '推送订阅格式无效' });
      db.prepare(`INSERT INTO push_subscriptions(endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, updated_at = CURRENT_TIMESTAMP`).run(target, user.id, p256dh, auth);
      return json(res, 200, { ok: true });
    });

    registry.registerApiRoute('DELETE', '/api/push/subscriptions', async (req, res) => {
      const user = requireUser(req, res); if (!user) return;
      const { endpoint = '' } = await readBody(req, 4_000);
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(String(endpoint), user.id);
      return json(res, 200, { ok: true });
    });

    // 房间新消息 → 给该房间订阅过推送的其它成员发离线通知。
    // 订阅 message:sent 事件（核心对所有房间消息发射，含话题回复，与旧 pushMessage 行为一致）。
    eventBus.on('message:sent', ({ roomId, message, sender }) => {
      void pushMessage(roomId, sender.id, message).catch(error => console.error('Web Push failed:', error.message));
    });

    async function pushMessage(roomId, senderId, message) {
      const room = db.prepare('SELECT name, is_private FROM rooms WHERE id = ?').get(roomId);
      if (!room) return;
      const subscriptions = db.prepare(`SELECT push_subscriptions.endpoint, push_subscriptions.p256dh, push_subscriptions.auth
        FROM push_subscriptions JOIN users ON users.id = push_subscriptions.user_id
        LEFT JOIN room_members ON room_members.room_id = ? AND room_members.user_id = users.id
        WHERE users.id != ? AND (? = 0 OR room_members.user_id IS NOT NULL OR users.is_admin = 1)`).all(roomId, senderId, room.is_private);
      const payload = JSON.stringify({
        title: `${message.username} · #${room.name}`,
        body: message.content || (message.attachment_name ? `发送了 ${message.attachment_name}` : '发送了附件'),
        roomId, messageId: message.id, url: `/?room=${roomId}&message=${message.id}`
      });
      await Promise.allSettled(subscriptions.map(async subscription => {
        try {
          await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 3600, urgency: 'high' });
        } catch (error) {
          if ([404, 410].includes(error.statusCode)) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(subscription.endpoint);
          else throw error;
        }
      }));
    }
  }
};
