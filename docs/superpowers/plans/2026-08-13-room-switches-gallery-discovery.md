# 房间开关 + 个人图床 + 局域网发现端点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 PolyChat 增加房间四项开关（锁定/隐藏/密码/只读）并重构私有房为"可见+可加入"、新增个人图床插件（本地 + 七牛 Kodo 双后端）、新增局域网发现端点插件。

**Architecture:** 三个独立子系统分阶段交付，每阶段独立可测：① 房间开关直接改核心 `server.mjs`（join/发言校验在核心，插件钩子覆盖不到）② 图床做成内置插件 `polychat-plugin-gallery`（复用插件注册表与核心 ctx，schema 集中建在核心）③ 发现端点做成内置插件 `polychat-plugin-lan-discovery`（health 同套路）。新插件通过 `modules/plugin-loader.js` 的 `BUILTIN_MODULES` 静态导入注册为内置，SEA 单文件自动打包。

**Tech Stack:** Node 22.5+（`node:sqlite`/`node:http`/`node:crypto`）、Vue 3 + Vite（web-client）、内置插件制（manifest + `setup(ctx)`）、`qiniu` npm SDK（图床七牛后端）、`node --test`（TDD）。

**Spec:** `docs/superpowers/specs/2026-08-13-room-switches-gallery-discovery-design.md`

## Global Constraints

- Node >= 22.5；测试命令 `npm test`（`node --test test/*.test.mjs`），新增测试文件放 `test/` 下即被自动发现。
- 数据库 schema 集中创建/迁移在 `server.mjs`（插件只搬逻辑不搬 schema）；迁移用 `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` 模式。
- 内置插件 = `modules/plugin-loader.js` 顶部静态 `import` + 加入 `BUILTIN_MODULES`；新插件 `plugins/polychat-plugin-<name>/index.js`（ESM，`package.json` 已 `"type": "module"`），manifest 含 `name/version/description/enabledByDefault/defaultConfig/setup(ctx)`。
- 插件配置：`data/plugins.json` 自动生成/迁移，`defaultConfig` 与配置逐键合并；env 覆盖（`GALLERY_*`、`QINIU_*`）；`DISABLED_PLUGINS` 黑名单优先。
- `NODE_ENV=test` 下外部插件不自动加载（需 `loadExternalPlugins()`）；**内置插件**经 `setupPlugins` 同步加载，测试中可用。
- 路由注册在 `server.mjs` 的 if-chain（`req.method === 'X' && url.pathname === '...'`）；插件用 `registry.registerApiRoute('METHOD', '/path', handler)`。
- 命名规范：`gallery` / `lan-discovery`；环境变量前缀 `GALLERY_` / `QINIU_`（沿用 `BACKUP_*`/`VAPID_*` 惯例）。
- 每次任务结束必须 `npm test` 全绿 + `git commit`。所有提交在 main 分支。

---

## Phase A：房间开关（核心）

### Task A1: 房间开关 Schema 迁移 + 加入申请表

**Files:**
- Modify: `server.mjs`（schema 建表段 ~line 130 附近；自动迁移段 ~line 300 附近）
- Test: `test/api.test.mjs`（追加测试）

**Interfaces:**
- Consumes: 现有 `db`、`PRAGMA table_info` 迁移模式
- Produces: `rooms` 表新列 `locked/hidden/password_hash/readonly`；新表 `room_join_requests(id, room_id, user_id, status, created_at, UNIQUE(room_id, user_id))`

- [ ] **Step 1: 写失败测试**（追加到 `test/api.test.mjs`）

```js
test('房间开关：新列与加入申请表存在（迁移生效）', async () => {
  const cols = db.prepare('PRAGMA table_info(rooms)').all().map(c => c.name);
  for (const c of ['locked', 'hidden', 'password_hash', 'readonly']) assert.ok(cols.includes(c), `rooms 缺列 ${c}`);
  const joinTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='room_join_requests'").get();
  assert.ok(joinTable, '缺少 room_join_requests 表');
});
```

- [ ] **Step 2: 运行确认失败** — `node --test test/api.test.mjs`，预期 FAIL（缺列/缺表）
- [ ] **Step 3: 实现迁移**（`server.mjs` 建表段，紧跟 `room_pins` 建表后）

```js
db.exec(`CREATE TABLE IF NOT EXISTS room_join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL,
  UNIQUE(room_id, user_id)
)`);
```

自动迁移段（模仿现有 `dmMemberColumns` 写法）：

```js
const roomColumns = new Set(db.prepare('PRAGMA table_info(rooms)').all().map(column => column.name));
if (!roomColumns.has('locked')) db.exec('ALTER TABLE rooms ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
if (!roomColumns.has('hidden')) db.exec('ALTER TABLE rooms ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
if (!roomColumns.has('password_hash')) db.exec('ALTER TABLE rooms ADD COLUMN password_hash TEXT');
if (!roomColumns.has('readonly')) db.exec('ALTER TABLE rooms ADD COLUMN readonly INTEGER NOT NULL DEFAULT 0');
```

- [ ] **Step 4: 运行确认通过** — `node --test test/api.test.mjs`，预期 PASS
- [ ] **Step 5: 提交**

```bash
git add server.mjs test/api.test.mjs
git commit -m "feat: add room switch columns and join-requests table migration"
```

---

### Task A2: 房间列表可见性变更（私有房可见 + hidden 过滤）

**Files:**
- Modify: `server.mjs` `GET /api/rooms`（~line 1028）
- Test: `test/api.test.mjs`

**Interfaces:**
- Consumes: Task A1 新列
- Produces: `GET /api/rooms` 响应中每个房间含 `locked/hidden/readonly/has_password`（布尔）；过滤条件 `hidden = 0 OR 是成员 OR 管理员`

- [ ] **Step 1: 写失败测试**

```js
test('房间列表：私有房非成员可见（🔒）、hidden 房仅成员可见', async () => {
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'bob_list', password: 'pw' }) });
  const authB = { authorization: `Bearer ${bob.body.token}` };
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'alice_list', password: 'pw' }) });
  const authA = { authorization: `Bearer ${alice.body.token}` };

  const priv = await api('/api/rooms', { method: 'POST', headers: authA, body: JSON.stringify({ name: '私有房列表', is_private: true }) });
  const hidden = await api('/api/rooms', { method: 'POST', headers: authA, body: JSON.stringify({ name: '隐藏房列表' }) });
  await api(`/api/rooms/${hidden.body.room.id}/settings`, { method: 'PATCH', headers: authA, body: JSON.stringify({ hidden: true }) });

  const listB = await api('/api/rooms', { headers: authB });
  const names = listB.body.rooms.map(r => r.name);
  assert.ok(names.includes('私有房列表'), '非成员应看到私有房名');
  assert.ok(!names.includes('隐藏房列表'), '非成员不应看到 hidden 房');

  // 已是成员 → hidden 房可见
  await api(`/api/rooms/${hidden.body.room.id}/members`, { method: 'POST', headers: authA, body: JSON.stringify({ username: 'bob_list' }) });
  const listB2 = await api('/api/rooms', { headers: authB });
  assert.ok(listB2.body.rooms.some(r => r.name === '隐藏房列表'), '成员应看到 hidden 房');
  const privItem = listB2.body.rooms.find(r => r.name === '私有房列表');
  assert.equal(privItem.is_private, true);
});
```

- [ ] **Step 2: 运行确认失败**（列表仍按 is_private 过滤，非成员看不到私有房名；无新字段）
- [ ] **Step 3: 实现**（把 `GET /api/rooms` 的 SELECT 加新列、WHERE 改 `hidden`、返回前布尔化）

