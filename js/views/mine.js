// mine.js — YouTube vocabulary miner: link/paste/file → transcript → unknown words → DeepSeek meanings → SRS + protocol + library.
import { html, mount, icon, toast, confirmDialog, openSheet, closeSheet, speakButton, backLink, progressBar, $ } from '../ui.js';
import { hi, hiBlock } from '../i18n.js';
import * as db from '../db.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as ai from '../ai.js';
import * as yt from '../youtube.js';
import * as mine from '../mine.js';
import * as lemmas from '../lemmas.js';
import { setContext } from '../router.js';
import { fmtDate, nowISO, dayKey, addDays, todayKey, escapeHtml, readFileText } from '../utils.js';

export async function render(container, params) {
  if (params.id) return renderVideo(container, decodeURIComponent(params.id));
  return renderHub(container);
}

/* ============================================================ HUB ============================================================ */
async function renderHub(container) {
  const videos = (await db.getAll('videos', { index: 'ts' })).reverse();
  const key = await ai.hasKey();
  const proxy = (await db.getSetting('transcriptProxy', '')) || yt.DEFAULT_PROXY;
  const cap = await db.getSetting('mineCap', 40);
  const channels = await content.load('channels').catch(() => []);
  const harvested = videos.reduce((a, v) => a + (v.cardsAdded || 0), 0);
  mount(container, html`
    <div class="page-head"><div><h1>Mine a video</h1><p class="sub">Paste a YouTube link. Every video you watch becomes a deck of the words you did not know, with the exact sentence they appeared in.</p></div></div>
    <div class="card accent">
      <form id="mine-form" autocomplete="off">
        <div class="row"><input class="input" id="url" placeholder="https://youtu.be/… or a video id" inputmode="url" autocapitalize="off" style="flex:1;min-width:220px"><select class="select" id="cap" style="width:auto"><option value="20" ${cap == 20 ? 'selected' : ''}>20 words</option><option value="40" ${cap == 40 ? 'selected' : ''}>40 words</option><option value="60" ${cap == 60 ? 'selected' : ''}>60 words</option><option value="0" ${cap == 0 ? 'selected' : ''}>All words</option></select><button class="btn btn-primary" type="submit" id="go">${icon('search')} Mine</button></div>
      </form>
      <p class="xs muted mt mb-0">${proxy ? html`Transcript proxy connected — paste a link and it just works. If a video has no captions you'll be offered the paste box.` : html`No transcript proxy: after tapping Mine you'll paste the transcript.`} ${key ? '' : html`No DeepSeek key: you'll get the word list and video sentences without meanings.`}</p>
      <div id="mine-status" class="mt"></div>
    </div>
    <details class="card compact"><summary class="small muted" style="cursor:pointer">${icon('note')} Paste a transcript or any text instead (or drop a .srt / .vtt / .txt file)</summary>
      <textarea class="textarea mt" id="paste" rows="6" placeholder="Paste here: a YouTube transcript (Show transcript → select all → copy), an article, subtitles…"></textarea>
      <div class="row mt"><input class="input" id="paste-title" placeholder="Title (optional)" style="flex:1"><label class="btn" for="file">${icon('upload')} File</label><input type="file" id="file" accept=".srt,.vtt,.txt,.md,text/plain" hidden><button class="btn btn-primary" id="mine-text">Mine this text</button></div></details>
    ${videos.length ? html`<div class="row between mt-lg"><h3 class="mb-0">Your library</h3><span class="xs muted">${videos.length} mined · ${harvested} words harvested</span></div>
      <div class="list mt">${videos.map((v) => html`<a class="list-item" href="#/mine/${encodeURIComponent(v.id)}">${v.thumb ? html`<img src="${v.thumb}" alt="" style="width:64px;height:40px;object-fit:cover;border-radius:6px;flex:none">` : icon('note')}<div class="grow"><div class="title">${v.title || v.id}</div><div class="sub">${v.channel ? v.channel + ' · ' : ''}${fmtDate(v.ts)} · ${v.stats?.density ?? '?'}% known · ${v.cardsAdded || 0} added${v.protocol?.closed ? ' · closed' : ''}</div></div><button class="btn btn-sm btn-ghost" data-del-video="${v.id}" aria-label="Delete">${icon('trash')}</button>${icon('next', 'arrow')}</a>`)}</div>` : ''}
    <h3 class="mt-lg">Channels worth mining</h3>
    ${['Everyday English', 'Your field'].map((g) => html`<div class="section-label">${g}</div><div class="grid">${channels.filter((c) => c.group === g).map((c) => html`<a class="card compact" href="${c.url}" target="_blank" rel="noopener" style="margin:0"><div class="row between"><strong>${c.name}</strong><span class="chip" style="min-height:22px">${c.level}</span></div><div class="xs muted mt">${c.why}</div></a>`)}</div>`)}
    <p class="xs faint mt">Transcripts are fetched for your personal study only.</p>`);
  $('#cap', container).onchange = (e) => db.setSetting('mineCap', +e.target.value);
  container.querySelectorAll('[data-del-video]').forEach((b) => b.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); if (await confirmDialog('Delete this video from your library? Words you already added to reviews stay.', { okLabel: 'Delete', danger: true })) { await db.del('videos', b.dataset.delVideo); toast('Deleted', 'ok'); renderHub(container); } });
  $('#mine-form', container).onsubmit = (e) => { e.preventDefault(); startFromUrl(container, $('#url', container).value); };
  $('#mine-text', container).onclick = () => { const t = $('#paste', container).value.trim(); if (!t) { toast('Paste some text first.', 'warn'); return; } startFromText(container, t, $('#paste-title', container).value.trim() || 'Pasted text'); };
  $('#file', container).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const t = await readFileText(f); $('#paste', container).value = t; if (!$('#paste-title', container).value) $('#paste-title', container).value = f.name.replace(/\.[^.]+$/, ''); toast(`Loaded ${f.name}`, 'ok'); };
  const dz = container.querySelector('details.card');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.style.borderColor = 'var(--accent)'; });
  dz.addEventListener('dragleave', () => { dz.style.borderColor = ''; });
  dz.addEventListener('drop', async (e) => { e.preventDefault(); dz.style.borderColor = ''; const f = e.dataTransfer.files[0]; if (f) { dz.open = true; $('#paste', container).value = await readFileText(f); $('#paste-title', container).value ||= f.name.replace(/\.[^.]+$/, ''); } });
  setContext({ title: 'Video miner', text: 'Mining YouTube transcripts for unknown vocabulary.' });
}

async function startFromUrl(container, input) {
  const id = yt.parseVideoId(input);
  const status = $('#mine-status', container);
  if (!id) { toast('That does not look like a YouTube link or video id.', 'warn'); return; }
  const existing = await db.get('videos', id);
  if (existing && existing.words) { location.hash = `#/mine/${id}`; return; }
  mount(status, html`<div class="row"><span class="spinner"></span> Fetching video info…</div>`);
  const meta = await yt.fetchMeta(id);
  mount(status, html`<div class="row"><img src="${meta.thumb}" alt="" style="width:96px;border-radius:8px"><div class="grow"><strong>${meta.title || id}</strong><div class="xs muted">${meta.channel}</div><div class="xs muted mt" id="fetch-msg"><span class="spinner"></span> Getting the transcript through your worker… (up to a minute for long videos)</div></div></div><div id="fallback"></div>`);
  try {
    const t = await yt.fetchTranscript(id);
    await processSegments(container, { id, kind: 'youtube', title: meta.title || t.title || id, channel: meta.channel || t.channel || '', thumb: meta.thumb, url: yt.watchUrl(id) }, t.segments, { auto: t.auto });
  } catch (e) {
    const msg = $('#fetch-msg', container);
    if (e.code === 'NO_CAPTIONS') { msg.innerHTML = 'This video has no captions, so there is nothing to mine. Pick another one, or paste the text if you have it.'; }
    else if (e.code === 'CORS') { msg.textContent = e.message; }
    else { msg.textContent = e.message; }
    mount($('#fallback', container), html`<ol class="small mt" style="padding-left:1.2em"><li>Open the video on YouTube${meta.title ? '' : ''} → tap <strong>…more</strong> under the title → <strong>Show transcript</strong>.</li><li>Select all the transcript text and copy it (timestamps are fine).</li><li>Paste it here:</li></ol>
      <textarea class="textarea" id="fb-paste" rows="6" placeholder="Paste the transcript…"></textarea>
      <div class="btn-row mt"><button class="btn btn-primary" id="fb-go">Mine the pasted transcript</button><a class="btn" href="${yt.watchUrl(id)}" target="_blank" rel="noopener">${icon('play')} Open on YouTube</a></div>`);
    $('#fb-go', container).onclick = async () => {
      const raw = $('#fb-paste', container).value.trim(); if (!raw) return;
      const segs = yt.parseCaptions(raw);
      await processSegments(container, { id, kind: 'youtube', title: meta.title || id, channel: meta.channel, thumb: meta.thumb, url: yt.watchUrl(id) }, segs, { auto: false });
    };
  }
}
async function startFromText(container, raw, title) {
  const segs = yt.parseCaptions(raw);
  const id = mine.textId(raw);
  await processSegments(container, { id, kind: 'text', title, channel: '', thumb: '', url: '' }, segs, { auto: false });
}

/** Normalise → (optional punctuation repair) → analyse → save → open. */
async function processSegments(container, meta, segments, { auto }) {
  const status = $('#mine-status', container) || container;
  const { text, words, hasPunctuation, timed } = yt.segmentsToText(segments);
  if (words < 20) { toast('That transcript is too short to mine.', 'warn'); return; }
  let finalText = text;
  if (!hasPunctuation) {
    const key = await ai.hasKey();
    if (key) {
      const est = await mine.estimateRepunctuate(text);
      const ok = await confirmDialog(`This transcript has no punctuation (auto-captions). Fixing it with the tutor makes clean sentences for your cloze cards. About ${words} words ≈ ₹${est.inr.toFixed(2)}. Fix it?`, { okLabel: 'Fix punctuation', cancelLabel: 'Use as is' });
      if (ok) {
        try { mount(status, html`<div class="row"><span class="spinner"></span> Adding punctuation… <span id="pp"></span></div>`); finalText = await mine.repunctuate(text, { onChunk: (i, n) => { const p = $('#pp', container); if (p) p.textContent = `${i + 1}/${n}`; } }); }
        catch (e) { toast(e.message === 'CAP_REACHED' ? 'Monthly AI spend cap reached (Settings).' : e.message, 'err'); }
      }
    }
  }
  mount(status, html`<div class="row"><span class="spinner"></span> Analysing ${words} words… <span id="ap"></span></div>`);
  const cap = await db.getSetting('mineCap', 40);
  await lemmas.seed();
  const res = await mine.analyse(finalText, { segments: timed ? segments : null, cap, onProgress: (p) => { const el = $('#ap', container); if (el) el.textContent = `${Math.round(p * 100)}%`; } });
  const duration = timed ? Math.max(...segments.map((s) => (s.t || 0) + (s.d || 0))) : Math.round(words / 2.5);
  const rec = {
    id: meta.id, kind: meta.kind, title: meta.title, channel: meta.channel, thumb: meta.thumb, url: meta.url, ts: nowISO(), status: 'mined',
    duration, auto: !!auto, transcript: finalText, segments: timed ? segments.map((s) => ({ t: s.t, text: s.text })) : null,
    stats: res.stats, cap,
    words: res.candidates.map((c) => ({ lemma: c.lemma, form: c.form, count: c.count, sentence: c.sentence, t: c.t, band: c.band, rank: Math.round(c.rank * 10) / 10, decision: null, wordId: null })),
    protocol: { preTaught: false, watched: null, reviewed1: false, reviewed3: false, questionsDone: false, summaryDone: false, closed: false }, cardsAdded: 0,
  };
  await db.put('videos', rec);
  location.hash = `#/mine/${encodeURIComponent(meta.id)}?lookup=1`;
}

/* ============================================================ VIDEO ============================================================ */
async function renderVideo(container, id) {
  const v = await db.get('videos', id);
  if (!v) { mount(container, html`${backLink('#/mine')}<div class="empty">Not found</div>`); return; }
  const key = await ai.hasKey();
  const cache = await mine.cached(v.words.map((w) => w.lemma));
  const verdict = mine.verdict(v.stats.density);
  const pending = v.words.filter((w) => !w.decision);
  const newCount = pending.filter((w) => !cache.has(w.lemma)).length;
  const est = await mine.estimate(newCount);
  const month = await ai.monthSpend();
  const inr = await db.getSetting('inrRate', 84);
  let tab = location.hash.includes('tab=protocol') ? 'protocol' : location.hash.includes('tab=text') ? 'text' : 'words';
  const autoLookup = location.hash.includes('lookup=1');
  const draw = async () => {
    mount(container, html`
      ${backLink('#/mine', 'Miner')}
      <div class="card compact"><div class="row" style="align-items:flex-start">${v.thumb ? html`<img src="${v.thumb}" alt="" style="width:120px;border-radius:8px;flex:none">` : ''}<div class="grow"><h2 style="font-size:var(--fs-lg);margin:0">${v.title}</h2><div class="xs muted">${v.channel ? v.channel + ' · ' : ''}${yt.fmtTime(v.duration)} · ${v.stats.tokens} words · ${v.stats.unknownLemmas} unknown lemmas · mined ${fmtDate(v.ts)}</div>
        <div class="mt feedback ${verdict.level === 'ok' ? 'ok' : verdict.level === 'mid' ? 'close' : 'bad'} small" style="margin-top:8px"><strong>${v.stats.density}% known.</strong> ${verdict.text.replace(/^\d+% known — /, '')}</div></div></div>
        <div class="btn-row mt">${v.url ? html`<a class="btn btn-primary" href="${v.url}" target="_blank" rel="noopener" id="watch">${icon('play')} Watch on YouTube</a>` : ''}<a class="btn" href="#/read/${encodeURIComponent('v:' + v.id)}">${icon('book')} Reader mode</a><button class="btn btn-ghost" id="del-video" aria-label="Delete video">${icon('trash')} Delete</button></div></div>
      <div class="tabs"><button class="${tab === 'words' ? 'active' : ''}" data-t="words">Words (${v.words.length})</button><button class="${tab === 'protocol' ? 'active' : ''}" data-t="protocol">Protocol</button><button class="${tab === 'text' ? 'active' : ''}" data-t="text">Transcript</button></div>
      <div id="pane"></div>`);
    container.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
    const w = $('#watch', container); if (w) w.addEventListener('click', async () => { v.protocol.watched = nowISO(); await db.put('videos', v); });
    $('#del-video', container).onclick = async () => { if (await confirmDialog('Delete this video from your library? Words you already added to reviews stay.', { okLabel: 'Delete', danger: true })) { await db.del('videos', v.id); toast('Deleted', 'ok'); location.hash = '#/mine'; } };
    if (tab === 'words') drawWords(); else if (tab === 'protocol') drawProtocol(); else drawText();
  };
  const persist = () => db.put('videos', v);

  const drawWords = () => {
    const pane = $('#pane', container);
    const pendingNow = v.words.filter((w) => !w.decision);
    const newNow = pendingNow.filter((w) => !cache.has(w.lemma)).length;
    mount(pane, html`
      ${!key ? html`<div class="card amber"><strong>${icon('alert')} No meanings yet: the DeepSeek key is missing.</strong><p class="small mt">The word list and the video sentences are free, but the explanations (IPA, English meaning, हिन्दी, ગુજરાતી, example) come from DeepSeek. Add your key once and tap <em>Look up</em>; it costs about half a rupee per video and every word is cached forever.</p><a class="btn btn-primary" href="#/settings">Open Settings → AI tutor</a></div>` : ''}
      ${pendingNow.length && newNow ? html`<div class="card accent compact"><div class="row between"><div><strong>${icon('sparkle')} Get meanings for ${newNow} words</strong><div class="xs muted">${pendingNow.length - newNow} already in your word cache (free) · ${newNow} new ≈ ₹${(est.inr * newNow / Math.max(1, newCount)).toFixed(2)} · this month so far ₹${(month.usd * inr).toFixed(2)}</div></div>
        <button class="btn btn-primary" id="enrich" ${key ? '' : 'disabled'}>${key ? 'Look up' : 'Needs API key'}</button></div><div id="enrich-progress"></div></div>` : ''}
      <div class="btn-row mb"><button class="btn btn-sm" id="add-all">${icon('plus')} Add all</button><button class="btn btn-sm" id="add-b1">Add only B1+</button><button class="btn btn-sm" id="export">${icon('download')} Export list</button><span class="xs muted">${v.words.filter((w) => w.decision === 'added').length} added · ${v.words.filter((w) => w.decision === 'known').length} known · ${v.words.filter((w) => w.decision === 'ignored').length} ignored</span></div>
      <div class="list" id="wl">${v.words.map((w, i) => wordRow(w, i, cache.get(w.lemma)))}</div>`);
    const en = $('#enrich', pane); if (en) en.onclick = () => runEnrich(pane);
    if (autoLookup && key && newNow && en && !pane.dataset.offered) { pane.dataset.offered = '1'; setTimeout(() => runEnrich(pane), 400); }
    $('#add-all', pane).onclick = () => bulkAdd((w) => true);
    $('#add-b1', pane).onclick = () => bulkAdd((w) => { const c = cache.get(w.lemma); return c ? ['B1', 'B2', 'C1', 'C2'].includes(c.cefr) : w.band >= 3; });
    $('#export', pane).onclick = () => exportList();
    pane.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => decide(+b.dataset.i, b.dataset.act));
    pane.querySelectorAll('[data-fav]').forEach((b) => b.onclick = async () => { const w = v.words[+b.dataset.fav]; const c = cache.get(w.lemma) || {}; const mv = await import('../myvocab.js'); const added = await mv.toggle({ key: w.wordId || `lemma:${w.lemma}`, word: c.word || w.lemma, en: c.en_def || `Seen in: ${w.sentence.slice(0, 80)}`, hi: c.hi_def || '', gu: c.gu_def || '', ipa: c.ipa || '', source: { title: v.title, href: `#/mine/${encodeURIComponent(v.id)}` } }); b.style.color = added ? 'var(--red)' : ''; toast(added ? 'Added to your vocabulary list' : 'Removed from your list', 'ok', { timeout: 1500 }); });
    import('../myvocab.js').then(async (mv) => { const keys = new Set((await mv.list()).map((x) => x.key)); pane.querySelectorAll('[data-fav]').forEach((b) => { const w = v.words[+b.dataset.fav]; if (keys.has(w.wordId || `lemma:${w.lemma}`)) b.style.color = 'var(--red)'; }); });
  };
  const wordRow = (w, i, c) => html`<div class="list-item" style="align-items:flex-start;${w.decision ? 'opacity:.6' : ''}"><div class="grow">
      <div class="row" style="gap:6px"><strong style="font-size:var(--fs-lg)">${c ? c.word : w.lemma}</strong>${c ? html`<span class="ipa xs">${c.ipa}</span><span class="pos xs">${c.pos}</span><span class="chip" style="min-height:20px;padding:0 6px">${c.cefr}</span>` : html`<span class="chip" style="min-height:20px;padding:0 6px">band ${w.band > 5 ? '5+' : w.band}</span>`}<span class="xs faint">×${w.count}</span>${speakButton(c ? c.word : w.lemma)}</div>
      ${c ? html`<div class="small">${c.en_def}</div><div class="small">${hi(c.hi_def)}${c.gu_def ? html` <span class="hi-text" lang="gu">· ${c.gu_def}</span>` : ''}</div>${c.hi_nuance ? html`<div class="xs muted">${c.hi_nuance}</div>` : ''}` : ''}
      <div class="xs muted mt" style="font-style:italic">“${{ toString: () => escapeHtml(w.sentence).replace(new RegExp(`\\b(${escapeHtml(w.form || w.lemma)})\\b`, 'i'), '<mark style="background:var(--accent-soft);color:inherit;border-radius:3px">$1</mark>') }}”${w.t != null && v.url ? html` <a href="${yt.watchUrl(v.id, Math.max(0, w.t - 3))}" target="_blank" rel="noopener">${yt.fmtTime(w.t)}</a>` : ''}</div></div>
      <div class="stack" style="gap:4px">${w.decision ? html`<span class="chip ${w.decision === 'added' ? 'green' : ''}" style="min-height:26px">${w.decision}</span>` : html`<button class="btn btn-sm btn-primary" data-act="added" data-i="${i}">${icon('plus')} Add</button><button class="btn btn-sm" data-act="known" data-i="${i}">Know it</button><button class="btn btn-sm btn-ghost" data-act="ignored" data-i="${i}">Ignore</button>`}<div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn btn-sm btn-ghost" data-fav="${i}" aria-label="Add to my vocabulary list" title="My vocabulary list">❤</button><a class="btn btn-sm btn-ghost" href="https://www.google.com/search?q=${encodeURIComponent('define ' + (c ? c.word : w.lemma))}" target="_blank" rel="noopener" aria-label="Search on Google" title="Google">G</a></div></div></div>`;

  const runEnrich = async (pane) => {
    const pendingNow = v.words.filter((w) => !w.decision);
    const missing = pendingNow.filter((w) => !cache.has(w.lemma)).map((w) => w.lemma);
    const e = await mine.estimate(missing.length);
    if (!(await confirmDialog(`Look up ${missing.length} new words with deepseek-chat? Estimated cost ₹${e.inr.toFixed(2)} ($${e.usd.toFixed(4)}). Cached words are free.`, { okLabel: 'Look up' }))) return;
    const prog = $('#enrich-progress', pane); mount(prog, html`<div class="row mt"><span class="spinner"></span> <span id="ep">Looking up…</span></div>`);
    try {
      const level = await store.level();
      const sentences = Object.fromEntries(v.words.map((w) => [w.lemma, w.sentence]));
      const r = await mine.enrich(missing, { level, sentences, onBatch: (i, n) => { const el = $('#ep', pane); if (el) el.textContent = `Batch ${i + 1} of ${n}…`; } });
      for (const [k, val] of r.entries) cache.set(k, val);
      if (r.skipped.length) toast(`${r.skipped.length} words could not be looked up and were skipped: ${r.skipped.slice(0, 5).join(', ')}${r.skipped.length > 5 ? '…' : ''}`, 'warn', { timeout: 7000 });
      toast('Meanings saved to your word cache', 'ok');
    } catch (err) { toast(err.message === 'CAP_REACHED' ? 'Monthly AI spend cap reached. Raise it in Settings.' : err.message === 'NO_KEY' ? 'Add your DeepSeek key in Settings.' : err.message, 'err', { timeout: 7000 }); }
    drawWords();
  };
  const decide = async (i, act) => {
    const w = v.words[i]; w.decision = act;
    if (act === 'added') {
      const c = cache.get(w.lemma) || { lemma: w.lemma, word: w.lemma, ipa: '', pos: 'other', cefr: 'B1', en_def: `Seen in: ${w.sentence.slice(0, 80)}`, hi_def: 'अर्थ अभी नहीं मिला', example_en: '', example_hi: '', synonyms: [], register: 'neutral' };
      const wordId = await mine.toCustomWord({ ...c, form: w.form }, w.sentence, { videoId: v.id, title: v.title });
      if (wordId) { w.wordId = wordId; await store.ensureVocabCards([wordId], { priority: 1 }); v.cardsAdded = (v.cardsAdded || 0) + 1; }
      await lemmas.setState(w.lemma, lemmas.STATE.learning, 'mine');
    } else if (act === 'known') await lemmas.setState(w.lemma, lemmas.STATE.known, 'user');
    else if (act === 'ignored') await lemmas.setState(w.lemma, lemmas.STATE.ignored, 'user');
    await persist(); mine.invalidateDecks();
    drawWords();
  };
  const bulkAdd = async (pred) => {
    const targets = v.words.map((w, i) => [w, i]).filter(([w]) => !w.decision && pred(w));
    if (!targets.length) { toast('Nothing to add.', '', { timeout: 1500 }); return; }
    if (!(await confirmDialog(`Add ${targets.length} words to your reviews?${targets.length > 60 ? ' That is a lot; they will arrive at your daily new-card limit.' : ''}`, { okLabel: 'Add' }))) return;
    for (const [, i] of targets) await decide(i, 'added');
    toast(`Added ${targets.length} words`, 'ok');
  };
  const exportList = () => {
    const lines = ['word\tipa\tpos\tcefr\tenglish\thindi\tsentence'];
    for (const w of v.words) { const c = cache.get(w.lemma) || {}; lines.push([c.word || w.lemma, c.ipa || '', c.pos || '', c.cefr || '', c.en_def || '', c.hi_def || '', w.sentence].map((x) => String(x).replace(/\t/g, ' ')).join('\t')); }
    import('../utils.js').then(({ download }) => download(`${(v.title || v.id).replace(/[^\w]+/g, '-').slice(0, 40)}-words.tsv`, lines.join('\n'), 'text/tab-separated-values'));
  };

  const drawProtocol = () => {
    const pane = $('#pane', container);
    const p = v.protocol;
    const addedWords = v.words.filter((w) => w.decision === 'added');
    const watchedDay = p.watched ? dayKey(new Date(p.watched)) : null;
    const day3 = watchedDay ? dayKey(addDays(new Date(p.watched), 3)) : null;
    const today = todayKey();
    mount(pane, html`
      <p class="small muted">Watching once teaches almost nothing. This is the flow that does.</p>
      <div class="card ${p.preTaught ? 'green' : ''}"><div class="row between"><div><strong>1 · Pre-teach the 10 hardest words</strong><div class="xs muted">Comprehension jumps when the unknown words are not a surprise.</div></div>${p.preTaught ? icon('check') : html`<button class="btn btn-primary" id="preteach">Start</button>`}</div><div id="pt"></div></div>
      <div class="card ${p.watched ? 'green' : ''}"><div class="row between"><div><strong>2 · Watch</strong><div class="xs muted">${p.watched ? `Watched ${fmtDate(p.watched)}.` : 'Keep the word list open beside the video.'}</div></div>${v.url ? html`<a class="btn ${p.watched ? '' : 'btn-primary'}" href="${v.url}" target="_blank" rel="noopener" id="watch2">${icon('play')} Watch</a>` : ''}</div>${p.watched ? '' : html`<div class="btn-row mt"><button class="btn btn-sm btn-ghost" id="mark-watched">I've watched it</button></div>`}</div>
      <div class="card ${p.reviewed1 && p.reviewed3 ? 'green' : ''}"><strong>3 · Review twice, re-watch once</strong>
        <div class="small mt">${addedWords.length} words from this video are in your reviews${p.watched ? html`; they come back tomorrow and on <strong>${day3 ? fmtDate(day3, { weekday: 'short', day: 'numeric', month: 'short' }) : ''}</strong>` : ''}.</div>
        <div class="stack mt">
          <label class="switch"><input type="checkbox" id="r1" ${p.reviewed1 ? 'checked' : ''}><span class="track"></span><span>Day 1 review done</span></label>
          <label class="switch"><input type="checkbox" id="r3" ${p.reviewed3 ? 'checked' : ''}><span class="track"></span><span>Day 3: re-watched the same video ${day3 && today >= day3 && !p.reviewed3 ? html`<span class="chip amber" style="min-height:22px">due</span>` : ''}</span></label>
        </div>
        <p class="xs muted mt mb-0">Re-watching known content ("narrow listening") beats chasing new videos. The second viewing is where the words settle.</p></div>
      ${p.watched ? html`<div class="card ${p.closed ? 'green' : ''}"><strong>4 · Close the loop</strong><div class="small mt muted">Mining words is input; saying it back is output. A video is not finished until both are done.</div>
        <div class="row between mt"><span class="small">${p.questionsDone ? html`${icon('check')} Questions answered${p.questionsScore !== undefined ? ` (${p.questionsScore}/5)` : ''}` : 'Five comprehension questions from the transcript'}</span>${p.questionsDone ? '' : html`<button class="btn btn-sm btn-primary" id="q-start">${icon('sparkle')} Generate questions</button>`}</div><div id="q-area"></div>
        <div class="row between mt"><span class="small">${p.summaryDone ? html`${icon('check')} Summary recorded` : 'A 60-second summary in your own words'}</span>${p.summaryDone ? html`<button class="btn btn-sm" id="s-play">${icon('play')} Play</button>` : html`<button class="btn btn-sm btn-primary" id="s-start">${icon('mic')} Record summary</button>`}</div><div id="s-area"></div>
        ${p.closed ? html`<div class="feedback ok small mt">${icon('award')} Closed. This video is finished.</div>` : ''}</div>` : ''}
      ${addedWords.length ? html`<h3 class="mt-lg">Words I learned from this video</h3><div class="chips" id="learned">${addedWords.map((w) => html`<a class="chip" href="${w.wordId ? '#/word/' + w.wordId : '#'}" data-lemma="${w.lemma}">${(cache.get(w.lemma) || {}).word || w.lemma}</a>`)}</div>` : ''}`);
    const pt = $('#preteach', pane); if (pt) pt.onclick = () => preTeach($('#pt', pane));
    const w2 = $('#watch2', pane); if (w2) w2.onclick = async () => { v.protocol.watched = nowISO(); await persist(); };
    const mw = $('#mark-watched', pane); if (mw) mw.onclick = async () => { v.protocol.watched = nowISO(); await persist(); drawProtocol(); };
    $('#r1', pane).onchange = async (e) => { v.protocol.reviewed1 = e.target.checked; await persist(); };
    $('#r3', pane).onchange = async (e) => { v.protocol.reviewed3 = e.target.checked; await persist(); drawProtocol(); };
    const closeIfDone = async () => { if (v.protocol.questionsDone && v.protocol.summaryDone && !v.protocol.closed) { v.protocol.closed = true; await persist(); toast('Video closed. Input and output both done.', 'ok', { timeout: 4000 }); } };
    const qs = $('#q-start', pane); if (qs) qs.onclick = async () => {
      if (!(await ai.hasKey())) { toast('Comprehension questions need a DeepSeek key (Settings).', 'warn'); return; }
      qs.disabled = true; qs.innerHTML = '<span class="spinner"></span>';
      try {
        const gen = await import('../generate.js');
        const existing = (await db.getAll('generated', { index: 'refId', query: v.id })).find((g) => g.kind === 'questions');
        const rec = existing || await gen.comprehension(v);
        const area = $('#q-area', pane); let i = 0; let score = 0;
        const { mountExercise } = await import('../exercise.js');
        const step = async () => {
          if (i >= rec.data.items.length) { v.protocol.questionsDone = true; v.protocol.questionsScore = score; await persist(); await closeIfDone(); drawProtocol(); return; }
          const it = rec.data.items[i];
          mount(area, html`<div class="card compact mt" id="q-ex"></div>`);
          const item = it.type === 'choose' ? { type: 'choose', prompt: it.q, options: it.options || [], answer: [it.answer], hi: it.hi || '', feedback_en: '' } : { type: 'fix', prompt: it.q, answer: [it.answer], hi: it.hi || '', feedback_en: `Expected: ${it.answer}` };
          const r = await mountExercise($('#q-ex', area), item);
          if (r.status !== 'wrong') score++;
          const nb = document.createElement('button'); nb.className = 'btn btn-sm btn-primary mt'; nb.textContent = i === rec.data.items.length - 1 ? 'Finish' : 'Next'; nb.onclick = () => { i++; step(); }; $('#q-ex', area).appendChild(nb);
        };
        step();
      } catch (e) { toast(e.message === 'CAP_REACHED' ? 'Monthly AI cap reached.' : e.message, 'err'); qs.disabled = false; qs.textContent = 'Generate questions'; }
    };
    const ss = $('#s-start', pane); if (ss) ss.onclick = async () => {
      const area = $('#s-area', pane);
      mount(area, html`<p class="xs muted mt">Tell the story of the video in your own words for about a minute. No script.</p><div id="s-rec"></div>`);
      mountRecorderLite($('#s-rec', pane), `summary:${v.id}`, async (seconds) => { v.protocol.summaryDone = true; v.protocol.summarySeconds = seconds; await persist(); await store.logAttempt({ kind: 'speaking', refId: v.id, transcript: '', extra: { seconds, summary: true } }); await closeIfDone(); drawProtocol(); });
    };
    const sp = $('#s-play', pane); if (sp) sp.onclick = async () => { const a = await import('../audio.js'); const r = await a.getRecording(`summary:${v.id}`); if (r) a.play(r.blob); else toast('Recording not found on this device.', 'warn'); };
    // colour learned chips by card state
    (async () => { const cards = await store.allCards(); const byRef = new Map(cards.map((c) => [c.refId, c])); pane.querySelectorAll('#learned a').forEach((a) => { const w = addedWords.find((x) => x.lemma === a.dataset.lemma); const c = w && w.wordId ? byRef.get(w.wordId) : null; if (c && c.interval >= 21) a.classList.add('green'); else if (c && c.state !== 'new') a.classList.add('amber'); }); })();
  };
  const preTeach = (el) => {
    const top = v.words.filter((w) => w.decision !== 'ignored' && w.decision !== 'known').slice(0, 10);
    let i = 0; let revealed = false;
    const one = async () => {
      if (i >= top.length) { v.protocol.preTaught = true; await persist(); mount(el, html`<div class="feedback ok mt">Pre-teaching done. Now watch the video.</div>`); return; }
      const w = top[i]; const c = cache.get(w.lemma);
      mount(el, html`<div class="flashcard mt" style="min-height:200px"><span class="kind">pre-teach ${i + 1}/${top.length}</span><div class="word" style="font-size:var(--fs-2xl)">${c ? c.word : w.lemma} ${speakButton(c ? c.word : w.lemma)}</div><div class="xs muted" style="font-style:italic">“${w.sentence}”</div>
        <div class="answer" ${revealed ? '' : 'hidden'}>${c ? html`<div class="def">${c.en_def}</div><div>${hi(c.hi_def)}</div>` : html`<div class="muted small">No meaning yet (look up the words first for the best pre-teach).</div>`}</div></div>
        <div class="btn-row mt">${revealed ? html`<button class="btn btn-primary" id="pt-next">Next ${icon('next')}</button>${!w.decision ? html`<button class="btn" id="pt-add">${icon('plus')} Add to reviews</button>` : ''}` : html`<button class="btn btn-primary" id="pt-reveal">Show meaning</button>`}</div>`);
      const r = $('#pt-reveal', el); if (r) r.onclick = () => { revealed = true; one(); };
      const n = $('#pt-next', el); if (n) n.onclick = () => { i++; revealed = false; one(); };
      const a = $('#pt-add', el); if (a) a.onclick = async () => { await decide(v.words.indexOf(w), 'added'); one(); };
    };
    one();
  };
  const drawText = () => {
    const pane = $('#pane', container);
    const unknown = new Set(v.words.filter((w) => !w.decision || w.decision === 'added').map((w) => w.lemma));
    const sents = v.transcript.split(/(?<=[.!?])\s+/);
    mount(pane, html`<p class="xs muted">Unknown words are underlined. Tap a timestamp to jump there on YouTube. For read-aloud and tap-to-define, open <a href="#/read/${encodeURIComponent('v:' + v.id)}">Reader mode</a>.</p>
      <div class="card" style="line-height:1.9;font-size:var(--fs-md)">${sents.map((s, i) => { const seg = v.segments && v.segments.length ? nearestSeg(v.segments, s) : null; return html`<span>${seg && v.url ? html`<a class="xs faint" href="${yt.watchUrl(v.id, seg.t)}" target="_blank" rel="noopener">${yt.fmtTime(seg.t)}</a> ` : ''}${{ toString: () => markUnknown(s, unknown) }} </span>`; })}</div>`);
  };
  await draw();
  setContext({ title: `Mined video: ${v.title}`, text: `Transcript vocabulary. Unknown words: ${v.words.slice(0, 15).map((w) => w.lemma).join(', ')}. First sentences: ${v.transcript.slice(0, 300)}` });
}
function nearestSeg(segments, sentence) {
  const head = sentence.slice(0, 30).toLowerCase();
  return segments.find((s) => s.text.toLowerCase().includes(head.slice(0, 18))) || null;
}
function markUnknown(sentence, unknown) {
  return escapeHtml(sentence).replace(/[A-Za-z][A-Za-z'’-]*/g, (m) => {
    const { lemmatise } = lemmaApi;
    const l = lemmatise ? lemmatise(m.toLowerCase().replace(/’/g, "'")) : m.toLowerCase();
    return unknown.has(l) ? `<u style="text-decoration-color:var(--accent);text-underline-offset:3px">${m}</u>` : m;
  });
}
const lemmaApi = {};
import('../lemma.js').then((m) => { lemmaApi.lemmatise = m.lemmatise; });

/** Minimal record/stop widget used for the closing summary. */
function mountRecorderLite(el, refId, onDone) {
  import('../audio.js').then((audio) => {
    let rec = false; let t0 = 0;
    mount(el, html`<div class="row" style="justify-content:center;gap:16px"><button class="rec-btn" id="lite-rec">${icon('mic')}</button><div class="stack" style="flex:1;max-width:240px"><div class="meter"><span id="lite-meter"></span></div><div class="xs muted center" id="lite-status">Tap to start</div></div></div>`);
    $('#lite-rec', el).onclick = async () => {
      const b = $('#lite-rec', el); const st = $('#lite-status', el);
      if (!rec) { const ok = await audio.start({ onLevel: (v) => { { const _m = $('#lite-meter', el); if (_m) _m.style.width = `${Math.round(v * 100)}%`; } } }); if (!ok) return; rec = true; t0 = performance.now(); b.classList.add('recording'); b.innerHTML = String(icon('stop')); st.textContent = 'Recording…'; }
      else { rec = false; b.classList.remove('recording'); b.innerHTML = String(icon('mic')); const r = await audio.stop(); const seconds = (performance.now() - t0) / 1000; if (r && r.blob && r.blob.size) { await audio.saveRecording(refId, r.blob, r.mime, r.seconds); st.textContent = `Saved ${Math.round(seconds)}s`; onDone(seconds); } else st.textContent = 'Nothing recorded.'; }
    };
  });
}
