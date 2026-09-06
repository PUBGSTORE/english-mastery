// grammar.js — lesson list (CEFR-gated) and lesson page: concept → Hindi → pattern → examples → contrast → practice → production.
import { html, mount, icon, toast, speakButton, backLink, progressBar, $ } from '../ui.js';
import { hi, hiBlock } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as ai from '../ai.js';
import { mountExercise } from '../exercise.js';
import { setContext } from '../router.js';
import { CEFR, wordDiffHtml } from '../utils.js';

export async function render(container, params) {
  if (params.id) return renderLesson(container, params.id);
  return renderList(container);
}

async function renderList(container) {
  const lessons = await content.grammarSorted();
  const s = await store.settings();
  const done = (await store.getSetting('grammarDone')) || {};
  const scores = (await store.getSetting('grammarScores')) || {};
  const byLevel = {};
  for (const l of lessons) (byLevel[l.cefr] ||= []).push(l);
  const doneCount = lessons.filter((l) => done[l.id]).length;
  mount(container, html`
    <div class="page-head"><div><h1>Grammar</h1><p class="sub">${lessons.length} lessons · ${doneCount} completed · your level ${s.level}</p></div></div>
    ${progressBar((doneCount / lessons.length) * 100, 'green')}
    <p class="small muted mt">Lessons at your level and one above are unlocked. Priority lessons fix the mistakes Hindi speakers make most.</p>
    ${CEFR.map((lvl) => byLevel[lvl] ? html`<h3 class="mt-lg">${lvl}</h3><div class="list">${byLevel[lvl].map((l) => {
      const unlocked = store.isUnlocked(l.cefr, s.level);
      return html`<a class="list-item ${unlocked ? '' : 'locked'}" href="#/grammar/${l.id}"><span class="badge muted">${l.order}</span><div class="grow"><div class="title">${l.title}${(l.tags || []).includes('hindi-l1-priority') ? html` <span class="chip amber" style="min-height:22px;padding:0 8px">priority</span>` : ''}</div><div class="sub">${scores[l.id] !== undefined ? `Practice: ${scores[l.id]}/10` : l.pattern.slice(0, 60)}</div></div>${done[l.id] ? icon('check') : unlocked ? icon('next', 'arrow') : icon('lock', 'arrow')}</a>`;
    })}</div>` : '')}`);
}

async function renderLesson(container, id) {
  const lessons = await content.grammarSorted();
  const l = lessons.find((x) => x.id === id);
  if (!l) { mount(container, html`${backLink('#/grammar')}<div class="empty">Lesson not found.</div>`); return; }
  const idx = lessons.indexOf(l);
  const next = lessons[idx + 1];
  const done = (await store.getSetting('grammarDone')) || {};
  const s = await store.settings();
  const unlocked = store.isUnlocked(l.cefr, s.level);
  mount(container, html`
    ${backLink('#/grammar', 'Grammar')}
    <div class="page-head"><div><span class="chip">${l.cefr} · lesson ${l.order}</span><h1 style="margin-top:8px">${l.title}</h1></div></div>
    ${!unlocked ? html`<div class="card amber compact small">${icon('lock')} This lesson is above your current level (${s.level}). You can still study it, but consider finishing earlier lessons first.</div>` : ''}
    <div class="tabs" id="tabs"><button class="active" data-t="learn">Learn</button><button data-t="practice">Practice (10)</button><button data-t="produce">Produce</button></div>
    <div id="pane"></div>`);
  const panes = { learn: () => paneLearn(container, l), practice: () => panePractice(container, l), produce: () => paneProduce(container, l, next) };
  const tabs = $('#tabs', container);
  tabs.querySelectorAll('button').forEach((b) => b.onclick = () => { tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); panes[b.dataset.t](); window.scrollTo({ top: tabs.offsetTop - 8, behavior: 'smooth' }); });
  panes.learn();
  setContext({ title: `Grammar: ${l.title}`, text: `${l.concept_en} Pattern: ${l.pattern}. Common error: "${l.contrast[0]?.wrong}" → "${l.contrast[0]?.right}".` });
  if (done[l.id]) $('#pane', container).insertAdjacentHTML('afterbegin', `<div class="chip green mb">${icon('check')} completed</div>`);
}