```js
const rooms = db.prepare(`SELECT rooms.id, rooms.name, rooms.created_at, rooms.is_private, room_members.role,
  rooms.announcement, rooms.announcement_by, rooms.announcement_updated_at,
  rooms.locked, rooms.hidden, rooms.readonly, rooms.password_hash IS NOT NULL AS has_password,
  announcers.username AS announcement_username,
  (SELECT COUNT(*) FROM messages WHERE messages.room_id = rooms.id) AS message_count
  FROM rooms LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
  LEFT JOIN users AS announcers ON announcers.id = rooms.announcement_by
  WHERE rooms.hidden = 0 OR room_members.user_id IS NOT NULL OR ? = 1 ORDER BY rooms.id`).all(user.id, user.is_admin ? 1 : 0);
return json(res, 200, { rooms: rooms.map(r => ({ ...r, locked: Boolean(r.locked), hidden: Boolean(r.hidden), readonly: Boolean(r.readonly), has_password: Boolean(r.has_password) })) });
```

> 注意：`GET /api/events`、`/api/search`、`requireRoomAccess` 的消息可读性条件**保持不变**（`is_private = 0 OR 成员 OR 管理员`）。

- [ ] **Step 4: 运行确认通过**（含既有 25 条全绿）
- [ ] **Step 5: 提交**

```bash
git add server.mjs test/api.test.mjs
git commit -m "feat: private rooms visible in list, hidden rooms filtered by membership"
```

---

### Task A3: PATCH /api/rooms/:id/settings（四开关）+ WS 广播

**Files:**
- Modify: `server.mjs`（房间相关 if-chain，`roomMemberMatch` 附近）
- Test: `test/api.test.mjs`

**Interfaces:**
- Consumes: `requireRoomManager`、`hashPassword`、`logAudit`、`broadcast`
- Produces: `PATCH /api/rooms/:id/settings`，body `{locked?, hidden?, password?, readonly?}`（password 空串=清除）；广播 `{type:'room_settings', room_id, locked, hidden, readonly, has_password}` + `{type:'rooms'}`；200 返回 `{settings}`
- 后续任务用：`context.room.locked/hidden/readonly/password_hash`

- [ ] **Step 1: 写失败测试**

```js
test('房间设置：owner 可设四开关+密码，member 403，密码哈希不落明文', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'alice_set', password: 'pw' }) });
  const authA = { authorization: `Bearer ${alice.body.token}` };
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'bob_set', password: 'pw' }) });
  const authB = { authorization: `Bearer ${bob.body.token}` };
  const room = await api('/api/rooms', { method: 'POST', headers: authA, body: JSON.stringify({ name: '设置房' }) });
  const id = room.body.room.id;

  const r = await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: authA, body: JSON.stringify({ locked: true, readonly: true, password: 'secret' }) });
  assert.equal(r.response.status, 200);
  assert.equal(r.body.settings.locked, true);
  assert.equal(r.body.settings.readonly, true);
  assert.equal(r.body.settings.has_password, true);

  const row = db.prepare('SELECT password_hash, locked, readonly FROM rooms WHERE id = ?').get(id);
  assert.equal(row.locked, 1);
  assert.equal(row.readonly, 1);
  assert.ok(row.password_hash !== 'secret' && row.password_hash.length > 20, '密码应存哈希而非明文');

  const denied = await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: authB, body: JSON.stringify({ locked: false }) });
  assert.equal(denied.response.status, 403);

  const clear = await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: authA, body: JSON.stringify({ password: '' }) });
  assert.equal(clear.body.settings.has_password, false);
});
```

> 注意上方断言有误读：`row.password_hash` 应是哈希（非 null）。以"非明文 + 长度>20"为准。

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**（新增路由，放在 `roomMemberMatch` POST 之前）

```js
const roomSettingsMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/settings$/);
if (roomSettingsMatch && req.method === 'PATCH') {
  const context = requireRoomManager(req, res, Number(roomSettingsMatch[1])); if (!context) return;
  const { locked, hidden, password, readonly } = await readBody(req);
  const room = context.room;
  const next = {
    locked: locked === undefined ? room.locked : (locked ? 1 : 0),
    hidden: hidden === undefined ? room.hidden : (hidden ? 1 : 0),
    readonly: readonly === undefined ? room.readonly : (readonly ? 1 : 0),
    password_hash: password === undefined ? room.password_hash : (password === '' ? null : hashPassword(String(password)))
  };
  db.prepare('UPDATE rooms SET locked = ?, hidden = ?, password_hash = ?, readonly = ? WHERE id = ?')
    .run(next.locked, next.hidden, next.password_hash, next.readonly, room.id);
  logAudit(context.user.id, 'room_settings', room.id);
  const settings = { room_id: room.id, locked: Boolean(next.locked), hidden: Boolean(next.hidden), readonly: Boolean(next.readonly), has_password: next.password_hash !== null };
  broadcast({ type: 'room_settings', ...settings });
  broadcast({ type: 'rooms' });
  return json(res, 200, { settings });
}
```

- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交**

```bash
git add server.mjs test/api.test.mjs
git commit -m "feat: room settings endpoint for lock/hidden/password/readonly switches"
```

---

### Task A4: POST /api/rooms/:id/join（密码加入）

**Files:**
- Modify: `server.mjs`
- Test: `test/api.test.mjs`

**Interfaces:**
- Consumes: `roomForUser`、`hashPassword`、`broadcast`
- Produces: `POST /api/rooms/:id/join {password?}` → 已是成员 200；locked 403；密码错 403；密码对/公共房 → 加入为 member 200；无密码私有房 → 403「私有房间需申请加入」

- [ ] **Step 1: 写失败测试**

