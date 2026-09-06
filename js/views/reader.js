// reader.js — Reader mode: any text (or a mined video's transcript) with word-state highlighting, tap-to-define, read-aloud, shadow.
import { html, mount, icon, toast, openSheet, closeSheet, speakButton, backLink, confirmDialog, $ } from '../ui.js';
import { hi } from '../i18n.js';
import * as db from '../db.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as ai from '../ai.js';
import * as tts from '../tts.js';
import * as mine from '../mine.js';
import * as lemmas from '../lemmas.js';
import { setContext } from '../router.js';
import { nowISO, fmtDate, hashStr, readFileText, escapeHtml, countWords } from '../utils.js';

export async function render(container, params) {
  if (params.id) return renderText(container, decodeURIComponent(params.id));
  return renderList(container);
}

async function renderList(container) {
  const texts = (await db.getAll('texts', { index: 'ts' })).reverse();
  const videos = (await db.getAll('videos', { index: 'ts' })).reverse();
  const totalRead = texts.reduce((a, t) => a + (t.wordsRead || 0), 0) + videos.reduce((a, v) => a + (v.wordsRead || 0), 0);
  mount(container, html`
    <div class="page-head"><div><h1>Reader</h1><p class="sub">Paste any article. Unknown words are marked; tap one to learn it. ${totalRead ? `${totalRead.toLocaleString()} words read so far.` : ''}</p></div></div>
    <div class="card accent"><input class="input mb" id="title" placeholder="Title"><textarea class="textarea" id="text" rows="7" placeholder="Paste an article, blog post, email, documentation… (or drop a .txt/.md file)"></textarea>
      <div class="row mt"><label class="btn" for="rfile">${icon('upload')} File</label><input type="file" id="rfile" accept=".txt,.md,text/plain" hidden><button class="btn btn-primary" id="open">${icon('book')} Read</button></div></div>
    ${texts.length ? html`<h3 class="mt-lg">Saved texts</h3><div class="list">${texts.map((t) => html`<a class="list-item" href="#/read/${encodeURIComponent(t.id)}">${icon('note')}<div class="grow"><div class="title">${t.title}</div><div class="sub">${t.words} words · ${fmtDate(t.ts)}${t.position ? ` · ${Math.round((t.position / Math.max(1, t.sentenceCount)) * 100)}% read` : ''}</div></div>${icon('next', 'arrow')}</a>`)}</div>` : ''}
    ${videos.length ? html`<h3 class="mt-lg">Mined videos</h3><div class="list">${videos.map((v) => html`<a class="list-item" href="#/read/${encodeURIComponent('v:' + v.id)}">${icon('play')}<div class="grow"><div class="title">${v.title}</div><div class="sub">${v.stats.tokens} words · ${v.stats.density}% known</div></div>${icon('next', 'arrow')}</a>`)}</div>` : ''}`);
  $('#rfile', container).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; $('#text', container).value = await readFileText(f); $('#title', container).value ||= f.name.replace(/\.[^.]+$/, ''); };
  $('#open', container).onclick = async () => {
    const text = $('#text', container).value.trim(); if (countWords(text) < 5) { toast('Paste some text first.', 'warn'); return; }
    const id = mine.textId(text);
    const title = $('#title', container).value.trim() || text.slice(0, 50) + '…';
    await db.put('texts', { id, title, text, source: 'paste', words: countWords(text), ts: nowISO(), position: 0, wordsRead: 0 });
    location.hash = `#/read/${encodeURIComponent(id)}`;
  };
  setContext({ title: 'Reader', text: 'Reading English texts with tap-to-define.' });
}

