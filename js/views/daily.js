// daily.js — Daily 5 words: learn flow + history with retention.
import { html, mount, icon, toast, speakButton, backLink, $ } from '../ui.js';
import { hi } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import { current, setContext } from '../router.js';
import { todayKey, fmtDate } from '../utils.js';

export async function render(container) {
  if (current().endsWith('/history')) return renderHistory(container);
  const rec = await store.daily5();
  const words = (await Promise.all(rec.wordIds.map((id) => content.wordById(id)))).filter(Boolean);
  let i = 0;
  const draw = () => {
    if (i >= words.length) return finish();
    const w = words[i];
    mount(container, html`
      ${backLink('#/', 'Home')}
      <div class="page-head"><div><h1>Daily 5</h1><p class="sub">${fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })} · word ${i + 1} of ${words.length}</p></div><a class="btn btn-ghost btn-sm" href="#/daily/history">History</a></div>
      <div class="progress mb"><span style="width:${(i / words.length) * 100}%"></span></div>
      <div class="card">
        <div class="word-head"><span class="word">${w.word}</span><span class="ipa">${w.ipa}</span>${speakButton(w.word)}<span class="pos">${w.pos}</span><span class="chip">${w.cefr}</span></div>
        <p style="font-size:var(--fs-lg);margin-top:8px">${w.en_def}</p>
        <div class="hi-text" lang="hi" style="font-size:var(--fs-lg)">${w.hi_def}</div>
        ${w.hi_nuance ? html`<div class="feedback close small mt"><strong>Note:</strong> ${w.hi_nuance}</div>` : ''}
        <div class="section-label">Examples</div>
        <div class="example-list">${(w.examples || []).slice(0, 4).map((ex) => html`<div class="ex"><div class="grow"><div>${ex.en}</div><div>${hi(ex.hi)}</div></div>${speakButton(ex.en)}</div>`)}</div>
        ${w.collocations && w.collocations.length ? html`<div class="section-label">Goes with</div><div class="chips">${w.collocations.slice(0, 5).map((c) => html`<span class="chip">${c}</span>`)}</div>` : ''}
        ${w.common_mistake ? html`<div class="section-label">Don't say</div><div><span style="color:var(--red);text-decoration:line-through">${w.common_mistake.wrong}</span> → <span style="color:var(--green);font-weight:600">${w.common_mistake.right}</span><div class="small muted">${w.common_mistake.why}</div></div>` : ''}
        <div class="section-label">Say it three times</div>
        <p class="small muted">Tap the speaker, repeat aloud, copy the stress. Then write one sentence of your own in your head.</p>
        <div class="btn-row mt"><button class="btn btn-primary btn-lg" id="next">${i === words.length - 1 ? 'Finish' : 'Next word'} ${icon('next')}</button><a class="btn" href="#/word/${w.id}">Full entry</a></div>
      </div>`);
    $('#next', container).onclick = () => { i++; draw(); };
    setContext({ title: `Daily 5: ${w.word}`, text: `Today's word "${w.word}" (${w.pos}): ${w.en_def}. Hindi: ${w.hi_def}.` });
  };
  const finish = async () => {
    if (!rec.completed) { await store.completeDaily(); toast('Daily 5 complete. These words are now in your reviews.', 'ok'); }
    mount(container, html`<div class="hero center"><h1>Daily 5 done</h1><p>These five words are now SRS cards. They will come back for active recall tomorrow, then in 3 days, then in a week.</p>
      <div class="chips" style="justify-content:center">${words.map((w) => html`<a class="chip green" href="#/word/${w.id}">${w.word}</a>`)}</div>
      <div class="btn-row center mt-lg"><a class="btn btn-primary btn-lg" href="#/review">Review now</a><a class="btn btn-lg" href="#/">Home</a></div></div>`);
  };
  if (rec.completed) {
    mount(container, html`${backLink('#/', 'Home')}<div class="page-head"><div><h1>Daily 5</h1><p class="sub">Completed today. Come back tomorrow for a new set.</p></div><a class="btn btn-ghost btn-sm" href="#/daily/history">History</a></div>
      <div class="list">${words.map((w) => html`<a class="list-item" href="#/word/${w.id}"><div class="grow"><div class="title">${w.word} <span class="ipa xs">${w.ipa}</span></div><div class="sub">${w.en_def}</div></div>${icon('check')}</a>`)}</div>
      <div class="btn-row mt"><button class="btn" id="again">Go through them again</button></div>`);
    $('#again', container).onclick = () => { i = 0; draw(); };
    return;
  }
  draw();
}

async function renderHistory(container) {
  const hist = await store.dailyHistory();
  const rows = [];
  for (const h of hist) {
    const words = await Promise.all(h.wordIds.map(async (id) => { const w = await content.wordById(id); const r = await store.wordRetention(id); return { id, word: w ? w.word : id, retention: r }; }));
    rows.push({ ...h, words });
  }
  const completed = hist.filter((h) => h.completed).length;
  mount(container, html`
    ${backLink('#/daily', 'Daily 5')}
    <div class="page-head"><div><h1>Daily 5 history</h1><p class="sub">${hist.length} days · ${completed} completed · ${hist.length * 5} words introduced</p></div></div>
    ${rows.length ? rows.map((h) => html`<div class="card compact"><div class="row between"><strong>${h.day === todayKey() ? 'Today' : fmtDate(h.day, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>${h.completed ? html`<span class="chip green">${icon('check')} done</span>` : html`<span class="chip">missed</span>`}</div>
      <div class="chips mt">${h.words.map((w) => html`<a class="chip ${w.retention === null ? '' : w.retention >= 80 ? 'green' : w.retention >= 50 ? 'amber' : 'red'}" href="#/word/${w.id}">${w.word}${w.retention !== null ? ` ${w.retention}%` : ''}</a>`)}</div></div>`) : html`<div class="empty">No history yet. Your first set is waiting on the Daily 5 page.</div>`}`);
}
