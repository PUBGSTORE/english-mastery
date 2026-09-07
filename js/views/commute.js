// commute.js — §8 hands-free audio player: word → pause → Hindi → example → pause to repeat. Media Session + wake lock + sleep timer.
import { html, mount, icon, toast, $ } from '../ui.js';
import * as db from '../db.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as tts from '../tts.js';
import { setContext } from '../router.js';
import { shuffle, sleep, pick } from '../utils.js';
import { vocabFace } from '../srs.js';

export async function render(container) {
  const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let mode = 'words'; let queue = []; let i = 0; let playing = false; let wake = null; let sleepAt = null; let stopFlag = false;
  const starred = new Set((await db.getSetting('commuteStars', [])) || []);
  const build = async () => {
    if (mode === 'words') {
      const q = await store.reviewQueue();
      const cards = q.queue.filter((c) => c.kind === 'vocab').slice(0, 60);
      const items = [];
      for (const c of cards) { const w = await content.wordById(c.refId); if (w) items.push({ id: w.id, word: w.word, hi: w.hi_def, en: w.en_def, example: (w.examples || [])[0]?.en || '' }); }
      if (items.length < 10) { for (const w of shuffle(await content.loadDeck('vocab-everyday')).slice(0, 40 - items.length)) items.push({ id: w.id, word: w.word, hi: w.hi_def, en: w.en_def, example: (w.examples || [])[0]?.en || '' }); }
      queue = items;
    } else if (mode === 'sentences') {
      const q = await store.reviewQueue();
      const items = [];
      for (const c of q.queue.slice(0, 40)) {
        if (c.kind === 'vocab') { const w = await content.wordById(c.refId); const ex = w && pick(w.examples || []); if (ex) items.push({ id: w.id, word: w.word, en: ex.en, hi: ex.hi }); }
        else if (c.kind === 'chunk' || c.kind === 'phrase') items.push({ id: c.refId, word: c.payload.text, en: c.payload.example?.en || c.payload.text, hi: c.payload.hi });
        else if (c.kind === 'mistake' || c.kind === 'correction') items.push({ id: c.refId, word: c.payload.fix || c.payload.to, en: c.payload.fix || c.payload.to, hi: '' });
      }
      queue = items;
    } else {
      const s = await store.settings();
      queue = shuffle((await content.shadowing()).filter((x) => x.cefr === s.level)).slice(0, 30).map((x) => ({ id: x.id, word: x.title || '', en: x.text, hi: x.hi }));
    }
  };
  const draw = () => {
    const it = queue[i];
    mount(container, html`
      <div class="page-head"><div><h1>Commute</h1><p class="sub">Hands-free audio. ${queue.length} items.</p></div></div>
      ${isApple ? html`<div class="card amber compact small">${icon('info')} On iPhone and iPad, Safari pauses speech when the screen locks. Keep the screen on (use the toggle below) or keep Safari in the foreground. Lock-screen controls work on Android and desktop.</div>` : ''}
      <div class="chips mb">${[['words', 'Words'], ['sentences', 'Due sentences'], ['shadow', 'Shadowing lines']].map(([k, l]) => html`<button class="chip ${mode === k ? 'active' : ''}" data-mode="${k}">${l}</button>`)}</div>
      <div class="card center" style="min-height:220px;display:flex;flex-direction:column;justify-content:center">${it ? html`<div class="xs muted">${i + 1}/${queue.length}</div><div style="font-size:var(--fs-2xl);font-weight:800">${it.word}</div><div class="hi-text" lang="hi">${it.hi}</div><div class="small muted mt">${it.en !== it.word ? it.en : ''}${it.example ? html`<br>${it.example}` : ''}</div>` : html`<div class="muted">Nothing queued. Add words or decks first.</div>`}</div>
      <div class="btn-row center mt" style="gap:14px"><button class="btn btn-icon" id="prev" style="width:56px;height:56px" aria-label="Previous">${icon('back')}</button><button class="btn btn-primary btn-icon" id="play" style="width:72px;height:72px" aria-label="Play or pause">${playing ? icon('stop') : icon('play')}</button><button class="btn btn-icon" id="next" style="width:56px;height:56px" aria-label="Next">${icon('next')}</button><button class="btn btn-icon ${it && starred.has(it.id) ? 'btn-primary' : ''}" id="star" style="width:56px;height:56px" aria-label="Star this word">${icon('star')}</button></div>
      <div class="row between mt"><label class="switch"><input type="checkbox" id="awake" ${wake ? 'checked' : ''}><span class="track"></span><span class="small">Keep screen awake${'wakeLock' in navigator ? '' : ' (unsupported here)'}</span></label>
        <div class="row" style="gap:6px"><span class="xs muted">Sleep in</span>${[0, 15, 30, 60].map((m) => html`<button class="chip ${sleepAt && m ? '' : ''}" data-sleep="${m}">${m ? m + 'm' : 'off'}</button>`)}</div></div>
      ${starred.size ? html`<p class="xs muted mt">${starred.size} starred · <a href="#/vocab/custom">review them later</a></p>` : ''}`);
    container.querySelectorAll('[data-mode]').forEach((b) => b.onclick = async () => { stop(); mode = b.dataset.mode; i = 0; await build(); draw(); });
    $('#play', container).onclick = () => (playing ? stop() : play());
    $('#prev', container).onclick = () => { stop(); i = Math.max(0, i - 1); draw(); };
    $('#next', container).onclick = () => { stop(); i = Math.min(queue.length - 1, i + 1); draw(); };
    $('#star', container).onclick = async () => { const it = queue[i]; if (!it) return; if (starred.has(it.id)) starred.delete(it.id); else { starred.add(it.id); if (it.id.startsWith('v:')) await store.ensureVocabCards([it.id], { priority: 1 }); } await db.setSetting('commuteStars', [...starred]); draw(); };
    $('#awake', container).onchange = async (e) => { if (e.target.checked) { try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch (err) { toast('Wake lock not available: ' + err.message, 'warn'); e.target.checked = false; } } else { wake && wake.release(); wake = null; } };
    container.querySelectorAll('[data-sleep]').forEach((b) => b.onclick = () => { const m = +b.dataset.sleep; sleepAt = m ? Date.now() + m * 60000 : null; toast(m ? `Sleep timer: ${m} min` : 'Sleep timer off', '', { timeout: 1500 }); });
  };
  const say = (t, rate = 1) => tts.speak(t, { rate });
  const play = async () => {
    if (!queue.length) return; playing = true; stopFlag = false; draw(); setMedia();
    while (playing && i < queue.length) {
      if (sleepAt && Date.now() > sleepAt) { toast('Sleep timer reached', '', { timeout: 2000 }); break; }
      const it = queue[i]; setMedia(it);
      if (mode === 'words') { await say(it.word); if (stopFlag) break; await sleep(1500); await say(it.word, 0.85); if (stopFlag) break; await sleep(800); await speakHindi(it.hi); if (stopFlag) break; await sleep(600); if (it.example) { await say(it.example); if (stopFlag) break; } await sleep(2200); }
      else { await say(it.en); if (stopFlag) break; await sleep(Math.min(6000, 700 + it.en.length * 45)); await say(it.en, 0.85); if (stopFlag) break; await sleep(Math.min(6000, 700 + it.en.length * 45)); }
      if (stopFlag) break;
      i++; if (i < queue.length) draw();
    }
    if (i >= queue.length) { i = 0; await store.bumpDay({ attempts: 1, skill: 'listening' }); }
    playing = false; draw();
  };
  const stop = () => { stopFlag = true; playing = false; tts.stop(); };
  const speakHindi = async (text) => { if (!text) return; const v = (window.speechSynthesis?.getVoices() || []).find((x) => /^hi/i.test(x.lang)); if (!v) return; await new Promise((res) => { const u = new SpeechSynthesisUtterance(text); u.voice = v; u.lang = v.lang; u.rate = 0.95; u.onend = res; u.onerror = res; speechSynthesis.speak(u); }); };
  const setMedia = (it) => {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: it ? it.word : 'ADHD Things', artist: it ? (it.hi || '') : 'Commute mode', album: 'ADHD Things', artwork: [{ src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
      navigator.mediaSession.setActionHandler('play', () => play());
      navigator.mediaSession.setActionHandler('pause', () => stop());
      navigator.mediaSession.setActionHandler('nexttrack', () => { stop(); i = Math.min(queue.length - 1, i + 1); play(); });
      navigator.mediaSession.setActionHandler('previoustrack', () => { stop(); i = Math.max(0, i - 1); play(); });
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch { /* ignore */ }
  };
  await build(); draw();
  setContext({ title: 'Commute mode', text: 'Audio-only word and sentence drill.' });
  return () => { stop(); wake && wake.release(); };
}
