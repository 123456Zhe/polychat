// 入口：启动、事件委托、局部更新。
import 'katex/dist/katex.min.css';
import './style.css';
import { S, onChange, emit, init, doLogin, doRegister, doLogout, selectRoom, selectDM,
  loadMessages, loadMore, sendMessage, toggleReaction, editMessage, retractMessage,
  pinMessage, unpinMessage, loadPins, createRoom, joinRoom, friendsApi, notifApi,
  searchMessages, sendTyping, resolveDevice, setDevice, activeKey } from './store.js';
import { api, uploadFile, ApiError } from './api.js';
import { ICONS, icon } from './icons.js';
import { escapeHTML } from './markdown.js';
import { loadTheme, applyTheme, loadCustomCss, applyCustomCss, themeModalHTML } from './themes.js';
import * as V from './views.js';

const root = () => document.getElementById('v2root');

// ---------- 渲染调度 ----------
function renderAll() {
  const r = root();
  if (!S.user) { r.innerHTML = V.renderAuth(); return; }
  r.innerHTML = V.renderApp();
  scrollBottom(true);
  if (S.resolved === 'phone' && S.phoneTab === 'friends') renderPhoneFriends();
}

function refreshSidebar() {
  const body = document.getElementById('sidebarBody');
  if (body) body.innerHTML = V.sessionListHTML();
}

let prevFirstId = null, prevScrollH = 0;
function refreshMessages() {
  const list = document.getElementById('msgList');
  const sc = document.getElementById('msgScroll');
  if (!list || !sc) { if (S.resolved === 'watch') refreshWatch(); return; }
  const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
  const firstId = S.messages[0]?.id ?? null;
  const grewTop = prevFirstId !== null && firstId !== null && firstId !== prevFirstId;
  list.innerHTML = V.messagesHTML();
  if (grewTop) {
    // 加载更早消息：保持滚动位置
    sc.scrollTop = sc.scrollHeight - prevScrollH + sc.scrollTop;
  } else if (nearBottom) {
    scrollBottom();
  }
  prevFirstId = firstId;
  prevScrollH = sc.scrollHeight;
  if (S.resolved === 'watch') refreshWatch();
}

function scrollBottom(instant) {
  const sc = document.getElementById('msgScroll');
  if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
}

function refreshTyping() {
  const el = document.getElementById('typingLine');
  if (el) el.innerHTML = V.typingHTML();
}
function refreshNotice() {
  const el = document.getElementById('noticeSlot');
  if (el) el.innerHTML = V.noticeHTML();
}
function refreshWatch() {
  const w = document.querySelector('.watch-ui');
  if (w) w.outerHTML = V.watchHTML();
}

onChange(what => {
  if (typeof what === 'object' && what?.text !== undefined) { V.showToast(what.text); return; }
  switch (what) {
    case 'auth': renderAll(); break;
    case 'enter': renderAll(); break;
    case 'rooms': case 'convs': refreshSidebar(); break;
    case 'active': prevFirstId = null; renderAll(); break;
    case 'messages': refreshMessages(); break;
    case 'typing': refreshTyping(); break;
    case 'announcement': refreshNotice(); break;
    case 'pins': {
      refreshNotice();
      if (document.querySelector('[data-modal-veil]')?.textContent.includes('置顶消息')) V.openModal(V.pinsModalHTML());
      break;
    }
    case 'notif': refreshSidebar(); {
      const mp = document.getElementById('morePop');
      if (mp) { V.closePop(); document.getElementById('pop-root').innerHTML = V.morePopHTML(); }
      break;
    }
    case 'ws': {
      const st = document.querySelector('.me-status');
      if (st) st.innerHTML = `<span class="status-dot"></span>${S.wsOk ? '在线' : '连接中…'}`;
      break;
    }
    case 'device': renderAll(); break;
    case 'friends-changed':
      if (friendsState.open) openFriends(friendsState.tab);
      break;
  }
});