```js
test('加入房间：密码错 403、对 200 并成为成员、locked 403、无密码私有房引导申请', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'alice_j', password: 'pw' }) });
  const authA = { authorization: `Bearer ${alice.body.token}` };
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'bob_j', password: 'pw' }) });
  const authB = { authorization: `Bearer ${bob.body.token}` };
  const room = await api('/api/rooms', { method: 'POST', headers: authA, body: JSON.stringify({ name: '密码房', is_private: true }) });
  const id = room.body.room.id;
  await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: authA, body: JSON.stringify({ password: 's3cret' }) });

  const wrong = await api(`/api/rooms/${id}/join`, { method: 'POST', headers: authB, body: JSON.stringify({ password: 'nope' }) });
  assert.equal(wrong.response.status, 403);
  const readDenied = await api(`/api/rooms/${id}/messages`, { headers: authB });
  assert.equal(readDenied.response.status, 403, '未加入成员仍不可读私有房消息');

  const ok = await api(`/api/rooms/${id}/join`, { method: 'POST', headers: authB, body: JSON.stringify({ password: 's3cret' }) });
  assert.equal(ok.response.status, 200);
  const readOk = await api(`/api/rooms/${id}/messages`, { headers: authB });
  assert.equal(readOk.response.status, 200);

  // locked：第三人无法加入
  const carol = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'carol_j', password: 'pw' }) });
  const authC = { authorization: `Bearer ${carol.body.token}` };
  await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: authA, body: JSON.stringify({ locked: true }) });
  const locked = await api(`/api/rooms/${id}/join`, { method: 'POST', headers: authC, body: JSON.stringify({ password: 's3cret' }) });
  assert.equal(locked.response.status, 403);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**

```js
const roomJoinMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/join$/);
if (roomJoinMatch && req.method === 'POST') {
  const user = requireUser(req, res); if (!user) return;
  const room = roomForUser(Number(roomJoinMatch[1]), user.id);
  if (!room) return json(res, 404, { error: '聊天室不存在' });
  if (room.role) return json(res, 200, { member: { role: room.role } });
  if (room.locked) return json(res, 403, { error: '房间已锁定，仅接受邀请' });
  const { password = '' } = await readBody(req);
  if (room.password_hash) {
    if (hashPassword(String(password)) !== room.password_hash) return json(res, 403, { error: '房间密码错误' });
  } else if (room.is_private) {
    return json(res, 403, { error: '私有房间需申请加入' });
  }
  db.prepare("INSERT INTO room_members(room_id, user_id, role) VALUES (?, ?, 'member') ON CONFLICT(room_id, user_id) DO NOTHING").run(room.id, user.id);
  broadcast({ type: 'rooms' });
  return json(res, 200, { member: { role: 'member' } });
}
```

- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交**

```bash
git add server.mjs test/api.test.mjs
git commit -m "feat: join room endpoint with password gate"
```

---

### Task A5: 加入申请全流程（request / list / approve / reject）

**Files:**
- Modify: `server.mjs`
- Test: `test/api.test.mjs`

**Interfaces:**
- Consumes: `requireRoomManager`、`createNotification`、`roomForUser`、`broadcast`
- Produces:
  - `POST /api/rooms/:id/join-request` → 201；重复 409；locked 403；已是成员 409
  - `GET /api/rooms/:id/join-requests`（owner/admin）→ `{requests: [{id,user_id,username,status,created_at}]}`（仅 pending）
  - `POST /api/rooms/:id/join-requests/:userId/approve|reject`（owner/admin）→ 200；申请不存在 404；审批后通知申请人

- [ ] **Step 1: 写失败测试**

```js
test('加入申请：申请→审批→成为成员并收通知；重复 409；非管理员 403', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'alice_rq', password: 'pw' }) });
  const authA = { authorization: `Bearer ${alice.body.token}` };
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'bob_rq', password: 'pw' }) });
  const authB = { authorization: `Bearer ${bob.body.token}` };
  const room = await api('/api/rooms', { method: 'POST', headers: authA, body: JSON.stringify({ name: '申请房', is_private: true }) });
  const id = room.body.room.id;

  const req1 = await api(`/api/rooms/${id}/join-request`, { method: 'POST', headers: authB });
  assert.equal(req1.response.status, 201);
  const req2 = await api(`/api/rooms/${id}/join-request`, { method: 'POST', headers: authB });
  assert.equal(req2.response.status, 409, '重复申请应 409');

  const list = await api(`/api/rooms/${id}/join-requests`, { headers: authA });
  assert.equal(list.body.requests.length, 1);
  assert.equal(list.body.requests[0].username, 'bob_rq');

  const nonManager = await api(`/api/rooms/${id}/join-requests`, { headers: authB });
  assert.equal(nonManager.response.status, 403, '成员无审批权限');

  const approve = await api(`/api/rooms/${id}/join-requests/${bob.body.id}/approve`, { method: 'POST', headers: authA });
  assert.equal(approve.response.status, 200);
  const readOk = await api(`/api/rooms/${id}/messages`, { headers: authB });
  assert.equal(readOk.response.status, 200, '审批后成为成员可读');
  const notif = await api('/api/notifications/unread-count', { headers: authB });
  assert.ok(Number(notif.body.count) >= 1, '申请人应收到通知');
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**（三条路由，`roomJoinMatch` 附近）

```js
const roomJoinRequestMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/join-request$/);
if (roomJoinRequestMatch && req.method === 'POST') {
  const user = requireUser(req, res); if (!user) return;
  const room = roomForUser(Number(roomJoinRequestMatch[1]), user.id);
  if (!room) return json(res, 404, { error: '聊天室不存在' });
  if (room.role) return json(res, 409, { error: '你已是房间成员' });
  if (room.locked) return json(res, 403, { error: '房间已锁定，仅接受邀请' });
  try {
    const result = db.prepare('INSERT INTO room_join_requests(room_id, user_id, status, created_at) VALUES (?, ?, ?, ?)').run(room.id, user.id, 'pending', Date.now());
    const managers = db.prepare("SELECT user_id FROM room_members WHERE room_id = ? AND role IN ('owner','admin')").all(room.id);
    for (const m of managers) createNotification(m.user_id, { type: 'room', title: '新的加入申请', content: `${user.username} 申请加入房间「${room.name}」`, link: `/room/${room.id}`, data: { room_id: room.id, user_id: user.id } });
    return json(res, 201, { request: { id: Number(result.lastInsertRowid) } });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return json(res, 409, { error: '已提交过申请，等待审批' });
    throw error;
  }
}
const roomJoinRequestsMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/join-requests$/);
if (roomJoinRequestsMatch && req.method === 'GET') {
  const context = requireRoomManager(req, res, Number(roomJoinRequestsMatch[1])); if (!context) return;
  const rows = db.prepare(`SELECT room_join_requests.id, room_join_requests.user_id, room_join_requests.status, room_join_requests.created_at, users.username
    FROM room_join_requests JOIN users ON users.id = room_join_requests.user_id
    WHERE room_join_requests.room_id = ? AND room_join_requests.status = 'pending' ORDER BY room_join_requests.created_at`).all(context.room.id);
  return json(res, 200, { requests: rows });
}
const roomJoinDecisionMatch = url.pathname.match(/^\/api\/rooms\/(\d+)\/join-requests\/(\d+)\/(approve|reject)$/);
if (roomJoinDecisionMatch && req.method === 'POST') {
  const context = requireRoomManager(req, res, Number(roomJoinDecisionMatch[1])); if (!context) return;
  const targetId = Number(roomJoinDecisionMatch[2]); const action = roomJoinDecisionMatch[3];
  const request = db.prepare('SELECT * FROM room_join_requests WHERE room_id = ? AND user_id = ? AND status = ?').get(context.room.id, targetId, 'pending');
  if (!request) return json(res, 404, { error: '申请不存在或已处理' });
  if (action === 'approve') {
    db.prepare("INSERT INTO room_members(room_id, user_id, role) VALUES (?, ?, 'member') ON CONFLICT(room_id, user_id) DO NOTHING").run(context.room.id, targetId);
  }
  db.prepare('UPDATE room_join_requests SET status = ? WHERE id = ?').run(action === 'approve' ? 'approved' : 'rejected', request.id);
  createNotification(targetId, { type: 'room', title: action === 'approve' ? '加入申请已通过' : '加入申请被拒绝', content: `你申请加入「${context.room.name}」${action === 'approve' ? '已通过' : '被拒绝'}`, link: `/room/${context.room.id}` });
  broadcast({ type: 'rooms' });
  return json(res, 200, { request: { status: action === 'approve' ? 'approved' : 'rejected' } });
}
```

- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交**

```bash
git add server.mjs test/api.test.mjs
git commit -m "feat: join-request approve/reject flow with notifications"
```

---

### Task A6: readonly 只读守卫（HTTP 消息发送）

**Files:**
- Modify: `server.mjs`（`messageMatch && POST` 处理器，~line 1438 `isUserMuted` 旁）
- Test: `test/api.test.mjs`

**Interfaces:**
- Consumes: `requireRoomAccess` 返回的 `context.room.readonly`、`context.room.role`
- Produces: readonly 房间内非 owner/admin/全局管理员发送 → 403「房间为只读模式」

- [ ] **Step 1: 写失败测试**

