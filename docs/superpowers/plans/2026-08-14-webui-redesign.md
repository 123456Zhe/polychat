# PolyChat Web 桌面端 UI 改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按参考截图把 PolyChat Web 桌面端 UI 改版（sidebar 搜索+图床入口、topbar 中央搜索、消息操作外露、composer 精简、图片限宽、主题适配）。

**Architecture:** 纯前端改动，仅修改 `web-client/src/App.vue`（模板 + script）与 `web-client/src/style.css`。不碰 `server.mjs`、不碰数据库、不碰移动端（`isMobile` 分支）模板。无新增依赖。

**Tech Stack:** Vue 3 (script setup)、原生 CSS（`web-client/src/style.css`）、Vite 构建。

**Spec:** `docs/superpowers/specs/2026-08-14-webui-redesign-design.md`

## Global Constraints

- **只改桌面端**：`App.vue` 中 `<main v-else-if="!isMobile" class="chat">`（约 1015-1058 行）及其对应 `style.css`。移动端 `m-app` 分支（1059+ 行）与 `@media (max-width:768px)` 样式块一律不动。
- **sidebar 背景色不改**：现有 `.chat > aside` 及 5 套主题的 CSS 覆盖已存在，本次不新增 sidebar 背景色规则。
- **去掉 `/` 按钮**：composer 只有 `＋ ☺ MD` 三键（当前代码本来就没有 `/`，无需删除，确认不新增即可）。
- **图片最大宽度**：`.attachment-image` 与 `.markdown img` 统一 `max-width: min(100%, 520px)`。
- **消息操作按钮始终显示**：桌面端 `.bubble` 内操作按钮 `opacity: 1`，移除 hover 显示逻辑。
- **移动端样式保留**：`@media (max-width:768px)` 内所有规则不得删除或改写；若新样式影响移动端，需在移动端块内覆盖。
- 现有 Node 测试不涉及本改动（纯静态前端），但必须保持 `npm run web:build` 干净通过。
- 无新增 npm 依赖。

---

### Task 1: Sidebar — 搜索框、图床入口、底部 footer 三 icon

**Files:**
- Modify: `web-client/src/App.vue` — script（新增 ref + computed）、桌面端 aside 模板（1017-1020 行）
- Modify: `web-client/src/style.css` — 新增 sidebar 搜索框/图床按钮/footer 样式

**Interfaces:**
- Produces: `sidebarSearchQuery` (ref<string>)、`filteredRooms` (computed<Room[]>)、`filteredConversations` (computed<Conversation[]>)
- Consumes: 已有 `rooms`、`conversations`、`galleryOpen`、`loadGallery`、`profileOpen`、`themeOpen`、`logout`、`toggleNotifications`

- [ ] **Step 1: script 新增搜索状态与过滤 computed**

在 `App.vue` script 区（建议放在 `const sidebarOpen = ref(false), isMobile = ref(false);` 附近）添加：

```js
const sidebarSearchQuery = ref('');
const sidebarSearching = computed(() => sidebarSearchQuery.value.trim().length > 0);
const filteredRooms = computed(() => {
  const q = sidebarSearchQuery.value.trim().toLowerCase();
  if (!q) return rooms.value;
  return rooms.value.filter(item => item.name.toLowerCase().includes(q));
});
const filteredConversations = computed(() => {
  const q = sidebarSearchQuery.value.trim().toLowerCase();
  if (!q) return conversations.value;
  return conversations.value.filter(conv => (conv.peer?.username || '').toLowerCase().includes(q));
});
```

- [ ] **Step 2: aside 模板加入搜索框（聊天室 nav-label 之前）**

把桌面端 aside 中 `...</header><button class="new" ...>＋</button> 新建聊天室</button><p class="nav-label">聊天室</p>...` 的 `<p class="nav-label">聊天室</p>` 之前插入：

```html
<div class="sidebar-search"><span>⌕</span><input v-model="sidebarSearchQuery" placeholder="搜索聊天室或私信…" type="text"></div>
```

