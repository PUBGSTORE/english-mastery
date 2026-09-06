// router.js — hash router. Views are ES modules exporting render(container, params, query) → optional cleanup fn.
import { clearShortcuts, closeSheet, setTitle, scrollTop, toast } from './ui.js';

const routes = [];
let currentCleanup = null;
let currentPath = '';
let context = null; // what the user is studying right now (for the AI tutor)
const listeners = new Set();

export function route(pattern, loader, meta = {}) {
  // pattern like '/word/:id' → regex
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\//g, '\\/').replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^\\/]+)'; }) + '\\/?$');
  routes.push({ re, keys, loader, meta });
}

export function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  const query = {};
  if (qs) for (const kv of qs.split('&')) { const [k, v = ''] = kv.split('='); query[decodeURIComponent(k)] = decodeURIComponent(v); }
  return { path: path.startsWith('/') ? path : '/' + path, query };
}

export function navigate(hash, { replace = false } = {}) {
  const h = hash.startsWith('#') ? hash : '#' + hash;
  if (replace) history.replaceState(null, '', h); else location.hash = h;
  if (replace) handle();
}
export function current() { return currentPath; }
export function onRoute(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setContext(ctx) { context = ctx; }
export function getContext() { return context; }

async function handle() {
  const { path, query } = parseHash();
  const container = document.getElementById('view');
  let match = null, params = {};
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) { match = r; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); break; }
  }
  if (typeof currentCleanup === 'function') { try { currentCleanup(); } catch (e) { console.warn(e); } }
  currentCleanup = null;
  clearShortcuts();
  closeSheet();
  setContext(null);
  currentPath = path;
  try { localStorage.setItem('em.route', location.hash); } catch { /* ignore */ }
  for (const l of listeners) l(path);
  if (!match) { navigate('/', { replace: true }); return; }
  container.classList.remove('view'); void container.offsetWidth; container.classList.add('view');
  container.innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  try {
    const mod = await match.loader();
    // Guard against a navigation that happened while loading
    if (currentPath !== path) return;
    container.innerHTML = '';
    setTitle(match.meta.title || '');
    const cleanup = await mod.render(container, params, query);
    if (typeof cleanup === 'function') currentCleanup = cleanup;
    scrollTop();
    if (!match.meta.keepFocus) container.focus({ preventScroll: true });
  } catch (e) {
    console.error('[router] render failed', e);
    container.innerHTML = `<div class="card red"><h3>Something went wrong</h3><p class="muted">${(e && e.message) || e}</p><p><a class="btn" href="#/">Go home</a></p></div>`;
    toast('View failed to load: ' + ((e && e.message) || e), 'err');
  }
}

export function start() {
  window.addEventListener('hashchange', handle);
  if (!location.hash) {
    let last = '';
    try { last = localStorage.getItem('em.route') || ''; } catch { /* ignore */ }
    if (last && last !== '#/' && !last.startsWith('#/review')) { history.replaceState(null, '', last); }
  }
  handle();
}
