# polychat-plugin-md-editor

Markdown 编辑器插件：在聊天输入框旁添加展开按钮，展开后左侧编写 Markdown，右侧实时预览渲染结果。

## 功能

- 可展开/收起的分屏编辑器
- 左侧 textarea 编写 Markdown，右侧实时渲染预览
- 展开状态跨会话持久化（localStorage）
- 支持标题、粗体、斜体、删除线、代码块、链接、图片、引用等 Markdown 语法
- 当 PolyChat 的 marked + KaTeX 渲染管线可用时自动复用，否则降级为简易渲染
- 移动端适配

## 安装

作为内置插件随 PolyChat 主仓库打包。独立安装：

```bash
cd plugins/
git clone https://github.com/123456Zhe/polychat-plugin-md-editor.git
```

## 配置

无需配置，安装即用。

## 环境变量

无。
