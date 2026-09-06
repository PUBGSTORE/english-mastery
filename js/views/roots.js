// roots.js — word roots with a decode drill (§5) and confusables quiz.
import { html, mount, icon, toast, speakButton, backLink, progressBar, $ } from '../ui.js';
import { hi, hiBlock } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import { setContext, current } from '../router.js';
import { shuffle, fuzzyMatch } from '../utils.js';

export async function render(container, params) {
  if (current().startsWith('/confusables')) return renderConfusables(container, params);
  if (params.id === 'decode') return renderDecode(container);
  if (params.id) return renderRoot(container, decodeURIComponent(params.id));
  return renderList(container);
}

async function renderList(container) {
  const roots = await content.load('morphology');
  const cards = new Set((await store.allCards()).filter((c) => c.kind === 'root').map((c) => c.refId));
  const groups = { root: [], prefix: [], suffix: [] };
  for (const r of roots) (groups[r.type] || groups.root).push(r);
  mount(container, html`
    <div class="page-head"><div><h1>Word roots</h1><p class="sub">120 Latin and Greek parts. Learn 100 and you can guess 1,000 words instead of looking them up.</p></div>
      <div class="btn-row"><a class="btn btn-primary" href="#/roots/decode">${icon('zap')} Decode drill</a><a class="btn" href="#/confusables">Confusables</a>${cards.size ? html`<a class="btn" href="#/review?kind=root">Review (${cards.size})</a>` : ''}</div></div>
    ${Object.entries(groups).map(([t, list]) => html`<h3 class="mt-lg" style="text-transform:capitalize">${t}es (${list.length})</h3><div class="grid-3">${list.map((r) => html`<a class="card compact" href="#/roots/${encodeURIComponent(r.id)}" style="margin:0"><div class="row between"><strong style="font-size:var(--fs-lg)">${r.part}</strong>${cards.has(r.id) ? icon('check') : ''}</div><div class="xs muted">${r.meaning_en}</div><div class="xs">${hi(r.meaning_hi, { block: false })}</div></a>`)}</div>`)}`);
  setContext({ title: 'Word roots', text: 'Latin and Greek roots, prefixes and suffixes.' });
}

async function renderRoot(container, id) {
  const roots = await content.load('morphology');
  const r = roots.find((x) => x.id === id);
  if (!r) { mount(container, html`${backLink('#/roots')}<div class="empty">Not found</div>`); return; }
  const idx = roots.indexOf(r);
  const card = await store.getCard(`card:${r.id}`);
  mount(container, html`
    ${backLink('#/roots', 'Roots')}
    <div class="card center"><div class="xs muted" style="text-transform:uppercase;letter-spacing:.08em">${r.type} · ${r.origin}</div><div style="font-size:var(--fs-3xl);font-weight:800">${r.part}</div><div style="font-size:var(--fs-lg)">${r.meaning_en}</div><div class="hi-text" lang="hi">${r.meaning_hi}</div>
      <p class="small mt">${r.note_en}</p>${hiBlock(r.note_hi)}</div>
    <div class="card"><h3>Words built on it</h3><div class="list">${r.derived.map((d) => html`<div class="list-item"><div class="grow"><div class="title">${d.word}</div><div class="sub">${d.def_en}</div><div class="sub">${hi(d.def_hi)}</div></div>${speakButton(d.word)}</div>`)}</div></div>
    <div class="card"><h3>Decode these</h3>${r.decode.map((d, k) => html`<details class="mt"><summary style="cursor:pointer;font-size:var(--fs-lg);font-weight:600">${d.word}</summary><div class="chips mt">${d.parts.map((p) => html`<span class="chip">${p}</span>`)}</div><div class="small mt">${d.meaning}</div></details>`)}</div>
    <div class="btn-row between">${idx > 0 ? html`<a class="btn" href="#/roots/${encodeURIComponent(roots[idx - 1].id)}">${icon('back')} ${roots[idx - 1].part}</a>` : '<span></span>'}${card ? html`<span class="chip green">${icon('check')} in reviews</span>` : html`<button class="btn btn-primary" id="add">${icon('plus')} Add to reviews</button>`}${idx < roots.length - 1 ? html`<a class="btn" href="#/roots/${encodeURIComponent(roots[idx + 1].id)}">${roots[idx + 1].part} ${icon('next')}</a>` : '<span></span>'}</div>`);
  const add = $('#add', container); if (add) add.onclick = async () => { await store.ensureCard({ id: `card:${r.id}`, refId: r.id, deck: 'roots', kind: 'root', payload: { part: r.part, type: r.type, meaning_en: r.meaning_en, meaning_hi: r.meaning_hi, derived: r.derived.slice(0, 4).map((d) => d.word) } }); toast('Added', 'ok'); renderRoot(container, id); };
  setContext({ title: `Root: ${r.part}`, text: `${r.part} means "${r.meaning_en}". Derived: ${r.derived.map((d) => d.word).join(', ')}.` });
}

