// app.js — boot: theme → db → nav → router → service worker.
import * as db from './db.js';
import { route, start, onRoute, navigate, getContext, current } from './router.js';
import { toast, icon, html, openSheet, $, $$ } from './ui.js';
import { isHindi, setHindi, onHindiChange } from './i18n.js';
import * as store from './store.js';
import * as tts from './tts.js';
import * as sync from './sync.js';
import * as session from './session.js';
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
route('/', V('today'), { title: 'Today' });
route('/today', V('today'), { title: 'Today' });
route('/home', V('home'), { title: 'Dashboard' });
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
route('/translate', V('translate'), { title: 'Translate' });
route('/mine', V('mine'), { title: 'Video miner' });
route('/mine/:id', V('mine'), { title: 'Mined video' });
route('/read', V('reader'), { title: 'Reader' });
route('/read/:id', V('reader'), { title: 'Reader' });
route('/coverage', V('coverage'), { title: 'Coverage' });
route('/chunks', V('chunks'), { title: 'Chunks' });
route('/chunks/:group', V('chunks'), { title: 'Chunks' });
route('/phrases', V('chunks'), { title: 'Everyday phrases' });
route('/roots', V('roots'), { title: 'Word roots' });
route('/roots/:id', V('roots'), { title: 'Word roots' });
route('/confusables', V('roots'), { title: 'Confusables' });
route('/confusables/:id', V('roots'), { title: 'Confusables' });
route('/generate', V('generate'), { title: 'Generate' });
route('/generate/:id', V('generate'), { title: 'Generate' });
route('/converse', V('converse'), { title: 'Conversation' });
route('/converse/:id', V('converse'), { title: 'Conversation' });
route('/commute', V('commute'), { title: 'Commute' });
route('/proof', V('proof'), { title: 'Proof' });
route('/proof/:id', V('proof'), { title: 'Proof' });
route('/knowledge', V('knowledge'), { title: 'Get Fast Knowledge' });
route('/knowledge/:id', V('knowledge'), { title: 'Get Fast Knowledge' });
route('/myvocab', V('myvocab'), { title: 'My vocabulary list' });
route('/everyday', V('everyday'), { title: 'Every day vocab' });
route('/everyday/:id', V('everyday'), { title: 'Every day vocab' });
route('/books', V('books'), { title: 'Book explainer' });
route('/books/:id', V('books'), { title: 'Book explainer' });
route('/know', V('know'), { title: 'Knowledge' });
route('/discover', V('discover'), { title: 'Daily Discovery' });
route('/discover/:id', V('discover'), { title: 'Daily Discovery' });
route('/learn', V('hub'), { title: 'Learn' });
route('/practice', V('hub'), { title: 'Practice' });

