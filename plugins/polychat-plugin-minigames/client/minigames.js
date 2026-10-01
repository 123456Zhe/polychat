// polychat-plugin-minigames client: 联机小游戏（五子棋 / 数字炸弹）
// 原生 JS，经 registerClientAssets 注入；不依赖 Vue，用悬浮按钮 + 弹窗承载全部 UI。
(function () {
  'use strict';

  var BOARD_N = 15;
  var viewGameId = null;      // 正在观看的五子棋对局
  var pollTimer = null;
  var inviteTimer = null;
  var loggedOut = false;

  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {})).then(function (r) {
      if (r.status === 401) { loggedOut = true; throw new Error('unauth'); }
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body.error || ('请求失败 ' + r.status));
        return body;
      });
    });
  }
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function toast(msg) {
    var t = h('div', 'mg-toast', msg);
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 2200);
  }

  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  onReady(function () { setTimeout(init, 800); });

  function init() {
    if (document.getElementById('mg-float-btn')) return;
    var btn = h('button', '', '🎮');
    btn.id = 'mg-float-btn';
    btn.title = '小游戏';
    btn.onclick = function () { openModal('gomoku'); };
    document.body.appendChild(btn);
    pollInvites();
    inviteTimer = setInterval(pollInvites, 10000);
  }

  function pollInvites() {
    if (loggedOut) { clearInterval(inviteTimer); return; }
    api('/api/minigames/invites').then(function (d) {
      var btn = document.getElementById('mg-float-btn');
      if (!btn) return;
      var badge = document.getElementById('mg-invite-badge');
      if (d.invites && d.invites.length) {
        if (!badge) {
          badge = h('span', '', String(d.invites.length));
          badge.id = 'mg-invite-badge';
          btn.appendChild(badge);
        } else badge.textContent = String(d.invites.length);
        btn.classList.add('has-invite');
      } else if (badge) { badge.remove(); btn.classList.remove('has-invite'); }
    }).catch(function () {});
  }

  // ── 弹窗框架 ──
  var overlay = null, bodyEl = null, tabBtns = {};
  function openModal(tab) {
    closeModal();
    overlay = h('div'); overlay.id = 'mg-overlay';
    var modal = h('div'); modal.id = 'mg-modal';
    var tabs = h('div'); tabs.id = 'mg-tabs';
    [['gomoku', '五子棋'], ['bomb', '数字炸弹'], ['rank', '排行榜']].forEach(function (t) {
      var b = h('button', 'mg-tab', t[1]);
      b.onclick = function () { switchTab(t[0]); };
      tabBtns[t[0]] = b; tabs.appendChild(b);
    });
    var x = h('button', 'mg-tab mg-close', '✕');
    x.onclick = closeModal; tabs.appendChild(x);
    bodyEl = h('div'); bodyEl.id = 'mg-body';
    modal.appendChild(tabs); modal.appendChild(bodyEl);
    overlay.appendChild(modal);
    overlay.onclick = function (e) { if (e.target === overlay) closeModal(); };
    document.body.appendChild(overlay);
    switchTab(tab || 'gomoku');
  }
  function closeModal() {
    stopPoll();
    viewGameId = null;
    if (overlay) { overlay.remove(); overlay = null; }
    pollInvites();
  }
  function switchTab(tab) {
    stopPoll();
    Object.keys(tabBtns).forEach(function (k) { tabBtns[k].classList.toggle('active', k === tab); });
    bodyEl.innerHTML = '';
    if (tab === 'gomoku') renderGomokuTab();
    else if (tab === 'bomb') renderBombTab();
    else renderRankTab();
  }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // ── 五子棋 ──
  function renderGomokuTab() {
    var wrap = h('div');

    // 发起邀请
    var inv = h('div', 'mg-card');
    inv.appendChild(h('div', 'mg-card-title', '发起对战'));
    var row = h('div', 'mg-row');
    var input = h('input', 'mg-input'); input.placeholder = '对方用户名';
    var btn = h('button', 'mg-btn', '邀请');
    btn.onclick = function () {
      var name = input.value.trim();
      if (!name) return toast('请输入用户名');
      api('/api/minigames/gomoku/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name }) })
        .then(function (d) { toast('邀请已发送，等待对方接受'); input.value = ''; viewGameId = d.game.id; renderBoardView(wrap, d.game); })
        .catch(function (e) { toast(e.message); });
    };
    row.appendChild(input); row.appendChild(btn); inv.appendChild(row); wrap.appendChild(inv);

    // 收到的邀请
    var invBox = h('div', 'mg-card');
    invBox.appendChild(h('div', 'mg-card-title', '收到的邀请'));
    var invList = h('div'); invBox.appendChild(invList); wrap.appendChild(invBox);
    api('/api/minigames/invites').then(function (d) {
      if (!d.invites.length) { invList.appendChild(h('div', 'mg-muted', '暂无')); return; }
      d.invites.forEach(function (g) {
        var r = h('div', 'mg-row');
        r.appendChild(h('span', '', g.black.username + ' 邀请你来一局'));
        var ok = h('button', 'mg-btn', '接受');
        ok.onclick = function () { respondInvite(g.id, true, wrap); };
        var no = h('button', 'mg-btn mg-btn-ghost', '拒绝');
        no.onclick = function () { respondInvite(g.id, false, wrap); };
        r.appendChild(ok); r.appendChild(no); invList.appendChild(r);
      });
    }).catch(function () {});

    // 我的对局
    var myBox = h('div', 'mg-card');
    myBox.appendChild(h('div', 'mg-card-title', '我的对局'));
    var myList = h('div'); myBox.appendChild(myList); wrap.appendChild(myBox);
    api('/api/minigames/gomoku/my-games').then(function (d) {
      if (!d.games.length) { myList.appendChild(h('div', 'mg-muted', '暂无对局，去邀请一位朋友吧')); return; }
      d.games.forEach(function (g) {
        var r = h('div', 'mg-row mg-clickable');
        var vs = g.black.username + ' ⚫ vs ⚪ ' + g.white.username;
        var st = g.status === 'pending' ? '（等待接受）' : g.status === 'finished' ? (g.draw ? '（和棋）' : '（已结束）') : '（进行中）';
        r.appendChild(h('span', '', vs + st));
        r.onclick = function () { viewGameId = g.id; renderBoardView(wrap, g); };
        myList.appendChild(r);
      });
    }).catch(function () {});

    bodyEl.appendChild(wrap);
  }

  function respondInvite(gameId, accept, wrap) {
    api('/api/minigames/gomoku/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: gameId, accept: accept }) })
      .then(function (d) {
        if (accept) { viewGameId = gameId; renderBoardView(wrap, d.game); }
        else { toast('已拒绝'); switchTab('gomoku'); }
      }).catch(function (e) { toast(e.message); });
  }

  function renderBoardView(wrap, game) {
    wrap.innerHTML = '';
    var back = h('button', 'mg-btn mg-btn-ghost', '← 返回列表');
    back.onclick = function () { viewGameId = null; switchTab('gomoku'); };
    wrap.appendChild(back);

    var info = h('div', 'mg-card-title mg-center');
    wrap.appendChild(info);

    var canvas = document.createElement('canvas');
    var cell = 28, pad = 20, size = pad * 2 + cell * (BOARD_N - 1);
    canvas.width = size; canvas.height = size;
    canvas.id = 'mg-board';
    wrap.appendChild(canvas);

    var actions = h('div', 'mg-row mg-center');
    var giveup = h('button', 'mg-btn mg-btn-ghost', '认输');
    giveup.onclick = function () {
      if (!confirm('确定认输吗？')) return;
      api('/api/minigames/gomoku/giveup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: game.id }) })
        .then(function (d) { drawGame(canvas, d.game); updateInfo(info, d.game); })
        .catch(function (e) { toast(e.message); });
    };
    actions.appendChild(giveup); wrap.appendChild(actions);

    function updateInfo(el, g) {
      var turnName = g.turn === 1 ? g.black.username : g.white.username;
      if (g.status === 'finished') {
        el.textContent = g.draw ? '和棋！' : ('🏆 ' + (g.winnerId === g.black.id ? g.black.username : g.white.username) + ' 获胜！');
      } else if (g.status === 'pending') {
        el.textContent = '等待 ' + g.white.username + ' 接受邀请…';
      } else {
        el.textContent = g.black.username + ' ⚫ vs ⚪ ' + g.white.username + '　轮到 ' + turnName;
      }
    }
    updateInfo(info, game);
    drawGame(canvas, game);

    canvas.onclick = function (e) {
      if (game.status !== 'active') return;
      var rect = canvas.getBoundingClientRect();
      var scale = canvas.width / rect.width;
      var px = (e.clientX - rect.left) * scale, py = (e.clientY - rect.top) * scale;
      var x = Math.round((px - pad) / cell), y = Math.round((py - pad) / cell);
      if (x < 0 || x >= BOARD_N || y < 0 || y >= BOARD_N) return;
      api('/api/minigames/gomoku/move', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: game.id, x: x, y: y }) })
        .then(function (d) { game = d.game; drawGame(canvas, game); updateInfo(info, game); })
        .catch(function (e) { toast(e.message); });
    };

    // 轮询对局状态（等对方落子 / 等接受）
    stopPoll();
    pollTimer = setInterval(function () {
      api('/api/minigames/gomoku/state?gameId=' + game.id).then(function (d) {
        game = d.game; drawGame(canvas, game); updateInfo(info, game);
      }).catch(function () {});
    }, 1500);
  }

  function drawGame(canvas, game) {
    var ctx2d = canvas.getContext('2d');
    var cell = 28, pad = 20;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    ctx2d.fillStyle = '#e8b86d'; ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    ctx2d.strokeStyle = '#5b3a1a'; ctx2d.lineWidth = 1;
    for (var i = 0; i < BOARD_N; i++) {
      ctx2d.beginPath(); ctx2d.moveTo(pad, pad + i * cell); ctx2d.lineTo(pad + cell * (BOARD_N - 1), pad + i * cell); ctx2d.stroke();
      ctx2d.beginPath(); ctx2d.moveTo(pad + i * cell, pad); ctx2d.lineTo(pad + i * cell, pad + cell * (BOARD_N - 1)); ctx2d.stroke();
    }
    // 星位
    ctx2d.fillStyle = '#5b3a1a';
    [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]].forEach(function (p) {
      ctx2d.beginPath(); ctx2d.arc(pad + p[0] * cell, pad + p[1] * cell, 3, 0, 7); ctx2d.fill();
    });
    // 棋子
    for (var y = 0; y < BOARD_N; y++) for (var x = 0; x < BOARD_N; x++) {
      var v = game.board[y * BOARD_N + x];
      if (!v) continue;
      var cx = pad + x * cell, cy = pad + y * cell;
      var grad = ctx2d.createRadialGradient(cx - 3, cy - 3, 2, cx, cy, 11);
      if (v === 1) { grad.addColorStop(0, '#666'); grad.addColorStop(1, '#111'); }
      else { grad.addColorStop(0, '#fff'); grad.addColorStop(1, '#bbb'); }
      ctx2d.fillStyle = grad;
      ctx2d.beginPath(); ctx2d.arc(cx, cy, 11, 0, 7); ctx2d.fill();
    }
  }

  // ── 数字炸弹 ──
  var bombRoomId = null;
  function renderBombTab() {
    var wrap = h('div');
    var card = h('div', 'mg-card');
    card.appendChild(h('div', 'mg-card-title', '数字炸弹：1~100 里藏了一颗雷，猜中即爆炸'));
    var row = h('div', 'mg-row');
    var sel = h('select', 'mg-input'); sel.id = 'mg-bomb-room';
    var start = h('button', 'mg-btn', '开始新的一局');
    row.appendChild(sel); row.appendChild(start); card.appendChild(row); wrap.appendChild(card);

    var stateBox = h('div', 'mg-card'); stateBox.id = 'mg-bomb-state';
    wrap.appendChild(stateBox);

    api('/api/rooms').then(function (d) {
      (d.rooms || []).forEach(function (r) {
        var o = document.createElement('option'); o.value = r.id; o.textContent = '# ' + r.name; sel.appendChild(o);
      });
      if (sel.options.length) { bombRoomId = Number(sel.value); refreshBomb(stateBox); }
      sel.onchange = function () { bombRoomId = Number(sel.value); refreshBomb(stateBox); };
    }).catch(function () {});

    start.onclick = function () {
      if (!bombRoomId) return;
      api('/api/minigames/bomb/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: bombRoomId }) })
        .then(function () { refreshBomb(stateBox); })
        .catch(function (e) { toast(e.message); });
    };

    bodyEl.appendChild(wrap);
    stopPoll();
    pollTimer = setInterval(function () { if (bombRoomId) refreshBomb(stateBox, true); }, 2000);
  }

  function refreshBomb(box, quiet) {
    if (!bombRoomId) return;
    api('/api/minigames/bomb/state?roomId=' + bombRoomId).then(function (d) {
      box.innerHTML = '';
      var g = d.game;
      if (!g) { box.appendChild(h('div', 'mg-muted mg-center', '本房间还没有炸弹，来开一局吧')); return; }
      var range = h('div', 'mg-bomb-range', g.low + ' ── ? ── ' + g.high);
      box.appendChild(range);
      if (g.status === 'finished') {
        var loser = g.guesses.length ? g.guesses[g.guesses.length - 1].username : '?';
        box.appendChild(h('div', 'mg-center', '💥 ' + loser + ' 踩中了 ' + g.answer + '，爆炸！'));
      } else {
        var row = h('div', 'mg-row mg-center');
        var input = h('input', 'mg-input mg-bomb-input'); input.type = 'number'; input.placeholder = '猜一个数';
        var btn = h('button', 'mg-btn', '开猜');
        var doGuess = function () {
          var n = Number(input.value);
          api('/api/minigames/bomb/guess', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: bombRoomId, number: n }) })
            .then(function (r) { input.value = ''; if (r.boom) toast('💥 你炸了！'); refreshBomb(box); })
            .catch(function (e) { if (!quiet) toast(e.message); });
        };
        btn.onclick = doGuess;
        input.onkeydown = function (e) { if (e.key === 'Enter') doGuess(); };
        row.appendChild(input); row.appendChild(btn); box.appendChild(row);
      }
      if (g.guesses.length) {
        var hist = h('div', 'mg-muted mg-bomb-hist');
        hist.textContent = '记录：' + g.guesses.slice(-8).map(function (gu) {
          return gu.username + '→' + gu.n + (gu.boom ? '💥' : '');
        }).join('　');
        box.appendChild(hist);
      }
    }).catch(function () {});
  }

  // ── 排行榜 ──
  function renderRankTab() {
    var wrap = h('div');
    [['gomoku', '五子棋'], ['bomb', '数字炸弹']].forEach(function (g) {
      var card = h('div', 'mg-card');
      card.appendChild(h('div', 'mg-card-title', g[1] + ' · 胜场榜'));
      var list = h('div'); card.appendChild(list); wrap.appendChild(card);
      api('/api/minigames/leaderboard?game=' + g[0]).then(function (d) {
        if (!d.leaderboard.length) { list.appendChild(h('div', 'mg-muted', '虚位以待')); return; }
        d.leaderboard.forEach(function (r, i) {
          var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
          list.appendChild(h('div', 'mg-rank-row', medal + ' ' + r.username + '　' + r.score + ' 胜'));
        });
      }).catch(function () {});
    });
    bodyEl.appendChild(wrap);
  }
})();