- [ ] **Step 3: 两个 nav 改用过滤后的列表**

桌面端房间 nav：`v-for="item in rooms"` → `v-for="item in filteredRooms"`；
私信 nav：`v-for="conv in conversations"` → `v-for="conv in filteredConversations"`。
搜索非空且列表为空时，在对应 nav 下方显示 `<p class="sidebar-empty">无匹配结果</p>`（需 `v-if="sidebarSearching && !filteredRooms.length"`，私信同理）。

- [ ] **Step 4: 私信 nav 之下新增「我的图床」独立按钮**

私信 nav 结束后（`</nav>` 之后、`<footer>` 之前）插入：

```html
<button class="sidebar-gallery" title="我的图床" @click="galleryOpen = true; loadGallery()"><span>🖼</span> 我的图床</button>
```

- [ ] **Step 5: footer 压缩为 头像+用户名+三个 icon 按钮**

替换桌面端 `<footer>...</footer>` 为：

```html
<footer class="sidebar-footer"><button class="profile-button" title="个人资料" @click="profileOpen = true"><img v-if="avatar(user)" :src="avatar(user)"><b v-else>{{ user.username[0] }}</b></button><span><b>{{ user.username }}<small class="user-number">#{{ user.number || user.id }}</small></b><small>{{ isAdmin ? '管理员 · 在线' : '在线' }}</small></span><button class="footer-icon" title="主题与自定义 CSS" @click="themeOpen = true">◐</button><button class="footer-icon" title="桌面通知" @click="toggleNotifications">{{ notificationOn ? '🔔' : '🔕' }}</button><button class="footer-icon" title="退出登录" @click="logout">↪</button></footer>
```

- [ ] **Step 6: 新增对应 CSS**

在 `style.css` 中（`.nav-add` 规则附近）新增：

```css
.sidebar-search { display: flex; align-items: center; gap: 7px; padding: 7px 10px; margin: 4px 0 2px; border: 1px solid rgba(255,255,255,.12); border-radius: 9px; color: var(--blue-400); background: rgba(255,255,255,.06); }
.sidebar-search input { min-width: 0; flex: 1; border: 0; outline: none; color: #fff; font-size: 12px; background: transparent; }
.sidebar-search input::placeholder { color: var(--blue-400); }
.sidebar-empty { padding: 8px 10px; color: var(--blue-400); font-size: 11px; }
.sidebar-gallery { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 6px; padding: 9px 10px; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; color: #e8edf3; font-size: 12px; text-align: left; background: rgba(154,173,185,.1); }
.sidebar-gallery:hover { background: rgba(154,173,185,.2); }
.sidebar-gallery span { color: var(--blue-400); font-size: 15px; }
.sidebar-footer { display: flex; align-items: center; gap: 7px; margin-top: auto; padding: 12px 5px 2px; border-top: 1px solid rgba(255,255,255,.1); }
.sidebar-footer > span { min-width: 0; display: grid; flex: 1; overflow: hidden; font-size: 12px; }
.sidebar-footer > span b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar-footer > span small { margin-top: 1px; color: #a9d2be; font-size: 10px; font-weight: 500; }
.sidebar-footer .footer-icon { padding: 6px 5px; border: 0; border-radius: 7px; color: #bdc9d5; font-size: 15px; background: transparent; }
.sidebar-footer .footer-icon:hover { color: #fff; background: rgba(255,255,255,.1); }
```

注意：现有 `.chat > aside > footer`、`.profile-button` 等规则复用，无需删除。移动端 `@media` 块内如引用了旧 footer 结构，需核对不受影响（移动端用 `m-app` 独立结构，无依赖）。

- [ ] **Step 7: 构建验证**

Run: `npm run web:build`
Expected: 构建成功无报错。

- [ ] **Step 8: 提交**

```bash
git add web-client/src/App.vue web-client/src/style.css
git commit -m "feat(web): sidebar 搜索、图床入口与 footer 三 icon"
```

