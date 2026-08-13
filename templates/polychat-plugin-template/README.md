# polychat-plugin-<name>

PolyChat 插件：一句话描述。

## 安装

- **目录部署**：把本目录放到服务器的 `plugins/` 下（`plugins/polychat-plugin-<name>/`），重启即自动发现。
- **npm 部署**：`npm install polychat-plugin-<name>`，重启即自动发现（`node_modules/polychat-plugin-*` 前缀）。
- **内置打包**（可选）：把入口加入 `modules/plugin-loader.js` 的 `BUILTINS`，随单文件/SEA 一起打包。

> 注：外部插件需要真实文件系统，SEA 单文件二进制只含内置插件。

## 配置

首次启动自动登记到 `data/plugins.json`：

```jsonc
{
  "plugins": {
    "<name>": { "enabled": true, "config": { "example": "value" } }
  }
}
```

可用 `DISABLED_PLUGINS=<name>` 快速停用。

## 开发

接口契约见 [docs/PLUGIN_API.md](../../docs/PLUGIN_API.md)。
