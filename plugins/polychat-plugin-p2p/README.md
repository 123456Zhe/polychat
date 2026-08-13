# polychat-plugin-p2p

私信间 WebRTC P2P 大文件直传：文件字节不经过服务器，失败自动回退分片上传。

- 路由：`GET /api/p2p/config`、`POST /api/p2p/transfers`、`GET /api/p2p/transfers/:id`、`POST /api/p2p/transfers/:id/(accept|reject|cancel|complete|fail)`
- WS 消息：`p2p_signal`（仅转发给已接受的传输双方）
- 完成时插入带 `p2p_transfer_id` 的私信消息并发射 `dm:sent`

配置（`data/plugins.json` → `p2p.config`）：`minSize`（默认 5MB）/ `activeLimit` / `ttlMs` / `connectTimeoutMs`。环境变量覆盖：`P2P_MIN_SIZE`、`TURN_URL`、`TURN_USERNAME`、`TURN_CREDENTIAL`。