---

### Task 2: Topbar — 56px 高度、中央搜索框（⌘K）、右侧按钮精简

**Files:**
- Modify: `web-client/src/App.vue` — 桌面端 topbar 模板（1022-1041 行）、script（键盘监听）
- Modify: `web-client/src/style.css` — topbar 高度、搜索框、按钮样式

**Interfaces:**
- Consumes: 已有 `searchOpen`、`searchText`、`openFriends`、`openAnnouncement`、`openRoomManage`、`openInviteCodePrompt`、`loadMembers`、`loadPins`、`themeOpen`、`adminOpen`、`openNotifications`、`helpOpen`、`notifUnreadCount`、`isAdmin`、`room`
- Produces: `openTopSearch()`（打开搜索 modal）、⌘K 全局快捷键

- [ ] **Step 1: 新增 ⌘K 键盘监听与搜索打开函数**

在 script 区（`onMounted` 前后均可）添加：

```js
function openTopSearch() { searchOpen.value = true; }
function handleGlobalShortcut(event) {
  if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
    event.preventDefault();
    if (user.value) openTopSearch();
  }
}
```

在 `onMounted` 中注册、`onBeforeUnmount` 中移除：

```js
onMounted(() => { window.addEventListener('keydown', handleGlobalShortcut); });
onBeforeUnmount(() => { window.removeEventListener('keydown', handleGlobalShortcut); });
```

（`onMounted`/`onBeforeUnmount` 已从 vue 导入并在现有代码中使用，确认合并到现有调用即可。）

- [ ] **Step 2: 重写桌面端 topbar 模板**

替换 `App.vue` 桌面端 `<header class="topbar">...</header>`（1022-1041 行）为：

```html
<header class="topbar">
  <div class="topbar-title" v-if="view === 'dm' && conversation"><button class="toolbar-button" @click="selectRooms">← 返回</button><h2><span>✉</span> {{ conversation.peer?.username }} <small>私信</small></h2></div>
  <div class="topbar-title" v-else><h2><span>#</span> {{ room?.name || '大厅' }} <small v-if="room?.is_private">🔒 私有</small></h2><small><i class="online-dot"></i>{{ onlineUsers.length }} 人在线<span v-if="typingText"> · {{ typingText }}</span></small></div>
  <div class="topbar-search" title="搜索消息 (Ctrl+K)" @click="openTopSearch"><span>⌕</span><span class="topbar-search-ph">搜索消息、用户或频道</span><kbd>⌘K</kbd></div>
  <div class="topbar-actions">
    <button class="toolbar-button" title="好友与私信" @click="openFriends"><span>👥</span><em>好友</em><small v-if="totalDmUnread || friendList.incoming.length" class="unread">{{ (totalDmUnread + friendList.incoming.length) > 99 ? '99+' : (totalDmUnread + friendList.incoming.length) }}</small></button>
    <button v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" class="toolbar-button" title="房间公告" @click="openAnnouncement"><span>📢</span><em>公告</em></button>
    <button v-if="view !== 'dm'" class="toolbar-button" title="房间操作" @click="roomQuickMenuOpen = !roomQuickMenuOpen"><span>⚙</span><em>房间</em></button>
    <button class="toolbar-button" title="更多" @click="moreMenuOpen = !moreMenuOpen"><span>⋯</span><em>更多</em></button>
    <button class="toolbar-button notif-bell" :class="{active: notifOpen}" title="通知" @click="openNotifications"><span>🔔</span><small v-if="notifUnreadCount" class="unread">{{ notifUnreadCount > 99 ? '99+' : notifUnreadCount }}</small></button>
    <button class="toolbar-button" title="帮助" @click="helpOpen = true"><span>?</span><em>帮助</em></button>
  </div>
</header>
```

- [ ] **Step 3: 房间/更多下拉菜单**

在 topbar 之后（`</header>` 与 `global-announcement-bar` 之间）新增两个下拉面板：

