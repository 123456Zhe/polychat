export default {
  name: 'md-editor',
  version: '1.0.0',
  description: 'Markdown 编辑器：可展开的分屏编辑器，左侧编写 Markdown，右侧实时预览渲染结果',
  enabledByDefault: true,
  defaultConfig: {},
  setup(ctx) {
    const { registry } = ctx;
    // Register client-side assets (CSS + JS)
    registry.registerClientAssets({ css: ['style.css'], js: ['index.js'] });
  }
};
