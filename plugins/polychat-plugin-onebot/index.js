import { setupOnebot } from './onebot.js';

export default {
  name: 'onebot',
  version: '1.0.0',
  description: 'OneBot v11 机器人网关：Bot 经 WebSocket 接入，可收发群消息、私信消息与文件',
  enabledByDefault: true,
  defaultConfig: {},
  setup(ctx) {
    const onebot = setupOnebot(ctx);
    onebot.attach(ctx.server);
    if (process.env.NODE_ENV !== 'test') onebot.startReverse();
    ctx.registry.registerHeartbeat(() => onebot.heartbeat());
    // 核心在封禁用户 / 吊销 Bot token 时通过该服务断开对应 Bot 连接。
    ctx.registry.provide('onebot', { disconnectUser: userId => onebot.disconnectUser(userId) });
  }
};
