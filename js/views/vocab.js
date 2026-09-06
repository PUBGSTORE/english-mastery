// vocab.js — deck browser, deck list, word detail, search.
import { html, mount, icon, toast, confirmDialog, speakButton, progressBar, backLink, $ } from '../ui.js';
import { hi, hiBlock } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import { debounce, fmtRelDue, pick } from '../utils.js';
import { setContext } from '../router.js';
import { current } from '../router.js';

export async function render(container, params) {
  const path = current();
  if (path.startsWith('/word/')) return renderWord(container, params.id);
  if (params.deck === 'collocations') return renderCollocations(container);
  if (params.deck) return renderDeck(container, params.deck);
  return renderDecks(container);
}

async function renderDecks(container) {
  const stats = await Promise.all(content.VOCAB_DECKS.map((d) => store.deckStats(d.id)));
  const idx = await content.index().catch(() => null);
  const counts = (idx && idx.counts) || {};
  mount(container, html`
    <div class="page-head"><div><h1>Vocabulary</h1><p class="sub">Frequency-ordered decks. Add a deck to feed it into your reviews at ${(await store.settings()).newPerDay} new words a day.</p></div></div>
    <div class="search mb">${icon('search')}<input class="input" type="search" id="q" placeholder="Search 1,200+ words, Hindi meanings…" autocomplete="off"></div>
    <div id="results"></div>
    <div class="card accent compact"><div class="row between"><div><strong>${icon('sparkle')} Words for any topic</strong><div class="xs muted">The tutor writes full entries (Hindi, examples, mistakes) and adds them to <a href="#/vocab/custom">My AI words</a>.</div></div></div>
      <form class="row mt" id="gen-form" autocomplete="off"><input class="input" id="gen-topic" placeholder="e.g. job interviews, cooking, cloud security, small talk" style="flex:1;min-width:200px"><select class="select" id="gen-n" style="width:auto"><option value="5">5 words</option><option value="10">10 words</option></select><button class="btn btn-primary" type="submit" id="gen-btn">Generate</button></form>
      <div id="gen-out" class="mt"></div></div>
    <div class="grid">
      ${content.VOCAB_DECKS.map((d, i) => {
        const s = stats[i]; const total = counts[d.file] || s.total || 0;
        return html`<a class="card" href="#/vocab/${d.id}"><div class="row between"><h3 class="mb-0">${d.name}</h3><span class="chip">${d.cefr}</span></div>
          <p class="muted small">${d.desc}</p>
          ${s.total ? html`${progressBar((s.mastered / s.total) * 100, 'green')}<p class="xs muted mt" style="margin-bottom:0">${s.learned}/${s.total} learned · ${s.mastered} mastered${s.due ? ` · ${s.due} due` : ''}</p>` : html`<p class="xs muted mb-0">${total} words · not in reviews yet</p>`}</a>`;
      })}
      <a class="card" href="#/vocab/collocations"><div class="row between"><h3 class="mb-0">Collocations</h3><span class="chip">A2–C1</span></div><p class="muted small">make vs do, take vs have, workplace and security phrases</p><p class="xs muted mb-0">${counts.collocations || 150} phrases</p></a>
    </div>`);
  const q = $('#q', container); const res = $('#results', container);
  q.oninput = debounce(async () => {
    const v = q.value.trim();
    if (!v) { res.innerHTML = ''; return; }
    const hits = await content.searchVocab(v);
    mount(res, html`<div class="list mb">${hits.length ? hits.map((w) => html`<a class="list-item" href="#/word/${w.id}"><div class="grow"><div class="title">${w.word} <span class="ipa xs">${w.ipa}</span></div><div class="sub">${w.en_def} · <span class="hi-text" lang="hi">${w.hi_def}</span></div></div><span class="chip">${w.cefr}</span></a>`) : html`<div class="empty small">No matches for “${v}”</div>`}</div>`);
  }, 150);
  $('#gen-form', container).onsubmit = async (e) => {
    e.preventDefault();
    const topic = $('#gen-topic', container).value.trim(); if (!topic) return;
    const ai = await import('../ai.js');
    if (!(await ai.hasKey())) { toast('Add your DeepSeek key in Settings first.', 'warn', { action: { label: 'Settings', onClick: () => { location.hash = '#/settings'; } } }); return; }
    const btn = $('#gen-btn', container); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing…';
    try {
      const n = +$('#gen-n', container).value;
      const all = await content.allVocab();
      const level = await store.level();
      const words = await ai.generateWords(topic, level, n, all.filter((w) => (w.tags || []).includes('custom') || Math.random() < 0.15).map((w) => w.word));
      const saved = await content.addCustomWords(words, { topic });
      if (!saved.length) { toast('All suggested words already exist in your decks. Try a narrower topic.', 'warn'); }
      else {
        await store.ensureVocabCards(saved.map((w) => w.id), { priority: 1 });
        mount($('#gen-out', container), html`<div class="chips">${saved.map((w) => html`<a class="chip green" href="#/word/${w.id}">${w.word}</a>`)}</div><p class="xs muted mt mb-0">${saved.length} new words saved and queued for review.</p>`);
        toast(`${saved.length} words added to My AI words`, 'ok');
      }
    } catch (err) { toast(err.message === 'NO_KEY' ? 'Add your DeepSeek key in Settings.' : err.message, 'err', { timeout: 7000 }); }
    btn.disabled = false; btn.textContent = 'Generate';
  };
}