async function renderDecode(container) {
  const roots = await content.load('morphology');
  const pool = shuffle(roots.flatMap((r) => r.decode.map((d) => ({ ...d, root: r }))));
  let i = 0; let score = 0; let total = 0;
  const draw = () => {
    const d = pool[i % pool.length];
    mount(container, html`
      ${backLink('#/roots', 'Roots')}
      <div class="page-head"><div><h1>Decode</h1><p class="sub">Break the word into parts and guess the meaning before you reveal. ${total ? `${score}/${total}` : ''}</p></div></div>
      <div class="card center"><div style="font-size:var(--fs-3xl);font-weight:800">${d.word} ${speakButton(d.word)}</div>
        <p class="small muted">What does it mean? Say your guess aloud, then reveal.</p>
        <div id="ans" hidden><div class="chips mt" style="justify-content:center">${d.parts.map((p) => html`<span class="chip">${p}</span>`)}</div><div class="mt" style="font-size:var(--fs-lg)">${d.meaning}</div><div class="xs muted mt">Root <a href="#/roots/${encodeURIComponent(d.root.id)}">${d.root.part}</a> = ${d.root.meaning_en} · ${hi(d.root.meaning_hi, { block: false })}</div>
          <div class="btn-row center mt"><button class="btn" id="wrong">${icon('x')} Missed it</button><button class="btn btn-primary" id="right">${icon('check')} Got it</button></div></div>
        <div class="btn-row center mt" id="rev"><button class="btn btn-primary btn-lg" id="reveal">Reveal</button></div></div>`);
    $('#reveal', container).onclick = () => { $('#ans', container).hidden = false; $('#rev', container).hidden = true; };
    const done = async (ok) => { total++; if (ok) score++; await store.logAttempt({ kind: 'decode', refId: d.root.id, accuracy: ok ? 100 : 0, extra: { word: d.word } }); if (!ok) await store.ensureCard({ id: `card:${d.root.id}`, refId: d.root.id, deck: 'roots', kind: 'root', payload: { part: d.root.part, type: d.root.type, meaning_en: d.root.meaning_en, meaning_hi: d.root.meaning_hi, derived: d.root.derived.slice(0, 4).map((x) => x.word) }, priority: 1 }); i++; draw(); };
    $('#right', container).onclick = () => done(true); $('#wrong', container).onclick = () => done(false);
    setContext({ title: 'Decode drill', text: `Decoding "${d.word}" from its parts.` });
  };
  draw();
}

