// generate.js (view) — §3 infinite practice from my own weaknesses.
import { html, mount, icon, toast, confirmDialog, backLink, speakButton, progressBar, $ } from '../ui.js';
import { hi, hiBlock } from '../i18n.js';
import * as db from '../db.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as ai from '../ai.js';
import * as gen from '../generate.js';
import { mountExercise } from '../exercise.js';
import { setContext } from '../router.js';
import { fmtDate } from '../utils.js';

export async function render(container, params) {
  if (params.id) return runItem(container, params.id);
  const key = await ai.hasKey();
  const weak = await gen.weakestWords(8);
  const mistakes = await gen.recentMistakes(7, 25);
  const lessons = await content.grammarSorted();
  const brokenLessonIds = [...new Set(mistakes.map((m) => m.lessonId).filter(Boolean))];
  const items = await gen.list();
  const inr = await db.getSetting('inrRate', 84);
  const est = async (k) => `≈ ₹${(await gen.estimate(k)).inr.toFixed(2)}`;
  mount(container, html`
    <div class="page-head"><div><h1>Generate</h1><p class="sub">New material built from your weakest cards, this week's mistakes and your level. Everything is validated, saved, and works offline afterwards.</p></div></div>
    ${!key ? html`<div class="card amber compact small">This module needs a DeepSeek key (Settings). Nothing else here changes without one.</div>` : ''}
    <div class="grid-2">
      <div class="card"><h3>Reading passage</h3><p class="small muted">120–200 words that naturally reuse your 8 weakest words, then opens in Reader.</p><div class="chips mb">${weak.map((w) => html`<span class="chip">${w.word.word}</span>`)}</div>${weak.length < 4 ? html`<p class="xs muted">Review a few days first so the app knows your weak words.</p>` : html`<button class="btn btn-primary" id="g-passage" ${key ? '' : 'disabled'}>${icon('sparkle')} Write passage <span class="xs muted" id="e-passage"></span></button>`}</div>
      <div class="card"><h3>Cloze × 10 for a word</h3><p class="small muted">Fresh sentences for a word you keep failing; they feed that word's cloze face.</p><select class="select mb" id="cloze-word">${weak.map((w) => html`<option value="${w.word.id}">${w.word.word} (ease ${w.card.ease}, ${w.card.lapses} lapses)</option>`)}</select><button class="btn btn-primary" id="g-cloze" ${key && weak.length ? '' : 'disabled'}>${icon('sparkle')} Generate <span class="xs muted" id="e-cloze"></span></button></div>
      <div class="card"><h3>Dialogue on a grammar point</h3><p class="small muted">A two-person dialogue that uses the rule you keep breaking, with Hindi.</p><select class="select mb" id="dlg-lesson">${[...brokenLessonIds.map((id) => lessons.find((l) => l.id === id)).filter(Boolean), ...lessons.filter((l) => !brokenLessonIds.includes(l.id))].map((l) => html`<option value="${l.id}">${brokenLessonIds.includes(l.id) ? '⚠ ' : ''}${l.title}</option>`)}</select><button class="btn btn-primary" id="g-dialogue" ${key ? '' : 'disabled'}>${icon('sparkle')} Write dialogue <span class="xs muted" id="e-dialogue"></span></button></div>
      <div class="card"><h3>10 new practice items</h3><p class="small muted">Extra exercises for any lesson, in the same format as the built-in ones.</p><select class="select mb" id="pr-lesson">${lessons.map((l) => html`<option value="${l.id}">${l.title}</option>`)}</select><button class="btn btn-primary" id="g-practice" ${key ? '' : 'disabled'}>${icon('sparkle')} Generate <span class="xs muted" id="e-practice"></span></button></div>
      <div class="card"><h3>Weekly quiz</h3><p class="small muted">10 items over everything you got wrong this week (${mistakes.length} mistakes logged).</p><button class="btn btn-primary" id="g-quiz" ${key && mistakes.length >= 3 ? '' : 'disabled'}>${icon('sparkle')} Build quiz <span class="xs muted" id="e-quiz"></span></button></div>
    </div>
    ${items.length ? html`<h3 class="mt-lg">Generated material</h3><div class="list">${items.map((g) => html`<a class="list-item" href="${g.kind === 'passage' ? `#/read/${encodeURIComponent('text:gen:' + g.id)}` : `#/generate/${g.id}`}">${icon(g.kind === 'passage' ? 'book' : g.kind === 'dialogue' ? 'message' : 'zap')}<div class="grow"><div class="title">${g.title}</div><div class="sub">${g.kind} · ${fmtDate(g.ts)}${g.data.score !== undefined ? ` · last score ${g.data.score}` : ''}</div></div>${icon('next', 'arrow')}</a>`)}</div>` : ''}`);
  for (const k of ['passage', 'cloze', 'dialogue', 'practice', 'quiz']) { const el = $('#e-' + k, container); if (el) el.textContent = await est(k); }
  const run = async (btnId, fn, after) => {
    const b = $(btnId, container); if (!b) return; b.disabled = true; const orig = b.innerHTML; b.innerHTML = '<span class="spinner"></span> Working…';
    try { const rec = await fn(); toast('Saved', 'ok'); after ? after(rec) : render(container); }
    catch (e) { toast(e.message === 'CAP_REACHED' ? 'Monthly AI cap reached (Settings).' : e.message === 'NO_KEY' ? 'Add your DeepSeek key.' : e.message, 'err', { timeout: 7000 }); b.disabled = false; b.innerHTML = orig; }
  };
  $('#g-passage', container) && ($('#g-passage', container).onclick = () => run('#g-passage', () => gen.passage(weak.map((w) => w.word)), (rec) => { location.hash = `#/read/${encodeURIComponent('text:gen:' + rec.id)}`; }));
  $('#g-cloze', container).onclick = () => run('#g-cloze', async () => gen.clozeSet(await content.wordById($('#cloze-word', container).value)));
  $('#g-dialogue', container).onclick = () => run('#g-dialogue', async () => { const l = lessons.find((x) => x.id === $('#dlg-lesson', container).value); return gen.dialogue(l, mistakes.filter((m) => m.lessonId === l.id)); }, (rec) => { location.hash = `#/generate/${rec.id}`; });
  $('#g-practice', container).onclick = () => run('#g-practice', async () => gen.practiceItems(lessons.find((x) => x.id === $('#pr-lesson', container).value)), (rec) => { location.hash = `#/generate/${rec.id}`; });
  $('#g-quiz', container).onclick = () => run('#g-quiz', () => gen.weeklyQuiz(), (rec) => { location.hash = `#/generate/${rec.id}`; });
  setContext({ title: 'Generate practice', text: `Weak words: ${weak.map((w) => w.word.word).join(', ')}.` });
}

async function runItem(container, id) {
  const g = await db.get('generated', id);
  if (!g) { mount(container, html`${backLink('#/generate')}<div class="empty">Not found</div>`); return; }
  if (g.kind === 'dialogue') {
    mount(container, html`${backLink('#/generate', 'Generate')}<div class="page-head"><div><h1 style="font-size:var(--fs-xl)">${g.title}</h1><p class="sub">${g.data.lesson}</p></div><div class="btn-row"><button class="btn" id="play-all">${icon('speaker')} Play all</button><button class="btn btn-ghost" id="del">${icon('trash')}</button></div></div>
      <div class="card">${g.data.lines.map((l) => html`<div class="row mb" style="align-items:flex-start"><span class="chip" style="min-width:34px">${l.speaker}</span><div class="grow"><div>${l.en}</div><div>${hi(l.hi)}</div></div>${speakButton(l.en)}</div>`)}<p class="small muted mt">${g.data.notes_en}</p></div>`);
    $('#play-all', container).onclick = async () => { const tts = await import('../tts.js'); for (const l of g.data.lines) { const ok = await tts.speak(l.en); if (!ok) break; } };
    $('#del', container).onclick = async () => { if (await confirmDialog('Delete this dialogue?', { okLabel: 'Delete', danger: true })) { await gen.remove(id); location.hash = '#/generate'; } };
    setContext({ title: g.title, text: g.data.lines.map((l) => `${l.speaker}: ${l.en}`).join('\n').slice(0, 600) });
    return;
  }
  if (g.kind === 'cloze') {
    mount(container, html`${backLink('#/generate', 'Generate')}<div class="page-head"><div><h1 style="font-size:var(--fs-xl)">${g.title}</h1><p class="sub">These sentences now appear on the word's cloze card.</p></div><button class="btn btn-ghost" id="del">${icon('trash')}</button></div>
      <div class="list">${g.data.items.map((it) => html`<div class="list-item"><div class="grow"><div>${it.sentence.replace(/_{3,}/, '[' + it.answer + ']')}</div><div class="sub">${hi(it.hi)}</div></div>${speakButton(it.sentence.replace(/_{3,}/, it.answer))}</div>`)}</div>`);
    $('#del', container).onclick = async () => { if (await confirmDialog('Delete?', { okLabel: 'Delete', danger: true })) { await gen.remove(id); location.hash = '#/generate'; } };
    return;
  }
  // practice / quiz / questions runner
  const items = g.data.items; let i = 0; let correct = 0;
  const draw = async () => {
    if (i >= items.length) {
      g.data.score = `${correct}/${items.length}`; await db.put('generated', g);
      if (g.kind === 'quiz') await db.put('tests', { id: `test:quiz:${g.id}`, kind: 'weekly-quiz', ts: new Date().toISOString(), score: correct, total: items.length, refId: g.id });
      mount(container, html`${backLink('#/generate', 'Generate')}<div class="hero center"><h1>${correct}/${items.length}</h1><p>${correct / items.length >= 0.7 ? 'Solid.' : 'Wrong answers went to your mistakes notebook and reviews.'}</p><div class="btn-row center"><button class="btn" id="again">Again</button><a class="btn btn-primary" href="#/generate">Done</a></div></div>`);
      $('#again', container).onclick = () => { i = 0; correct = 0; draw(); }; return;
    }
    const it = items[i];
    mount(container, html`${backLink('#/generate', 'Generate')}<div class="row between mb"><span class="muted small">${g.title} · ${i + 1}/${items.length}</span><span class="chip">${it.type}</span></div>${progressBar((i / items.length) * 100)}<div class="card mt" id="ex"></div><div class="btn-row right" id="nav" hidden><button class="btn btn-primary" id="next">Next ${icon('next')}</button></div>`);
    const item = it.type === 'short' ? { type: 'fill', prompt: it.q + ' ___', answer: [it.answer], feedback_en: '' } : it.type === 'choose' && it.q ? { type: 'choose', prompt: it.q, options: it.options, answer: [it.answer], feedback_en: '', hi: it.hi } : it;
    const r = await mountExercise($('#ex', container), item);
    if (r.status !== 'wrong') correct++;
    else await store.logMistake({ source: 'grammar', refId: g.refId, lessonId: g.kind === 'practice' ? g.refId : null, original: r.typed || '(no answer)', fix: r.answer, rule: it.rule || g.data.lesson || 'generated practice', why_en: it.feedback_en, why_hi: it.feedback_hi, makeCard: true });
    $('#nav', container).hidden = false; $('#next', container).onclick = () => { i++; draw(); }; $('#next', container).focus();
  };
  draw();
  setContext({ title: g.title, text: `Practising: ${g.title}` });
}