```js
test('只读房：member 发言 403，owner 可发', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'alice_ro', password: 'pw' }) });
  const authA = { authorization: `Bearer ${alice.body.token}` };
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'bob_ro', password: 'pw' }) });
  const authB = { authorization: `Bearer ${bob.body.token}` };
  const room = await api('/api/rooms', { method: 'POST', headers: authA, body: JSON.stringify({ name: '只读房' }) });
  const id = room.body.room.id;
  await api(`/api/rooms/${id}/settings`, { method: 'PATCH', headers: authA, body: JSON.stringify({ readonly: true }) });
  await api(`/api/rooms/${id}/members`, { method: 'POST', headers: authA, body: JSON.stringify({ username: 'bob_ro' }) });

  const denied = await api(`/api/rooms/${id}/messages`, { method: 'POST', headers: authB, body: JSON.stringify({ content: 'hi' }) });
  assert.equal(denied.response.status, 403);
  const allowed = await api(`/api/rooms/${id}/messages`, { method: 'POST', headers: authA, body: JSON.stringify({ content: 'announcement' }) });
  assert.equal(allowed.response.status, 201);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**（在 `requireRoomAccess` 与 `isUserBanned` 检查之间插入）

```js
if (context.room.readonly && !user.is_admin && !['owner', 'admin'].includes(context.room.role)) {
  return json(res, 403, { error: '房间为只读模式' });
}
```

- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交**

```bash
git add server.mjs test/api.test.mjs
git commit -m "feat: readonly room blocks non-manager message sending"
```

---

### Task A7: Web 前端——房间列表 🔒/hidden、密码弹窗、申请加入

**Files:**
- Modify: `web-client/src/App.vue`（script setup + 模板）、`web-client/src/style.css`

**Interfaces:**
- Consumes: `GET /api/rooms` 新字段 `locked/hidden/readonly/has_password/is_private`；`POST /api/rooms/:id/join`；`POST /api/rooms/:id/join-request`；`room_settings` WS 事件
- Produces: 房间列表渲染 🔒/🔐 标记；点击私有房非成员 → 密码弹窗/申请按钮；加入成功刷新列表；`room_settings` 事件更新当前房间状态

- [ ] **Step 1: 状态与函数**（`App.vue` script setup 新增）

```js
const joinOpen = ref(false), joinError = ref(''), joinPassword = ref(''), joinPending = ref(false);
async function joinRoomWithPassword() {
  if (!room.value) return;
  try {
    await api(`/api/rooms/${room.value.id}/join`, { method: 'POST', body: JSON.stringify({ password: joinPassword.value }) });
    joinOpen.value = false; joinPassword.value = ''; joinError.value = '';
    await loadRooms(); notify('已加入房间');
  } catch (e) { joinError.value = e.message; }
}
async function requestJoin() {
  if (!room.value) return;
  try { await api(`/api/rooms/${room.value.id}/join-request`, { method: 'POST' }); joinPending.value = true; notify('已提交申请，等待房主审批'); } catch (e) { notify(e.message); }
}
```

- [ ] **Step 2: 房间列表渲染**（桌面列表与移动端列表项）——私有房显示 🔒，锁定的显示 🔐，只读显示 📖：

```html
<span v-if="r.is_private">🔒</span><span v-if="r.locked">🔐</span><span v-if="r.readonly">📖</span>
```

- [ ] **Step 3: 进入私有房守卫**——打开房间时若 `room.is_private && !room.role && !isAdmin`：`has_password` 则弹密码框（`joinOpen=true`），否则 `requestJoin()`。模板加密码弹窗：

```html
<div v-if="joinOpen" class="modal"><section class="room-modal">
  <button class="close" @click="joinOpen = false">×</button><h2>输入房间密码</h2>
  <input v-model="joinPassword" type="password" placeholder="房间密码" @keyup.enter="joinRoomWithPassword">
  <p v-if="joinError" class="error">{{ joinError }}</p>
  <div class="theme-actions"><button class="primary" @click="joinRoomWithPassword">加入</button><button @click="joinOpen = false">取消</button></div>
</section></div>
```

- [ ] **Step 4: `room_settings` WS 事件**——`handleSocketEvent` 里处理：

```js
if (event.type === 'room_settings' && room.value && event.room_id === room.value.id) {
  Object.assign(room.value, { locked: event.locked, readonly: event.readonly, has_password: event.has_password });
  await loadRooms();
}
```

- [ ] **Step 5: 验证** — `npm run web:build` 干净；`npm test` 全绿
- [ ] **Step 6: 提交**

```bash
git add web-client/src/App.vue web-client/src/style.css
git commit -m "feat(web): room lock/hidden/password/readonly badges, password join modal"
```

---

### Task A8: Web 前端——房主面板四开关 + 加入申请审批

**Files:**
- Modify: `web-client/src/App.vue`、`web-client/src/style.css`

**Interfaces:**
- Consumes: `PATCH /api/rooms/:id/settings`、`GET/POST /api/rooms/:id/join-requests`
- Produces: 房主面板（`roomManageOpen` 弹窗）内加"房间设置"四开关 + 密码输入 + 保存；加"加入申请"列表（通过/拒绝）；申请通过/拒绝后列表刷新

- [ ] **Step 1: 状态与函数**

```js
const roomSettingsDraft = ref({ locked: false, hidden: false, readonly: false, password: '' });
const joinRequests = ref([]);
async function loadRoomSettings() {
  if (!room.value) return;
  roomSettingsDraft.value = { locked: !!room.value.locked, hidden: !!room.value.hidden, readonly: !!room.value.readonly, password: '' };
}
async function saveRoomSettings() {
  if (!room.value) return;
  try {
    const body = { locked: roomSettingsDraft.value.locked, hidden: roomSettingsDraft.value.hidden, readonly: roomSettingsDraft.value.readonly };
    if (roomSettingsDraft.value.password) body.password = roomSettingsDraft.value.password;
    await api(`/api/rooms/${room.value.id}/settings`, { method: 'PATCH', body: JSON.stringify(body) });
    notify('房间设置已保存');
  } catch (e) { notify(e.message); }
}
async function loadJoinRequests() {
  if (!room.value) return;
  try { joinRequests.value = (await api(`/api/rooms/${room.value.id}/join-requests`)).requests; } catch { joinRequests.value = []; }
}
async function decideJoinRequest(userId, action) {
  try { await api(`/api/rooms/${room.value.id}/join-requests/${userId}/${action}`, { method: 'POST' }); await loadJoinRequests(); await loadMembers(); notify(action === 'approve' ? '已通过' : '已拒绝'); } catch (e) { notify(e.message); }
}
```

- [ ] **Step 2: `roomManageOpen` 弹窗**内追加（现有"名称/保存/删除"下方）：

```html
<h3>房间权限</h3>
<label><input v-model="roomSettingsDraft.locked" type="checkbox"> 锁定（禁止新成员加入）</label>
<label><input v-model="roomSettingsDraft.hidden" type="checkbox"> 隐藏（不在房间列表显示）</label>
<label><input v-model="roomSettingsDraft.readonly" type="checkbox"> 只读（仅房主/管理员可发言）</label>
<label>加入密码 <input v-model="roomSettingsDraft.password" type="password" placeholder="留空不改 / 填新值"></label>
<button class="primary" @click="saveRoomSettings">保存房间设置</button>
<h3>加入申请 <button @click="loadJoinRequests">刷新</button></h3>
<div v-for="rq in joinRequests" :key="rq.id" class="member">
  <span>{{ rq.username }}</span>
  <button @click="decideJoinRequest(rq.user_id, 'approve')">通过</button>
  <button class="danger" @click="decideJoinRequest(rq.user_id, 'reject')">拒绝</button>
