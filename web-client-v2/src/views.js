// 视图层：HTML 模板与局部更新。事件委托在 main.js。
import { S } from './store.js';
import { icon } from './icons.js';
import { escapeHTML, renderMarkdown, renderAttachment, mentionNames } from './markdown.js';
import { THEMES, themeModalHTML } from './themes.js';

export { themeModalHTML };

export function $(sel, root) { return (root || document).querySelector(sel); }
export function $all(sel, root) { return [...(root || document).querySelectorAll(sel)]; }

export function avatarHTML(user, cls) {
  const name = user?.username || '?';
  if (user?.avatar_url) {
    return `<img class="avatar ${cls || ''}" src="${escapeHTML(user.avatar_url)}" alt="${escapeHTML(name)}" loading="lazy">`;
  }
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return `<div class="avatar g${h % 8} ${cls || ''}">${escapeHTML(name.charAt(0).toUpperCase())}</div>`;
}

export function timeStr(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  const y = d.getFullYear(), mo = d.getMonth() + 1, da = d.getDate();
  return y === now.getFullYear() ? `${mo}/${da} ${hh}:${mm}` : `${y}/${mo}/${da} ${hh}:${mm}`;
}

// ---------- 登录 ----------
export function renderAuth() {
  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-brand">${icon('sparkle')}<b>PolyChat</b></div>
      <div class="auth-sub">新版界面 · 与旧版账号互通</div>
      <div class="auth-tabs">
        <button data-auth-tab="login" class="active">登录</button>
        <button data-auth-tab="register">注册</button>
      </div>
      <div class="auth-error" id="authErr"></div>
      <div class="auth-field"><label>用户名</label><input id="authUser" autocomplete="username" maxlength="20" placeholder="用户名"></div>
      <div class="auth-field"><label>密码</label><input id="authPass" type="password" autocomplete="current-password" placeholder="密码"></div>
      <button class="auth-submit" id="authGo">登录</button>
      <div class="auth-hint">首个注册的用户将成为管理员<br><a href="/" style="color:var(--accent)">返回旧版界面</a></div>
    </div>
  </div>`;
}

// ---------- 主界面骨架 ----------
export function renderApp() {
  const d = S.resolved;
  const appInner = d === 'phone'
    ? (S.active ? mainHTML() : phoneListHTML())
    : `${sidebarHTML()}<div class="drawer-scrim" data-action="close-drawer"></div>${mainHTML()}`;
  return `
  <div class="app">${appInner}</div>
  ${d === 'phone' ? mobileTabsHTML() : ''}
  ${d === 'watch' ? watchHTML() : ''}
  <div class="toast" id="toast"></div>
  <div id="modal-root"></div>
  <div id="pop-root"></div>`;
}

function sidebarHTML() {
  const u = S.user || {};
  return `
  <aside class="sidebar">
    <div class="brand-row">
      <span class="brand-mark">${icon('sparkle')}</span>
      <span class="brand-name">PolyChat <em class="pill" style="font-style:normal">v2</em></span>
    </div>
    <div style="padding:12px 10px 0">
      <div class="side-search">${icon('search')}<input id="sideFilter" placeholder="搜索会话" value="${escapeHTML(S.searchFilter)}"></div>
    </div>
    <div class="sidebar-body" id="sidebarBody">${sessionListHTML()}</div>
    <div class="sidebar-foot">
      ${avatarHTML(u)}
      <div class="me-meta" style="flex:1;min-width:0">
        <div class="me-name">${escapeHTML(u.username || '')}</div>
        <div class="me-status"><span class="status-dot"></span>${S.wsOk ? '在线' : '连接中…'}</div>
      </div>
      <button class="icon-button" data-action="open-theme" title="主题">${icon('palette')}</button>
      <button class="icon-button" data-action="logout" title="退出登录">${icon('logout')}</button>
    </div>
  </aside>`;
}

export function sessionListHTML() {
  const q = S.searchFilter.trim().toLowerCase();
  const rooms = S.rooms.filter(r => !q || r.name.toLowerCase().includes(q));
  const convs = S.convs.filter(c => !q || (c.peer?.username || '').toLowerCase().includes(q));
  const roomItems = rooms.map(r => {
    const un = S.unreadRooms[r.id] || 0;
    const active = S.active?.kind === 'room' && S.active.id === r.id;
    return `<button class="nav-item${active ? ' active' : ''}" data-action="open-room" data-id="${r.id}">
      <span class="nav-icon">${icon('hash')}</span>
      <span class="nav-name">${escapeHTML(r.name)}</span>
      ${r.is_private ? icon('lock', 'lock-ic') : ''}
      ${un ? `<span class="pill">${un > 99 ? '99+' : un}</span>` : ''}
    </button>`;
  }).join('');
  const dmItems = convs.map(c => {
    const un = c.unread_count || S.unreadDms[c.id] || 0;
    const active = S.active?.kind === 'dm' && S.active.id === c.id;
    return `<button class="nav-item${active ? ' active' : ''}" data-action="open-dm" data-id="${c.id}">
      <span class="nav-icon">${icon('mail')}</span>
      <span class="nav-name">${escapeHTML(c.peer?.username || '私信')}</span>
      ${un ? `<span class="pill">${un > 99 ? '99+' : un}</span>` : ''}
    </button>`;
  }).join('');
  return `
    <div class="group-title">聊天室</div>
    ${roomItems || '<div class="side-empty">暂无聊天室</div>'}
    <div style="height:10px"></div>
    <div class="group-title">私信</div>
    ${dmItems || '<div class="side-empty">暂无私信</div>'}`;
}

// 手机端：全屏会话列表（含底部 Tab 上方的"我"入口）
function phoneListHTML() {
  const u = S.user || {};
  let body = '';
  if (S.phoneTab === 'chats') {
    body = `<div style="padding:12px 10px 0"><div class="side-search">${icon('search')}<input id="sideFilter" placeholder="搜索会话" value="${escapeHTML(S.searchFilter)}"></div></div>
      <div class="sidebar-body" id="sidebarBody" style="flex:1">${sessionListHTML()}</div>`;
  } else if (S.phoneTab === 'friends') {
    body = `<div class="sidebar-body" style="flex:1" id="phoneFriends"></div>`;
  } else {
    body = `<div class="sidebar-body" style="flex:1">
      <div class="list-row">${avatarHTML(u)}<div class="grow"><div class="t1">${escapeHTML(u.username || '')}</div><div class="t2">${u.is_admin ? '管理员' : '成员'}</div></div></div>
      <div class="menu-sep"></div>
      <button class="list-row" data-action="open-theme" style="width:100%;border:0;background:transparent;text-align:left">${icon('palette')}<div class="grow"><div class="t1">主题</div></div></button>
      <button class="list-row" data-action="open-notif" style="width:100%;border:0;background:transparent;text-align:left">${icon('bell')}<div class="grow"><div class="t1">通知中心</div></div>${S.notifUnread ? `<span class="pill">${S.notifUnread}</span>` : ''}</button>
      <button class="list-row" data-action="create-room" style="width:100%;border:0;background:transparent;text-align:left">${icon('plus')}<div class="grow"><div class="t1">新建聊天室</div></div></button>
      <button class="switch-oldver" data-action="goto-oldver">${icon('back')}<span>切换到旧版界面</span></button>
      <div class="menu-sep"></div>
      <button class="list-row" data-action="logout" style="width:100%;border:0;background:transparent;text-align:left;color:#c94c57">${icon('logout')}<div class="grow"><div class="t1" style="color:#c94c57">退出登录</div></div></button>
    </div>`;
  }
  return `
  <div class="phone-list">
    <div class="brand-row"><span class="brand-mark">${icon('sparkle')}</span><span class="brand-name">PolyChat</span>
      <span style="flex:1"></span>
      <button class="icon-button" data-action="open-notif" title="通知">${icon('bell')}${S.notifUnread ? `<span class="pill" style="position:absolute;margin:-14px 0 0 14px">${S.notifUnread}</span>` : ''}</button>
    </div>
    <div style="display:flex;flex-direction:column;flex:1;min-height:0">${body}</div>
  </div>`;
}

function mobileTabsHTML() {
  const t = S.phoneTab;
  return `
  <nav class="mobile-tabs">
    <button class="mobile-tab${t === 'chats' ? ' active' : ''}" data-action="phone-tab" data-tab="chats">${icon('chat')}<span>聊天</span></button>
    <button class="mobile-tab${t === 'friends' ? ' active' : ''}" data-action="phone-tab" data-tab="friends">${icon('friend')}<span>好友</span></button>
    <button class="mobile-tab${t === 'me' ? ' active' : ''}" data-action="phone-tab" data-tab="me">${icon('user')}<span>我</span></button>
  </nav>`;
}

// ---------- 主区域 ----------
function mainHTML() {
  if (!S.active) {
    return `<main class="main"><div class="side-empty" style="margin:auto;text-align:center">
      <div style="margin-bottom:10px;color:var(--faint)">${icon('chat')}</div>
      选择一个聊天室或私信开始聊天</div></main>`;
  }
  const isRoom = S.active.kind === 'room';
  const title = isRoom ? (S.roomDetail?.name || '聊天室') : (S.convDetail?.peer?.username || '私信');
  const stats = isRoom ? roomStatsHTML() : dmStatsHTML();
  return `
  <main class="main">
    <header class="topbar">
      <button class="icon-button drawer-btn" data-action="open-drawer" title="会话列表">${icon('menu')}</button>
      ${S.resolved === 'phone' ? `<button class="icon-button" data-action="phone-back" title="返回">${icon('back')}</button>` : ''}
      <div class="room-head">
        <div class="room-title">${icon(isRoom ? 'hash' : 'mail')}<span>${escapeHTML(title)}</span>${isRoom && S.roomDetail?.is_private ? icon('lock') : ''}</div>
        <div class="room-stats">${stats}</div>
      </div>
      <div class="top-actions">
        <button class="icon-button desktop-action" data-action="open-search" title="搜索消息">${icon('search')}</button>
        ${isRoom ? `<button class="icon-button desktop-action" data-action="open-pins" title="置顶消息">${icon('pin')}</button>` : ''}
        <button class="icon-button" data-action="toggle-more" title="更多">${icon('more')}</button>
      </div>
    </header>
    <div id="noticeSlot">${noticeHTML()}</div>
    <div class="messages" id="msgScroll">
      <div id="msgList">${messagesHTML()}</div>
    </div>
    <div class="typing-line" id="typingLine">${typingHTML()}</div>
    <div id="composerSlot">${composerHTML()}</div>
  </main>`;
}

function roomStatsHTML() {
  const online = S.online.size;
  const parts = [];
  if (S.roomDetail?.announcement) parts.push('有公告');
  if (S.pins.length) parts.push(`${S.pins.length} 条置顶`);
  parts.push(`${online} 人在线`);
  return parts.map(escapeHTML).join(' · ');
}
function dmStatsHTML() {
  const peer = S.convDetail?.peer;
  const on = peer && S.online.has(peer.id);
  return on ? '<span class="status-dot"></span>对方在线' : '私信会话';
}

export function noticeHTML() {
  const rows = [];
  if (S.globalAnnouncement?.content) {
    rows.push(`<div class="notice-row">${icon('megaphone')}<span class="notice-text">${escapeHTML(S.globalAnnouncement.content)}</span></div>`);
  }
  if (S.active?.kind === 'room' && S.roomDetail?.announcement) {
    rows.push(`<div class="notice-row">${icon('megaphone')}<span class="notice-text"><b>房间公告：</b>${escapeHTML(S.roomDetail.announcement)}</span></div>`);
  }
  if (!rows.length) return '';
  return `<div class="notice">${rows.join('')}</div>`;
}

function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  const diff = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diff <= 0) return '今天';
  if (diff === 1) return '昨天';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function messagesHTML() {
  if (!S.messages.length) return '<div class="side-empty" style="text-align:center;padding:40px 0">还没有消息，来发第一条吧</div>';
  let html = '';
  let lastDay = null;
  if (S.hasMore) html += `<div style="text-align:center;padding:6px 0 12px"><button class="mini-btn" data-action="load-more" ${S.loadingMore ? 'disabled' : ''}>${S.loadingMore ? '加载中…' : '加载更早的消息'}</button></div>`;
  for (const m of S.messages) {
    const dk = dayKey(m.created_at);
    if (dk !== lastDay) { lastDay = dk; html += `<div class="day-rule">${dayLabel(m.created_at)}</div>`; }
    html += messageHTML(m);
  }
  return html;
}

export function messageHTML(m) {
  const own = m.user_id === S.user?.id;
  const deleted = m.is_deleted;
  const uname = m.username || mentionNames[m.user_id] || `用户${m.user_id}`;
  const user = { username: uname, avatar_url: m.avatar_url };
  let body;
  if (deleted) {
    body = `<div class="msg-deleted">${m.deleted_by_admin ? '该消息已被管理员删除' : '该消息已撤回'}</div>`;
  } else {
    const reply = m.reply_to ? replyQuoteHTML(m.reply_to) : '';
    const md = renderMarkdown(m.content || '');
    const atts = m.attachments && m.attachments.length
      ? m.attachments.map(renderAttachment).join('')
      : (m.attachment ? renderAttachment(m.attachment) : '');
    body = `${reply}${md ? `<div class="msg-body">${md}</div>` : ''}${atts}`;
  }
  const reactions = (m.reactions || []).map(r =>
    `<button class="reaction${r.reacted ? ' selected' : ''}" data-action="react" data-id="${m.id}" data-emoji="${escapeHTML(r.emoji)}">${escapeHTML(r.emoji)}<span>${r.count}</span></button>`
  ).join('');
  return `
  <article class="message${own ? ' own' : ''}" data-id="${m.id}" tabindex="0">
    ${avatarHTML(user)}
    <div class="msg-main">
      <div class="msg-meta"><span class="msg-name">${escapeHTML(uname)}</span><time class="msg-time">${timeStr(m.created_at)}</time>${m.is_edited ? '<span class="edited-tag">已编辑</span>' : ''}</div>
      ${body}
      ${reactions ? `<div class="reaction-row">${reactions}</div>` : ''}
    </div>
    ${deleted ? '' : `<div class="msg-actions">
      <button data-action="msg-reply" data-id="${m.id}" aria-label="回复">${icon('reply')}</button>
      <button data-action="msg-react" data-id="${m.id}" aria-label="表情反应">${icon('smile')}</button>
      <button data-action="msg-more" data-id="${m.id}" aria-label="更多操作">${icon('more')}</button>
    </div>`}
  </article>`;
}

function replyQuoteHTML(r) {
  const uname = r.username || mentionNames[r.user_id] || `用户${r.user_id}`;
  const text = r.is_deleted ? '该消息已撤回' : (r.content || '[附件]').slice(0, 80);
  return `<div class="quote"><strong>${escapeHTML(uname)}</strong>：${escapeHTML(text)}</div>`;
}

export function typingHTML() {
  const key = S.active ? `${S.active.kind}:${S.active.id}` : null;
  const set = key ? S.typing.get(key) : null;
  if (!set || !set.size) return '';
  const names = [...set.values()].map(v => v.name).slice(0, 3);
  return `${names.map(escapeHTML).join('、')} 正在输入…`;
}

function composerHTML() {
  const isRoom = S.active?.kind === 'room';
  const readonly = isRoom && S.roomDetail?.readonly && !['owner', 'admin'].includes(S.roomDetail?.role) && !S.user?.is_admin;
  if (readonly) return `<div class="composer-wrap"><div class="empty-note">该房间为只读，无法发言</div></div>`;
  const edit = S.editing;
  const reply = S.replyTo && !edit ? S.messages.find(m => m.id === S.replyTo) : null;
  return `
  ${edit ? `<div class="reply-bar"><span class="rb-text">正在编辑消息</span><button data-action="cancel-edit" title="取消">${icon('x')}</button></div>` : ''}
  ${reply ? `<div class="reply-bar"><span class="rb-text">回复 <b>${escapeHTML(reply.username || '')}</b>：${escapeHTML((reply.content || '').slice(0, 60))}</span><button data-action="cancel-reply" title="取消">${icon('x')}</button></div>` : ''}
  <div class="upload-chip" id="uploadChip" style="display:none"><span class="up-name"></span><span class="bar"><i></i></span></div>
  <div class="mention-pop" id="mentionPop"></div>
  <div class="emoji-pop" id="emojiPop"><div class="emoji-grid" id="emojiGrid"></div></div>
  <div class="composer-wrap">
    <div class="composer">
      <button class="composer-btn" data-action="attach" title="发送文件">${icon('paperclip')}</button>
      <textarea class="composer-input" id="composerInput" rows="1" placeholder="输入消息，Enter 发送，Shift+Enter 换行（支持 Markdown / $公式$）"></textarea>
      <button class="composer-btn" data-action="emoji" title="表情">${icon('smile')}</button>
      <button class="send-btn" data-action="send" title="发送">${icon('send')}</button>
    </div>
    <div class="composer-hint">Enter 发送 · Shift + Enter 换行 · 支持 Markdown / LaTeX</div>
    <input type="file" id="fileInput" style="display:none">
  </div>`;
}

// ---------- 更多菜单 ----------
export function morePopHTML() {
  const isAdmin = S.user?.is_admin;
  const isRoom = S.active?.kind === 'room';
  const devices = [['auto', '自动', 'auto'], ['desktop', '电脑', 'monitor'], ['tablet', '平板', 'tablet'], ['phone', '手机', 'phone'], ['watch', '手表', 'watch']];
  return `
  <div class="popover more-pop open" id="morePop" role="menu">
    <div class="pop-heading">消息与会话</div>
    <div class="menu-grid">
      <button class="menu-item" data-action="open-search">${icon('search')}<span>搜索消息</span></button>
      ${isRoom ? `<button class="menu-item" data-action="open-pins">${icon('pin')}<span>置顶消息</span></button>` : ''}
      <button class="menu-item" data-action="open-friends">${icon('friend')}<span>好友管理</span></button>
      <button class="menu-item" data-action="open-notif">${icon('bell')}<span>通知中心${S.notifUnread ? ` (${S.notifUnread})` : ''}</span></button>
      <button class="menu-item" data-action="create-room">${icon('plus')}<span>新建聊天室</span></button>
      <button class="menu-item" data-action="oldver" data-feature="管理面板" ${isAdmin ? '' : 'disabled style="opacity:.4"'}>${icon('shield')}<span>管理面板</span></button>
      <button class="menu-item" data-action="oldver" data-feature="图床">${icon('image')}<span>图床</span></button>
      <button class="menu-item" data-action="oldver" data-feature="话题串">${icon('thread')}<span>话题串</span></button>
    </div>
    <div class="menu-sep"></div>
    <div class="pop-heading">外观与设备</div>
    <div class="menu-grid">
      <button class="menu-item" data-action="open-theme">${icon('palette')}<span>主题</span></button>
    </div>
    <div class="pop-heading" style="margin-top:8px">设备视图（${S.resolved === 'watch' ? '手表' : S.resolved === 'phone' ? '手机' : S.resolved === 'tablet' ? '平板' : '电脑'}）</div>
    <div class="device-opts" style="padding:0 4px 4px">
      ${devices.map(([v, label, ic]) => `<button data-action="set-device" data-v="${v}" class="${S.device === v ? 'active' : ''}">${icon(ic)}<span>${label}</span></button>`).join('')}
    </div>
    <div class="menu-sep"></div>
    <button class="switch-oldver" data-action="goto-oldver">${icon('back')}<span>切换到旧版界面（全部功能）</span></button>
  </div>`;
}

// ---------- 弹窗 ----------
export function openModal(html) {
  const root = $('#modal-root');
  if (root) root.innerHTML = html;
}
export function closeModal() {
  const root = $('#modal-root');
  if (root) root.innerHTML = '';
}
export function closePop() {
  const root = $('#pop-root');
  if (root) root.innerHTML = '';
}
export function modalShell(title, bodyHTML, footHTML) {
  return `
  <div class="modal-veil open" data-modal-veil>
    <div class="modal-panel">
      <div class="modal-head"><div class="modal-title">${escapeHTML(title)}</div>
        <button class="icon-button" data-action="close-modal" title="关闭">${icon('x')}</button></div>
      <div class="modal-body">${bodyHTML}</div>
      ${footHTML ? `<div class="modal-foot">${footHTML}</div>` : ''}
    </div>
  </div>`;
}

export function oldverModalHTML(feature) {
  return modalShell(`${feature} · 旧版可用`, `
    <div class="oldver-box">
      ${icon('sparkle')}
      <p>「${escapeHTML(feature)}」暂未在新版界面中实现。<br>请切换到旧版界面使用，数据完全互通。</p>
      <button class="primary-btn" data-action="goto-oldver">前往旧版界面</button>
    </div>`);
}

export function friendsModalHTML(tab, data) {
  const tabs = [['list', '我的好友'], ['incoming', `收到的请求${data.incoming.length ? ` (${data.incoming.length})` : ''}`], ['outgoing', '已发送'], ['add', '添加好友']];
  let body = `<div class="seg-tabs">${tabs.map(([v, l]) => `<button data-action="friends-tab" data-tab="${v}" class="${tab === v ? 'active' : ''}">${l}</button>`).join('')}</div>`;
  if (tab === 'list') {
    body += data.accepted.length ? data.accepted.map(f => `
      <div class="list-row">${avatarHTML(f)}<div class="grow"><div class="t1">${escapeHTML(f.username)}</div></div>
        <button class="mini-btn" data-action="dm-user" data-username="${escapeHTML(f.username)}">私信</button>
        <button class="mini-btn danger" data-action="friend-remove" data-id="${f.id}">删除</button></div>`).join('')
      : '<div class="empty-note">还没有好友，去添加吧</div>';
  } else if (tab === 'incoming') {
    body += data.incoming.length ? data.incoming.map(f => `
      <div class="list-row">${avatarHTML(f)}<div class="grow"><div class="t1">${escapeHTML(f.username)}</div><div class="t2">请求加你为好友</div></div>
        <button class="mini-btn primary" data-action="friend-accept" data-id="${f.id}">接受</button>
        <button class="mini-btn" data-action="friend-decline" data-id="${f.id}">拒绝</button></div>`).join('')
      : '<div class="empty-note">暂无新的好友请求</div>';
  } else if (tab === 'outgoing') {
    body += data.outgoing.length ? data.outgoing.map(f => `
      <div class="list-row">${avatarHTML(f)}<div class="grow"><div class="t1">${escapeHTML(f.username)}</div><div class="t2">等待对方接受</div></div></div>`).join('')
      : '<div class="empty-note">没有待处理的请求</div>';
  } else {
    body += `<input class="search-input" id="friendSearch" placeholder="输入用户名搜索">
      <div id="friendSearchResult"></div>`;
  }
  return modalShell('好友管理', body);
}

export function notifModalHTML(list) {
  const items = list.length ? list.map(n => `
    <div class="list-row" style="${n.is_read ? 'opacity:.65' : ''}">
      <div class="grow"><div class="t1">${escapeHTML(n.title || '通知')}</div>
      <div class="t2">${escapeHTML(n.body || '')}</div>
      <div class="t2">${timeStr(n.created_at)}</div></div>
    </div>`).join('') : '<div class="empty-note">暂无通知</div>';
  return modalShell('通知中心', items,
    `<button class="secondary-btn" data-action="close-modal">关闭</button>
     ${list.some(n => !n.is_read) ? '<button class="primary-btn" data-action="notif-read-all">全部标为已读</button>' : ''}`);
}

export function pinsModalHTML() {
  const items = S.pins.length ? S.pins.map(p => {
    const uname = p.username || `用户${p.user_id}`;
    return `<div class="pin-item"><div class="pin-meta">${escapeHTML(uname)} · ${timeStr(p.pinned_at || p.created_at)}</div>
      <div class="msg-body">${renderMarkdown(p.content || '')}</div>
      <div style="margin-top:8px"><button class="mini-btn" data-action="jump-msg" data-id="${p.id}">定位</button>
      <button class="mini-btn danger" data-action="unpin" data-id="${p.id}">取消置顶</button></div></div>`;
  }).join('') : '<div class="empty-note">暂无置顶消息</div>';
  return modalShell('置顶消息', items);
}

export function searchModalHTML() {
  return modalShell('搜索消息', `
    <input class="search-input" id="msgSearchInput" placeholder="输入关键词，回车搜索${S.active?.kind === 'room' ? '（当前房间）' : '（全站）'}">
    <div id="msgSearchResult"><div class="empty-note">支持搜索消息内容</div></div>`);
}

export function searchResultHTML(results) {
  if (!results.length) return '<div class="empty-note">没有找到相关消息</div>';
  return results.map(m => {
    const where = m.room_name ? `#${escapeHTML(m.room_name)}` : (m.dm_peer_name ? `私信 ${escapeHTML(m.dm_peer_name)}` : '');
    return `<div class="list-row"><div class="grow">
      <div class="t1">${escapeHTML(m.username || '')} <span style="color:var(--faint);font-weight:400">${where} · ${timeStr(m.created_at)}</span></div>
      <div class="t2">${escapeHTML((m.content || '').slice(0, 100))}</div></div>
      ${m.room_id ? `<button class="mini-btn" data-action="search-goto-room" data-room="${m.room_id}" data-msg="${m.id}">前往</button>` : ''}
    </div>`;
  }).join('');
}

