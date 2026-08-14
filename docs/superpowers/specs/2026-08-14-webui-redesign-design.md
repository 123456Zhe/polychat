# PolyChat Web UI 桌面端风格改版设计

## 背景
用户参考 GPT 修改后的截图，希望将 Web 桌面端 UI 按图中风格统一改版。移动端保持现有 `m-app` 分支不变。

## 设计目标
- 左栏深色 Sidebar 更紧凑、更现代
- 顶栏中央搜索 + 右侧 icon 精简
- 消息操作始终外露
- Composer 重排，去掉无用 `/` 按钮
- 图片渲染尺寸受限
- Sidebar 本地搜索 + 滚动
- 图床入口独立

## 范围
**仅桌面端**（`isMobile === false`），移动端模板与样式完全不动。

## 模块设计

### 1. Sidebar（`aside`）
- **背景色保持不变**（现有 `.chat > aside` 及各主题 CSS 已覆盖，本次不动）
- Logo 区：icon + "PolyChat" + 副标题保留，底部在线绿点保留
- "新建聊天室" 按钮：实心深色（`background: var(--sidebar-btn-bg)`），圆角 10px，白字
- **新增搜索框**：在 `nav-label` 之前插入一个固定在 sidebar 内的搜索输入框
  - placeholder: `搜索聊天室或私信…`
  - 输入时实时过滤 `rooms` 和 `conversations`，只显示匹配的列表项
  - 无结果时显示 "无匹配结果"
  - 搜索框本身可滚动？不，搜索框固定，列表滚动
- 聊天室列表 + 私信列表保持现有数据源，但被搜索过滤时只显示匹配项
- 私信 nav 下面新增独立按钮：`🖼 我的图床`
  - 样式同 nav 按钮但略加区分（可加 subtle 背景色或 icon 颜色不同）
  - 点击直接 `galleryOpen = true; loadGallery()`
- 底部 footer 压缩：
  - 左侧头像（40px）+ 用户名 #id + "在线" 小字
  - 右侧横排三个紧凑 icon 按钮：主题（◐）、退出（↪），设置（⚙）移到头像点击（保持现有 `profileOpen` 行为）

### 2. Topbar
- 高度降至 `56px`
- 左侧：`# 房间名` + ⭐ icon（纯视觉，不实现收藏功能）+ 在线人数绿点
- **中央搜索框**（占剩余空间的 flex 居中）：
  - 圆角灰底输入框，`搜索消息、用户或频道`，右侧显示 `⌘K` 快捷键提示
  - 点击后弹出现有搜索 modal（`searchOpen = true`），快捷键绑定 `Ctrl/Cmd + K` 呼出搜索
  - 注：此搜索框和 sidebar 搜索是两层 — sidebar 搜的是「频道/人」，topbar 中央搜索搜的是「消息内容」
- 右侧 icon 精简为横排：`👥 好友`、`📢 公告`、`⚙ 房间`（聚合：成员/公告/设置/邀请/置顶/房间设置）、`⋯`（更多：主题/管理/通知/帮助/加入房间）、`🔔`（通知铃铛）、`?`（帮助）
- 每个 icon 带 `title` tooltip，文字标签保留（和现有 `.toolbar-button` 一致）

### 3. 消息区域
- 消息气泡圆角加大：`border-radius: 12px 16px 16px 12px`（或更大，使视觉更圆润）
- **消息头部右侧始终显示操作按钮**：
  - 结构改为 header 内右对齐横排：
    - `↩ 回复`（文字按钮或 icon+文字）
    - `☺` 表情反应按钮
    - `•••` 更多下拉（话题/置顶/编辑/撤回/复制）
  - 桌面端始终 `opacity: 1`，取消现有的 hover 才显示逻辑
- 日期分割线（按天分组的 `time` 分隔）居中、灰色、字号 11px，加一条 subtle 横线贯穿或仅居中文字
- **图片尺寸限制**：
  - CSS `.attachment-image` / `.markdown img` 增加 `max-width: min(100%, 520px)`（避免超大图撑破布局）
  - `max-height: 70vh` 保留
- 系统消息（如「欢迎 zyc 加入了聊天室」）带左侧绿色圆形系统头像（或机器人头像），与参考图对齐
- Reactions 样式微调，更紧凑

### 4. Composer（输入区）
- 左侧按钮组：去掉 `/`（用户要求）
  - 保留：`＋`（附件）、`☺`（表情）、`MD`（Markdown 速查）
- 输入框 placeholder：`输入消息，粘贴图片、拖拽文件或使用 Markdown…`
- 右侧：保留链接 icon（占位样式，`cursor: default`，无实际功能），`发送` 主按钮改为深绿色/深青色强调色，圆角 10px
- `▼` 下拉箭头保留占位但不展开任何选项
- 底部提示：`Enter 发送 · Shift + Enter 换行`

### 5. 主题适配
5 套主题全部适配新 sidebar 深色背景、按钮强调色、消息气泡边框等关键变量：
- sidebar 背景沿用各主题现有 `.chat > aside` 覆盖（`teal`/`mocha`/`amber-rose` 已有），无需新增 sidebar 背景色
- `mist`：无需调整 sidebar；强调色保持现有蓝紫渐变
- 各主题的 CSS 需覆盖 `.new`、`.composer .send` 等新引入的关键选择器

## 数据结构变化
无。全部使用现有响应式数据。

## 行为变化
1. 新增 `sidebarSearchQuery` ref，绑定 sidebar 搜索框 v-model
2. 新增计算属性 `filteredRooms` / `filteredConversations`，在搜索非空时过滤，否则返回完整列表
3. 新增全局键盘监听 `Ctrl+K` / `Cmd+K` 呼出搜索 modal（已有搜索功能）
4. 图床按钮触发 `galleryOpen = true; loadGallery()`（复用现有逻辑）

## 测试要点
- `web:build` 通过无报错
- 5 套主题切换后 sidebar / topbar / composer / 气泡视觉正常
- Sidebar 搜索：输入字符实时过滤，清空后恢复全部列表
- 消息操作按钮始终可见，hover 无回归问题
- 图片消息在不同屏幕宽度下最大宽度不超过 520px
- 通知铃铛/帮助/管理面板弹层正常
- 现有 Node 测试不受影响（本次只改前端静态文件）