</div>
<p v-if="!joinRequests.length" class="hint">暂无待审批申请</p>
```

- [ ] **Step 3: `openRoomManage`** 中调用 `loadRoomSettings(); loadJoinRequests();`
- [ ] **Step 4: 验证** — `npm run web:build` 干净；桌面+移动视口手动冒烟（四开关保存、申请审批、通知）
- [ ] **Step 5: 提交**

```bash
git add web-client/src/App.vue web-client/src/style.css
git commit -m "feat(web): room settings switches and join-request approval UI"
```

---

## Phase B：个人图床插件

### Task B1: 注册内置插件 + schema

**Files:**
- Create: `plugins/polychat-plugin-gallery/index.js`
- Modify: `modules/plugin-loader.js`（顶部静态 import + `BUILTIN_MODULES`）
- Modify: `server.mjs`（建表段）
- Test: `test/gallery.test.mjs`（新建）

**Interfaces:**
- Consumes: 插件加载机制（`BUILTIN_MODULES`）；`server.mjs` 建表
- Produces: `gallery_images` 表；插件 `setup(ctx)` 空壳（路由后续任务加）；`GET /api/plugins` 列表出现 gallery

- [ ] **Step 1: 写失败测试**（`test/gallery.test.mjs`，头部仿 `test/plugins.test.mjs` 的 `NODE_ENV=test` 设置）

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporary = mkdtempSync(join(tmpdir(), 'polychat-gallery-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = join(temporary, 'test.db');
process.env.UPLOAD_DIR = join(temporary, 'uploads');
process.env.AVATAR_DIR = join(temporary, 'avatars');
process.env.FILE_URL_SECRET = 'test-file-secret';
const { server, db } = await import('../server.mjs');
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const api = (path, options = {}) => fetch(`${base}${path}`, { headers: { 'content-type': 'application/json', ...options.headers }, ...options });

test.after(async () => {
  server.close();
  db.close();
  rmSync(temporary, { recursive: true, force: true });
});

test('gallery 插件注册：/api/plugins 含 gallery，gallery_images 表存在', async () => {
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'gal_a', password: 'pw' }) });
  const auth = { authorization: `Bearer ${reg.body.token}` };
  const list = await api('/api/plugins', { headers: auth });
  assert.ok(list.body.plugins.some(p => p.name === 'gallery'));
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gallery_images'").get();
  assert.ok(t);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**（`server.mjs` 建表段）

```js
db.exec(`CREATE TABLE IF NOT EXISTS gallery_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  stored_name TEXT NOT NULL,
  storage TEXT NOT NULL DEFAULT 'local' CHECK(storage IN ('local', 'qiniu')),
  created_at INTEGER NOT NULL
)`);
```

`modules/plugin-loader.js` 顶部（现有 6 个 import 之后）：

```js
import galleryPlugin from '../plugins/polychat-plugin-gallery/index.js';
import lanDiscoveryPlugin from '../plugins/polychat-plugin-lan-discovery/index.js';
```

`BUILTIN_MODULES` 对象加两项（`name: plugin` 形式，仿 `health: healthPlugin`）。

`plugins/polychat-plugin-gallery/index.js` 骨架：

```js
// 个人图床：本地 / 七牛 Kodo 双后端（GALLERY_* / QINIU_* 环境变量可覆盖）。
export default {
  name: 'gallery',
  version: '1.0.0',
  description: '个人图床：上传/配额/外链，支持本地与七牛 Kodo 双后端',
  enabledByDefault: true,
  defaultConfig: { quota_mb: 500, storage: 'local' },
  setup(ctx) {
    // 路由在 Task B2-B4 添加
  }
};
```

- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交**

```bash
git add plugins/polychat-plugin-gallery/index.js modules/plugin-loader.js server.mjs test/gallery.test.mjs
git commit -m "feat: register gallery plugin as builtin with gallery_images schema"
```

> 注意：`lan-discovery` 的 import 与 BUILTIN_MODULES 项在 Phase C Task C1 才创建，若 B1 先行提交会把 loader 改坏——**Step 3 只加 gallery 的 import 与注册项**，lan-discovery 留到 C1。

---

### Task B2: 图床上传（local 落盘）+ 配额

**Files:**
- Modify: `plugins/polychat-plugin-gallery/index.js`
- Test: `test/gallery.test.mjs`

**Interfaces:**
- Consumes: `ctx.db/json/requireUser/readBody/maxFileSize/uploadDir/pluginConfig/env/logAudit`；图片 mime 白名单 `['image/png','image/jpeg','image/webp','image/gif']`
- Produces: `POST /api/gallery`（multipart 或原始 bytes）→ 201 `{image:{id,...}}`；非图片 400；超 maxFileSize 413；超配额 413；`qiniu` 模式缺配置 503；`storage=qiniu` 的端到端在 B4
- 命名：`data/uploads/gallery/<userId>-<ts>-<rand>.<ext>`（`uploadDir` + `/gallery/`）

- [ ] **Step 1: 写失败测试**

```js
async function uploadGallery(auth, body, name) {
  return api('/api/gallery', { method: 'POST', headers: { authorization: auth.authorization, 'content-type': 'application/octet-stream' }, body });
}
test('图床上传：本地落盘 201、列表可见；非图片 400；超大 413', async () => {
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'gal_u', password: 'pw' }) });
  const auth = { authorization: `Bearer ${reg.body.token}` };
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
  const up = await api('/api/gallery', { method: 'POST', headers: { authorization: auth.authorization, 'content-type': 'image/png' }, body: png });
  assert.equal(up.response.status, 201);
  assert.ok(up.body.image.id);
  const list = await api('/api/gallery', { headers: auth });
  assert.equal(list.body.images.length, 1);
  assert.equal(list.body.images[0].filename, 'image.png');
  assert.ok(list.body.used_mb >= 0);

  const bad = await api('/api/gallery', { method: 'POST', headers: { authorization: auth.authorization, 'content-type': 'text/plain' }, body: Buffer.from('hello') });
  assert.equal(bad.response.status, 400);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**（`setup(ctx)` 内）

```js
const { registry, db, json, requireUser, readBody, maxFileSize, uploadDir, env, pluginConfig, logAudit } = ctx;
const { mkdirSync, writeFileSync, existsSync, unlinkSync } = await import('node:fs');
const { join } = await import('node:path');
const { randomBytes } = await import('node:crypto');
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const QUOTA_BYTES = Number(env.GALLERY_QUOTA_MB || pluginConfig.quota_mb) * 1024 * 1024;
const STORAGE = env.GALLERY_STORAGE || pluginConfig.storage;
const GALLERY_DIR = join(uploadDir, 'gallery');

function galleryDir() { mkdirSync(GALLERY_DIR, { recursive: true }); return GALLERY_DIR; }
function usedBytes(userId) {
  return db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM gallery_images WHERE user_id = ?').get(userId).used;
}
function extOf(mime) { return { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[mime]; }

registry.registerApiRoute('POST', '/api/gallery', async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_MIME.has(mime)) return json(res, 400, { error: '仅支持 PNG/JPEG/WebP/GIF 图片' });
  const bytes = await readBody(req);
  if (!Buffer.isBuffer(bytes) || !bytes.length) return json(res, 400, { error: '空文件' });
  if (bytes.length > maxFileSize) return json(res, 413, { error: '超过单文件大小上限' });
  if (usedBytes(user.id) + bytes.length > QUOTA_BYTES) return json(res, 413, { error: '超出图床配额' });
  if (STORAGE === 'qiniu') return json(res, 503, { error: '七牛模式未配置（缺 QINIU_* 环境变量）' }); // B4 替换
  const storedName = `${user.id}-${Date.now()}-${randomBytes(4).toString('hex')}${extOf(mime)}`;
  writeFileSync(join(galleryDir(), storedName), bytes, { flag: 'wx', mode: 0o600 });
  const result = db.prepare('INSERT INTO gallery_images(user_id, filename, mime, size, stored_name, storage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(user.id, `image${extOf(mime)}`, mime, bytes.length, storedName, 'local', Date.now());
  logAudit(user.id, 'gallery_upload', Number(result.lastInsertRowid));
  return json(res, 201, { image: { id: Number(result.lastInsertRowid), filename: `image${extOf(mime)}`, mime, size: bytes.length, storage: 'local' } });
});
```

> `readBody` 返回 Buffer 还是字符串？现有代码 `await readBody(req)` 在 JSON 路由返回对象。需在 B2 实现时确认 `readBody` 对 `application/octet-stream` 的解析（若返回 string，用 `Buffer.from(bytes)` 兜底）。**实现时验证**：`NODE_ENV=test` 下用二进制 body 实测。

- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交**

```bash
git add plugins/polychat-plugin-gallery/index.js test/gallery.test.mjs
git commit -m "feat(gallery): local upload endpoint with quota and mime checks"
```

---

### Task B3: 图床列表 / 删除 / 文件外链（local 签名 URL）

**Files:**
- Modify: `plugins/polychat-plugin-gallery/index.js`
- Modify: `server.mjs`（pluginCtx ~line 1867 暴露 `signPublicFileUrl`/`verifyPublicFileUrl` 给插件）
- Test: `test/gallery.test.mjs`

