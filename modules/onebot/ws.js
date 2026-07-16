import { WebSocketServer } from 'ws';

export function createOnebotWs({ db, isUserBanned, botSockets, handleAction }) {
  const onebotWsServer = new WebSocketServer({ noServer: true });

  function attach(server) {
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname !== '/api/onebot/ws' && url.pathname !== '/api') return;
      const token = url.searchParams.get('token') || '';
      if (!token) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
      const row = db.prepare('SELECT user_id FROM bot_tokens WHERE token = ?').get(token);
      if (!row) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
      const botUser = db.prepare('SELECT id, username, is_admin, avatar_updated_at, banned_until, muted_until, device_fingerprint FROM users WHERE id = ?').get(row.user_id);
      if (!botUser || isUserBanned(botUser)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
      onebotWsServer.handleUpgrade(req, socket, head, client => {
        client.user = botUser;
        client.isAlive = true;
        botSockets.add(client);
        client.on('pong', () => { client.isAlive = true; });
        client.on('message', raw => {
          try { handleAction(client, JSON.parse(String(raw))); }
          catch { /* ignore malformed messages */ }
        });
        client.on('close', () => { botSockets.delete(client); });
        client.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), self_id: botUser.id, post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'connect' }));
        client.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), self_id: botUser.id, post_type: 'meta_event', meta_event_type: 'heartbeat', status: { online: true }, interval: 30000 }));
      });
    });
  }

  function heartbeat() {
    for (const socket of botSockets) {
      if (!socket.isAlive) { socket.terminate(); botSockets.delete(socket); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }

  return { attach, heartbeat };
}