// ---------- 弹窗：好友 ----------
const friendsState = { open: false, tab: 'list', data: null };
async function openFriends(tab) {
  friendsState.open = true;
  friendsState.tab = tab || friendsState.tab;
  try {
    friendsState.data = await friendsApi.list();
  } catch (e) { V.showToast(e.message); return; }
  V.openModal(V.friendsModalHTML(friendsState.tab, friendsState.data));
}
async function renderPhoneFriends() {
  const el = document.getElementById('phoneFriends');
  if (!el) return;
  try {
    const d = await friendsApi.list();
    el.innerHTML = d.accepted.map(f => `
      <div class="list-row">${V.avatarHTML(f)}<div class="grow"><div class="t1">${escapeHTML(f.username)}</div></div>
      <button class="mini-btn" data-action="dm-user" data-username="${escapeHTML(f.username)}">私信</button></div>`).join('')
      + (d.incoming.length ? `<div class="group-title">好友请求</div>` + d.incoming.map(f => `
      <div class="list-row">${V.avatarHTML(f)}<div class="grow"><div class="t1">${escapeHTML(f.username)}</div></div>
      <button class="mini-btn primary" data-action="friend-accept" data-id="${f.id}">接受</button>
      <button class="mini-btn" data-action="friend-decline" data-id="${f.id}">拒绝</button></div>`).join('') : '')
      || '<div class="empty-note">还没有好友</div>';
  } catch { el.innerHTML = '<div class="empty-note">加载失败</div>'; }
}

// ---------- 消息发送 ----------
async function doSend() {
  const input = document.getElementById('composerInput');
  if (!input || !S.active) return;
  const text = input.value.trim();
  if (!text && !S.editing) return;
  sendTyping(false);
  try {
    if (S.editing) {
      await editMessage(S.editing, text);
      S.editing = null;
    } else {
      await sendMessage(text, { replyTo: S.replyTo });
    }
    input.value = '';
    autoresize(input);
  } catch (e) { V.showToast(e.message); }
}

function autoresize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
}

let typingTimer = null;
function onComposerInput() {
  const ta = document.getElementById('composerInput');
  if (!ta) return;
  autoresize(ta);
  sendTyping(true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => sendTyping(false), 2500);
  updateMentionPop(ta);
}

function updateMentionPop(ta) {
  const pop = document.getElementById('mentionPop');
  if (!pop || S.active?.kind !== 'room') return;
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);
  const m = before.match(/@([\p{L}\p{N}_-]*)$/u);
  if (!m) { pop.classList.remove('open'); pop.innerHTML = ''; return; }
  const q = m[1].toLowerCase();
  const list = S.mentionables.filter(u => u.username.toLowerCase().includes(q)).slice(0, 8);
  if (!list.length) { pop.classList.remove('open'); return; }
  pop.innerHTML = list.map(u => `<button data-action="mention-pick" data-u="${escapeHTML(u.username)}">${V.avatarHTML(u)}<span>${escapeHTML(u.username)}</span></button>`).join('');
  pop.classList.add('open');
}

async function doAttach(file) {
  if (!file || !S.active) return;
  const chip = document.getElementById('uploadChip');
  const bar = chip?.querySelector('.bar i');
  const name = chip?.querySelector('.up-name');
  if (chip) { chip.style.display = 'flex'; }
  if (name) name.textContent = file.name;
  try {
    const up = await uploadFile(file, r => { if (bar) bar.style.width = `${Math.round(r * 100)}%`; });
    await sendMessage('', { attachment: up, replyTo: S.replyTo });
  } catch (e) { V.showToast(e.message || '上传失败'); }
  if (chip) chip.style.display = 'none';
}