**Interfaces:**
- Consumes: `ctx.signPublicFileUrl`/`ctx.verifyPublicFileUrl`（复用核心签名 URL 机制，`server.mjs` 已有 `signPublicFileUrl(storedName, base)` 与 `verifyPublicFileUrl(storedName, expires, sig)`，本任务把它们加入 `pluginCtx`）、`ctx.publicBaseUrl`、`ctx.fileUrlTtlMs`
- Produces:
  - `GET /api/gallery` → 200 `{images:[{id,filename,mime,size,storage,url,created_at}], quota_mb, used_mb}`
  - `DELETE /api/gallery/:id` → 200（本人/管理员）；他人 403；不存在 404
  - `GET /api/gallery/:id/file?expires=&sig=` → 图片 bytes（local；qiniu 302 到下载 URL）；无效/过期 403

- [ ] **Step 1: 写失败测试**

```js
test('图床列表/删除/文件：外链 200、删除后 404、他人 403', async () => {
  const alice = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'gal_l', password: 'pw' }) });
  const authA = { authorization: `Bearer ${alice.body.token}` };
  const bob = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'gal_lb', password: 'pw' }) });
  const authB = { authorization: `Bearer ${bob.body.token}` };
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
  const up = await api('/api/gallery', { method: 'POST', headers: { authorization: authA.authorization, 'content-type': 'image/png' }, body: png });
  const id = up.body.image.id;

  const list = await api('/api/gallery', { headers: authA });
  const img = list.body.images[0];
  assert.ok(img.url.includes('/api/gallery/'), 'url 应为图床文件链接');

  const fileResp = await fetch(base + img.url);
  assert.equal(fileResp.status, 200);
  assert.equal(fileResp.headers.get('content-type'), 'image/png');

  const badSig = img.url.replace(/sig=[^&]+/, 'sig=deadbeef');
  const tampered = await fetch(base + badSig);
  assert.equal(tampered.status, 403, '伪造签名应 403');

  const denied = await api(`/api/gallery/${id}`, { method: 'DELETE', headers: authB });
  assert.equal(denied.response.status, 403);

  const del = await api(`/api/gallery/${id}`, { method: 'DELETE', headers: authA });
  assert.equal(del.response.status, 200);
  const gone = await fetch(base + img.url);
  assert.equal(gone.status, 404);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**——`server.mjs` pluginCtx（~line 1867）暴露 `verifyPublicFileUrl`（`signPublicFileUrl` 与 `attachments` 耦合，不需暴露；`fileUrlSecret`/`fileUrlTtlMs` 已在 ctx）：

```js
verifyPublicFileUrl,
```

`plugins/polychat-plugin-gallery/index.js` 内（`ctx` 解构加 `fileUrlSecret, fileUrlTtlMs, publicBaseUrl, verifyPublicFileUrl`）：

```js
// 与核心 signPublicFileUrl 相同的 HMAC-SHA256 签名，但路径指向本插件的文件端点
function buildGalleryUrl(row) {
  const expires = Date.now() + fileUrlTtlMs;
  const sig = createHmac('sha256', fileUrlSecret).update(`${row.stored_name}:${expires}`).digest('hex');
  return `${publicBaseUrl}/api/gallery/${row.id}/file?expires=${expires}&sig=${sig}`;
}
```

```js
// 路由 handler 签名：(req, res, url)，url 为 URL 实例（核心分发处 route.handler(req, res, url)），
// 用 url.pathname / url.searchParams 解析路径与查询参数。
registry.registerApiRoute('GET', '/api/gallery', async (req, res, url) => {
  const user = requireUser(req, res); if (!user) return;
  const offset = Number(url.searchParams.get('offset') || 0);
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100);
  const rows = db.prepare('SELECT * FROM gallery_images WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(user.id, limit, offset);
  const used = db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM gallery_images WHERE user_id = ?').get(user.id).used;
  return json(res, 200, {
    images: rows.map(r => ({ id: r.id, filename: r.filename, mime: r.mime, size: r.size, storage: r.storage, created_at: r.created_at, url: buildGalleryUrl(r) })),
    quota_mb: QUOTA_BYTES / 1024 / 1024, used_mb: used / 1024 / 1024
  });
});
registry.registerApiRoute('DELETE', '/api/gallery/:id', async (req, res, url) => {
  const user = requireUser(req, res); if (!user) return;
  const id = Number(url.pathname.match(/\/api\/gallery\/(\d+)$/)[1]);
  const row = db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(id);
  if (!row) return json(res, 404, { error: '图片不存在' });
  if (row.user_id !== user.id && !user.is_admin) return json(res, 403, { error: '无权删除他人图片' });
  if (row.storage === 'local') { try { unlinkSync(join(galleryDir(), row.stored_name)); } catch { /* stale */ } }
  db.prepare('DELETE FROM gallery_images WHERE id = ?').run(id);
  logAudit(user.id, 'gallery_delete', id);
  return json(res, 200, { ok: true });
});
registry.registerApiRoute('GET', '/api/gallery/:id/file', async (req, res, url) => {
  const id = Number(url.pathname.match(/\/api\/gallery\/(\d+)\/file$/)[1]);
  const expires = Number(url.searchParams.get('expires') || 0);
  const sig = url.searchParams.get('sig') || '';
  const row = db.prepare('SELECT * FROM gallery_images WHERE id = ?').get(id);
  if (!row) return json(res, 404, { error: '图片不存在' });
  if (!verifyPublicFileUrl(row.stored_name, expires, sig)) return json(res, 403, { error: '链接无效或已过期' });
  if (row.storage === 'qiniu') return redirectToQiniuUrl(res, row.stored_name); // B4 实现
  try {
    const bytes = readFileSync(join(galleryDir(), row.stored_name));
    res.writeHead(200, { 'content-type': row.mime, 'content-length': bytes.length, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' });
    return res.end(bytes);
  } catch { return json(res, 404, { error: '文件数据不存在' }); }
});
```

- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交**

```bash
git add plugins/polychat-plugin-gallery/index.js server.mjs test/gallery.test.mjs
git commit -m "feat(gallery): list, delete and signed file endpoint"
```

---

### Task B4: 七牛 Kodo 后端（storage=qiniu）

**Files:**
- Modify: `plugins/polychat-plugin-gallery/index.js`
- Modify: `package.json`（dependencies 加 `qiniu`）
- Test: `test/gallery.test.mjs`

**Interfaces:**
- Consumes: `env.QINIU_ACCESS_KEY/QINIU_SECRET_KEY/QINIU_BUCKET/QINIU_ZONE/QINIU_DOMAIN/QINIU_PRIVATE`；`qiniu` npm SDK
- Produces: `storage=qiniu` 时——上传 201（服务端生成 token 直传 Kodo，DB 记 key `gallery/<userId>/<ts>-<rand><ext>`）；列表 `url` 为 `https://<QINIU_DOMAIN>/<key>`（公开空间）或七牛签名 URL（私有）；DELETE 调 `BucketManager.delete`；`GET /:id/file` 302 到下载 URL；缺 `QINIU_*` 上传 503（B2 已留占位，此处替换）

- [ ] **Step 1: 写失败测试**（不依赖真实七牛：只测"缺配置 503"与配置分支）

```js
test('图床七牛模式：缺 QINIU_* 配置上传 503 且错误明确', async () => {
  process.env.GALLERY_STORAGE = 'qiniu';
  // 注意：本测试文件在 server.mjs import 前设置 env；动态切换需重启 server，
  // 因此此用例独立成文件 test/gallery-qiniu-misconfig.test.mjs，单独设 env 再 import server。
});
```

> **实现说明**：缺配置 503 的用例必须放在**独立测试文件**（`test/gallery-qiniu-misconfig.test.mjs`），因为 `STORAGE` 在 `setup` 时读 env、不可中途切换。该文件头部设 `process.env.GALLERY_STORAGE='qiniu'`（不设 `QINIU_*`）→ import server → 上传 → 断言 503。

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**（`setup(ctx)` 内替换 B2 的 503 占位为真实七牛上传）

```js
// qiniu SDK（CommonJS，ESM 默认导入）
import qiniu from 'qiniu';

function qiniuMac() {
  const ak = env.QINIU_ACCESS_KEY, sk = env.QINIU_SECRET_KEY;
  const bucket = env.QINIU_BUCKET, zone = env.QINIU_ZONE;
  const domain = env.QINIU_DOMAIN;
  if (!ak || !sk || !bucket || !zone || !domain) return null;
  const mac = new qiniu.auth.digest.Mac(ak, sk);
  const config = new qiniu.conf.Config();
  config.zone = qiniu.zone[`Zone_${zone}`]; // Zone_z0 华东 / Zone_z1 华北 ...
  return { mac, bucket, config, domain, privateBucket: env.QINIU_PRIVATE === 'true' };
}
function uploadToQiniu(q, key, bytes) {
  const putPolicy = new qiniu.rs.PutPolicy({ scope: `${q.bucket}:${key}`, expires: 3600 });
  const token = putPolicy.uploadToken(q.mac);
  return new Promise((resolve, reject) => {
    new qiniu.form_up.FormUploader(q.config).put(token, key, bytes, new qiniu.form_up.PutExtra(), (err, resp) => err ? reject(err) : resolve(resp));
  });
}
```

上传 handler 的 qiniu 分支：`const q = qiniuMac(); if (!q) return json(res, 503, { error: '七牛模式未配置 QINIU_* 环境变量' });` → `key = \`gallery/${user.id}/${Date.now()}-${randomBytes(4).toString('hex')}${extOf(mime)}\`` → `uploadToQiniu(q, key, bytes)` → DB 插 `storage='qiniu'` → 201。删除用 `qiniu.rs.BucketManager(q.mac, q.config).delete(q.bucket, key)`。外链：公开空间 `https://${q.domain}/${key}`；私有空间用 `BucketManager.privateDownloadUrl`。

- [ ] **Step 4: 运行确认通过**（缺配置 503 用例 + 既有用例；真实七牛端到端留给手动冒烟）
- [ ] **Step 5: 提交**

```bash
npm install qiniu --save
git add plugins/polychat-plugin-gallery/index.js package.json package-lock.json test/gallery-qiniu-misconfig.test.mjs
git commit -m "feat(gallery): Qiniu Kodo storage backend with signed URLs"
```

---

### Task B5: Web 图床页（我的 → 图床）

**Files:**
- Modify: `web-client/src/App.vue`、`web-client/src/style.css`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/gallery`、`navigator.clipboard`（复制外链）
- Produces: 「我的」页「我的图床」入口；图床面板：上传（粘贴/拖拽/按钮）、网格预览、用量条、复制外链、删除、"发送到聊天"（插入 `![](...)` 到输入框）

- [ ] **Step 1: 状态与函数**

```js
const galleryOpen = ref(false), galleryItems = ref([]), galleryQuota = ref({ quota_mb: 0, used_mb: 0 });
async function loadGallery() {
  try { const r = await api('/api/gallery'); galleryItems.value = r.images; galleryQuota.value = { quota_mb: r.quota_mb, used_mb: r.used_mb }; } catch (e) { notify(e.message); }
}
async function uploadGalleryFile(file) {
  try {
    const resp = await fetch('/api/gallery', { method: 'POST', headers: { authorization: tokenHeader(), 'content-type': file.type || 'application/octet-stream' }, body: file });
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.error || '上传失败');
    await loadGallery(); notify('已上传');
  } catch (e) { notify(e.message); }
}
async function deleteGalleryImage(img) {
  if (!confirm('删除这张图？')) return;
  try { await api(`/api/gallery/${img.id}`, { method: 'DELETE' }); await loadGallery(); } catch (e) { notify(e.message); }
}
async function copyGalleryUrl(img) {
  try { await navigator.clipboard.writeText(img.url); notify('外链已复制'); } catch { notify('复制失败，请手动复制'); }
}
function sendGalleryImage(img) { draft.value += `\n![](${img.url})\n`; galleryOpen.value = false; notify('已插入输入框'); }
```

> `tokenHeader()`：App.vue 已有统一鉴权头函数，按现有代码取用（若为 `Authorization: Bearer <token>`，仿 `api()` 内部实现）。

- [ ] **Step 2: 模板**——「我的」页加「🖼 我的图床」按钮（`galleryOpen = true` 时 `loadGallery()`）；图床面板（桌面 modal / 移动端 sheet）：

```html
<div v-if="galleryOpen" class="modal"><section class="gallery-modal">
  <button class="close" @click="galleryOpen = false">×</button><h2>我的图床</h2>
  <div class="gallery-quota">已用 {{ galleryQuota.used_mb.toFixed(1) }} / {{ galleryQuota.quota_mb }} MB</div>
  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="e => uploadGalleryFile(e.target.files[0])">
  <div class="gallery-grid">
    <div v-for="img in galleryItems" :key="img.id" class="gallery-item">
      <img :src="img.url" loading="lazy">
      <button @click="copyGalleryUrl(img)">复制外链</button>
      <button @click="sendGalleryImage(img)">发到聊天</button>
      <button class="danger" @click="deleteGalleryImage(img)">删除</button>
    </div>
  </div>
</section></div>
```

- [ ] **Step 3: 验证** — `npm run web:build` 干净；桌面+移动视口冒烟（上传/预览/复制/删除/发到聊天）
- [ ] **Step 4: 提交**

```bash
git add web-client/src/App.vue web-client/src/style.css
git commit -m "feat(web): personal gallery page with upload, quota, external links"
```

---

### Task B6: 账户注销清理图床

**Files:**
- Modify: `server.mjs`（`DELETE /api/me` 账户删除清理段，~line 759 `DELETE FROM room_members WHERE user_id = ?` 附近）

**Interfaces:**
- Consumes: 现有账户删除清理逻辑
- Produces: 注销账户时删除其 `gallery_images` 行 + 本地文件（`data/uploads/gallery/<stored_name>`）；qiniu 模式对象删除依赖 `gallery` 插件导出清理服务（经 `registry.service('gallery-cleanup')` 安全调用）

- [ ] **Step 1: 写失败测试**

```js
test('注销账户：图床记录与文件一并清理', async () => {
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'gal_del', password: 'pw' }) });
  const auth = { authorization: `Bearer ${reg.body.token}` };
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
  const up = await api('/api/gallery', { method: 'POST', headers: { authorization: auth.authorization, 'content-type': 'image/png' }, body: png });
  assert.equal(up.response.status, 201);
  const gone = await api('/api/me', { method: 'DELETE', headers: auth });
  assert.equal(gone.response.status, 200);
  const rows = db.prepare('SELECT COUNT(*) AS c FROM gallery_images WHERE user_id = ?').get(reg.body.id);
  assert.equal(rows.c, 0);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**——`DELETE /api/me` 清理段追加：