/* ---------------- navigation ---------------- */
const KNOW_RE = /^\/(know|discover|knowledge|books)(\/|$)/;
const TABS_ENGLISH = [
  { href: '#/', label: 'Today', icon: 'home', match: (p) => p === '/' || p === '/today' || p === '/home' },
  { href: '#/learn', label: 'Learn', icon: 'book', match: (p) => /^\/(learn|vocab|word|daily|grammar|notes)/.test(p) },
  { href: '#/practice', label: 'Practice', icon: 'target', match: (p) => /^\/(practice|pron|shadow|listen|speak|write|translate|mistakes|review|converse|generate|commute)/.test(p) },
  { href: '#/chat', label: 'Tutor', icon: 'chat', match: (p) => p.startsWith('/chat') },
  { href: '#/progress', label: 'Progress', icon: 'chart', match: (p) => /^\/(progress|settings|placement|proof)/.test(p) },
];
const TABS_KNOW = [
  { href: '#/know', label: 'Knowledge', icon: 'grid', match: (p) => p === '/know' },
  { href: '#/discover', label: 'Discover', icon: 'sparkle', match: (p) => p.startsWith('/discover') },
  { href: '#/knowledge', label: 'Videos', icon: 'play', match: (p) => p.startsWith('/knowledge') },
  { href: '#/books', label: 'Books', icon: 'book', match: (p) => p.startsWith('/books') },
  { href: '#/', label: 'English', icon: 'home', match: () => false },
];
let TABS = TABS_ENGLISH;
const SIDE_KNOW = [
  { title: '', items: [{ href: '#/know', label: 'Knowledge home', icon: 'grid' }] },
  { title: '🧠 Daily Discovery', cls: 'dc-group', items: [{ href: '#/discover', label: "Today's topics", icon: 'sparkle', cls: 'dc-link' }] },
  { title: '🦉 Get Fast Knowledge', cls: 'owl-group', items: [{ href: '#/knowledge', label: 'Analyse a video', icon: 'play', cls: 'owl-link' }] },
  { title: '📚 Book explainer', cls: 'book-group', items: [{ href: '#/books', label: 'Explain a book', icon: 'book', cls: 'book-link' }] },
  { title: 'More', items: [{ href: '#/notes', label: 'Notes', icon: 'note' }, { href: '#/myvocab', label: '❤ My vocabulary list', icon: 'star' }, { href: '#/chat', label: 'AI Tutor', icon: 'chat' }, { href: '#/settings', label: 'Settings', icon: 'settings' }] },
];
const SIDE_ENGLISH = [
  { title: '', items: [{ href: '#/', label: 'Today', icon: 'home' }, { href: '#/home', label: 'Dashboard', icon: 'grid' }, { href: '#/review', label: 'Review', icon: 'zap', badge: 'due' }] },
  { title: 'Learn', items: [{ href: '#/vocab', label: 'Vocabulary', icon: 'layers' }, { href: '#/daily', label: 'Daily 5', icon: 'calendar' }, { href: '#/grammar', label: 'Grammar', icon: 'book' }, { href: '#/mine', label: 'Video miner', icon: 'play' }, { href: '#/read', label: 'Reader', icon: 'eye' }, { href: '#/chunks', label: 'Chunks & phrases', icon: 'message' }, { href: '#/roots', label: 'Roots', icon: 'layers' }, { href: '#/coverage', label: 'Coverage', icon: 'trending' }, { href: '#/notes', label: 'Notes', icon: 'note' }] },
  { title: '', items: [{ href: '#/myvocab', label: '❤ My vocabulary list', icon: 'star' }] },
  { title: '🌞 Every day vocab', cls: 'sun-group', items: [{ href: '#/everyday', label: 'Everyday words', icon: 'sun', cls: 'sun-link' }, { href: '#/everyday/today', label: "Today's 10", icon: 'calendar' }, { href: '#/everyday/phrases', label: 'Ready-made sentences', icon: 'message' }] },
  { title: 'Practice', items: [{ href: '#/pron', label: 'Pronunciation', icon: 'wave' }, { href: '#/shadow', label: 'Shadowing', icon: 'ear' }, { href: '#/listen', label: 'Listening', icon: 'speaker' }, { href: '#/speak', label: 'Speaking', icon: 'mic' }, { href: '#/write', label: 'Writing', icon: 'pen' }, { href: '#/translate', label: 'Translate', icon: 'refresh' }, { href: '#/converse', label: 'Conversation', icon: 'chat' }, { href: '#/generate', label: 'Generate', icon: 'sparkle' }, { href: '#/commute', label: 'Commute', icon: 'speaker' }, { href: '#/mistakes', label: 'Mistakes', icon: 'alert' }] },
  { title: 'More', items: [{ href: '#/chat', label: 'AI Tutor', icon: 'chat' }, { href: '#/progress', label: 'Progress', icon: 'chart' }, { href: '#/proof', label: 'Proof', icon: 'award' }, { href: '#/settings', label: 'Settings', icon: 'settings' }] },
];
let world = 'english';
function renderNav() {
  TABS = world === 'know' ? TABS_KNOW : TABS_ENGLISH;
  const SIDE = world === 'know' ? SIDE_KNOW : SIDE_ENGLISH;
  document.body.dataset.world = world;
  const sw = document.getElementById('world-switch');
  if (sw) { sw.innerHTML = `<a href="#/" class="${world === 'english' ? 'active' : ''}" data-world="english">📘 English</a><a href="#/know" class="${world === 'know' ? 'active' : ''}" data-world="know">🧠 Knowledge</a>`; }
  const tab = document.getElementById('tabbar');
  tab.innerHTML = TABS.map((t) => `<a href="${t.href}" data-tab aria-label="${t.label}">${icon(t.icon)}<span>${t.label}</span></a>`).join('');
  const side = document.getElementById('side-links');
  side.innerHTML = SIDE.map((g) => `${g.title ? `<div class="side-title ${g.cls || ''}">${g.title}</div>` : ''}${g.items.map((i) => `<a class="side-link ${i.cls || ''}" href="${i.href}" data-side>${icon(i.icon)}<span>${i.label}</span>${i.badge ? `<span class="badge" data-badge="${i.badge}" hidden></span>` : ''}</a>`).join('')}`).join('');
  refreshBadges();
}
function bindSideFoot() {
  $('#side-theme').onclick = () => setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  const hb = $('#side-hindi');
  const syncHi = () => { hb.setAttribute('aria-pressed', String(isHindi())); hb.classList.toggle('active', isHindi()); };
  hb.onclick = () => { setHindi(!isHindi()); syncHi(); location.reload(); };
  onHindiChange(syncHi); syncHi();
  updateThemeButtons();
}
function highlightNav(path) {
  const w = KNOW_RE.test(path) ? 'know' : 'english';
  if (w !== world) { world = w; renderNav(); }
  $$('[data-tab]').forEach((a, i) => a.classList.toggle('active', TABS[i].match(path)));
  $$('[data-side]').forEach((a) => {
    const h = a.getAttribute('href').slice(1);
    a.classList.toggle('active', h === '/' ? path === '/' : path === h || path.startsWith(h + '/'));
  });
  const fab = document.getElementById('ask-fab');
  fab.hidden = path.startsWith('/chat');
  document.body.dataset.section = world === 'know' ? 'know' : (TABS.find((t) => t.match(path))?.label.toLowerCase() || 'today');
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
  renderNav(); bindSideFoot();
  try {
    await db.open();
  } catch (e) {
    document.getElementById('view').innerHTML = `<div class="card red"><h2>Storage unavailable</h2><p>${String(e.message).replace(/[<>&]/g, '')}. English Mastery needs IndexedDB. Private browsing on iOS may block it; open the site in a normal tab.</p></div>`;
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
  sync.start();
  session.init();
  start();
  document.addEventListener('keydown', (e) => { const tag = (e.target && e.target.tagName) || ''; if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && !document.querySelector('.search input')) { e.preventDefault(); import('./search.js').then((m) => m.openSearch()); } });
  localAutoBackup();
  registerSW();
  exportReminder();
  cloudRestoreOffer();
  // First run → placement
  try {
    const s = await store.settings();
    if (!s.placementDone && !(await db.getSetting('placementSkipped', false)) && !location.hash.startsWith('#/placement') && !location.hash.startsWith('#/settings')) {
      toast('Take the 5-minute placement test to set your level.', '', { timeout: 8000, action: { label: 'Start', onClick: () => navigate('/placement') } });
    }
  } catch { /* ignore */ }
}

/** New device with a token but no progress yet → offer to pull the cloud backup. */
async function cloudRestoreOffer() {
  try {
    if (!(await sync.isConfigured())) return;
    if (await db.getSetting('lastCloudRestore', null)) return;
    const cards = await db.count('cards');
    if (cards > 0) return;
    toast('A cloud backup may exist for this GitHub account.', '', { timeout: 12000, action: { label: 'Restore', onClick: () => navigate('/settings') } });
  } catch { /* ignore */ }
}

/** §11: silently keep the last 3 exports in IndexedDB (daily). */
async function localAutoBackup() {
  try {
    const last = await db.getSetting('lastLocalBackup', null);
    if (last && Date.now() - new Date(last).getTime() < 24 * 3600000) return;
    if (!(await db.count('cards'))) return;
    await db.snapshotBackup('auto');
    await db.setSetting('lastLocalBackup', new Date().toISOString());
  } catch (e) { console.warn('[backup]', e); }
}

async function exportReminder() {
  if (await sync.isConfigured()) return; // cloud backup covers it
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