// ---------- 打开房间（含加入流程） ----------
async function openRoomFlow(id) {
  const room = S.rooms.find(r => r.id === Number(id) || r.id === id);
  const rid = room ? room.id : id;
  if (room && room.role) { await selectRoom(rid); return; }
  try {
    await joinRoom(rid);
    V.showToast('已加入房间');
    await selectRoom(rid);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403 && /密码|password/i.test(e.message)) {
      V.openModal(V.passwordModalHTML(room || { id: rid, name: '房间' }));
    } else {
      V.showToast(e.message);
    }
  }
}

// ---------- 全局点击委托 ----------
document.addEventListener('click', async ev => {
  const veil = ev.target.closest('[data-modal-veil]');
  if (veil && ev.target === veil) { V.closeModal(); friendsState.open = false; return; }
  const el = ev.target.closest('[data-action]');
  // 点空白处关闭 pop
  if (!ev.target.closest('#morePop') && !ev.target.closest('#msgPop') && !ev.target.closest('[data-action="toggle-more"]') && !ev.target.closest('[data-action="msg-more"]')) {
    V.closePop();
  }
  if (!el) return;
  const a = el.dataset.action;
  const id = el.dataset.id;
  try {
    switch (a) {
      case 'open-room': await openRoomFlow(id); break;
      case 'open-dm': await selectDM(Number(id) || id); break;
      case 'open-drawer': S.drawerOpen = true; document.getElementById('v2app')?.classList.add('drawer-open'); break;
      case 'close-drawer': S.drawerOpen = false; document.getElementById('v2app')?.classList.remove('drawer-open'); break;
      case 'phone-tab': S.phoneTab = el.dataset.tab; renderAll(); break;
      case 'phone-back': S.active = null; S.messages = []; S.msgIds = new Set(); renderAll(); break;
      case 'load-more': await loadMore(); break;
      case 'send': await doSend(); break;
      case 'attach': document.getElementById('fileInput')?.click(); break;
      case 'emoji': {
        const pop = document.getElementById('emojiPop');
        const grid = document.getElementById('emojiGrid');
        if (pop && grid) {
          if (!grid.innerHTML) grid.innerHTML = V.emojiGridHTML();
          pop.classList.toggle('open');
        }
        break;
      }
      case 'insert-emoji': {
        const ta = document.getElementById('composerInput');
        if (ta) { ta.value += el.dataset.e; autoresize(ta); ta.focus(); }
        document.getElementById('emojiPop')?.classList.remove('open');
        break;
      }
      case 'mention-pick': {
        const ta = document.getElementById('composerInput');
        if (ta) {
          const pos = ta.selectionStart;
          const before = ta.value.slice(0, pos).replace(/@[\p{L}\p{N}_-]*$/u, `@${el.dataset.u} `);
          ta.value = before + ta.value.slice(pos);
          ta.focus();
        }
        document.getElementById('mentionPop')?.classList.remove('open');
        break;
      }
      case 'cancel-reply': S.replyTo = null; renderAll(); break;
      case 'cancel-edit': S.editing = null; { const ta = document.getElementById('composerInput'); if (ta) ta.value = ''; } renderAll(); break;
      case 'msg-reply': S.replyTo = Number(id); S.editing = null; renderAll(); document.getElementById('composerInput')?.focus(); break;
      case 'msg-react': quickReact(Number(id)); break;
      case 'react': {
        const msg = S.messages.find(m => m.id === Number(id));
        if (msg) await toggleReaction(msg, el.dataset.emoji);
        break;
      }
      case 'msg-more': {
        const msg = S.messages.find(m => m.id === Number(id));
        if (!msg) break;
        V.closePop();
        const r = document.getElementById('pop-root');
        if (r) {
          r.innerHTML = V.msgMenuHTML(Number(id), msg);
          const pop = document.getElementById('msgPop');
          const rect = el.getBoundingClientRect(), app = document.getElementById('v2app').getBoundingClientRect();
          if (pop) { pop.style.top = `${rect.bottom - app.top + 6}px`; pop.style.right = `${app.right - rect.right}px`; }
        }
        break;
      }
      case 'msg-edit': {
        const msg = S.messages.find(m => m.id === Number(id));
        if (msg) { S.editing = msg; S.replyTo = null; renderAll(); const ta = document.getElementById('composerInput'); if (ta) { ta.value = msg.content || ''; autoresize(ta); ta.focus(); } }
        V.closePop();
        break;
      }
      case 'msg-retract': {
        const msg = S.messages.find(m => m.id === Number(id));
        if (msg && confirm('确定撤回这条消息吗？')) { await retractMessage(msg); }
        V.closePop();
        break;
      }
      case 'msg-pin': {
        await pinMessage(Number(id));
        V.showToast('已置顶');
        V.closePop();
        break;
      }
      case 'unpin': await unpinMessage(Number(id)); V.openModal(V.pinsModalHTML()); break;
      case 'jump-msg': {
        V.closeModal();
        const t = document.querySelector(`article.message[data-id="${id}"]`);
        if (t) { t.scrollIntoView({ block: 'center' }); t.style.outline = '2px solid var(--accent)'; setTimeout(() => t.style.outline = '', 1600); }
        break;
      }
      case 'toggle-more': {
        V.closePop();
        const r = document.getElementById('pop-root');
        if (r && !document.getElementById('morePop')) r.innerHTML = V.morePopHTML();
        else V.closePop();
        break;
      }
      case 'open-theme': V.closePop(); V.openModal(themeModalHTML(document.documentElement.dataset.theme)); break;
      case 'open-search': V.closePop(); V.openModal(V.searchModalHTML()); setTimeout(() => document.getElementById('msgSearchInput')?.focus(), 50); break;
      case 'open-pins': V.closePop(); if (S.active?.kind === 'room') { await loadPins(S.active.id); V.openModal(V.pinsModalHTML()); } break;
      case 'open-friends': V.closePop(); await openFriends('list'); break;
      case 'open-notif': {
        V.closePop();
        try {
          const ret = await notifApi.list();
          V.openModal(V.notifModalHTML(ret.notifications || []));
        } catch (e) { V.showToast(e.message); }
        break;
      }
      case 'notif-read-all': await notifApi.readAll(); S.notifUnread = 0; V.closeModal(); renderAll(); break;
      case 'create-room': V.closePop(); V.openModal(V.createRoomModalHTML(S.user?.is_admin)); break;
      case 'create-room-go': {
        const name = document.getElementById('crName')?.value.trim();
        if (!name) { V.showToast('请输入房间名称'); break; }
        const isPrivate = S.user?.is_admin ? !!document.getElementById('crPrivate')?.checked : true;
        const room = await createRoom({ name, isPrivate });
        V.closeModal();
        await selectRoom(room.id);
        break;
      }
      case 'join-room-go': {
        const pass = document.getElementById('joinPass')?.value;
        try { await joinRoom(Number(id), pass); V.closeModal(); await selectRoom(Number(id)); }
        catch (e) { V.showToast(e.message); }
        break;
      }
      case 'friends-tab': await openFriends(el.dataset.tab); break;
      case 'friend-accept': await friendsApi.accept(id); await openFriends(friendsState.tab); renderAll(); break;
      case 'friend-decline': await friendsApi.decline(id); await openFriends(friendsState.tab); break;
      case 'friend-remove':
        if (confirm('确定删除这位好友吗？')) { await friendsApi.remove(id); await openFriends(friendsState.tab); if (S.resolved === 'phone') renderAll(); }
        break;
      case 'dm-user': {
        const ret = await friendsApi.startDM(el.dataset.username);
        await selectDM(ret.conversation.id);
        V.closeModal(); friendsState.open = false;
        S.phoneTab = 'chats';
        break;
      }
      case 'oldver': V.closePop(); V.openModal(V.oldverModalHTML(el.dataset.feature || '该功能')); break;
      case 'goto-oldver': location.href = '/'; break;
      case 'set-device': setDevice(el.dataset.v); V.closePop(); break;
      case 'logout':
        if (confirm('确定退出登录吗？')) { await doLogout(); }
        break;
      case 'close-modal': V.closeModal(); friendsState.open = false; break;
      case 'search-goto-room': V.closeModal(); await selectRoom(Number(el.dataset.room)); break;
      case 'watch-open': {
        if (el.dataset.kind === 'room') await selectRoom(Number(el.dataset.id));
        else await selectDM(Number(el.dataset.id));
        S.watchView = 'chat'; refreshWatch();
        break;
      }
      case 'watch-back': S.watchView = 'list'; refreshWatch(); break;
      case 'watch-compose': S.watchView = 'compose'; refreshWatch(); setTimeout(() => document.getElementById('watchInput')?.focus(), 50); break;
      case 'watch-quick': {
        const ta = document.getElementById('watchInput');
        if (ta) ta.value = (ta.value ? ta.value + ' ' : '') + el.dataset.t;
        break;
      }
      case 'watch-send': {
        const ta = document.getElementById('watchInput');
        const text = ta?.value.trim();
        if (text && S.active) { await sendMessage(text); S.watchView = 'chat'; refreshWatch(); }
        break;
      }
    }
    // 主题卡片点击（data-theme-id，不在 data-action 体系内）
    const themeCard = ev.target.closest('[data-theme-id]');
    if (themeCard) {
      const t = applyTheme(themeCard.dataset.themeId);
      V.openModal(themeModalHTML(t.id));
    }
    if (ev.target.closest('[data-css-save]')) {
      const css = document.getElementById('pc2-css')?.value || '';
      applyCustomCss(css);
      V.showToast('自定义 CSS 已保存');
    }
    if (ev.target.closest('[data-css-clear]')) {
      const ta = document.getElementById('pc2-css');
      if (ta) ta.value = '';
      applyCustomCss('');
      V.showToast('已清空自定义 CSS');
    }
  } catch (e) {
    console.error(e);
    V.showToast(e.message || '操作失败');
  }
});