```js
// 图床：清理数据库行 + 本地文件（qiniu 模式对象经插件清理服务）
const galleryRows = db.prepare('SELECT id, stored_name, storage FROM gallery_images WHERE user_id = ?').all(user.id);
db.prepare('DELETE FROM gallery_images WHERE user_id = ?').run(user.id);
for (const g of galleryRows) {
  if (g.storage === 'local') {
    try { unlinkSync(join(UPLOAD_DIR, 'gallery', g.stored_name)); } catch { /* stale */ }
  }
}
const galleryCleanup = registry.service('gallery-cleanup');
if (galleryCleanup) for (const g of galleryRows.filter(x => x.storage === 'qiniu')) { try { await galleryCleanup.deleteObject(g.stored_name); } catch { /* non-fatal */ } }
```

`gallery` 插件 `setup(ctx)` 中注册清理服务：`ctx.registry.provide('gallery-cleanup', { deleteObject: async key => { /* BucketManager.delete */ } })`。

- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交**

```bash
git add server.mjs plugins/polychat-plugin-gallery/index.js test/gallery.test.mjs
git commit -m "feat: purge gallery rows and files on account deletion"
```

---

## Phase C：局域网发现端点插件

### Task C1: polychat-plugin-lan-discovery（GET /api/discovery）