async function renderDeck(container, deckId) {
  const deck = content.VOCAB_DECKS.find((d) => d.id === deckId);
  if (!deck) { container.innerHTML = 'Unknown deck'; return; }
  const rows = await content.loadDeck(deckId);
  const cards = new Map((await store.allCards()).filter((c) => c.deck === deckId).map((c) => [c.refId, c]));
  const stats = await store.deckStats(deckId);
  let filter = 'all';
  const draw = () => {
    const list = rows.filter((w) => filter === 'all' || (filter === 'new' && !cards.has(w.id)) || (filter === 'learning' && cards.has(w.id) && !(cards.get(w.id).interval >= 21)) || (filter === 'mastered' && cards.has(w.id) && cards.get(w.id).interval >= 21));
    mount($('#deck-list', container), html`${list.map((w) => { const c = cards.get(w.id); return html`<a class="list-item" href="#/word/${w.id}"><div class="grow"><div class="title">${w.word} <span class="ipa xs">${w.ipa}</span></div><div class="sub">${w.en_def}</div></div>${c ? html`<span class="chip ${c.interval >= 21 ? 'green' : c.state === 'new' ? '' : 'amber'}">${c.state === 'new' ? 'queued' : c.interval >= 21 ? 'mastered' : `due ${fmtRelDue(c.due)}`}</span>` : ''}</a>`; })}`);
  };
  mount(container, html`
    ${backLink('#/vocab', 'Decks')}
    <div class="page-head"><div><h1>${deck.name}</h1><p class="sub">${deck.desc} · ${rows.length} words · ${deck.cefr}</p></div>
      <div class="btn-row">${stats.total ? html`<a class="btn btn-primary" href="#/review?deck=${deckId}">${icon('zap')} Review ${stats.due ? `(${stats.due})` : ''}</a><button class="btn btn-ghost" id="remove">Remove from reviews</button>` : html`<button class="btn btn-primary" id="add">${icon('plus')} Add all ${rows.length} to reviews</button>`}</div></div>
    ${stats.total ? html`<div class="card compact">${progressBar((stats.mastered / stats.total) * 100, 'green')}<p class="xs muted mt mb-0">${stats.learned} learned · ${stats.mastered} mastered · ${stats.total - stats.learned} not yet seen</p></div>` : ''}
    <div class="chips mb" id="filters">${['all', 'new', 'learning', 'mastered'].map((f) => html`<button class="chip ${f === 'all' ? 'active' : ''}" data-f="${f}">${f}</button>`)}</div>
    <div class="list" id="deck-list"></div>`);
  draw();
  container.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; container.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('active', x === b)); draw(); });
  const add = $('#add', container);
  if (add) add.onclick = async () => { add.disabled = true; const n = await store.addDeckToSrs(deckId); toast(`Added ${n} words. They will appear ${(await store.settings()).newPerDay} per day.`, 'ok', { timeout: 5000 }); renderDeck(container, deckId); };
  const rm = $('#remove', container);
  if (rm) rm.onclick = async () => { if (await confirmDialog('Remove this deck from reviews? Your review history for these words stays, but scheduling is lost.', { okLabel: 'Remove', danger: true })) { await store.removeDeckFromSrs(deckId); toast('Deck removed from reviews', 'ok'); renderDeck(container, deckId); } };
  setContext({ title: deck.name, text: `Vocabulary deck ${deck.name} (${deck.cefr}).` });
}