function paneLearn(container, l) {
  mount($('#pane', container), html`
    <div class="lesson-section"><h3>Concept</h3><p style="font-size:var(--fs-lg)">${l.concept_en}</p>${hiBlock(l.concept_hi)}</div>
    <div class="lesson-section"><h3>The pattern</h3><div class="pattern">${l.pattern}</div></div>
    <div class="lesson-section"><h3>Examples</h3><div class="example-list">${l.examples.map((ex) => html`<div class="ex"><div class="grow"><div>${ex.en}</div><div>${hi(ex.hi)}</div>${ex.note ? html`<div class="xs muted">${ex.note}</div>` : ''}</div>${speakButton(ex.en)}</div>`)}</div></div>
    <div class="lesson-section"><h3>${icon('alert')} What Hindi speakers get wrong here</h3><div class="contrast">${l.contrast.map((c) => html`<div class="card compact red" style="margin:0"><div><span class="wrong">${c.wrong}</span></div><div class="right">${c.right}</div><div class="small mt">${c.why_en}</div><div class="small">${hi(c.why_hi)}</div></div>`)}</div></div>
    <div class="btn-row"><button class="btn btn-primary btn-lg" id="go-practice">Practice ${icon('next')}</button></div>`);
  $('#go-practice', container).onclick = () => $('#tabs button[data-t="practice"]', container).click();
}

async function panePractice(container, l) {
  const pane = $('#pane', container);
  let i = 0, correct = 0; const results = [];
  const draw = async () => {
    if (i >= l.practice.length) return summary();
    const item = l.practice[i];
    mount(pane, html`<div class="row between mb"><span class="muted small">Question ${i + 1} of ${l.practice.length}</span><span class="chip">${item.type}</span></div>
      ${progressBar((i / l.practice.length) * 100)}
      <div class="card mt" id="ex"></div>
      <div class="btn-row right" id="nav" hidden><button class="btn btn-primary" id="next">${i === l.practice.length - 1 ? 'See results' : 'Next'} ${icon('next')}</button></div>`);
    const r = await mountExercise($('#ex', pane), item);
    results.push({ item, ...r });
    if (r.status !== 'wrong') correct++;
    if (r.status === 'wrong') {
      await store.logMistake({ source: 'grammar', refId: item.id, lessonId: l.id, original: r.typed || '(no answer)', fix: r.answer, rule: l.title, why_en: item.feedback_en, why_hi: item.feedback_hi, makeCard: false });
      await store.ensureCard({ id: `card:${item.id}`, refId: item.id, deck: 'grammar', kind: 'grammar', payload: { item, lessonId: l.id }, priority: 1 });
    }
    $('#nav', pane).hidden = false;
    const nb = $('#next', pane); nb.onclick = () => { i++; draw(); }; nb.focus();
  };
  const summary = async () => {
    const scores = (await store.getSetting('grammarScores')) || {}; scores[l.id] = correct; await store.setSetting('grammarScores', scores);
    if (correct >= 7) { const done = (await store.getSetting('grammarDone')) || {}; if (!done[l.id]) { done[l.id] = new Date().toISOString(); await store.setSetting('grammarDone', done); await store.bumpDay({ attempts: 1, skill: 'grammar' }); } }
    const wrong = results.filter((r) => r.status === 'wrong');
    mount(pane, html`<div class="card ${correct >= 7 ? 'green' : 'amber'} center"><div class="big" style="font-size:var(--fs-3xl);font-weight:800">${correct}/${l.practice.length}</div><p>${correct >= 7 ? 'Lesson completed. Wrong answers were added to your review queue.' : 'Below 7 — study the contrast box again and retry.'}</p>
      <div class="btn-row center"><button class="btn" id="retry">Retry</button><button class="btn btn-primary" id="produce">Free production ${icon('next')}</button></div></div>
      ${wrong.length ? html`<h3>Review these</h3><div class="contrast">${wrong.map((r) => html`<div class="card compact" style="margin:0"><div class="small muted">${r.item.prompt}</div><div><span style="color:var(--red)">${r.typed || '—'}</span> → <span style="color:var(--green);font-weight:600">${r.answer}</span></div><div class="small mt">${r.item.feedback_en}</div></div>`)}</div>` : ''}`);
    $('#retry', pane).onclick = () => { i = 0; correct = 0; results.length = 0; draw(); };
    $('#produce', pane).onclick = () => $('#tabs button[data-t="produce"]', container).click();
  };
  draw();
}