**Files:**
- Create: `plugins/polychat-plugin-lan-discovery/index.js`
- Modify: `modules/plugin-loader.js`（补 `lan-discovery` import + `BUILTIN_MODULES` 项）
- Test: `test/lan-discovery.test.mjs`（新建）

**Interfaces:**
- Consumes: `ctx.registry/json/db/env/onlineUsers`；`package.json` version（`ctx.root` 读）
- Produces: `GET /api/discovery` → 200 `{name, version, host, port, rooms, online, uptime_ms, features}`；未登录 401；插件停用 404

- [ ] **Step 1: 写失败测试**（`test/lan-discovery.test.mjs`，头部仿 gallery 测试文件）

```js
test('局域网发现端点：登录返回完整字段', async () => {
  const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: 'disc_a', password: 'pw' }) });
  const auth = { authorization: `Bearer ${reg.body.token}` };
  const r = await api('/api/discovery', { headers: auth });
  assert.equal(r.response.status, 200);
  for (const k of ['name', 'version', 'host', 'port', 'rooms', 'online', 'uptime_ms', 'features']) assert.ok(k in r.body, `缺字段 ${k}`);
  assert.ok(Array.isArray(r.body.features));
  const anon = await api('/api/discovery');
  assert.equal(anon.response.status, 401);
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**

```js
// plugins/polychat-plugin-lan-discovery/index.js
// 局域网发现端点：为未来客户端（Android/GUI 恢复自动发现）预留的服务器元信息。
// 规划：v2 在 heartbeat 中发送 UDP/multicast beacon（本轮不做）。
export default {
  name: 'lan-discovery',
  version: '1.0.0',
  description: '局域网发现端点 GET /api/discovery（服务器元信息，未来客户端自动发现预留）',
  enabledByDefault: true,
  defaultConfig: {},
  setup(ctx) {
    const { registry, json, requireUser, db, env, onlineUsers } = ctx;
    const startTime = Date.now();
    const version = JSON.parse(readFileSync(join(ctx.root, 'package.json'), 'utf8')).version || '1.0.0';
    registry.registerApiRoute('GET', '/api/discovery', (req, res) => {
      const user = requireUser(req, res); if (!user) return;
      const rooms = db.prepare('SELECT COUNT(*) AS c FROM rooms').get().c;
      return json(res, 200, {
        name: env.POLYCHAT_NAME || 'PolyChat',
        version,
        host: env.HOST || '0.0.0.0',
        port: Number(env.PORT || 3000),
        rooms,
        online: onlineUsers?.size ?? onlineUsers?.length ?? 0,
        uptime_ms: Date.now() - startTime,
        features: ['rooms', 'dm', 'friends', 'upload', 'p2p', 'push', 'onebot', 'gallery']
      });
    });
  }
};
```

`modules/plugin-loader.js`：`import lanDiscoveryPlugin from '../plugins/polychat-plugin-lan-discovery/index.js';` + `BUILTIN_MODULES` 加 `'lan-discovery': lanDiscoveryPlugin`。顶部需补 `readFileSync`/`join` 导入（若 loader 未引入则在本插件 import）。

- [ ] **Step 4: 运行确认通过**（另确认 `DISABLED_PLUGINS=lan-discovery` 时 404——在 `test/plugins-disabled.test.mjs` 已有同套路，本任务只验证启用路径）
- [ ] **Step 5: 提交**

```bash
git add plugins/polychat-plugin-lan-discovery/index.js modules/plugin-loader.js test/lan-discovery.test.mjs
git commit -m "feat(discovery): GET /api/discovery endpoint plugin"
```

---

## Phase D：收尾

### Task D1: 全量验证 + 文档

**Files:**
- Modify: `README.md`（功能清单、环境变量表 `GALLERY_*`/`QINIU_*`、插件列表）
- Modify: `docs/PLUGINS.md`（新增两个插件）
- Modify: `AGENTS.md`（本次会话日志）

- [ ] **Step 1: `npm test`** — 全部通过（既有 25 + 新增约 16）
- [ ] **Step 2: `npm run web:build`** — 干净
- [ ] **Step 3: `npm run build:all`** — SEA 单文件成功，`dist/polychat-server` 启动冒烟：`/api/discovery` 200、`/api/gallery` 存在、私有房四项开关全流程
- [ ] **Step 4: README/PLUGINS/AGENTS 更新** + 提交

```bash
git add README.md docs/PLUGINS.md AGENTS.md
git commit -m "docs: document room switches, gallery and discovery plugins"
```

---

## 附录 A：Let's Encrypt 证书自动化（运维，非 node --test 范围）

背景：`img.zhezhe.online` 源站域名（七牛海外空间，免备案）；证书签发/续期在服务器 `68.64.177.154`（Ubuntu 22.04，已装 `certbot 1.21.0` + `python3-certbot-dns-cloudflare`；`/etc/letsencrypt/cloudflare.ini` 与 `/etc/letsencrypt/qiniu.env` 已就位，权限 600）。

**A-1 签发**（服务器上执行）：

```bash
certbot certonly --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d img.zhezhe.online --non-interactive --agree-tos -m admin@zhezhe.online \
  --key-type ecdsa --preferred-challenges dns-01
```

预期：DNS-01 全自动，证书落在 `/etc/letsencrypt/live/img.zhezhe.online/`。

**A-2 deploy hook**（`/opt/polychat/scripts/qiniu-upload-cert.py`，内容见会话中已展示版本；要点）：
- 读 `fullchain.pem` → `ca`、`privkey.pem` → `pri`
- `POST https://fusion.qiniuapi.com/sslcert`（QBox 签名，用 `qiniu.env` 的 AK/SK）→ `certID`
- `PUT https://api.qiniu.com/domain/img.zhezhe.online/httpsconf` body `{certId, forceHttps:true, http2Enable:true}`
- 脚本开头 `source /etc/letsencrypt/qiniu.env` 取 AK/SK

**A-3 首次手动触发 + 验证**：`certbot certonly ...`（A-1）→ 手动跑 hook 脚本 → `curl -I https://img.zhezhe.online/` 验证 200 且证书 SAN 正确。

**A-4 自动续期**：`systemctl list-timers | grep certbot` 确认 timer 已启用；把 hook 放入 `/etc/letsencrypt/renewal-hooks/deploy/qiniu-upload-cert.py`（certbot renew 成功后自动执行）；`certbot renew --dry-run` 验证。

**A-5 风险**：CF token / 七牛 AK-SK 撤销会中断续期；hook 脚本失败需邮件/日志观察（可加 `systemd` 通知）。

---

## 自审记录（计划阶段）

- 覆盖检查：spec §1（开关/可见性/端点/守卫/前端/测试）→ A1-A8；spec §2（schema/存储后端/路由/外链/WebUI/注销清理/测试）→ B1-B6；spec §3（端点/字段/测试）→ C1；验收 → D1。
- 无占位符：所有任务含实际代码或精确集成点；两处"实现时确认"（`readBody` 对二进制 body 的返回类型、`fileUrlSecret` 签名算法）已在任务内显式标注为需在实现第一步验证，非含糊占位。
- 类型一致：`createNotification(userId, {type,title,content,link,data})`、`broadcast(event, roomId?)`、`registry.service('gallery-cleanup')` 各任务引用一致。
- 依赖顺序：A 内部 A1→A2→…→A8；B1 先于 B2-B6；C1 独立但 loader 修改与 B1 不冲突（B1 只加 gallery，C1 再加 lan-discovery）。
