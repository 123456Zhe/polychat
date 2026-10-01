// 消息 Markdown 渲染：marked + KaTeX + DOMPurify，渲染流程与老客户端 renderMarkdown 对齐。
import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { icon } from './icons.js';

marked.setOptions({ breaks: true, gfm: true });

export function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderMarkdown(content) {
  if (!content) return '';
  try {
    let src = String(content).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // KaTeX display $$...$$
    const display = [];
    src = src.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => {
      const i = display.length;
      try { display.push(katex.renderToString(tex, { displayMode: true, throwOnError: false })); }
      catch { display.push(`<code>${escapeHTML(m)}</code>`); }
      return `\u0000D${i}\u0000`;
    });
    // KaTeX inline $...$
    const inline = [];
    src = src.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (m, tex) => {
      const i = inline.length;
      try { inline.push(katex.renderToString(tex, { displayMode: false, throwOnError: false })); }
      catch { inline.push(`<code>${escapeHTML(m)}</code>`); }
      return `\u0000I${i}\u0000`;
    });
    // code blocks → 先占位，避免内部被 markdown 误伤
    const blocks = [];
    src = src.replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (m, lang, code) => {
      const i = blocks.length;
      blocks.push(`<pre><code>${escapeHTML(code.replace(/\n$/, ''))}</code></pre>`);
      return `\u0000B${i}\u0000`;
    });
    // [at:id] 提及 → 用户 pill
    src = src.replace(/\[at:(\d+)\]/g, (m, id) => `<span class="mention" data-uid="${id}">@${escapeHTML(mentionNames[id] || id)}</span>`);
    // @username 纯文本提及（服务端已验证用户名合法）
    src = src.replace(/(^|[\s(>])@([\p{L}\p{N}_-]{1,20})/gu, '$1<span class="mention">@$2</span>');
    let html = marked.parse(src);
    html = html.replace(/\u0000B(\d+)\u0000/g, (m, i) => blocks[+i] || m)
               .replace(/\u0000D(\d+)\u0000/g, (m, i) => display[+i] || m)
               .replace(/\u0000I(\d+)\u0000/g, (m, i) => inline[+i] || m);
    return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['script', 'style', 'iframe'] });
  } catch (e) {
    return `<p>${escapeHTML(content)}</p>`;
  }
}

// [at:id] → 用户名的映射，由应用层在渲染消息前注入。
export const mentionNames = {};

// 附件渲染：图片内联预览，其他为文件卡片
export function renderAttachment(att) {
  if (!att) return '';
  const url = att.url || `/api/files/${att.id}`;
  const name = escapeHTML(att.name || '附件');
  const type = att.type || '';
  if (type.startsWith('image/')) {
    return `<a class="att-img" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${name}" loading="lazy"></a>`;
  }
  return `<a class="att-file" href="${url}" target="_blank" rel="noopener">${icon('file','att-file-icon')}<span class="att-file-name">${name}</span></a>`;
}
