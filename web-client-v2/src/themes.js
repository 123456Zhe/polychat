// 主题系统：7 套预设 + 自定义 CSS，localStorage 持久化。
import { icon } from './icons.js';

export const THEMES = [
  { id: 'warm', name: '简约暖灰', desc: '默认浅色：柔光暖灰，中性舒适', sw: ['#f3f3f1', '#fafaf9', '#4f46e5', '#172033'] },
  { id: 'dusk', name: '暮石灰', desc: '护眼深色：低对比石墨，夜间首选', sw: ['#090b0f', '#171a21', '#7770ff', '#edf0f6'] },
  { id: 'mist', name: '雾蓝', desc: '冷静浅蓝：雾面质感，克制专业', sw: ['#edf0f4', '#f2f0ef', '#435675', '#2b3a4f'] },
  { id: 'midnight', name: '午夜靛蓝', desc: '深邃靛蓝：夜空般的沉浸深色', sw: ['#0b1220', '#1e293b', '#6366f1', '#e5e7eb'] },
  { id: 'teal', name: '青绿浅色', desc: '清新青绿：自然气息，活力而不刺眼', sw: ['#ecf3f2', '#f8fafc', '#0f766e', '#123f3b'] },
  { id: 'mocha', name: 'Catppuccin Mocha', desc: '社区经典深色：柔和马卡龙配色', sw: ['#11111b', '#1e1e2e', '#89b4fa', '#cdd6f4'] },
  { id: 'amber-rose', name: '琥珀玫瑰', desc: '暖阳浅色：琥珀与玫瑰的温柔碰撞', sw: ['#f9ecc8', '#fffdf4', '#d97706', '#451a03'] },
];

const LS_THEME = 'pc2.theme', LS_CSS = 'pc2.custom-css';
let styleEl = null;

export function applyTheme(id) {
  const theme = THEMES.find(t => t.id === id) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  try { localStorage.setItem(LS_THEME, theme.id); } catch {}
  return theme;
}

export function loadTheme() {
  let saved = null;
  try { saved = localStorage.getItem(LS_THEME); } catch {}
  return applyTheme(saved);
}

export function loadCustomCss() {
  try { return localStorage.getItem(LS_CSS) || ''; } catch { return ''; }
}

export function applyCustomCss(css) {
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'pc2-custom-css';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css || '';
  try {
    if (css) localStorage.setItem(LS_CSS, css);
    else localStorage.removeItem(LS_CSS);
  } catch {}
}

// 主题选择弹窗的 HTML（由 views.js 挂载）
export function themeModalHTML(current) {
  const cards = THEMES.map(t => `
    <button class="theme-card${t.id === current ? ' selected' : ''}" data-theme-id="${t.id}">
      <div class="theme-swatches"><span style="--sw1:${t.sw[0]}"></span><span style="--sw2:${t.sw[1]}"></span><span style="--sw3:${t.sw[2]}"></span><span style="--sw4:${t.sw[3]}"></span></div>
      <div class="theme-name-row"><span class="theme-name">${t.name}</span>${icon('check', 'theme-check')}</div>
      <div class="theme-desc">${t.desc}</div>
    </button>`).join('');
  return `
    <div class="modal-veil open" data-modal="theme">
      <div class="modal-panel" style="width:min(680px,100%)">
        <div class="modal-head">
          <div><div class="modal-title">主题与外观</div><div class="theme-dialog-copy">切换界面主题，或粘贴自定义 CSS 覆盖样式（保存在本机浏览器）。</div></div>
          <button class="icon-button" data-close title="关闭">${icon('x')}</button>
        </div>
        <div class="modal-body">
          <div class="theme-grid">${cards}</div>
          <div class="custom-css">
            <label for="pc2-css">自定义 CSS</label>
            <textarea id="pc2-css" placeholder="例如：&#10;.composer-input { font-size: 15px; }">${loadCustomCss().replace(/</g, '&lt;')}</textarea>
            <div class="custom-css-note">保存后立即生效，仅影响当前浏览器。</div>
            <div class="theme-actions">
              <button class="secondary-btn" data-css-clear>清空</button>
              <button class="primary-btn" data-css-save>保存 CSS</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}
