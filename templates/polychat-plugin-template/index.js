// PolyChat 插件模板。完整接口契约见 docs/PLUGIN_API.md。
//
// 使用步骤：
//   1. 把本目录复制为 plugins/polychat-plugin-<name>/（或独立 git 仓库）。
//   2. 修改 package.json 的 name 与下方 manifest 的 name/version/description。
//   3. 在 setup(ctx) 里注册路由 / WS 消息 / 心跳 / 清理钩子。
//   4. 重启服务器 → 自动被发现、自动登记到 data/plugins.json。
//
// 约定：
//   - 插件绝不 import server.mjs，一切依赖由 ctx 注入。
//   - 表结构由核心集中创建；插件只写逻辑（路由/WS/定时器/辅助函数/env 读取）。

export default {
  name: '<name>',              // 必填，全局唯一（不带 polychat-plugin- 前缀）
  version: '0.1.0',
  description: '一句话描述你的插件',
  enabledByDefault: true,
  defaultConfig: { example: 'value' },

  setup(ctx) {
    const { registry, db, json, env, pluginConfig } = ctx;

    // ── 注册 HTTP 路由（pattern 可为精确字符串或 RegExp）──
    registry.registerApiRoute('GET', '/api/demo', (req, res) => {
      return json(res, 200, { example: pluginConfig.example, node_env: env.NODE_ENV });
    });

    // ── 注册 WS 消息类型（client.user 为登录用户）──
    // registry.registerWsMessage('demo_event', (client, event) => {
    //   // ...
    // });

    // ── 注册心跳 / 清理钩子 ──
    // registry.registerHeartbeat(() => {});
    // registry.registerCleanup(() => {});

    // ── 向核心或其他插件提供服务 ──
    // registry.provide('demo', { ping: () => 'pong' });
  }
};
