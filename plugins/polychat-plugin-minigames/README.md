# polychat-plugin-minigames

联机小游戏插件：**五子棋双人对战** + **数字炸弹房间派对**，带全站胜场排行榜。

前端经 `registerClientAssets` 注入：右下角 🎮 悬浮按钮 → 弹窗（五子棋 / 数字炸弹 / 排行榜三个页签），原生 JS 实现，不依赖 Vue。

## 玩法

### 五子棋（双人）
1. 点 🎮 → 五子棋页签 → 输入对方用户名 → 邀请
2. 对方收到站内通知 + 🎮 按钮红点，点开接受
3. 15×15 棋盘，黑方先手，服务端权威判定胜负（五连即胜）
4. 支持认输；和棋判和；胜场计入排行榜

### 数字炸弹（房间派对）
1. 点 🎮 → 数字炸弹页签 → 选房间 → 开始
2. 1~100 里藏了一颗雷，房间成员轮流猜数
3. 猜错缩小范围，猜中即爆炸（踩雷者输，其余参与者 +1 胜场）

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/minigames/gomoku/invite` | 邀请（body: `{username}`） |
| GET | `/api/minigames/invites` | 我的待处理邀请 |
| POST | `/api/minigames/gomoku/respond` | 接受/拒绝（body: `{gameId, accept}`） |
| POST | `/api/minigames/gomoku/move` | 落子（body: `{gameId, x, y}`） |
| POST | `/api/minigames/gomoku/giveup` | 认输 |
| GET | `/api/minigames/gomoku/state?gameId=` | 对局状态（轮询） |
| GET | `/api/minigames/gomoku/my-games` | 我的对局 |
| POST | `/api/minigames/bomb/start` | 开炸弹（body: `{roomId}`） |
| POST | `/api/minigames/bomb/guess` | 猜数（body: `{roomId, number}`） |
| GET | `/api/minigames/bomb/state?roomId=` | 炸弹状态（轮询） |
| GET | `/api/minigames/leaderboard?game=` | 排行榜（`gomoku` / `bomb`） |

落子/猜数走 HTTP POST，状态走短轮询（1.5~2s），不独占 WebSocket 连接。

## 数据

- `minigame_scores(game, user_id, score, updated_at)`：记胜场（核心建表，外键级联删号）
- 对局状态放内存（Map）：服务端重启后进行中的对局作废，未完成不记分

## 配置（`data/plugins.json` → `minigames`）

| 键 | 默认 | 说明 |
|---|---|---|
| `leaderboardLimit` | `20` | 排行榜条数 |
| `inviteTtlSec` | `300` | 邀请有效期（秒） |
| `bombTtlSec` | `7200` | 炸弹对局过期（秒） |
