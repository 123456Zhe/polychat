# PolyChat Android App

原生 Android 客户端（Kotlin + Jetpack Compose + Material 3），直连 PolyChat 服务器。

## 功能

- 认证：登录 / 注册 / 会话恢复 / 头像 / 导出 / 删号
- 房间：列表 / 创建 / 发送消息 / 编辑 / 撤回 / 置顶 / 公告 / 成员 / 邀请码 / @提及
- 私信（DM）：会话 / 消息 / 已读回执 / 未读 / 表情反应
- 好友：请求 / 接受 / 拒绝 / 删除 / 搜索
- 文件：分片上传（1MB chunks）/ 图片预览 / 附件下载
- **Markdown + LaTeX 公式渲染**（WebView 内嵌 KaTeX，与 Web 端一致）
- 通知：前台 WS 实时 → 本地通知 + 通知中心
- 实时：在线状态 / typing 指示 / 双轨（WS + 轮询兜底）
- 主题：5 套预设（雾蓝/午夜靛蓝/青绿浅色/Mocha/琥珀玫瑰）+ 深色模式
- 管理面板（admin）：用户管理 / 封禁 / 禁言 / IP 封禁 / bot 审批

## 技术栈

| 层 | 选型 |
|---|---|
| UI | Jetpack Compose + Material 3（单 Activity） |
| 网络 | Retrofit + OkHttp + kotlinx-serialization |
| 实时 | OkHttp WebSocket（/ws，Bearer token） |
| 持久化 | DataStore（token/服务器地址/主题） |
| DI | Hilt |
| 图片 | Coil |
| 渲染 | WebView + marked/KaTeX/DOMPurify（assets 内嵌） |

要求：minSdk 24（Android 7.0），targetSdk 36（满足 2026-08-31 Google Play 要求）。

## 构建

前置：JDK 17+、Android SDK（`ANDROID_HOME` 或 `ANDROID_SDK_ROOT`）。

```bash
cd android-app
chmod +x gradlew
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

或直接用 Android Studio 打开 `android-app/` 目录运行。

CI：推送到 GitHub main 分支会自动构建 APK（`.github/workflows/build-android.yml`）。

## 服务器地址

默认连接 `http://68.64.177.154:3000`。安装后可在「我的 → 服务器地址」中修改。
因 Android 9+ 默认禁止明文 HTTP，`network_security_config.xml` 已放行明文流量（生产建议换成 HTTPS）。

## 与 Web 端的关系

- 完全独立的原生工程，不复用 WebView 壳（旧的 Capacitor 方案已移除）。
- 消息正文渲染复用 Web 端同一套 marked/KaTeX/DOMPurify 逻辑（`assets/markdown.html` + `assets/vendor/`），保证公式/表格/提及与 Web 端一致。
- P2P 直传与 OneBot 机器人面板暂未实现（v2 规划）：大文件走服务器分片上传，收到 P2P 消息显示只读提示。

## 目录结构

```
android-app/
  app/src/main/
    assets/                 # markdown.html + vendor（marked/katex/dompurify/字体）
    java/com/polychat/app/
      data/                 # model(API DTO) / api(Retrofit) / ws(WebSocket) / repo / local(DataStore)
      di/                   # Hilt 模块
      ui/                   # theme / auth / main / chats / contacts / profile / admin / components
    res/                    # 图标 / 主题 / network_security_config
```
