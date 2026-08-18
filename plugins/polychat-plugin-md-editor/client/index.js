// polychat-plugin-md-editor: 可展开可预览的 Markdown 编辑器
// 在聊天输入框旁边添加一个展开按钮，展开后左侧编辑、右侧实时预览。

(function () {
  'use strict';

  const STORAGE_KEY = 'polychat.md-editor-expanded';

  // 等待 DOM 就绪
  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  onReady(() => {
    // 延迟初始化，等 Vue 挂载完成
    setTimeout(init, 500);
  });

  function init() {
    injectStyles();
    setupObserver();
    // 恢复展开状态
    const wasExpanded = localStorage.getItem(STORAGE_KEY) === 'true';
    if (wasExpanded) {
      setTimeout(() => toggleExpand(true), 200);
    }
  }

  function injectStyles() {
    if (document.getElementById('md-editor-plugin-styles')) return;
    const style = document.createElement('style');
    style.id = 'md-editor-plugin-styles';
    style.textContent = `
      .md-editor-wrap { position: relative; }
      .md-editor-expand-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--warm-200, #e5e7eb);
        background: var(--warm-100, #f9fafb); color: #6b7280; cursor: pointer;
        font-size: 14px; transition: all 0.15s;
      }
      .md-editor-expand-btn:hover { background: var(--warm-200, #e5e7eb); color: #374151; }
      .md-editor-expand-btn.active { background: var(--accent, #5b9bd5); color: #fff; border-color: var(--accent, #5b9bd5); }
      .md-editor-expanded { display: flex; flex-direction: column; gap: 0; }
      .md-editor-expanded .compose-row { flex-wrap: wrap; }
      .md-editor-expanded .at-wrapper { flex: 1 1 100%; order: 10; }
      .md-editor-expanded .at-wrapper textarea {
        min-height: 120px; resize: vertical; border-radius: 8px 8px 0 0;
        font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
        font-size: 13px; line-height: 1.6; tab-size: 2;
      }
      .md-editor-preview {
        order: 11; width: 100%; max-height: 300px; overflow-y: auto;
        padding: 12px 16px; border: 1px solid var(--warm-200, #e5e7eb);
        border-top: none; border-radius: 0 0 8px 8px;
        background: var(--input-bg, #fafafa); font-size: 14px; line-height: 1.6;
        color: var(--markdown-color, #374151);
      }
      .md-editor-preview:empty::before {
        content: '预览区域 · 输入 Markdown 即可实时渲染';
        color: #9ca3af; font-style: italic;
      }
      .md-editor-preview .markdown { padding: 0; margin: 0; }
      .md-editor-toggle-row { order: 9; width: 100%; display: flex; justify-content: flex-end; padding: 0 0 4px; }
      @media (max-width: 768px) {
        .md-editor-expanded .at-wrapper textarea { min-height: 100px; }
        .md-editor-preview { max-height: 200px; font-size: 13px; }
      }
    `;
    document.head.appendChild(style);
  }

  function setupObserver() {
    // 监听 DOM 变化，为新增的 compose-row 添加展开按钮
    const observer = new MutationObserver(() => patchComposers());
    observer.observe(document.body, { childList: true, subtree: true });
    patchComposers();
  }

  function patchComposers() {
    document.querySelectorAll('.compose-row').forEach(row => {
      if (row.dataset.mdEditorPatched) return;
      row.dataset.mdEditorPatched = '1';

      const composer = row.closest('.composer');
      if (!composer) return;

      // 找到 MD 语法速查按钮，在它后面插入展开按钮
      const mdBtn = row.querySelector('.md-trigger');
      if (!mdBtn) return;

      const expandBtn = document.createElement('button');
      expandBtn.type = 'button';
      expandBtn.className = 'md-editor-expand-btn';
      expandBtn.title = '展开 Markdown 编辑器（分屏预览）';
      expandBtn.textContent = '⟁';
      expandBtn.addEventListener('click', () => toggleExpand());
      mdBtn.parentElement.insertBefore(expandBtn, mdBtn.nextSibling);

      // 添加预览区域
      const preview = document.createElement('div');
      preview.className = 'md-editor-preview';
      composer.appendChild(preview);

      // 监听 textarea 输入，实时渲染预览
      const textarea = row.querySelector('textarea');
      if (textarea) {
        let previewTimer = null;
        const updatePreview = () => {
          clearTimeout(previewTimer);
          previewTimer = setTimeout(() => {
            if (!composer.classList.contains('md-editor-expanded')) return;
            const text = textarea.value || '';
            preview.innerHTML = text ? renderMarkdown(text) : '';
          }, 150);
        };
        textarea.addEventListener('input', updatePreview);
        // 存储更新函数供外部调用
        composer._mdEditorUpdate = updatePreview;
      }
    });
  }

  function toggleExpand(forceState) {
    document.querySelectorAll('.composer').forEach(composer => {
      const expanded = forceState !== undefined ? forceState : !composer.classList.contains('md-editor-expanded');
      composer.classList.toggle('md-editor-expanded', expanded);
      // 更新按钮状态
      const btn = composer.querySelector('.md-editor-expand-btn');
      if (btn) {
        btn.classList.toggle('active', expanded);
        btn.title = expanded ? '收起编辑器' : '展开 Markdown 编辑器（分屏预览）';
        btn.textContent = expanded ? '⟃' : '⟁';
      }
      // 触发预览更新
      if (expanded && composer._mdEditorUpdate) composer._mdEditorUpdate();
    });
    localStorage.setItem(STORAGE_KEY, String(forceState !== undefined ? forceState : !localStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY) === 'false'));
  }

  // 简易 Markdown 渲染（复用 PolyChat 已有的 marked + KaTeX + DOMPurify）
  // 如果全局 markdown() 函数可用就用它，否则用简易渲染
  function renderMarkdown(text) {
    // 尝试调用 Vue 组件的 markdown 方法（通过 window 全局）
    if (window.__polychat_markdown) {
      try { return DOMPurify.sanitize(window.__polychat_markdown(text)); } catch { /* fallback */ }
    }
    // 简易降级渲染
    return simpleMarkdown(text);
  }

  function simpleMarkdown(text) {
    let html = text
      // 代码块
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
      // 行内代码
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // 粗体 + 斜体
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // 删除线
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      // 标题
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // 引用
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      // 链接
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // 图片
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">')
      // 水平线
      .replace(/^---$/gm, '<hr>')
      // 换行
      .replace(/\n/g, '<br>');
    return html;
  }

  // 暴露 markdown 渲染函数给插件使用
  // 当 Vue 组件加载后，会将自身的 markdown 函数挂载到 window
  const origDefineProperty = Object.defineProperty;
  let exposed = false;
  function tryExposeMarkdown() {
    if (exposed) return;
    // 查找 Vue app 实例
    const app = document.getElementById('app');
    if (!app || !app.__vue_app__) return;
    // Vue 3 组件实例在 __vue_app__._instance
    const instance = app.__vue_app__._instance;
    if (!instance?.proxy) return;
    // 从 proxy 中提取 markdown 函数
    if (typeof instance.proxy.markdown === 'function') {
      window.__polychat_markdown = instance.proxy.markdown.bind(instance.proxy);
      exposed = true;
    }
  }
  // 定期尝试暴露
  const exposeInterval = setInterval(() => {
    tryExposeMarkdown();
    if (exposed) clearInterval(exposeInterval);
  }, 1000);
  // 5 秒后停止尝试
  setTimeout(() => clearInterval(exposeInterval), 5000);
})();
