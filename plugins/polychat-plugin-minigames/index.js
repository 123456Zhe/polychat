export default {
  name: 'minigames',
  version: '1.0.0',
  description: '联机小游戏：五子棋双人对战、数字炸弹房间派对（前端经 registerClientAssets 注入）',
  enabledByDefault: true,
  defaultConfig: { leaderboardLimit: 20, inviteTtlSec: 300, bombTtlSec: 7200 },
  setup(ctx) {
    const { registry, json, requireUser, readBody, db, pluginConfig,
      sendToUser, broadcast, createNotification, roomForUser } = ctx;

    const BOARD = 15;
    const GAMES = ['gomoku', 'bomb'];
    const GAME_NAMES = { gomoku: '五子棋', bomb: '数字炸弹' };
    const inviteTtlMs = (pluginConfig.inviteTtlSec || 300) * 1000;
    const bombTtlMs = (pluginConfig.bombTtlSec || 7200) * 1000;

    // ── 内存对局（单进程；重启后进行中的对局作废，排行榜持久化在 minigame_scores）──
    let nextGomokuId = 1;
    const gomokuGames = new Map(); // id -> game
    const bombGames = new Map();   // roomId -> game

    function recordWin(game, userId) {
      db.prepare(
        `INSERT INTO minigame_scores(game, user_id, score, updated_at)
         VALUES(?, ?, 1, datetime('now'))
         ON CONFLICT(game, user_id) DO UPDATE SET score = score + 1, updated_at = datetime('now')`
      ).run(game, userId);
    }

    function publicGomoku(g) {
      return {
        id: g.id, game: 'gomoku', status: g.status,
        black: { id: g.blackId, username: g.blackName },
        white: { id: g.whiteId, username: g.whiteName },
        turn: g.turn, board: Array.from(g.board), moves: g.moves,
        winnerId: g.winnerId, draw: !!g.draw,
        createdAt: g.createdAt, updatedAt: g.updatedAt,
      };
    }
    function gomokuRole(g, userId) {
      if (userId === g.blackId) return 1;
      if (userId === g.whiteId) return 2;
      return 0;
    }
    function checkWin(board, x, y, color) {
      const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
      for (const [dx, dy] of dirs) {
        let count = 1;
        for (const s of [1, -1]) {
          let nx = x + dx * s, ny = y + dy * s;
          while (nx >= 0 && nx < BOARD && ny >= 0 && ny < BOARD && board[ny * BOARD + nx] === color) {
            count++; nx += dx * s; ny += dy * s;
          }
        }
        if (count >= 5) return true;
      }
      return false;
    }
    function notifyGomoku(g) {
      const pub = publicGomoku(g);
      sendToUser(g.blackId, { type: 'gomoku_update', game: pub });
      sendToUser(g.whiteId, { type: 'gomoku_update', game: pub });
    }

    registry.registerClientAssets({ css: ['minigames.css'], js: ['minigames.js'] });

    // ── 五子棋：发起邀请 ──
    registry.registerApiRoute('POST', '/api/minigames/gomoku/invite', async (req, res) => {
      const me = requireUser(req, res); if (!me) return;
      let body; try { body = await readBody(req); } catch { return json(res, 400, { error: '请求体非法' }); }
      const username = String(body?.username || '').trim();
      if (!username) return json(res, 400, { error: '请输入对方用户名' });
      const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
      if (!target) return json(res, 404, { error: '用户不存在' });
      if (target.id === me.id) return json(res, 400, { error: '不能邀请自己' });
      for (const g of gomokuGames.values()) {
        if (g.status !== 'finished' &&
            ((g.blackId === me.id && g.whiteId === target.id) || (g.blackId === target.id && g.whiteId === me.id))) {
          return json(res, 400, { error: '你们已有一局进行中' });
        }
      }
      const now = Date.now();
      const g = {
        id: nextGomokuId++, blackId: me.id, blackName: me.username,
        whiteId: target.id, whiteName: target.username,
        board: new Int8Array(BOARD * BOARD), turn: 1, moves: 0,
        status: 'pending', winnerId: null, draw: false,
        createdAt: now, updatedAt: now,
      };
      gomokuGames.set(g.id, g);
      createNotification(target.id, {
        type: 'minigame', title: '五子棋对战邀请',
        content: `${me.username} 邀请你来一局五子棋（${inviteTtlMs / 60000} 分钟内有效）`,
        data: { game: 'gomoku', gameId: g.id },
      });
      sendToUser(target.id, { type: 'gomoku_invite', game: publicGomoku(g) });
      return json(res, 200, { game: publicGomoku(g) });
    });

    // ── 五子棋：我的待处理邀请 ──
    registry.registerApiRoute('GET', '/api/minigames/invites', (req, res) => {
      const me = requireUser(req, res); if (!me) return;
      const now = Date.now();
      const invites = [];
      for (const g of gomokuGames.values()) {
        if (g.status === 'pending' && g.whiteId === me.id && now - g.createdAt < inviteTtlMs) {
          invites.push(publicGomoku(g));
        }
      }
      return json(res, 200, { invites });
    });

    // ── 五子棋：接受 / 拒绝 ──
    registry.registerApiRoute('POST', '/api/minigames/gomoku/respond', async (req, res) => {
      const me = requireUser(req, res); if (!me) return;
      let body; try { body = await readBody(req); } catch { return json(res, 400, { error: '请求体非法' }); }
      const g = gomokuGames.get(Number(body?.gameId));
      if (!g || g.status !== 'pending' || g.whiteId !== me.id) return json(res, 404, { error: '邀请不存在或已过期' });
      if (body?.accept) {
        g.status = 'active'; g.updatedAt = Date.now();
        sendToUser(g.blackId, { type: 'gomoku_update', game: publicGomoku(g) });
        return json(res, 200, { game: publicGomoku(g) });
      }
      gomokuGames.delete(g.id);
      sendToUser(g.blackId, { type: 'gomoku_declined', gameId: g.id, by: me.username });
      return json(res, 200, { ok: true });
    });

    // ── 五子棋：落子（服务端权威判定） ──
    registry.registerApiRoute('POST', '/api/minigames/gomoku/move', async (req, res) => {
      const me = requireUser(req, res); if (!me) return;
      let body; try { body = await readBody(req); } catch { return json(res, 400, { error: '请求体非法' }); }
      const g = gomokuGames.get(Number(body?.gameId));
      if (!g || g.status !== 'active') return json(res, 404, { error: '对局不存在或已结束' });
      const color = gomokuRole(g, me.id);
      if (!color) return json(res, 403, { error: '你不是对局成员' });
      if (g.turn !== color) return json(res, 400, { error: '还没轮到你' });
      const x = Number(body?.x), y = Number(body?.y);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= BOARD || y < 0 || y >= BOARD) {
        return json(res, 400, { error: '坐标非法' });
      }
      if (g.board[y * BOARD + x] !== 0) return json(res, 400, { error: '这里已经有棋子了' });
      g.board[y * BOARD + x] = color;
      g.moves++;
      g.updatedAt = Date.now();
      if (checkWin(g.board, x, y, color)) {
        g.status = 'finished'; g.winnerId = me.id;
        recordWin('gomoku', me.id);
      } else if (g.moves >= BOARD * BOARD) {
        g.status = 'finished'; g.draw = true;
      } else {
        g.turn = color === 1 ? 2 : 1;
      }
      notifyGomoku(g);
      return json(res, 200, { game: publicGomoku(g) });
    });

    // ── 五子棋：认输 ──
    registry.registerApiRoute('POST', '/api/minigames/gomoku/giveup', async (req, res) => {
      const me = requireUser(req, res); if (!me) return;
      let body; try { body = await readBody(req); } catch { return json(res, 400, { error: '请求体非法' }); }
      const g = gomokuGames.get(Number(body?.gameId));
      if (!g || g.status !== 'active') return json(res, 404, { error: '对局不存在或已结束' });
      if (!gomokuRole(g, me.id)) return json(res, 403, { error: '你不是对局成员' });
      g.status = 'finished';
      g.winnerId = me.id === g.blackId ? g.whiteId : g.blackId;
      g.updatedAt = Date.now();
      recordWin('gomoku', g.winnerId);
      notifyGomoku(g);
      return json(res, 200, { game: publicGomoku(g) });
    });

    // ── 五子棋：查对局 / 我的对局 ──
    registry.registerApiRoute('GET', '/api/minigames/gomoku/state', (req, res, url) => {
      const me = requireUser(req, res); if (!me) return;
      const g = gomokuGames.get(Number(url.searchParams.get('gameId')));
      if (!g || !gomokuRole(g, me.id)) return json(res, 404, { error: '对局不存在' });
      return json(res, 200, { game: publicGomoku(g) });
    });
    registry.registerApiRoute('GET', '/api/minigames/gomoku/my-games', (req, res) => {
      const me = requireUser(req, res); if (!me) return;
      const list = [];
      for (const g of gomokuGames.values()) {
        if (gomokuRole(g, me.id) && (g.status !== 'finished' || Date.now() - g.updatedAt < 86400000)) {
          list.push(publicGomoku(g));
        }
      }
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      return json(res, 200, { games: list.slice(0, 10) });
    });

    // ── 数字炸弹：开局（房间派对） ──
    function checkRoomAccess(user, roomId) {
      const room = roomForUser(roomId, user.id);
      if (!room) return { error: '聊天室不存在', status: 404 };
      if (room.is_private && !room.role && !user.is_admin) return { error: '这是私有聊天室', status: 403 };
      return { room };
    }
    function publicBomb(b) {
      return {
        game: 'bomb', roomId: b.roomId, roomName: b.roomName, status: b.status,
        low: b.low, high: b.high, answer: b.status === 'finished' ? b.answer : undefined,
        starter: { id: b.starterId, username: b.starterName },
        participants: Object.entries(b.participants).map(([id, username]) => ({ id: Number(id), username })),
        guesses: b.guesses, loserId: b.loserId, createdAt: b.createdAt,
      };
    }

    registry.registerApiRoute('POST', '/api/minigames/bomb/start', async (req, res) => {
      const me = requireUser(req, res); if (!me) return;
      let body; try { body = await readBody(req); } catch { return json(res, 400, { error: '请求体非法' }); }
      const roomId = Number(body?.roomId);
      const { room, error, status } = checkRoomAccess(me, roomId);
      if (error) return json(res, status, { error });
      const existing = bombGames.get(roomId);
      if (existing && existing.status === 'active') return json(res, 400, { error: '本房间已有一局进行中' });
      const b = {
        roomId, roomName: room.name, answer: 1 + Math.floor(Math.random() * 100),
        low: 0, high: 101, starterId: me.id, starterName: me.username,
        participants: {}, guesses: [], status: 'active', loserId: null, createdAt: Date.now(),
      };
      bombGames.set(roomId, b);
      broadcast({ type: 'bomb_update', roomId, game: publicBomb(b) }, roomId);
      return json(res, 200, { game: publicBomb(b) });
    });

    registry.registerApiRoute('POST', '/api/minigames/bomb/guess', async (req, res) => {
      const me = requireUser(req, res); if (!me) return;
      let body; try { body = await readBody(req); } catch { return json(res, 400, { error: '请求体非法' }); }
      const roomId = Number(body?.roomId);
      const { error, status } = checkRoomAccess(me, roomId);
      if (error) return json(res, status, { error });
      const b = bombGames.get(roomId);
      if (!b || b.status !== 'active') return json(res, 404, { error: '本房间没有进行中的炸弹' });
      const n = Number(body?.number);
      if (!Number.isInteger(n) || n <= b.low || n >= b.high) {
        return json(res, 400, { error: `猜一个 ${b.low} ~ ${b.high} 之间的整数（不含端点）` });
      }
      b.participants[me.id] = me.username;
      if (n === b.answer) {
        b.status = 'finished'; b.loserId = me.id;
        b.guesses.push({ userId: me.id, username: me.username, n, boom: true });
        for (const pid of Object.keys(b.participants)) {
          if (Number(pid) !== me.id) recordWin('bomb', Number(pid));
        }
      } else {
        if (n < b.answer) b.low = n; else b.high = n;
        b.guesses.push({ userId: me.id, username: me.username, n, boom: false });
      }
      broadcast({ type: 'bomb_update', roomId, game: publicBomb(b) }, roomId);
      return json(res, 200, { game: publicBomb(b), boom: n === b.answer });
    });

    registry.registerApiRoute('GET', '/api/minigames/bomb/state', (req, res, url) => {
      const me = requireUser(req, res); if (!me) return;
      const roomId = Number(url.searchParams.get('roomId'));
      const { error, status } = checkRoomAccess(me, roomId);
      if (error) return json(res, status, { error });
      const b = bombGames.get(roomId);
      return json(res, 200, { game: b && b.status === 'active' ? publicBomb(b) : null });
    });

    // ── 排行榜（公开；五子棋/炸弹记胜场） ──
    registry.registerApiRoute('GET', '/api/minigames/leaderboard', (req, res, url) => {
      const game = url.searchParams.get('game');
      if (!GAMES.includes(game)) return json(res, 400, { error: '未知游戏' });
      const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || pluginConfig.leaderboardLimit, 10) || 20));
      const rows = db.prepare(
        `SELECT s.score, s.updated_at, u.username
         FROM minigame_scores s JOIN users u ON u.id = s.user_id
         WHERE s.game = ? ORDER BY s.score DESC LIMIT ?`
      ).all(game, limit);
      return json(res, 200, { game, name: GAME_NAMES[game], unit: '胜场', leaderboard: rows });
    });

    // ── 定期清理：过期邀请 / 结束超 24h 的棋局 / 过期炸弹 ──
    registry.registerCleanup(() => {
      const now = Date.now();
      for (const [id, g] of gomokuGames) {
        if ((g.status === 'pending' && now - g.createdAt > inviteTtlMs) ||
            (g.status === 'finished' && now - g.updatedAt > 86400000)) {
          gomokuGames.delete(id);
        }
      }
      for (const [roomId, b] of bombGames) {
        if (now - b.createdAt > bombTtlMs) bombGames.delete(roomId);
      }
    });
  }
};