async function renderCollocations(container) {
  const rows = await content.collocations();
  const cards = new Set((await store.allCards()).filter((c) => c.kind === 'collocation').map((c) => c.refId));
  const groups = {};
  for (const c of rows) (groups[c.pattern] ||= []).push(c);
  mount(container, html`
    ${backLink('#/vocab', 'Decks')}
    <div class="page-head"><div><h1>Collocations</h1><p class="sub">Words that go together. Hindi speakers translate word-by-word; English chooses partners.</p></div>
      <div class="btn-row">${cards.size ? html`<a class="btn btn-primary" href="#/review?kind=collocation">${icon('zap')} Review</a>` : ''}<button class="btn ${cards.size ? '' : 'btn-primary'}" id="add-all">${icon('plus')} Add all ${rows.length}</button></div></div>
    ${Object.entries(groups).map(([pattern, list]) => html`<h3 class="mt-lg">${pattern}</h3><div class="list">${list.map((c) => html`<div class="list-item"><div class="grow"><div class="title">${c.phrase} ${speakButton(c.phrase)}</div><div class="sub"><span style="color:var(--red);text-decoration:line-through">${c.wrong}</span> · ${c.en_def}</div><div class="sub">${hi(c.hi_def)}</div></div>${cards.has(c.id) ? html`<span class="chip green">${icon('check')}</span>` : html`<button class="btn btn-sm" data-add="${c.id}">${icon('plus')}</button>`}</div>`)}</div>`)}`);
  container.querySelectorAll('[data-add]').forEach((b) => b.onclick = async () => { await store.ensureCard({ id: `card:${b.dataset.add}`, refId: b.dataset.add, deck: 'collocations', kind: 'collocation' }); b.replaceWith(Object.assign(document.createElement('span'), { className: 'chip green', innerHTML: String(icon('check')) })); });
  $('#add-all', container).onclick = async () => { let n = 0; for (const c of rows) { if (!cards.has(c.id)) { await store.ensureCard({ id: `card:${c.id}`, refId: c.id, deck: 'collocations', kind: 'collocation' }); n++; } } toast(`Added ${n} collocations`, 'ok'); renderCollocations(container); };
  setContext({ title: 'Collocations', text: 'English collocations (make/do, take/have, workplace phrases).' });
}