```html
<div v-if="roomQuickMenuOpen" class="topbar-dropdown" style="right: 230px"><button @click="loadPins(); roomQuickMenuOpen = false">⌖ 置顶消息</button><button @click="openInviteCodePrompt(); roomQuickMenuOpen = false">🔗 加入房间</button><button v-if="room?.is_private && (room?.role === 'owner' || room?.role === 'admin' || isAdmin)" @click="loadMembers(); roomQuickMenuOpen = false">♙ 成员管理</button><button v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" @click="openRoomManage(); roomQuickMenuOpen = false">⚙ 房间设置</button><button @click="searchOpen = true; roomQuickMenuOpen = false">⌕ 搜索消息</button></div>
<div v-if="moreMenuOpen" class="topbar-dropdown" style="right: 60px"><button @click="themeOpen = true; moreMenuOpen = false">◐ 主题与自定义 CSS</button><button v-if="isAdmin" @click="adminOpen = true; loadAdmin(); loadBannedIps(); loadBannedFingerprints(); loadBotRequests(); loadBotTokens(); adminTab = 'users'; moreMenuOpen = false">🛡 管理面板</button><button @click="openNotifications(); moreMenuOpen = false">🔔 通知中心</button><button @click="openFriends(); moreMenuOpen = false">👥 好友与私信</button></div>
```

script 新增：`const roomQuickMenuOpen = ref(false), moreMenuOpen = ref(false);`

- [ ] **Step 4: topbar CSS**

在 `style.css` 中调整/新增：

```css
.conversation { grid-template-rows: 56px auto minmax(0, 1fr) auto; }
.topbar { padding: 0 18px; gap: 12px; position: relative; }
.topbar-title { min-width: 0; display: grid; margin-right: auto; }
.topbar-title h2 { margin: 0; overflow: hidden; font-size: 17px; letter-spacing: -.02em; text-overflow: ellipsis; white-space: nowrap; }
.topbar-title h2 span { color: var(--blue-600); }
.topbar-title small { color: #8993a2; font-size: 10px; }
.topbar-search { display: flex; align-items: center; gap: 8px; min-width: 0; width: min(320px, 36%); padding: 7px 12px; border: 1px solid var(--warm-200); border-radius: 9px; color: #8b93a0; background: var(--warm-100); cursor: text; }
.topbar-search:hover { border-color: var(--blue-400); }
.topbar-search-ph { flex: 1; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.topbar-search kbd { padding: 1px 6px; border: 1px solid var(--warm-300); border-radius: 5px; color: #9aa3b1; font-size: 10px; font-family: inherit; background: var(--white); }
.topbar-actions { display: flex; align-items: center; gap: 4px; }
.topbar-dropdown { position: absolute; top: 52px; z-index: 5; display: grid; min-width: 150px; padding: 5px; border: 1px solid var(--warm-200); border-radius: 10px; background: var(--white); box-shadow: 0 12px 28px rgba(34,45,65,.16); }
.topbar-dropdown button { padding: 8px 10px; border: 0; border-radius: 7px; color: #536174; font-size: 12px; text-align: left; background: transparent; }
.topbar-dropdown button:hover { background: var(--warm-100); }
```

`.topbar` 原为 `display:flex; align-items:center; gap:9px; padding:0 23px`，改后保留 flex 布局：`.topbar-title` 用 `margin-right:auto` 推开，`.topbar-search` 占中间，`.topbar-actions` 自然靠右。原 `.topbar > div { margin-right: auto; }` 规则删除，替换为 `.topbar-title` 规则。

- [ ] **Step 5: 构建验证**

Run: `npm run web:build`
Expected: 构建成功无报错。

- [ ] **Step 6: 提交**

```bash
git add web-client/src/App.vue web-client/src/style.css
git commit -m "feat(web): topbar 中央搜索、56px 高度与下拉菜单"
```

---

### Task 3: 消息区 — 操作按钮外露、圆角、图片限宽、日期分隔、系统头像