async function paneProduce(container, l, next) {
  const pane = $('#pane', container);
  const key = await ai.hasKey();
  mount(pane, html`<div class="card"><h3>Free production</h3><p style="font-size:var(--fs-lg)">${l.production.task_en}</p>${hiBlock(l.production.task_hi)}
    <textarea class="textarea" id="prod" rows="5" placeholder="Write 3 sentences here…" autocapitalize="sentences"></textarea>
    <div class="btn-row mt"><button class="btn btn-primary" id="grade">${key ? html`${icon('sparkle')} Grade with AI` : 'Save (add API key in Settings for grading)'}</button>${next ? html`<a class="btn" href="#/grammar/${next.id}">Next lesson ${icon('next')}</a>` : ''}</div>
    <div id="result" class="mt"></div></div>`);
  $('#grade', pane).onclick = async (e) => {
    const text = $('#prod', pane).value.trim(); if (!text) return;
    const b = e.currentTarget;
    if (!key) { const notes = await store.saveNote({ title: `Practice: ${l.title}`, body: text, tags: ['grammar', l.cefr.toLowerCase()], attachedTo: l.id }); toast('Saved as a note', 'ok'); return; }
    b.disabled = true; b.innerHTML = '<span class="spinner"></span> Grading…';
    try {
      const r = await ai.gradeProduction(l.title, l.pattern, text, await store.level());
      let added = 0;
      for (const it of r.items || []) {
        if (!it.ok && it.corrected && it.original) { await store.logMistake({ source: 'grammar', lessonId: l.id, original: it.original, fix: it.corrected, rule: it.rule || l.title, why_en: it.why_en, why_hi: it.why_hi }); added++; }
      }
      await store.logAttempt({ kind: 'writing', refId: l.id, accuracy: Math.round((r.overall || 0) * 10), extra: { mode: 'production' } });
      mount($('#result', pane), html`<div class="feedback ${r.overall >= 7 ? 'ok' : 'close'}"><div class="bold">Score ${r.overall}/10</div><div class="small mt">${r.summary_en}</div><div class="small">${hi(r.summary_hi)}</div></div>
        ${(r.items || []).map((it) => html`<div class="card compact mt" style="margin-bottom:6px"><div class="diff">${{ toString: () => wordDiffHtml(it.original || '', it.corrected || it.original || '') }}</div>${it.ok ? html`<div class="xs" style="color:var(--green)">${icon('check')} correct</div>` : html`<div class="small mt">${it.why_en}</div><div class="small">${hi(it.why_hi)}</div>`}</div>`)}
        ${added ? html`<p class="small muted mt">${added} correction${added > 1 ? 's' : ''} added to your mistakes notebook and review queue.</p>` : ''}`);
      b.innerHTML = 'Graded';
    } catch (err) { toast(err.message === 'NO_KEY' ? 'Add your DeepSeek key in Settings.' : err.message, 'err', { timeout: 6000 }); b.disabled = false; b.textContent = 'Grade with AI'; }
  };
}