async function renderConfusables(container, params) {
  const list = await content.load('confusables');
  const cards = new Set((await store.allCards()).filter((c) => c.kind === 'confusable').map((c) => c.refId));
  if (params.id === 'quiz') return renderConfQuiz(container, list);
  mount(container, html`
    <div class="page-head"><div><h1>Confusables</h1><p class="sub">${list.length} pairs Indian learners mix up. Read the rule, then quiz.</p></div><div class="btn-row"><a class="btn btn-primary" href="#/confusables/quiz">${icon('zap')} Quiz</a><a class="btn" href="#/roots">Roots</a></div></div>
    <div class="search mb">${icon('search')}<input class="input" type="search" id="q" placeholder="affect, since, lay…"></div>
    <div id="list"></div>`);
  const draw = (q = '') => {
    const l = list.filter((c) => !q || `${c.a} ${c.b} ${c.c || ''}`.toLowerCase().includes(q));
    mount($('#list', container), html`${l.map((c) => html`<details class="card compact"><summary style="cursor:pointer;font-weight:700;font-size:var(--fs-lg)">${c.a} / ${c.b}${c.c ? ' / ' + c.c : ''} ${cards.has(c.id) ? icon('check') : ''}</summary>
      <p class="mt">${c.rule_en}</p>${hiBlock(c.rule_hi)}<div class="feedback close small">${c.trap_en}</div>
      <div class="example-list mt">${c.examples.map((ex) => html`<div class="ex"><div class="grow"><div>${ex.en} <span class="chip" style="min-height:20px;padding:0 6px">${ex.uses}</span></div><div>${hi(ex.hi)}</div></div>${speakButton(ex.en)}</div>`)}</div>
      ${cards.has(c.id) ? '' : html`<div class="btn-row mt"><button class="btn btn-sm" data-add="${c.id}">${icon('plus')} Add to reviews</button></div>`}</details>`)}`);
    container.querySelectorAll('[data-add]').forEach((b) => b.onclick = async () => { const c = list.find((x) => x.id === b.dataset.add); await addConf(c); cards.add(c.id); toast('Added', 'ok'); draw(q); });
  };
  $('#q', container).oninput = (e) => draw(e.target.value.toLowerCase().trim());
  draw();
  setContext({ title: 'Confusables', text: 'Commonly confused word pairs.' });
}
const addConf = (c) => store.ensureCard({ id: `card:${c.id}`, refId: c.id, deck: 'confusables', kind: 'confusable', payload: { a: c.a, b: c.b, c: c.c || null, quiz: c.quiz, rule_en: c.rule_en, rule_hi: c.rule_hi } });

async function renderConfQuiz(container, list) {
  const pool = shuffle(list.flatMap((c) => c.quiz.map((q) => ({ ...q, c }))));
  let i = 0; let score = 0; let total = 0;
  const draw = () => {
    const q = pool[i % pool.length]; const c = q.c;
    const opts = shuffle([c.a, c.b, ...(c.c ? [c.c] : [])]);
    mount(container, html`
      ${backLink('#/confusables', 'Confusables')}
      <div class="page-head"><div><h1>Confusables quiz</h1><p class="sub">${total ? `${score}/${total}` : 'Pick the right word'}</p></div></div>
      <div class="card"><div class="placement-q">${{ toString: () => String(html`${q.sentence}`).replace(/_{3,}/g, '<span style="display:inline-block;min-width:70px;border-bottom:2px solid var(--accent)">&nbsp;</span>') }}</div>
        <div class="option-list">${opts.map((o) => html`<button class="btn" data-o="${o}">${o}</button>`)}</div><div id="fb" class="mt"></div></div>`);
    container.querySelectorAll('[data-o]').forEach((b) => b.onclick = async () => {
      const ok = b.dataset.o.toLowerCase() === q.answer.toLowerCase(); total++; if (ok) score++;
      container.querySelectorAll('[data-o]').forEach((x) => { x.disabled = true; if (x.dataset.o.toLowerCase() === q.answer.toLowerCase()) x.classList.add('right'); });
      if (!ok) b.classList.add('wrong');
      mount($('#fb', container), html`<div class="feedback ${ok ? 'ok' : 'bad'}"><div class="small">${c.rule_en}</div><div class="small">${hi(c.rule_hi)}</div><div class="btn-row right mt"><button class="btn btn-primary" id="nx">Next ${icon('next')}</button></div></div>`);
      await store.logAttempt({ kind: 'confusable', refId: c.id, accuracy: ok ? 100 : 0 });
      if (!ok) { await store.logMistake({ source: 'grammar', refId: c.id, original: q.sentence.replace(/_{3,}/, b.dataset.o), fix: q.sentence.replace(/_{3,}/, q.answer), rule: `${c.a} vs ${c.b}`, why_en: c.rule_en, why_hi: c.rule_hi, makeCard: false }); await addConf(c); }
      $('#nx', container).onclick = () => { i++; draw(); }; $('#nx', container).focus();
    });
    setContext({ title: 'Confusables quiz', text: `${c.a} vs ${c.b}: ${c.rule_en}` });
  };
  draw();
}