async function renderText(container, id) {
  const isVideo = id.startsWith('v:');
  const rec = isVideo ? await db.get('videos', id.slice(2)) : await db.get('texts', id);
  if (!rec) { mount(container, html`${backLink('#/read')}<div class="empty">Not found</div>`); return; }
  const text = isVideo ? rec.transcript : rec.text;
  await lemmas.seed();
  mount(container, html`${backLink(isVideo ? `#/mine/${encodeURIComponent(rec.id)}` : '#/read', isVideo ? 'Video' : 'Reader')}<div class="row"><span class="spinner"></span> Preparing…</div>`);
  const res = await mine.analyse(text, { cap: 400 });
  const cache = await mine.cached([...new Set(res.sentences.flatMap((s) => s.tokens.map((t) => t.lemma)))]);
  let rate = await db.getSetting('ttsRate', 1);
  let playing = false; let cur = rec.position || 0; let maxSeen = cur;
  const key = await ai.hasKey();
  mount(container, html`
    ${backLink(isVideo ? `#/mine/${encodeURIComponent(rec.id)}` : '#/read', isVideo ? 'Video' : 'Reader')}
    <div class="page-head"><div><h1 style="font-size:var(--fs-xl)">${rec.title}</h1><p class="sub">${res.stats.tokens} words · ${res.stats.density}% known · ${res.stats.unknownLemmas} unknown</p></div></div>
    <div class="card compact" style="position:sticky;top:8px;z-index:5"><div class="row between"><div class="btn-row"><button class="btn btn-primary" id="play">${icon('play')} Read aloud</button><button class="btn" id="stop" hidden>${icon('stop')} Stop</button></div>
      <div class="row" style="gap:6px"><span class="xs muted">Speed</span><input type="range" id="rate" min="0.6" max="1.3" step="0.05" value="${rate}" style="width:110px"><span class="xs" id="rv">${rate}×</span></div></div>
      <div class="legend mt"><span><i style="background:var(--accent-soft);border-bottom:2px solid var(--accent)"></i>unknown</span><span><i style="background:var(--amber-soft)"></i>learning</span><span class="faint">tap any word · tap a sentence's ¶ to play from there</span></div></div>
    <div class="card" id="reader" style="font-size:var(--fs-lg);line-height:1.9"></div>
    <div class="btn-row"><button class="btn" id="mark-read">${icon('check')} Finished reading</button>${isVideo ? '' : html`<button class="btn btn-ghost" id="del">${icon('trash')} Delete</button>`}</div>`);
  const reader = $('#reader', container);
  const stateCls = (t) => t.proper || t.stop || t.inDeck && t.state >= 2 ? '' : t.state === 1 ? 'rw-learning' : t.state <= 0 ? 'rw-unknown' : '';
  reader.innerHTML = res.sentences.map((s, i) => `<span class="rs" data-i="${i}"><button class="rs-play" data-play="${i}" aria-label="Play from here">¶</button>${renderSentence(s, stateCls)} </span>`).join('');
  const sentEls = Array.from(reader.querySelectorAll('.rs'));
  const highlight = (i) => { sentEls.forEach((el, k) => el.classList.toggle('rs-current', k === i)); if (sentEls[i]) { const r = sentEls[i].getBoundingClientRect(); if (r.top < 120 || r.bottom > window.innerHeight - 40) sentEls[i].scrollIntoView({ block: 'center', behavior: 'smooth' }); } };
  const playFrom = async (i) => {
    playing = true; $('#play', container).hidden = true; $('#stop', container).hidden = false;
    for (cur = i; cur < res.sentences.length && playing; cur++) {
      highlight(cur); maxSeen = Math.max(maxSeen, cur);
      const ok = await tts.speak(res.sentences[cur].text, { rate });
      if (!ok || !playing) break;
    }
    if (cur >= res.sentences.length) cur = res.sentences.length - 1;
    stopPlay();
  };
  const stopPlay = () => { playing = false; tts.stop(); $('#play', container).hidden = false; $('#stop', container).hidden = true; savePos(); };
  $('#play', container).onclick = () => playFrom(cur);
  $('#stop', container).onclick = stopPlay;
  $('#rate', container).oninput = (e) => { rate = +e.target.value; $('#rv', container).textContent = rate + '×'; };
  reader.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-play]'); if (p) { stopPlay(); playFrom(+p.dataset.play); return; }
    const w = e.target.closest('[data-l]'); if (w) { const si = +w.closest('.rs').dataset.i; openWordSheet(w.dataset.l, w.textContent, res.sentences[si].text, si); }
  });
  const savePos = async () => { rec.position = cur; rec.sentenceCount = res.sentences.length; rec.wordsRead = Math.max(rec.wordsRead || 0, res.sentences.slice(0, maxSeen + 1).reduce((a, s) => a + s.tokens.length, 0)); await db.put(isVideo ? 'videos' : 'texts', rec); };
  $('#mark-read', container).onclick = async () => { maxSeen = res.sentences.length - 1; cur = 0; await savePos(); await store.bumpDay({ attempts: 1, skill: 'listening' }); toast(`Logged ${res.stats.tokens} words read`, 'ok'); };
  const del = $('#del', container); if (del) del.onclick = async () => { if (await confirmDialog('Delete this text?', { okLabel: 'Delete', danger: true })) { await db.del('texts', id); location.hash = '#/read'; } };
  if (cur > 0 && cur < res.sentences.length) highlight(cur);

  async function openWordSheet(lemma, surface, sentence, si) {
    let c = cache.get(lemma);
    const st = await lemmas.stateOf(lemma);
    const body = openSheet(html`<div class="row between"><div><strong style="font-size:var(--fs-2xl)">${c ? c.word : lemma}</strong> ${speakButton(c ? c.word : lemma)}${c ? html`<div class="ipa">${c.ipa} · ${c.pos} · ${c.cefr}</div>` : ''}</div><span class="chip">${lemmas.STATE_LABEL[st]}</span></div>
      <div id="ws-body" class="mt">${c ? html`<div style="font-size:var(--fs-lg)">${c.en_def}</div><div>${hi(c.hi_def)}</div>${c.hi_nuance ? html`<div class="small muted mt">${c.hi_nuance}</div>` : ''}${c.example_en ? html`<div class="small mt">“${c.example_en}”<div>${hi(c.example_hi)}</div></div>` : ''}` : html`<p class="muted small">No meaning cached yet.</p>${key ? html`<button class="btn btn-sm" id="ws-lookup">${icon('sparkle')} Look up (≈ ₹0.02)</button>` : html`<p class="xs muted">Add a DeepSeek key in Settings to look words up.</p>`}`}</div>
      <div class="xs muted mt" style="font-style:italic">“${sentence}”</div>
      <div class="btn-row mt"><button class="btn btn-primary" id="ws-add">${icon('plus')} Add to SRS</button><button class="btn" id="ws-known">Mark known</button><button class="btn btn-ghost" id="ws-ignore">Ignore</button><button class="btn" id="ws-save">${icon('note')} Save sentence</button><button class="btn" id="ws-shadow">${icon('ear')} Shadow this</button><button class="btn btn-ghost" id="ws-fav">❤ My list</button><a class="btn btn-ghost" href="https://www.google.com/search?q=${encodeURIComponent('define ' + (c ? c.word : lemma))}" target="_blank" rel="noopener">G</a></div>`);
    $('#ws-fav', body).onclick = async () => { const mv = await import('../myvocab.js'); const added = await mv.toggle({ key: `lemma:${lemma}`, word: c ? c.word : lemma, en: c ? c.en_def : `Seen in: ${sentence.slice(0, 80)}`, hi: c ? c.hi_def : '', gu: c ? (c.gu_def || '') : '', ipa: c ? c.ipa : '', source: { title: rec.title, href: location.hash } }); toast(added ? 'Added to your vocabulary list' : 'Removed', 'ok', { timeout: 1500 }); };
    const lk = $('#ws-lookup', body); if (lk) lk.onclick = async () => { lk.disabled = true; try { const r = await mine.enrich([lemma], { level: await store.level(), sentences: { [lemma]: sentence } }); c = r.entries.get(lemma); if (c) { cache.set(lemma, c); closeSheet(); setTimeout(() => openWordSheet(lemma, surface, sentence, si), 250); } else toast('Could not look that up.', 'warn'); } catch (e) { toast(e.message === 'CAP_REACHED' ? 'Monthly AI cap reached.' : e.message, 'err'); lk.disabled = false; } };
    $('#ws-add', body).onclick = async () => { const entry = c || { lemma, word: lemma, ipa: '', pos: 'other', cefr: 'B1', en_def: `Seen in: ${sentence.slice(0, 80)}`, hi_def: 'अर्थ अभी नहीं मिला', example_en: '', example_hi: '', synonyms: [], register: 'neutral' }; const wid = await mine.toCustomWord({ ...entry, form: surface }, sentence, { textId: id, title: rec.title }); if (wid) await store.ensureVocabCards([wid], { priority: 1 }); await lemmas.setState(lemma, 1, 'mine'); mine.invalidateDecks(); toast('Added to reviews', 'ok'); closeSheet(); recolor(lemma, 1); };
    $('#ws-known', body).onclick = async () => { await lemmas.setState(lemma, 3, 'user'); closeSheet(); recolor(lemma, 3); };
    $('#ws-ignore', body).onclick = async () => { await lemmas.setState(lemma, -1, 'user'); closeSheet(); recolor(lemma, -1); };
    $('#ws-save', body).onclick = async () => { await store.saveNote({ title: c ? c.word : lemma, body: `${sentence}\n\n${c ? c.en_def + '\n' + c.hi_def : ''}`, tags: ['sentence', 'reader'], attachedTo: null }); toast('Sentence saved to Notes', 'ok'); };
    $('#ws-shadow', body).onclick = async () => { const sid = `sh:cu:${hashStr(sentence).toString(36)}`; await db.put('custom', { id: sid, kind: 'shadow', cefr: await store.level(), text: sentence, hi: '', focus: ['reader'], target_wps: [2.0, 3.0], words: countWords(sentence), title: sentence.slice(0, 40), notes_en: `From “${rec.title}”` }); closeSheet(); location.hash = `#/shadow/${encodeURIComponent(sid)}`; };
  }
  function recolor(lemma, state) { reader.querySelectorAll(`[data-l="${CSS.escape(lemma)}"]`).forEach((el) => { el.className = 'rw ' + (state === 1 ? 'rw-learning' : state <= 0 && state !== -1 ? 'rw-unknown' : ''); }); }
  setContext({ title: `Reading: ${rec.title}`, text: text.slice(0, 400) });
  return () => { stopPlay(); };
}
function renderSentence(s, stateCls) {
  // Rebuild the sentence text with word spans, preserving punctuation/spaces.
  const toks = s.tokens; let ti = 0;
  return escapeHtml(s.text).replace(/[A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z]/g, (m) => {
    const lower = m.toLowerCase().replace(/’/g, "'").replace(/'(s|re|ve|ll|d|m|t)$/, '');
    let t = toks[ti]; while (t && t.w !== lower && ti < toks.length - 1 && toks[ti + 1] && toks[ti + 1].w === lower) { ti++; t = toks[ti]; }
    if (t && t.w === lower) { ti++; return `<span class="rw ${stateCls(t)}" data-l="${escapeHtml(t.lemma)}">${m}</span>`; }
    return m;
  });
}