export function createRoomModalHTML(isAdmin) {
  return modalShell('新建聊天室', `
    <div class="auth-field"><label>房间名称（1–30 字）</label><input id="crName" maxlength="30" placeholder="例如：算法交流"></div>
    ${isAdmin ? `<div class="auth-field"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="crPrivate" style="width:16px;height:16px"> 设为私密房间（仅成员可见）</label></div>`
      : `<div class="empty-note" style="padding:4px 0 8px">普通成员只能创建私密聊天室，公开房间请联系管理员。</div>`}`,
    `<button class="secondary-btn" data-action="close-modal">取消</button>
     <button class="primary-btn" data-action="create-room-go">创建</button>`);
}

export function passwordModalHTML(room) {
  return modalShell('加入房间', `
    <div class="empty-note" style="padding:6px">「${escapeHTML(room.name)}」是密码房间，请输入密码</div>
    <div class="auth-field"><input id="joinPass" type="password" placeholder="房间密码"></div>`,
    `<button class="secondary-btn" data-action="close-modal">取消</button>
     <button class="primary-btn" data-action="join-room-go" data-id="${room.id}">加入</button>`);
}

export function msgMenuHTML(msgId, msg) {
  const own = msg.user_id === S.user?.id;
  const canPin = S.active?.kind === 'room';
  return `
  <div class="popover open msg-more-pop" id="msgPop" role="menu" style="min-width:170px;padding:6px">
    <button class="menu-item" data-action="msg-reply" data-id="${msgId}">${icon('reply')}<span>回复</span></button>
    ${own ? `<button class="menu-item" data-action="msg-edit" data-id="${msgId}">${icon('code')}<span>编辑</span></button>
    <button class="menu-item danger" data-action="msg-retract" data-id="${msgId}">${icon('x')}<span>撤回</span></button>` : ''}
    ${canPin ? `<button class="menu-item" data-action="msg-pin" data-id="${msgId}">${icon('pin')}<span>置顶</span></button>` : ''}
    <button class="menu-item" data-action="oldver" data-feature="话题串">${icon('thread')}<span>查看话题串</span></button>
  </div>`;
}

