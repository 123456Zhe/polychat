# PolyChat Android App

原生 Android 客户端（Kotlin + Jetpack Compose + Material 3），直连 PolyChat 服务器。

## 功能

- 认证：登录 / 注册 / 会话恢复 / 头像 / 导出 / 删号
- 房间：列表 / 创建 / 发送消息 / 编辑 / 撤回 / 置顶 / 公告 / 成员 / 邀请码 / @提及（输入 @ 呼出成员选择器，被 @ 的人列表显示红色 @ 角标）
- 私信（DM）：会话 / 消息 / 已读回执 / 未读 / 表情反应
- 好友：请求 / 接受 / 拒绝 / 删除 / 搜索
- 文件：分片上传（1MB chunks）/ 发送文件 / 图片全屏预览（双指缩放、双击放大）/ 附件下载到系统「下载」并打开
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

CI：推送到 GitHub main 分支可手动触发 Release 构建（`.github/workflows/build-release.yml`），产物同时包含签名 APK 与单文件服务端二进制。

## 签名与覆盖安装

- release 签名密钥不提交到仓库。复制 `keystore.properties.example` 为 `keystore.properties` 并填写本地密钥；CI 使用 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` Secrets。debug 使用 Android 默认 debug key。
- **注意**：签名密钥与密码是公开的，仅适合自托管项目；若将来要上架应用商店，请换成私有密钥。
- **升级说明**：如果设备上已安装旧签名（本地 debug 或 CI 密钥）的版本，首次切换到本签名需**卸载重装一次**；之后所有构建均可互相覆盖安装。
- `versionCode` 只增不减（当前 2）。CI 不再用时间戳生成 versionCode，避免「版本号降低导致无法覆盖」。
- Android 7–9（API 24–28）下载文件需要「存储」权限，系统会在首次下载时提示。

## 服务器地址

默认连接 `https://chat.zhezhe.online`。安装后可在「我的 → 服务器地址」中修改。
release 默认只允许 HTTPS；公网服务地址为 `https://chat.zhezhe.online`。局域网 HTTP 请仅在 debug 环境显式配置。

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