function quickReact(msgId) {
  const msg = S.messages.find(m => m.id === msgId);
  if (!msg) return;
  const common = ['👍', '❤️', '😂', '🎉', '👀'];
  V.closePop();
  const r = document.getElementById('pop-root');
  if (!r) return;
  r.innerHTML = `<div class="popover open msg-more-pop" id="msgPop" style="min-width:0;padding:8px;display:flex;gap:4px">
    ${common.map(e => `<button class="composer-btn" data-action="react" data-id="${msgId}" data-emoji="${e}" style="font-size:20px">${e}</button>`).join('')}
  </div>`;
  const pop = document.getElementById('msgPop');
  const btn = document.querySelector(`[data-action="msg-react"][data-id="${msgId}"]`);
  const app = document.getElementById('v2app').getBoundingClientRect();
  if (pop && btn) {
    const rect = btn.getBoundingClientRect();
    pop.style.top = `${rect.bottom - app.top + 6}px`;
    pop.style.right = `${app.right - rect.right}px`;
  }
}

// ---------- 输入事件 ----------
document.addEventListener('input', ev => {
  if (ev.target.id === 'composerInput') onComposerInput();
  if (ev.target.id === 'sideFilter') {
    S.searchFilter = ev.target.value;
    clearTimeout(window.__sfT);
    window.__sfT = setTimeout(() => refreshSidebar(), 250);
  }
  if (ev.target.id === 'friendSearch') {
    const q = ev.target.value.trim();
    const box = document.getElementById('friendSearchResult');
    if (!box) return;
    clearTimeout(window.__fsT);
    window.__fsT = setTimeout(async () => {
      if (!q) { box.innerHTML = ''; return; }
      try {
        const ret = await friendsApi.searchUsers(q);
        box.innerHTML = (ret.users || []).map(u => `
          <div class="list-row">${V.avatarHTML(u)}<div class="grow"><div class="t1">${escapeHTML(u.username)}</div></div>
          <button class="mini-btn primary" data-action="friend-add" data-username="${escapeHTML(u.username)}">添加</button></div>`).join('')
          || '<div class="empty-note">没有找到该用户</div>';
      } catch (e) { box.innerHTML = `<div class="empty-note">${escapeHTML(e.message)}</div>`; }
    }, 350);
  }
});