const EMOJIS = ['😀','😁','😂','🤣','😊','😍','😘','😜','🤔','😴','😭','😡','👍','👎','👏','🙏','💪','🎉','🔥','❤️','💔','✨','🎈','👀','💯','🤝','👋','🙌','😎','🥳'];
export function emojiGridHTML() {
  return EMOJIS.map(e => `<button data-action="insert-emoji" data-e="${e}">${e}</button>`).join('');
}

// ---------- 手表 ----------
export function watchHTML() {
  const v = S.watchView;
  let screen = '';
  if (v === 'list') {
    const items = [
      ...S.rooms.map(r => ({ kind: 'room', id: r.id, name: r.name, un: S.unreadRooms[r.id] || 0, icon: 'hash' })),
      ...S.convs.map(c => ({ kind: 'dm', id: c.id, name: c.peer?.username || '私信', un: c.unread_count || S.unreadDms[c.id] || 0, icon: 'mail' })),
    ];
    screen = `
    <div class="watch-screen watch-scroll active">
      <div class="watch-head"><div class="watch-title">PolyChat</div>${S.notifUnread ? `<span class="watch-badge">${S.notifUnread}</span>` : ''}</div>
      <div class="watch-home-list">
        ${items.map(it => `<button class="watch-chat-item" data-action="watch-open" data-kind="${it.kind}" data-id="${it.id}">
          <span class="watch-chat-icon">${icon(it.icon)}</span>
          <span class="watch-chat-name">${escapeHTML(it.name)}</span>
          ${it.un ? `<span class="watch-badge">${it.un > 9 ? '9+' : it.un}</span>` : ''}
        </button>`).join('') || '<div class="watch-empty-badge">暂无会话</div>'}
      </div>
      <div class="watch-actions">
        <button class="watch-action" data-action="goto-oldver">${icon('back')}<span>旧版</span></button>
        <button class="watch-action" data-action="set-device" data-v="auto" title="退出手表模式，恢复按设备自动识别">${icon('auto')}<span>自动</span></button>
        <button class="watch-action" data-action="logout">${icon('logout')}<span>退出</span></button>
      </div>
    </div>`;
  } else if (v === 'chat') {
    const title = S.active?.kind === 'room' ? (S.roomDetail?.name || '') : (S.convDetail?.peer?.username || '');
    screen = `
    <div class="watch-screen watch-scroll active">
      <div class="watch-head"><button class="watch-action" data-action="watch-back">${icon('back')}</button><div class="watch-title" style="font-size:13px">${escapeHTML(title)}</div><span class="watch-head-spacer"></span></div>
      <div class="watch-messages">
        ${S.messages.slice(-30).map(m => `<div class="watch-msg"><span class="watch-name">${escapeHTML(m.username || '')}</span><span class="watch-body">${escapeHTML(m.is_deleted ? '[已撤回]' : (m.content || '[附件]').slice(0, 120))}</span></div>`).join('')}
      </div>
      <button class="watch-reply-btn" data-action="watch-compose">回复</button>
    </div>`;
  } else {
    screen = `
    <div class="watch-screen watch-compose-screen active">
      <div class="watch-head"><button class="watch-action" data-action="watch-back">${icon('back')}</button><div class="watch-title" style="font-size:13px">回复</div><span class="watch-head-spacer"></span></div>
      <div class="watch-compose-body">
        <textarea id="watchInput" rows="3" placeholder="输入回复…"></textarea>
        <div class="watch-quick">${['收到','好的','+1','哈哈'].map(q => `<button data-action="watch-quick" data-t="${q}">${q}</button>`).join('')}</div>
        <button class="watch-send-full" data-action="watch-send">发送</button>
      </div>
    </div>`;
  }
  return `<div class="watch-ui">${screen}</div>`;
}

// ---------- toast ----------
let toastTimer = null;
export function showToast(text) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- SVG defs 挂载 ----------
export function mountIcons(defs) {
  if (!document.getElementById('v2-icons')) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'v2-icons';
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0';
    svg.innerHTML = `<defs>${defs}</defs>`;
    document.body.prepend(svg);
  }
}
