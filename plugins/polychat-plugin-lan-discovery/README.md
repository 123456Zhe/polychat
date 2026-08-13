# polychat-plugin-lan-discovery

局域网发现端点插件：注册 `GET /api/discovery`，为未来客户端（Android / GUI 恢复自动发现）返回服务器元信息。

登录用户可访问（未登录 401），返回：

- `name` —— 服务器名称（`POLYCHAT_NAME` 环境变量，默认 `PolyChat`）
- `version` —— 服务端版本（读 `package.json`）
- `host` —— 监听地址（`HOST`，默认 `0.0.0.0`）
- `port` —— 监听端口（`PORT`，默认 `3000`）
- `rooms` —— 房间总数
- `online` —— 当前在线用户数
- `uptime_ms` —— 插件启动以来的运行毫秒数
- `features` —— 支持的功能列表（rooms / dm / friends / upload / p2p / push / onebot / gallery）

无配置项。插件停用时该端点返回 404。

## 规划

- v2：在 heartbeat 中发送 UDP / multicast beacon（本轮不做）。
