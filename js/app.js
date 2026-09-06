// app.js — boot: theme → db → nav → router → service worker.
import * as db from './db.js';
import { route, start, onRoute, navigate, getContext, current } from './router.js';
import { toast, icon, html, openSheet, $, $$ } from './ui.js';
import { isHindi, setHindi, onHindiChange } from './i18n.js';
import * as store from './store.js';
import * as tts from './tts.js';
import { dueCount } from './srs.js';

/* ---------------- theme ---------------- */
export function getTheme() { return document.documentElement.getAttribute('data-theme') || 'dark'; }
export function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('em.theme', t); } catch { /* ignore */ }
  updateThemeButtons();
}
function updateThemeButtons() {
  const t = getTheme();
  $$('#side-theme').forEach((b) => { b.innerHTML = `${icon(t === 'dark' ? 'sun' : 'moon')} ${t === 'dark' ? 'Light' : 'Dark'}`; });
}

/* ---------------- routes ---------------- */
const V = (name) => () => import(`./views/${name}.js`);
route('/', V('home'), { title: '' });
route('/review', V('review'), { title: 'Review' });
route('/vocab', V('vocab'), { title: 'Vocabulary' });
route('/vocab/:deck', V('vocab'), { title: 'Vocabulary' });
route('/word/:id', V('vocab'), { title: 'Word' });
route('/daily', V('daily'), { title: 'Daily 5' });
route('/daily/history', V('daily'), { title: 'Daily 5 history' });
route('/grammar', V('grammar'), { title: 'Grammar' });
route('/grammar/:id', V('grammar'), { title: 'Grammar' });
route('/pron', V('pronunciation'), { title: 'Pronunciation' });
route('/pron/:section', V('pronunciation'), { title: 'Pronunciation' });
route('/pron/:section/:id', V('pronunciation'), { title: 'Pronunciation' });
route('/shadow', V('shadowing'), { title: 'Shadowing' });
route('/shadow/:id', V('shadowing'), { title: 'Shadowing' });
route('/listen', V('listening'), { title: 'Listening' });
route('/listen/:mode', V('listening'), { title: 'Listening' });
route('/speak', V('speaking'), { title: 'Speaking' });
route('/write', V('writing'), { title: 'Writing' });
route('/write/:id', V('writing'), { title: 'Writing' });
route('/chat', V('chat'), { title: 'Tutor' });
route('/chat/:id', V('chat'), { title: 'Tutor' });
route('/notes', V('notes'), { title: 'Notes' });
route('/notes/:id', V('notes'), { title: 'Notes' });
route('/mistakes', V('mistakes'), { title: 'Mistakes' });
route('/progress', V('progress'), { title: 'Progress' });
route('/placement', V('placement'), { title: 'Placement test' });
route('/settings', V('settings'), { title: 'Settings' });
route('/learn', V('hub'), { title: 'Learn' });
route('/practice', V('hub'), { title: 'Practice' });

