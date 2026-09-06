// i18n.js — Hindi toggle + reveal components.
import { html, raw, icon } from './ui.js';
import { escapeHtml } from './utils.js';

let hindiOn = false;
try { hindiOn = localStorage.getItem('em.hindi') === '1'; } catch { /* ignore */ }
const listeners = new Set();

export function isHindi() { return hindiOn; }
export function setHindi(v) {
  hindiOn = !!v;
  try { localStorage.setItem('em.hindi', hindiOn ? '1' : '0'); } catch { /* ignore */ }
  document.documentElement.classList.toggle('hindi-on', hindiOn);
  for (const l of listeners) l(hindiOn);
}
export function toggleHindi() { setHindi(!hindiOn); }
export function onHindiChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
document.documentElement.classList.toggle('hindi-on', hindiOn);

/**
 * Inline Hindi: shown if global toggle is on, otherwise a tap-to-reveal button.
 * Returns Raw html. Use inside html`` templates.
 */
export function hi(text, { block = true, label = 'हिन्दी' } = {}) {
  if (!text) return raw('');
  const t = escapeHtml(text);
  if (hindiOn) return raw(`<span class="hi-text ${block ? 'hi-inline' : ''}" lang="hi">${t}</span>`);
  return raw(`<span class="hi-wrap ${block ? '' : 'inline'}"><button type="button" class="hi-reveal" data-hi="${t}" aria-label="Show Hindi">${label}</button></span>`);
}

/** Longer Hindi section: <details> block, open when global toggle is on */
export function hiBlock(text, title = 'हिन्दी में समझें') {
  if (!text) return raw('');
  return html`<details class="hi-block" ${hindiOn ? 'open' : ''}><summary>${title}</summary><div class="hi-text" lang="hi">${raw(escapeHtml(text).replace(/\n/g, '<br>'))}</div></details>`;
}

// Delegated reveal handler (one listener for the whole app)
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.hi-reveal');
  if (!b) return;
  const span = document.createElement('span');
  span.className = 'hi-text hi-inline';
  span.setAttribute('lang', 'hi');
  span.textContent = b.getAttribute('data-hi');
  b.replaceWith(span);
});

export function hindiToggleButton() {
  return html`<button type="button" class="chip ${hindiOn ? 'active' : ''}" data-hindi-toggle aria-pressed="${hindiOn}">${icon('eye')} हिन्दी</button>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-hindi-toggle]');
  if (!b) return;
  toggleHindi();
});
