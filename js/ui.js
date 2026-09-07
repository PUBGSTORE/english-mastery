// ui.js — DOM helpers, toasts, sheets, icons, shortcuts, swipe.
import { escapeHtml } from './utils.js';

/** Tagged template: escapes interpolations unless wrapped with raw() */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v instanceof Raw) out += v.s;
      else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : escapeHtml(x))).join('');
      else if (v === null || v === undefined || v === false) out += '';
      else if (typeof v === 'object' && typeof v.toString === 'function' && v.toString !== Object.prototype.toString) out += v.toString(); // { toString } = trusted html
      else out += escapeHtml(v);
    }
  });
  return new Raw(out);
}
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));

/** Create an element from an HTML string (first element). */
export function el(htmlStr) {
  const t = document.createElement('template');
  t.innerHTML = String(htmlStr).trim();
  return t.content.firstElementChild;
}
export function frag(htmlStr) {
  const t = document.createElement('template');
  t.innerHTML = String(htmlStr);
  return t.content;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function render(container, htmlStr) {
  container.innerHTML = String(htmlStr);
  return container;
}
export const mount = render;

/* ---------------- icons (inline SVG) ---------------- */
const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  home: P('<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/>'),
  book: P('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>'),
  target: P('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
  chat: P('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/>'),
  chart: P('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/>'),
  play: P('<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/>'),
  speaker: P('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>'),
  mic: P('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v5"/>'),
  stop: P('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>'),
  check: P('<path d="M20 6L9 17l-5-5"/>'),
  x: P('<path d="M18 6L6 18M6 6l12 12"/>'),
  back: P('<path d="M15 18l-6-6 6-6"/>'),
  next: P('<path d="M9 18l6-6-6-6"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  flame: P('<path d="M12 22c4.4 0 8-3.1 8-7.5 0-3.6-2.5-6-4-8.5-.6 2-1.5 3-3 3.5 0-3-1.5-6-4-7.5.5 3-1 5-3 7.5A7.5 7.5 0 0 0 12 22z"/>'),
  snow: P('<path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  note: P('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>'),
  alert: P('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  ear: P('<path d="M6 8.5a6 6 0 0 1 12 0c0 3-2 3.5-2 6a3 3 0 0 1-6 0"/><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 1.5-1 1.6-1 3"/>'),
  wave: P('<path d="M2 12h2l2-6 3 12 3-16 3 14 2-8 2 4h3"/>'),
  pen: P('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  layers: P('<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 12l10 5 10-5M2 17l10 5 10-5"/>'),
  calendar: P('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  refresh: P('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>'),
  download: P('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>'),
  upload: P('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: P('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  sparkle: P('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>'),
  trash: P('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  info: P('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
  clock: P('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  eye: P('<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>'),
  shuffle: P('<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
  star: P('<polygon points="12 2 15 8.5 22 9.3 17 14 18.2 21 12 17.7 5.8 21 7 14 2 9.3 9 8.5"/>'),
  lock: P('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  unlock: P('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>'),
  grid: P('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'),
  list: P('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  send: P('<path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4z"/>'),
  edit: P('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>'),
  tag: P('<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><path d="M7 7h.01"/>'),
  message: P('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  trending: P('<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>'),
  zap: P('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
  award: P('<circle cx="12" cy="8" r="6"/><path d="M8.2 13.9L7 22l5-3 5 3-1.2-8.1"/>'),
};
export function icon(name, cls = '') {
  const s = ICONS[name] || ICONS.info;
  return raw(s.replace('<svg ', `<svg class="ic ${cls}" `));
}

/* ---------------- toast ---------------- */
export function toast(message, type = '', { timeout = 3200, action } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) { console.log('[toast]', message); return; }
  const t = el(`<div class="toast ${type}" role="status"></div>`);
  t.textContent = message;
  if (action) {
    const b = el(`<button class="btn btn-sm btn-ghost"></button>`);
    b.textContent = action.label;
    b.onclick = () => { action.onClick(); t.remove(); };
    t.appendChild(b);
  }
  root.appendChild(t);
  if (root.children.length > 3) root.firstElementChild.remove();
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 200); }, timeout);
  return t;
}

/* ---------------- sheet / dialog ---------------- */
let sheetCleanup = null;
export function openSheet(contentHtml, { wide = false, dialog = false, onClose } = {}) {
  closeSheet();
  const root = document.getElementById('sheet-root');
  root.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet ${wide ? 'wide' : ''} ${dialog ? 'dialog' : ''}" role="dialog" aria-modal="true"><div class="grabber"></div><div class="sheet-body"></div></div>`;
  const body = root.querySelector('.sheet-body');
  if (typeof contentHtml === 'string' || contentHtml instanceof Raw) body.innerHTML = String(contentHtml);
  else body.appendChild(contentHtml);
  root.querySelector('.sheet-backdrop').onclick = () => closeSheet();
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey);
  const prevFocus = document.activeElement;
  sheetCleanup = () => { document.removeEventListener('keydown', onKey); onClose && onClose(); prevFocus && prevFocus.focus && prevFocus.focus(); };
  requestAnimationFrame(() => root.classList.add('open'));
  const f = body.querySelector('input, textarea, button, [tabindex]');
  if (f && window.matchMedia('(min-width: 768px)').matches) setTimeout(() => f.focus(), 50);
  document.body.style.overflow = 'hidden';
  return body;
}
export function closeSheet() {
  const root = document.getElementById('sheet-root');
  if (!root || !root.classList.contains('open')) { if (root) root.innerHTML = ''; return; }
  root.classList.remove('open');
  document.body.style.overflow = '';
  const c = sheetCleanup; sheetCleanup = null;
  setTimeout(() => { root.innerHTML = ''; c && c(); }, 230);
}
export function isSheetOpen() { const r = document.getElementById('sheet-root'); return !!(r && r.classList.contains('open')); }

export function confirmDialog(message, { okLabel = 'OK', cancelLabel = 'Cancel', danger = false, title = '' } = {}) {
  return new Promise((resolve) => {
    const body = openSheet(html`
      ${title ? html`<h3>${title}</h3>` : ''}
      <p>${message}</p>
      <div class="btn-row right mt">
        <button class="btn" data-x="cancel">${cancelLabel}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-x="ok">${okLabel}</button>
      </div>`, { dialog: true, onClose: () => resolve(false) });
    body.querySelector('[data-x="ok"]').onclick = () => { resolve(true); sheetCleanup = null; closeSheet(); };
    body.querySelector('[data-x="cancel"]').onclick = () => closeSheet();
  });
}

export function promptDialog(message, { value = '', okLabel = 'Save', placeholder = '', multiline = false, title = '' } = {}) {
  return new Promise((resolve) => {
    const body = openSheet(html`
      ${title ? html`<h3>${title}</h3>` : ''}
      <p>${message}</p>
      ${multiline
        ? html`<textarea class="textarea" data-x="in" placeholder="${placeholder}">${value}</textarea>`
        : html`<input class="input" data-x="in" placeholder="${placeholder}" value="${value}">`}
      <div class="btn-row right mt">
        <button class="btn" data-x="cancel">Cancel</button>
        <button class="btn btn-primary" data-x="ok">${okLabel}</button>
      </div>`, { dialog: true, onClose: () => resolve(null) });
    const input = body.querySelector('[data-x="in"]');
    const ok = () => { const v = input.value; sheetCleanup = null; closeSheet(); resolve(v); };
    body.querySelector('[data-x="ok"]').onclick = ok;
    if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    body.querySelector('[data-x="cancel"]').onclick = () => closeSheet();
    setTimeout(() => input.focus(), 60);
  });
}

/* ---------------- keyboard shortcuts ---------------- */
let shortcutMap = new Map();
export function setShortcuts(map) { shortcutMap = new Map(Object.entries(map || {})); }
export function clearShortcuts() { shortcutMap = new Map(); }
document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/' && !typing) {
    const s = document.querySelector('input[type="search"], .search input');
    if (s) { e.preventDefault(); s.focus(); return; }
  }
  if (typing && e.key !== 'Escape') return;
  const fn = shortcutMap.get(e.key) || shortcutMap.get(e.code);
  if (fn) { e.preventDefault(); fn(e); }
});

/* ---------------- swipe ---------------- */
export function bindSwipe(node, { onLeft, onRight, onMove, threshold = 80 } = {}) {
  let x0 = 0, y0 = 0, dx = 0, dy = 0, active = false, id = null;
  const start = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    active = true; id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = 0; dy = 0;
    node.classList.add('dragging');
  };
  const move = (e) => {
    if (!active || e.pointerId !== id) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dx) < 20) return; // vertical scroll
    node.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
    onMove && onMove(dx);
  };
  const end = (e) => {
    if (!active || e.pointerId !== id) return;
    active = false; node.classList.remove('dragging');
    node.style.transform = '';
    if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) onLeft && onLeft(); else onRight && onRight();
    }
    onMove && onMove(0);
  };
  node.addEventListener('pointerdown', start);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
  return () => {
    node.removeEventListener('pointerdown', start);
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', end);
    node.removeEventListener('pointercancel', end);
  };
}

/* ---------------- misc ---------------- */
export function setTitle(t) { document.title = t ? `${t} · ADHD Things` : 'ADHD Things'; }
export function scrollTop() { window.scrollTo({ top: 0, behavior: 'auto' }); }
export function haptic() { try { if (navigator.vibrate) navigator.vibrate(8); } catch { /* ignore */ } }
export function backLink(href, label = 'Back') {
  return html`<a class="back" href="${href}">${icon('back')} ${label}</a>`;
}
export function speakButton(text, extraCls = '') {
  return html`<button type="button" class="speak-btn ${extraCls}" data-speak="${text}" aria-label="Listen">${icon('speaker')}</button>`;
}
export function progressBar(pctVal, cls = '') {
  return html`<div class="progress ${cls}" role="progressbar" aria-valuenow="${Math.round(pctVal)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.max(0, Math.min(100, pctVal))}%"></span></div>`;
}
export function emptyState(msg, iconName = 'info') {
  return html`<div class="empty">${icon(iconName)}<p>${msg}</p></div>`;
}