/* ---------------- navigation ---------------- */
const TABS = [
  { href: '#/', label: 'Home', icon: 'home', match: (p) => p === '/' },
  { href: '#/learn', label: 'Learn', icon: 'book', match: (p) => /^\/(learn|vocab|word|daily|grammar|notes)/.test(p) },
  { href: '#/practice', label: 'Practice', icon: 'target', match: (p) => /^\/(practice|pron|shadow|listen|speak|write|mistakes|review)/.test(p) },
  { href: '#/chat', label: 'Tutor', icon: 'chat', match: (p) => p.startsWith('/chat') },
  { href: '#/progress', label: 'Progress', icon: 'chart', match: (p) => /^\/(progress|settings|placement)/.test(p) },
];
const SIDE = [
  { title: '', items: [{ href: '#/', label: 'Home', icon: 'home' }, { href: '#/review', label: 'Review', icon: 'zap', badge: 'due' }] },
  { title: 'Learn', items: [{ href: '#/vocab', label: 'Vocabulary', icon: 'layers' }, { href: '#/daily', label: 'Daily 5', icon: 'calendar' }, { href: '#/grammar', label: 'Grammar', icon: 'book' }, { href: '#/notes', label: 'Notes', icon: 'note' }] },
  { title: 'Practice', items: [{ href: '#/pron', label: 'Pronunciation', icon: 'wave' }, { href: '#/shadow', label: 'Shadowing', icon: 'ear' }, { href: '#/listen', label: 'Listening', icon: 'speaker' }, { href: '#/speak', label: 'Speaking', icon: 'mic' }, { href: '#/write', label: 'Writing', icon: 'pen' }, { href: '#/mistakes', label: 'Mistakes', icon: 'alert' }] },
  { title: 'More', items: [{ href: '#/chat', label: 'AI Tutor', icon: 'chat' }, { href: '#/progress', label: 'Progress', icon: 'chart' }, { href: '#/settings', label: 'Settings', icon: 'settings' }] },
];
function renderNav() {
  const tab = document.getElementById('tabbar');
  tab.innerHTML = TABS.map((t) => `<a href="${t.href}" data-tab aria-label="${t.label}">${icon(t.icon)}<span>${t.label}</span></a>`).join('');
  const side = document.getElementById('side-links');
  side.innerHTML = SIDE.map((g) => `${g.title ? `<div class="side-title">${g.title}</div>` : ''}${g.items.map((i) => `<a class="side-link" href="${i.href}" data-side>${icon(i.icon)}<span>${i.label}</span>${i.badge ? `<span class="badge" data-badge="${i.badge}" hidden></span>` : ''}</a>`).join('')}`).join('');
  $('#side-theme').onclick = () => setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  const hb = $('#side-hindi');
  const syncHi = () => { hb.setAttribute('aria-pressed', String(isHindi())); hb.classList.toggle('active', isHindi()); };
  hb.onclick = () => { setHindi(!isHindi()); syncHi(); location.reload(); };
  onHindiChange(syncHi); syncHi();
  updateThemeButtons();
}
function highlightNav(path) {
  $$('[data-tab]').forEach((a, i) => a.classList.toggle('active', TABS[i].match(path)));
  $$('[data-side]').forEach((a) => {
    const h = a.getAttribute('href').slice(1);
    a.classList.toggle('active', h === '/' ? path === '/' : path === h || path.startsWith(h + '/'));
  });
  const fab = document.getElementById('ask-fab');
  fab.hidden = path.startsWith('/chat');
}
export async function refreshBadges() {
  try {
    const cards = await store.allCards();
    const n = dueCount(cards);
    $$('[data-badge="due"]').forEach((b) => { b.textContent = n; b.hidden = n === 0; });
  } catch { /* ignore */ }
}

/* ---------------- Ask FAB ---------------- */
async function openAsk() {
  const ctx = getContext();
  const mod = await import('./views/chat.js');
  const body = openSheet('<div class="chat-sheet"></div>', { wide: true });
  await mod.mountChat(body.querySelector('.chat-sheet'), { context: ctx, embedded: true });
}

/* ---------------- boot ---------------- */
async function boot() {
  renderNav();
  try {
    await db.open();
  } catch (e) {
    document.getElementById('view').innerHTML = `<div class="card red"><h2>Storage unavailable</h2><p>${e.message}. English Mastery needs IndexedDB. Private browsing on iOS may block it; open the site in a normal tab.</p></div>`;
    return;
  }
  try {
    if (!(await db.getMeta('installedAt'))) { await db.setMeta('installedAt', new Date().toISOString()); await db.setMeta('schemaVersion', db.DB_VERSION); }
    const s = await store.settings();
    if (s.hindiDefault && !localStorage.getItem('em.hindi')) setHindi(true);
    tts.setPreferredVoice(s.voice); tts.setRate(s.ttsRate || 1);
    db.requestPersistence();
  } catch (e) { console.warn(e); }
  onRoute((p) => { highlightNav(p); refreshBadges(); });
  document.getElementById('ask-fab').onclick = openAsk;
  store.startStudyTimer();
  start();
  registerSW();
  exportReminder();
  // First run → placement
  try {
    const s = await store.settings();
    if (!s.placementDone && !(await db.getSetting('placementSkipped', false)) && !location.hash.startsWith('#/placement') && !location.hash.startsWith('#/settings')) {
      toast('Take the 5-minute placement test to set your level.', '', { timeout: 8000, action: { label: 'Start', onClick: () => navigate('/placement') } });
    }
  } catch { /* ignore */ }
}

async function exportReminder() {
  try {
    const last = await db.getSetting('lastExport', null);
    const cards = await db.count('cards');
    if (!cards) return;
    const days = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
    const installed = await db.getMeta('installedAt');
    const sinceInstall = installed ? (Date.now() - new Date(installed).getTime()) / 86400000 : 0;
    if (days >= 7 && sinceInstall >= 1) {
      toast('It has been a week since your last backup. Export your progress.', 'warn', { timeout: 10000, action: { label: 'Export', onClick: () => navigate('/settings') } });
    }
  } catch { /* ignore */ }
}

let swReg = null;
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    swReg = reg;
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version is ready.', '', { timeout: 12000, action: { label: 'Reload', onClick: () => { w.postMessage({ type: 'SKIP_WAITING' }); } } });
        }
      });
    });
  }).catch((e) => console.warn('[sw] register failed', e));
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (refreshing) return; refreshing = true; location.reload(); });
}
export function getSWRegistration() { return swReg; }

boot();