export async function renderWord(container, id) {
  const w = await content.wordById(id);
  if (!w) { mount(container, html`${backLink('#/vocab')}<div class="empty">Word not found.</div>`); return; }
  const deckId = content.deckOfWord(id);
  const deck = content.VOCAB_DECKS.find((d) => d.id === deckId);
  const card = await store.getCard(store.vocabCardId(id));
  const retention = await store.wordRetention(id);
  const notes = await store.notesFor(id);
  mount(container, html`
    ${backLink(deck ? `#/vocab/${deck.id}` : '#/vocab', deck ? deck.name : 'Vocabulary')}
    <div class="card">
      <div class="word-head"><span class="word">${w.word}</span><span class="ipa">${w.ipa}</span>${speakButton(w.word)}<span class="pos">${w.pos}</span><span class="chip">${w.cefr}</span><span class="chip">${w.register}</span>${w.separable !== null && w.separable !== undefined ? html`<span class="chip">${w.separable ? 'separable' : 'inseparable'}</span>` : ''}</div>
      <p style="font-size:var(--fs-lg);margin-top:10px">${w.en_def}</p>
      <div class="hi-text" lang="hi" style="font-size:var(--fs-lg)">${w.hi_def}</div>
      ${w.hi_nuance ? html`<div class="feedback close mt small"><strong>Hindi speakers, note:</strong> ${w.hi_nuance}</div>` : ''}
      <div class="btn-row mt">
        ${card ? html`<span class="chip ${card.interval >= 21 ? 'green' : 'amber'}">${card.state === 'new' ? 'In queue' : `Due ${fmtRelDue(card.due)} · ease ${card.ease}`}${retention !== null ? ` · retention ${retention}%` : ''}</span>` : html`<button class="btn btn-primary" id="add-card">${icon('plus')} Add to reviews</button>`}
        <button class="btn" id="add-note">${icon('note')} Note</button>
      </div>
    </div>
    <div class="section-label">Examples</div>
    <div class="example-list">${(w.examples || []).map((ex) => html`<div class="ex"><div class="grow"><div>${ex.en}</div><div>${hi(ex.hi)}</div></div>${speakButton(ex.en)}</div>`)}</div>
    ${w.common_mistake ? html`<div class="section-label">Common mistake</div><div class="card compact red"><div><span style="color:var(--red);text-decoration:line-through">${w.common_mistake.wrong}</span></div><div style="color:var(--green);font-weight:600">${w.common_mistake.right}</div><div class="small muted mt">${w.common_mistake.why}</div></div>` : ''}
    <div class="grid-2">
      ${w.collocations && w.collocations.length ? html`<div><div class="section-label">Collocations</div><div class="chips">${w.collocations.map((c) => html`<span class="chip">${c}</span>`)}</div></div>` : ''}
      ${w.word_family && w.word_family.length > 1 ? html`<div><div class="section-label">Word family</div><div class="chips">${w.word_family.map((c) => html`<span class="chip">${c}</span>`)}</div></div>` : ''}
      ${w.synonyms && w.synonyms.length ? html`<div><div class="section-label">Synonyms</div><div class="chips">${w.synonyms.map((c) => html`<span class="chip">${c}</span>`)}</div></div>` : ''}
      ${w.antonyms && w.antonyms.length ? html`<div><div class="section-label">Antonyms</div><div class="chips">${w.antonyms.map((c) => html`<span class="chip">${c}</span>`)}</div></div>` : ''}
    </div>
    ${notes.length ? html`<div class="section-label">Your notes</div><div class="list">${notes.map((n) => html`<a class="list-item" href="#/notes/${n.id}"><div class="grow"><div class="title">${n.title || 'Note'}</div><div class="sub">${(n.body || '').slice(0, 80)}</div></div></a>`)}</div>` : ''}
  `);
  const add = $('#add-card', container);
  if (add) add.onclick = async () => { await store.ensureVocabCards([id]); toast('Added to reviews', 'ok'); renderWord(container, id); };
  $('#add-note', container).onclick = () => { location.hash = `#/notes/new?attach=${encodeURIComponent(id)}&title=${encodeURIComponent(w.word)}`; };
  setContext({ title: w.word, text: `The word "${w.word}" (${w.pos}, ${w.cefr}): ${w.en_def}. Hindi: ${w.hi_def}. Example: ${w.examples?.[0]?.en || ''}` });
}