document.addEventListener('click', async ev => {
  const add = ev.target.closest('[data-action="friend-add"]');
  if (add) {
    try { await friendsApi.request(add.dataset.username); V.showToast('好友请求已发送'); await openFriends('outgoing'); }
    catch (e) { V.showToast(e.message); }
  }
});

document.addEventListener('keydown', async ev => {
  // 登录页回车
  if (ev.target.id === 'authUser' || ev.target.id === 'authPass') {
    if (ev.key === 'Enter') document.getElementById('authGo')?.click();
  }
  // 登录/注册 tab 切换
  const tab = ev.target.closest?.('[data-auth-tab]');
  // composer 回车发送
  if (ev.target.id === 'composerInput' && ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    await doSend();
  }
  if (ev.target.id === 'msgSearchInput' && ev.key === 'Enter') {
    const q = ev.target.value.trim();
    const box = document.getElementById('msgSearchResult');
    if (!q || !box) return;
    box.innerHTML = '<div class="empty-note">搜索中…</div>';
    try {
      const ret = await searchMessages(q, S.active?.kind === 'room' ? S.active.id : null);
      box.innerHTML = V.searchResultHTML(ret.results || ret.messages || []);
    } catch (e) { box.innerHTML = `<div class="empty-note">${escapeHTML(e.message)}</div>`; }
  }
  if (ev.key === 'Escape') {
    V.closeModal(); V.closePop(); friendsState.open = false;
    document.getElementById('mentionPop')?.classList.remove('open');
    document.getElementById('emojiPop')?.classList.remove('open');
  }
});

