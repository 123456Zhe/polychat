# PolyChat 自定义 CSS 指南

Web 客户端的主题面板位于登录后的聊天页顶部“主题”按钮。这里输入的 CSS 会在 PolyChat 原有样式**之后**加载，因此同等或更高优先级的规则会覆盖默认样式。

自定义内容保存在当前浏览器的 Local Storage：

- 当前预设：`polychat.theme`
- 自定义规则：`polychat.custom-css`

它不会上传到服务端，也不会影响其他账号、浏览器或设备。主题面板中的“清除自定义 CSS”会删除第二项；如页面已经无法操作，可在浏览器开发者工具的 Storage / Local Storage 中删除它。

> 不要粘贴不信任来源的 CSS。虽然 CSS 不能直接执行 JavaScript，但它能隐藏元素、覆盖界面或发起外部资源请求。

## 规则基础

```css
/* 所有主题变量都可在 :root 覆盖 */
:root {
  --blue-700: #0f766e;
  --violet-700: #0f766e;
}

/* 选择器与默认样式相同，后加载的规则会覆盖它 */
.chat > aside { background: #0f172a; }

/* 当默认规则优先级更高时，增加父选择器；通常不必使用 !important */
.chat .bubble { border-radius: 10px; }
```

可使用所有现代浏览器 CSS 属性和值；例如 `color`、`background`、`border`、`box-shadow`、`font-size`、`font-family`、`padding`、`gap`、`filter`、`transition` 和 `@media`。标准属性语义请查阅 [MDN CSS 参考](https://developer.mozilla.org/docs/Web/CSS/Reference)。本文件解释的是 PolyChat 提供的变量、DOM 区域和状态类。

## 主题变量

默认主题定义在 `web-client/src/style.css` 的 `:root` 中。覆盖变量是全局换色最稳妥的方式。

| 变量 | 默认值 | 控制范围 |
|---|---:|---|
| `--slate-950` | `#35445f` | 深色代码块、Toast、阴影深色 |
| `--slate-900` | `#435675` | 侧栏主色、主要深色文字 |
| `--slate-800` | `#506789` | 侧栏层级色 |
| `--blue-700` | `#58789a` | 链接、主要强调、按钮渐变起点 |
| `--blue-600` | `#6f8da8` | 聚焦边框、`#`、状态强调 |
| `--blue-400` | `#9aadb9` | 侧栏弱文字、悬停边框 |
| `--violet-700` | `#5d527c` | 主按钮渐变终点、通知开启态 |
| `--violet-600` | `#665981` | 默认头像渐变终点 |
| `--warm-100` | `#f2f0ef` | 聊天区域、输入控件浅底色 |
| `--warm-200` | `#e4e0df` | 分隔线、浅色标签背景 |
| `--warm-300` | `#c9c2c1` | 预留的中性边框层级 |
| `--white` | `#fff` | 预留的白色表面变量 |
| `--shadow` | `0 18px 50px ...` | 登录卡片与 Toast 阴影 |

完整换色示例：

```css
:root {
  --slate-950: #0b1120;
  --slate-900: #172554;
  --slate-800: #1e3a8a;
  --blue-700: #2563eb;
  --blue-600: #3b82f6;
  --blue-400: #93c5fd;
  --violet-700: #7c3aed;
  --violet-600: #8b5cf6;
  --warm-100: #f8fafc;
  --warm-200: #e2e8f0;
}
```

## 页面结构

```text
.chat
├── aside                         侧边栏
│   ├── .brand                    品牌
│   ├── .new                      新建房间按钮
│   ├── .nav-label                “聊天室”标签
│   ├── nav > button              房间按钮
│   └── footer                    当前用户资料与退出按钮
└── .conversation                 主聊天区
    ├── .topbar                   顶部栏
    ├── .messages                 唯一可滚动的消息区
    │   └── article
    │       ├── .avatar
    │       └── .bubble
    └── .composer                 固定输入区
```

不要把 `.chat`、`.conversation` 或 `.messages` 的 `height` / `min-height` / `overflow` 随意移除：它们保证侧边栏、顶部栏和输入框固定，只有消息区滚动。

## 登录页

| 选择器 | 作用 |
|---|---|
| `.auth` | 全屏登录/注册背景 |
| `.auth > section` | 登录卡片 |
| `.auth img` | 应用图标 |
| `.auth h1`, `.auth p` | 标题、英文说明 |
| `.tabs`, `.tabs button`, `.tabs .active` | 登录/注册切换标签 |
| `.auth input`, `.auth input:focus` | 输入框与聚焦状态 |
| `.auth form > button` | 登录、注册主按钮 |
| `.auth form small` | 错误提示 |

```css
.auth { background: radial-gradient(circle at top, #dbeafe, #f8fafc 60%); }
.auth > section { border-radius: 32px; box-shadow: 0 24px 70px #1e3a8a22; }
```

## 侧边栏与房间

| 选择器 | 作用 |
|---|---|
| `.chat > aside` | 整个固定侧边栏 |
| `.brand`, `.brand img`, `.brand small` | 品牌区域、图标、副标题 |
| `.new`, `.new:hover` | 新建聊天室按钮 |
| `.nav-label` | 房间列表标签 |
| `.chat nav` | 可独立滚动的房间列表 |
| `.chat nav button` | 单个房间 |
| `.chat nav button:hover` | 房间悬停状态 |
| `.chat nav button.active` | 当前房间 |
| `.chat nav button.hasUnread` | 含未读消息的房间 |
| `.chat nav button .unread` | 未读数字徽标 |
| `.profile-button` | 左下角头像按钮 |
| `.chat > aside > footer` | 左下角资料栏 |
| `.logout` | 退出按钮 |

```css
/* 当前房间改为实体蓝色卡片，未读改为橙色 */
.chat nav button.active { background: #2563eb; box-shadow: none; }
.chat nav button .unread { background: #f97316; }
```

## 顶部栏与通知

| 选择器 | 作用 |
|---|---|
| `.topbar` | 固定顶部栏 |
| `.topbar h2`, `.topbar h2 span`, `.topbar small` | 房间标题、`#`、说明 |
| `.toolbar-button`, `.toolbar-button:hover` | 主题、管理、通知按钮 |
| `.notification.on` | 桌面通知已开启 |
| `.notification.blocked` | 浏览器已阻止通知 |
| `.notification em` | 按钮文字 |

```css
.topbar { background: rgba(255, 255, 255, .98); backdrop-filter: none; }
.toolbar-button { border-radius: 999px; }
.notification.on { color: #047857; background: #d1fae5; }
```

## 消息与 Markdown

| 选择器 | 作用 |
|---|---|
| `.messages` | 消息滚动容器与左右留白 |
| `.messages article` | 一条消息的网格布局 |
| `.avatar`, `.avatar img`, `.avatar b` | 消息头像、图片、默认首字母 |
| `.bubble` | 消息卡片 |
| `.bubble > header` | 用户名、时间、复制按钮行 |
| `.bubble > header strong`, `small`, `button` | 用户名、时间、复制按钮 |
| `.markdown` | Markdown 内容根节点 |
| `.markdown h1/h2/h3/p/ul/ol` | 标题、段落、列表 |
| `.markdown blockquote` | 引用块 |
| `.markdown code`, `.markdown pre` | 行内代码、代码块 |
| `.markdown a` | 链接 |
| `.markdown table`, `th`, `td` | 表格 |
| `.math-block` | 块级 KaTeX 公式的横向滚动容器 |
| `.attachment-image` | 原尺寸图片附件 |
| `.attachment-file` | 非图片附件卡片 |
| `.empty` | 空聊天室占位内容 |

```css
/* 更接近即时通讯气泡的样式 */
.messages { padding: 18px 32px; }
.bubble { background: #eff6ff; border-color: #bfdbfe; border-radius: 18px; }
.markdown { font-size: 15px; line-height: 1.8; }
.attachment-image { border-radius: 4px; }
```

`.attachment-image` 默认 `max-width: none`，用于满足原尺寸图片显示；如果希望限制超大图片，请显式覆盖：

```css
.attachment-image { max-width: min(100%, 900px); height: auto; }
```

## 输入区与文件

| 选择器 | 作用 |
|---|---|
| `.composer` | 固定底部输入区 |
| `.compose-row` | 附件、文本框、发送按钮所在行 |
| `.composer textarea`, `:focus` | 消息输入框 |
| `.attach`, `.attach:hover` | 文件选择按钮 |
| `.send` | 发送按钮 |
| `.file-chip` | 待发送附件标签 |
| `.file-chip > span` | 文件类型徽标 |

```css
.composer { box-shadow: none; }
.composer textarea { border-radius: 22px; }
.attach, .send { border-radius: 50%; width: 43px; padding: 0; }
```

## 弹窗、个人资料和管理面板

| 选择器 | 作用 |
|---|---|
| `.modal` | 全屏遮罩 |
| `.modal > section` | 通用弹窗卡片 |
| `.close` | 右上角关闭按钮 |
| `.profile-modal`, `.avatar-preview`, `.profile-actions` | 个人资料弹窗、头像预览、操作按钮 |
| `.stats`, `.stats span`, `.stats b` | 管理面板统计项 |
| `.member`, `.member button` | 管理面板用户行 |
| `.theme-modal` | 主题弹窗 |
| `.theme-grid`, `.theme-grid > button`, `.selected` | 主题预设网格与选中态 |
| `.swatches`, `.swatches i` | 预设颜色条 |
| `.css-label`, `.css-label textarea` | 自定义 CSS 标签和编辑器 |
| `.theme-actions` | 保存、清除按钮组 |
| `.primary` | 渐变主按钮（用于头像与主题保存） |
| `.toast` | 右下角短提示 |

```css
.modal { background: rgb(2 6 23 / 76%); }
.theme-modal { width: min(900px, 100%); }
.css-label textarea { min-height: 240px; font-size: 13px; }
```

## 响应式与滚动条

当视口宽度不超过 `700px` 时，默认规则会隐藏 `.chat > aside`，将主题/通知等工具栏按钮只显示图标，消息头像缩小。你可以覆盖它：

```css
@media (max-width: 700px) {
  .topbar { min-height: 64px; }
  .messages { padding: 12px 8px; }
  .chat > aside { display: flex; } /* 不推荐：需要同时自行处理移动端导航 */
}
```

滚动条由 `::-webkit-scrollbar` 与 `::-webkit-scrollbar-thumb` 定义，可在 Chromium、Safari 和新 Edge 中覆盖：

```css
::-webkit-scrollbar-thumb { background: #8b5cf6; }
```

Firefox 可额外使用：

```css
* { scrollbar-color: #8b5cf6 #e2e8f0; }
```

## 常见问题

**主题只在自己的浏览器生效？** 是。它是本地个人偏好，刻意不写入账号或数据库。

**清除规则后为什么预设主题仍在？** “清除自定义 CSS”只移除手写 CSS；在主题卡片中选择“雾蓝”即可回到默认预设。

**为什么不要覆盖 `.conversation` 的高度或 `.messages` 的 `overflow`？** 这会重新引入顶部栏、侧边栏和输入框随消息一起滚动的问题。

**如何恢复完全默认？** 选择“雾蓝”，点击“清除自定义 CSS”，然后刷新页面。