**Files:**
- Modify: `web-client/src/App.vue` — 桌面端消息模板（1050、1054 行）、script（日期 helper）
- Modify: `web-client/src/style.css` — bubble 圆角、操作按钮、图片限宽、日期分隔、系统头像

**Interfaces:**
- Consumes: 已有 `messages`、`dmMessages`、`startReply`、`startDmReply`、`openThread`、`copy`、`beginEdit`、`retract`、`retractDm`、`pinMessage`、`toggleReaction`、`toggleDmReaction`、`reactionPickerFor`、`openMessageActions`
- Produces: `dayKey(value)`、`dayLabel(value)` 日期 helper

- [ ] **Step 1: script 新增日期分组 helper**

```js
function dayKey(value) { const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`; const d = new Date(normalized); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function dayLabel(value) { const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`; const d = new Date(normalized); const today = new Date(); const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate(); return sameDay ? '今天' : d.toLocaleDateString([], { month: 'long', day: 'numeric' }); }
```

- [ ] **Step 2: 重构桌面端房间消息 article 模板（1054 行）**

将房间消息 `article` 替换为（关键变化：header 右侧操作按钮横排外露、bubble 内嵌日期分隔与系统头像兜底）：

```html
<article v-for="(message, index) in messages" :key="message.id">
  <div v-if="index === 0 || dayKey(messages[index - 1].created_at) !== dayKey(message.created_at)" class="day-divider">{{ dayLabel(message.created_at) }}</div>
  <div class="avatar" :class="{sys: message.username === '系统'}"><img v-if="avatar(message)" :src="avatar(message)"><b v-else-if="message.username === '系统'">🤖</b><b v-else>{{ message.username[0] }}</b></div>
  <div class="bubble"><header><strong>{{ message.username }}<small class="user-number">#{{ message.user_id }}</small><i v-if="onlineIds.has(message.user_id)" class="online-dot" title="在线"></i></strong><small>{{ time(message.created_at) }}{{ message.edited_at ? ' · 已编辑' : '' }}</small><div class="message-actions"><button class="msg-action" title="回复" @click="startReply(message)">↩ 回复</button><button class="msg-action" title="添加表情" @click="reactionPickerFor = reactionPickerFor === message.id ? null : message.id">☺</button><button class="message-menu-trigger" @click="openMessageActions = openMessageActions === message.id ? null : message.id">•••</button></div><div v-if="openMessageActions === message.id" class="message-menu"><button @click="startReply(message); openMessageActions = null">回复</button><button @click="openThread(message); openMessageActions = null">打开话题</button><button @click="copy(message); openMessageActions = null">复制 Markdown</button><button v-if="isAdmin || room?.role === 'owner' || room?.role === 'admin'" @click="pinMessage(message); openMessageActions = null">置顶消息</button><button v-if="message.user_id === user.id && !message.deleted_at" @click="beginEdit(message); openMessageActions = null">编辑</button><button v-if="message.user_id === user.id || isAdmin || room?.role === 'owner' || room?.role === 'admin'" class="danger" @click="retract(message); openMessageActions = null">撤回</button></div></header><blockquote v-if="message.reply_to" class="reply-reference">回复 {{ message.reply_username || '消息' }}：{{ message.reply_content || '已撤回的消息' }}</blockquote><p v-if="message.deleted_at" class="retracted">此消息已撤回</p><div v-else-if="message.content" class="markdown" @click="previewMarkdownImage" v-html="markdown(message.content, message.mentions)"></div><template v-if="message.attachment_id"><img v-if="imageTypes.has(message.attachment_type)" class="attachment-image previewable" :src="`/api/files/${message.attachment_id}?inline=1`" :alt="message.attachment_name" @click="previewImage(`/api/files/${message.attachment_id}?inline=1`)"><a v-else class="attachment-file" :href="`/api/files/${message.attachment_id}`"><span>↓</span><div><b>{{ message.attachment_name }}</b><small>{{ size(message.attachment_size) }}</small></div></a></template><div v-if="!message.deleted_at" class="reactions"><button v-for="reaction in message.reactions" :key="reaction.emoji" :class="{active: reaction.reacted}" @click="toggleReaction(message, reaction.emoji)">{{ reaction.emoji }} {{ reaction.count }}</button><button class="reaction-add" @click="reactionPickerFor = reactionPickerFor === message.id ? null : message.id">☺</button></div><div v-if="reactionPickerFor === message.id" class="reaction-picker"><button v-for="emoji in emojiGroups['常用']" :key="emoji" @click="toggleReaction(message, emoji)">{{ emoji }}</button></div></div>
</article>
```

注意：`reaction-picker` 从 `.reactions` 内部移到 `.bubble` 尾部（与 header ☺、reactions ☺ 共用 `reactionPickerFor`）。

- [ ] **Step 3: 重构桌面端 DM 消息 article 模板（1050 行）**

DM 模板同样处理：header 右侧操作按钮（回复/☺/•••）、日期分隔、系统头像兜底、reaction-picker 移到 bubble 尾部。DM 无「打开话题/置顶」，菜单保留现有 DM 项（回复/复制/编辑/撤回）：

```html
<article v-for="(message, index) in dmMessages" :key="message.id">
  <div v-if="index === 0 || dayKey(dmMessages[index - 1].created_at) !== dayKey(message.created_at)" class="day-divider">{{ dayLabel(message.created_at) }}</div>
  <div class="avatar" :class="{sys: message.username === '系统'}"><img v-if="dmAvatar(message)" :src="dmAvatar(message)"><b v-else-if="message.username === '系统'">🤖</b><b v-else>{{ message.username[0] }}</b></div>
  <div class="bubble"><header><strong>{{ message.username }}<small class="user-number">#{{ message.user_id }}</small><i v-if="onlineIds.has(message.user_id)" class="online-dot" title="在线"></i></strong><small>{{ time(message.created_at) }}{{ message.edited_at ? ' · 已编辑' : '' }}</small><div class="message-actions"><button class="msg-action" title="回复" @click="startDmReply(message)">↩ 回复</button><button class="msg-action" title="添加表情" @click="reactionPickerFor = reactionPickerFor === message.id ? null : message.id">☺</button><button class="message-menu-trigger" @click="openMessageActions = openMessageActions === message.id ? null : message.id">•••</button></div><div v-if="openMessageActions === message.id" class="message-menu"><button @click="startDmReply(message); openMessageActions = null">回复</button><button @click="copy(message); openMessageActions = null">复制 Markdown</button><button v-if="message.user_id === user.id && !message.deleted_at" @click="beginEdit(message); openMessageActions = null">编辑</button><button v-if="message.user_id === user.id || isAdmin" class="danger" @click="retractDm(message); openMessageActions = null">撤回</button></div></header><blockquote v-if="message.reply_to" class="reply-reference">回复 {{ message.reply_username || '消息' }}：{{ message.reply_content || '已撤回的消息' }}</blockquote><p v-if="message.deleted_at" class="retracted">此消息已撤回</p><div v-else-if="message.content" class="markdown" @click="previewMarkdownImage" v-html="markdown(message.content, message.mentions)"></div><template v-if="message.attachment_id"><img v-if="imageTypes.has(message.attachment_type)" class="attachment-image previewable" :src="`/api/files/${message.attachment_id}?inline=1`" :alt="message.attachment_name" @click="previewImage(`/api/files/${message.attachment_id}?inline=1`)"><a v-else class="attachment-file" :href="`/api/files/${message.attachment_id}`" :download="message.attachment_name">{{ message.attachment_name }}</a></template><template v-if="message.p2p_transfer_id && !message.deleted_at"><div class="p2p-card"><span>📦</span><div><b>{{ message.p2p_name }}</b><small>{{ size(message.p2p_size) }} · P2P 直传</small><div class="p2p-card-actions"><template v-if="p2pLocalIds.has(message.p2p_transfer_id)"><button @click="downloadP2p(message)">下载</button><button class="danger" @click="deleteLocalP2p(message)">删除本机副本</button></template><small v-else-if="message.p2p_sender_id === user.id">已通过 P2P 直传</small><small v-else class="p2p-note">文件仅到达接收设备</small></div></div></div></template><div class="reactions" v-if="message.reactions && message.reactions.length"><button v-for="reaction in message.reactions" :key="reaction.emoji" @click="toggleDmReaction(message, reaction.emoji)">{{ reaction.emoji }} {{ reaction.count }}</button></div></div>
</article>
```

- [ ] **Step 4: 消息区 CSS**

在 `style.css` 中新增/调整：

```css
.messages-scroll article { grid-template-columns: 42px minmax(0, 1fr); }
.day-divider { grid-column: 1 / -1; margin: 6px 0 2px; color: #9aa3b1; font-size: 11px; font-weight: 500; text-align: center; letter-spacing: .02em; }
.avatar.sys b { background: linear-gradient(135deg, #22c55e, #16a34a); }
.bubble { border-radius: 14px 14px 14px 14px; }
.bubble > header { gap: 8px; }
.bubble > header .message-actions { display: flex; align-items: center; gap: 2px; margin-left: auto; }
.msg-action { padding: 3px 7px; border: 0; border-radius: 6px; color: #8b93a0; font-size: 11px; background: transparent; }
.msg-action:hover { color: var(--slate-900); background: var(--warm-200); }
.message-menu-trigger { margin-left: 0; opacity: 1; }
.bubble .attachment-image, .bubble .markdown img { max-width: min(100%, 520px) !important; }
.reactions { position: static; }
.reaction-picker { position: absolute; z-index: 4; bottom: calc(100% + 6px); right: 12px; display: flex; flex-wrap: wrap; gap: 3px; width: 230px; padding: 7px; border: 1px solid var(--warm-200); border-radius: 10px; background: var(--white); box-shadow: 0 10px 24px rgba(34,45,65,.16); }
.bubble { position: relative; }
```

注意：`.bubble { position: relative; }` 使 reaction-picker 相对 bubble 定位。删除旧 `.reaction-picker { left: 0; }` 定位（改为 right 定位）。
**关键覆盖**：旧规则 `.bubble > header button { opacity: 0 }`（style.css:170）与 `.bubble:hover > header button { opacity: 1 }`（style.css:171）必须改为始终显示，否则「回复/☺」按钮也一起被隐藏。将 style.css:170-171 两行替换为：

```css
.bubble > header button { opacity: 1; }
```

- [ ] **Step 5: 构建验证**

Run: `npm run web:build`
Expected: 构建成功无报错。

- [ ] **Step 6: 提交**

```bash
git add web-client/src/App.vue web-client/src/style.css
git commit -m "feat(web): 消息操作外露、日期分隔、系统头像与图片限宽"
```

---

### Task 4: Composer — 去重、发送按钮强调色、placeholder

**Files:**
- Modify: `web-client/src/App.vue` — 桌面端 composer 模板（1056-1057 行）
- Modify: `web-client/src/style.css` — composer 样式

**Interfaces:**
- Consumes: 现有 composer 逻辑不变（`send`、`sendDm`、`emojiOpen`、`mdHelpOpen`、`files`、`dmFiles` 等）

- [ ] **Step 1: 确认 composer 无 `/` 按钮**

当前桌面端 composer 左键组为 `＋ ☺ MD`（无 `/`）。核对模板确认，无需改动按钮组。

- [ ] **Step 2: 发送按钮加强调色 + 占位链接图标**

房间 composer 的 `</div><button class="send" title="发送消息">发送</button></div>` 改为：

```html
</div><button type="button" class="attach link-attach" title="（占位）">🔗</button><button class="send" title="发送消息">发送</button></div>
```

DM composer 的 `<button class="send" :disabled="dmSending" title="发送">发送</button>` 改为：

```html
<button type="button" class="attach link-attach" title="（占位）">🔗</button><button class="send" :disabled="dmSending" title="发送">发送</button>
```

- [ ] **Step 3: composer CSS**

```css
.composer { box-shadow: none; }
.compose-row .send { background: linear-gradient(135deg, #0f766e, #134e4a); }
.compose-row .send:hover { filter: brightness(1.1); }
.link-attach { font-size: 16px; }
```

（`#0f766e → #134e4a` 为深青强调色；主题覆盖规则里 `.send` 已由 `amber-rose` 等覆盖，新增的 `.compose-row .send` 只在无主题覆盖时生效——由于主题 CSS 也是写 `.send`，特异性相同、后定义者胜，主题 css 通过 `themeStyleElement` 注入晚于 style.css，因此主题强调色仍会生效，符合「5 套主题全适配」预期。）

- [ ] **Step 4: 构建验证**

Run: `npm run web:build`
Expected: 构建成功无报错。

- [ ] **Step 5: 提交**

```bash
git add web-client/src/App.vue web-client/src/style.css
git commit -m "feat(web): composer 发送按钮强调色与占位链接图标"
```

---

### Task 5: 主题适配核对与收尾

**Files:**
- Modify: `web-client/src/App.vue` — `themes` 数组（116-122 行）5 套主题 CSS 串
- Modify: `web-client/src/style.css` — 如需兜底

**Interfaces:**
- Consumes: `activeTheme`、`renderThemeCss`（现有机制）

- [ ] **Step 1: 核对 5 套主题对新元素无空白**

手动核对 `themes` 中 5 套 css 串对以下新选择器的覆盖是否合理：
- `.sidebar-search` / `.sidebar-gallery`（sidebar 底色由主题控制，透明 rgba 白字在深色 sidebar 下正常；amber-rose 的 `.chat nav button` 已定义浅字，侧栏搜索输入 `color:#fff` 在 amber-rose 浅色 sidebar 下需核对）
- `.send`（每套主题已定义渐变背景，确认 `.compose-row .send` 不与之冲突——主题 css 后注入，胜出）
- `.msg-action`、`.reaction-picker`（浅色主题下 `--warm-*` 变量即可）

若 amber-rose 等浅色 sidebar 主题下 sidebar 搜索框/图床按钮文字对比度不足，在该主题 css 串追加：
```css
.chat > aside .sidebar-search input, .chat > aside .sidebar-search, .chat > aside .sidebar-gallery { color: inherit; }
.chat > aside .sidebar-search { border-color: rgba(0,0,0,.12); background: rgba(255,255,255,.1); }
```
（具体按实测结果决定是否追加；不追加也属可接受——除非肉眼对比度明显不足。）

- [ ] **Step 2: 端到端构建验证**

Run: `npm run web:build`（无报错）→ `npm test`（确认 53/53 通过，证明 server 未受影响）

- [ ] **Step 3: 浏览器冒烟（桌面端 1280×800）**

启动 `./run-server.sh` 后浏览器验证（可用 browser-use / web-gui-tester 技能）：
1. 登录后 sidebar 显示搜索框、图床按钮、footer 三 icon
2. sidebar 输入「test」实时过滤聊天室/私信，清空恢复
3. topbar 中央搜索框点击弹出搜索 modal；Ctrl+K 同样呼出
4. 消息右侧 回复/☺/••• 始终可见，回复/表情/更多菜单可用
5. 发送图片消息，气泡内图片 max-width ≤ 520px
6. 日期分隔线（今天 → 「今天」，跨天 → 「8月13日」样式）
7. 5 套主题逐个切换，sidebar/topbar/composer/气泡视觉正常
8. 通知铃铛、帮助、管理面板弹层正常

- [ ] **Step 4: 提交**

```bash
git add web-client/src/App.vue web-client/src/style.css
git commit -m "feat(web): 主题适配核对与 UI 改版收尾"
```