document.addEventListener('click', async ev => {
  const tab = ev.target.closest('[data-auth-tab]');
  if (tab) {
    document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.remove('active'));
    tab.classList.add('active');
    const go = document.getElementById('authGo');
    if (go) go.textContent = tab.dataset.authTab === 'login' ? '登录' : '注册';
  }
  if (ev.target.id === 'authGo') {
    const mode = document.querySelector('[data-auth-tab].active')?.dataset.authTab || 'login';
    const u = document.getElementById('authUser')?.value.trim();
    const p = document.getElementById('authPass')?.value;
    const err = document.getElementById('authErr');
    if (!u || !p) { if (err) { err.textContent = '请输入用户名和密码'; err.classList.add('show'); } return; }
    ev.target.disabled = true;
    try {
      if (mode === 'login') await doLogin(u, p);
      else await doRegister(u, p);
    } catch (e) {
      if (err) { err.textContent = e.message; err.classList.add('show'); }
      ev.target.disabled = false;
    }
  }
});

document.addEventListener('change', ev => {
  if (ev.target.id === 'fileInput' && ev.target.files?.length) {
    doAttach(ev.target.files[0]);
    ev.target.value = '';
  }
});

// 消息滚动：顶部加载更多
document.addEventListener('scroll', ev => {
  if (ev.target.id === 'msgScroll' && ev.target.scrollTop < 60) {
    // 由 load-more 按钮处理，避免误触；此处不做
  }
}, true);

// ---------- 启动 ----------
async function boot() {
  V.mountIcons(ICONS);
  loadTheme();
  applyCustomCss(loadCustomCss());
  resolveDevice();
  window.addEventListener('resize', () => {
    clearTimeout(window.__rzT);
    window.__rzT = setTimeout(() => {
      const before = S.resolved;
      resolveDevice();
      if (S.resolved !== before) renderAll();
    }, 200);
  });
  const ok = await init();
  renderAll();
  if (ok && S.resolved === 'watch') V.showToast('手表模式：点会话查看消息');
}
boot();
