/* sw.js — English Mastery service worker.
   Precaches the app shell and all content JSON so the app works fully offline.
   Bump VERSION whenever files change; old caches are deleted on activate. */
const VERSION = 'em-v2.5.2';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/theme.css', './css/app.css',
  './js/theme-init.js', './js/app.js', './js/router.js', './js/db.js', './js/srs.js', './js/store.js', './js/content.js', './js/ui.js', './js/utils.js',
  './js/i18n.js', './js/sync.js', './js/lemma.js', './js/lemmas.js', './js/mine.js', './js/youtube.js', './js/generate.js', './js/session.js', './js/pitch.js', './js/search.js', './js/weaksounds.js', './js/knowledge.js', './js/myvocab.js', './js/books.js', './js/discover.js', './js/tts.js', './js/asr.js', './js/audio.js', './js/ai.js', './js/charts.js', './js/exercise.js',
  './js/views/home.js', './js/views/hub.js', './js/views/review.js', './js/views/vocab.js', './js/views/daily.js', './js/views/grammar.js',
  './js/views/pronunciation.js', './js/views/shadowing.js', './js/views/listening.js', './js/views/speaking.js', './js/views/writing.js',
  './js/views/chat.js', './js/views/notes.js', './js/views/mistakes.js', './js/views/progress.js', './js/views/placement.js', './js/views/settings.js', './js/views/translate.js', './js/views/mine.js', './js/views/reader.js', './js/views/coverage.js', './js/views/chunks.js', './js/views/roots.js', './js/views/generate.js', './js/views/converse.js', './js/views/commute.js', './js/views/proof.js', './js/views/today.js', './js/views/knowledge.js', './js/views/myvocab.js', './js/views/everyday.js', './js/views/books.js', './js/views/discover.js', './js/views/know.js',
  './icons/favicon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
const DATA = [
  'index', 'discover-topics', 'vocab-everyday', 'chunks', 'morphology', 'confusables', 'daily-phrases', 'scenarios', 'vocab-a1', 'vocab-a2', 'vocab-b1', 'vocab-b2', 'vocab-c1', 'vocab-tech', 'phrasal-verbs', 'idioms', 'collocations',
  'grammar', 'indianisms', 'phonemes', 'minimal-pairs', 'stress', 'tongue-twisters', 'shadowing', 'listening',
  'writing-prompts', 'speaking-prompts', 'placement', 'tenses', 'frequency-5000', 'irregular-verbs', 'stoplist', 'channels',
].map((n) => `./data/${n}.json`);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Shell must succeed; data files are added individually so one missing file doesn't block install.
    await cache.addAll(SHELL);
    await Promise.all(DATA.map((u) => cache.add(u).catch((e) => console.warn('[sw] precache skip', u, e.message))));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // never touch api.deepseek.com etc.
  // Navigation: serve cached shell, refresh in background.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match('./index.html');
      const fetching = fetch(req).then((res) => { if (res.ok) cache.put('./index.html', res.clone()); return res; }).catch(() => null);
      return cached || (await fetching) || new Response('Offline', { status: 503 });
    })());
    return;
  }
  // Everything else same-origin: stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    const fetching = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (cached) { fetching.catch(() => {}); return cached; }
    const res = await fetching;
    return res || new Response('', { status: 504 });
  })());
});
