// proof.js — §10 measurement that survives a year: weekly cumulative test, CEFR trajectory, voice diary, retention honesty.
import { html, mount, icon, toast, confirmDialog, backLink, progressBar, $ } from '../ui.js';
import { hi } from '../i18n.js';
import * as db from '../db.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as audio from '../audio.js';
import * as charts from '../charts.js';
import { mountExercise } from '../exercise.js';
import { setContext } from '../router.js';
import { shuffle, pick, fmtDate, nowISO, uid, download, sentenceMatch, fuzzyMatch, dayKey, addDays } from '../utils.js';
import { vocabFace } from '../srs.js';

const DIARY_TOPICS = ['Describe your typical work day.', 'Explain a security concept to a friend who is not technical.', 'Talk about a problem you solved recently and how.', 'What has changed in your life this year?', 'Describe your home town to a visitor.', 'What do you want your English to sound like in a year?', 'Tell the story of a mistake you learned from.', 'Give your opinion on remote work.', 'Describe a person who influenced you.', 'Explain how you plan a week.', 'What would you do with a free month?', 'Describe the best meal you have had.'];

export async function render(container, params) {
  if (params.id === 'test') return runWeeklyTest(container);
  if (params.id === 'diary') return runDiary(container);
  const tests = (await db.getAll('tests', { index: 'ts' }));
  const weekly = tests.filter((t) => t.kind === 'weekly');
  const cefr = tests.filter((t) => t.kind === 'cefr');
  const quizzes = tests.filter((t) => t.kind === 'weekly-quiz');
  const diary = (await db.getAll('diary', { index: 'ts' })).reverse();
  const s = await store.settings();
  const lastCefr = cefr[cefr.length - 1];
  const cefrDue = !lastCefr || (Date.now() - new Date(lastCefr.ts).getTime()) > 30 * 86400000;
  const lastWeekly = weekly[weekly.length - 1];
  const weeklyDue = !lastWeekly || (Date.now() - new Date(lastWeekly.ts).getTime()) > 6 * 86400000;
  const month = new Date().toISOString().slice(0, 7);
  const diaryDue = !diary.some((d) => d.month === month);
  const retention = await deckRetention();
  mount(container, html`
    <div class="page-head"><div><h1>Proof</h1><p class="sub">Measurement that survives a year. Three rituals: a weekly test, a monthly level check, a monthly voice diary.</p></div></div>
    <div class="grid-2">
      <div class="card ${weeklyDue ? 'accent' : ''}"><div class="card-title"><h3>Weekly test</h3>${weeklyDue ? html`<span class="chip amber">due</span>` : ''}</div><p class="small muted">25 items sampled across everything you have ever studied, not just this week.</p>
        ${weekly.length >= 2 ? html`${{ toString: () => charts.line([{ label: 'Weekly test', points: weekly.map((t) => ({ x: t.ts, y: Math.round((t.score / t.total) * 100) })) }], { height: 160 }) }}` : weekly.length ? html`<p class="small">Last: ${lastWeekly.score}/${lastWeekly.total} on ${fmtDate(lastWeekly.ts)}</p>` : ''}
        <a class="btn btn-primary mt" href="#/proof/test">${icon('zap')} Take the test</a></div>
      <div class="card ${cefrDue ? 'accent' : ''}"><div class="card-title"><h3>Level trajectory</h3>${cefrDue ? html`<span class="chip amber">re-check due</span>` : ''}</div><p class="small muted">The placement engine, re-run every 30 days. Current: <strong>${s.level}</strong>.</p>
        ${cefr.length ? html`${{ toString: () => charts.line([{ label: 'CEFR', points: cefr.map((t) => ({ x: t.ts, y: ['A1', 'A2', 'B1', 'B2', 'C1'].indexOf(t.level) * 25 })) }], { height: 160, yMax: 100, yLabel: '' }) }}<p class="xs muted">0 = A1 · 25 = A2 · 50 = B1 · 75 = B2 · 100 = C1</p><div class="chips">${cefr.slice(-6).map((t) => html`<span class="chip">${fmtDate(t.ts, { month: 'short', year: '2-digit' })}: ${t.level}</span>`)}</div>` : html`<p class="small">No re-assessment yet.</p>`}
        <a class="btn mt ${cefrDue ? 'btn-primary' : ''}" href="#/placement">${icon('award')} Re-assess now</a></div>
    </div>
    <div class="card ${diaryDue ? 'accent' : ''}"><div class="card-title"><h3>Voice diary</h3>${diaryDue ? html`<span class="chip amber">this month's entry due</span>` : ''}</div>
      <p class="small muted">Once a month: two unscripted minutes on a set topic. Hearing March next to September is the most motivating thing this app can do. <strong>Audio is stored only on this device and is not in the JSON export</strong>; download entries you care about.</p>
      <a class="btn btn-primary" href="#/proof/diary">${icon('mic')} Record this month</a>
      ${diary.length ? html`<div class="list mt" id="diary">${diary.map((d) => html`<div class="list-item"><div class="grow"><div class="title">${d.month} · ${Math.round(d.seconds)}s</div><div class="sub">${d.topic}</div></div><button class="btn btn-sm" data-play="${d.id}">${icon('play')}</button><button class="btn btn-sm btn-ghost" data-dl="${d.id}" aria-label="Download">${icon('download')}</button><button class="btn btn-sm btn-ghost" data-del="${d.id}" aria-label="Delete">${icon('trash')}</button></div>`)}</div>
        ${diary.length >= 2 ? html`<div class="btn-row mt"><button class="btn" id="ab">${icon('refresh')} Play oldest, then newest</button></div>` : ''}` : ''}</div>
    <div class="card"><h3>Retention honesty</h3><p class="small muted">True recall rate per deck over the last 30 days. Below 80% means you added new cards too fast: lower "new cards per day" for a week.</p>
      ${retention.length ? html`${{ toString: () => charts.bars(retention.map((r) => ({ label: r.deck, value: r.rate, max: 100, display: `${r.rate}% (${r.n})`, color: r.rate < 80 ? 'var(--red)' : 'var(--green)' }))) }}` : html`<p class="small">No reviews in the last 30 days.</p>`}
      ${retention.some((r) => r.rate < 80) ? html`<div class="feedback close small mt">Flagged: ${retention.filter((r) => r.rate < 80).map((r) => r.deck).join(', ')}. Consider dropping new cards per day from ${s.newPerDay} to ${Math.max(3, Math.floor(s.newPerDay / 2))}.</div>` : ''}</div>
    ${quizzes.length ? html`<p class="xs muted">Weekly quizzes from Generate: ${quizzes.slice(-5).map((q) => `${q.score}/${q.total}`).join(' · ')}</p>` : ''}`);
  container.querySelectorAll('[data-play]').forEach((b) => b.onclick = async () => { const d = await db.get('diary', b.dataset.play); if (d) audio.play(d.blob); });
  container.querySelectorAll('[data-dl]').forEach((b) => b.onclick = async () => { const d = await db.get('diary', b.dataset.dl); if (!d) return; const url = URL.createObjectURL(d.blob); const a = document.createElement('a'); a.href = url; a.download = `voice-diary-${d.month}.${(d.mime || '').includes('mp4') ? 'm4a' : (d.mime || '').includes('ogg') ? 'ogg' : 'webm'}`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); });
  container.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirmDialog('Delete this recording permanently?', { okLabel: 'Delete', danger: true })) { await db.del('diary', b.dataset.del); render(container, params); } });
  const ab = $('#ab', container); if (ab) ab.onclick = async () => { const first = diary[diary.length - 1], last = diary[0]; await audio.play(first.blob); await audio.play(last.blob); };
  setContext({ title: 'Proof', text: `Level ${s.level}; weekly tests ${weekly.length}; diary entries ${diary.length}.` });
}

async function deckRetention() {
  const cutoff = dayKey(addDays(new Date(), -30));
  const reviews = (await store.allReviews()).filter((r) => r.day >= cutoff && !r.wasNew);
  const cards = new Map((await store.allCards()).map((c) => [c.id, c]));
  const by = {};
  for (const r of reviews) { const c = cards.get(r.cardId); const deck = c ? c.deck : r.kind; const b = (by[deck] ||= { n: 0, ok: 0 }); b.n++; if (r.grade > 0) b.ok++; }
  return Object.entries(by).filter(([, b]) => b.n >= 10).map(([deck, b]) => ({ deck, n: b.n, rate: Math.round((b.ok / b.n) * 100) })).sort((a, b) => a.rate - b.rate);
}

/* ---------------- weekly cumulative test ---------------- */
async function runWeeklyTest(container) {
  const cards = (await store.allCards()).filter((c) => c.state !== 'new' && !c.suspended);
  if (cards.length < 10) { mount(container, html`${backLink('#/proof', 'Proof')}<div class="empty">Study a little longer first: the test samples from cards you have already reviewed (${cards.length} so far, need 10).</div>`); return; }
  // Stratified sample across kinds
  const byKind = {}; for (const c of cards) (byKind[c.kind] ||= []).push(c);
  const kinds = Object.keys(byKind); const sample = [];
  while (sample.length < Math.min(25, cards.length)) { for (const k of shuffle(kinds)) { const pool = byKind[k]; if (pool.length) { sample.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]); if (sample.length >= 25) break; } } if (kinds.every((k) => !byKind[k].length)) break; }
  let i = 0; let score = 0; const results = [];
  const draw = async () => {
    if (i >= sample.length) {
      await db.put('tests', { id: uid('test'), kind: 'weekly', ts: nowISO(), score, total: sample.length, byKind: results.reduce((a, r) => { (a[r.kind] ||= { n: 0, ok: 0 }).n++; if (r.ok) a[r.kind].ok++; return a; }, {}) });
      mount(container, html`${backLink('#/proof', 'Proof')}<div class="hero center"><div class="big" style="font-size:var(--fs-3xl);font-weight:800">${score}/${sample.length}</div><h1>Weekly test saved</h1><p>${Math.round((score / sample.length) * 100)}% · ${results.filter((r) => !r.ok).length} misses went to your mistakes.</p><a class="btn btn-primary btn-lg" href="#/proof">Back to Proof</a></div>`);
      return;
    }
    const c = sample[i];
    const item = await toItem(c);
    if (!item) { i++; return draw(); }
    mount(container, html`${backLink('#/proof', 'Proof')}<div class="row between mb"><span class="muted small">Weekly test · ${i + 1}/${sample.length}</span><span class="chip">${c.kind}</span></div>${progressBar((i / sample.length) * 100)}<div class="card mt" id="ex"></div><div class="btn-row right" id="nav" hidden><button class="btn btn-primary" id="next">Next ${icon('next')}</button></div>`);
    const r = await mountExercise($('#ex', container), item);
    const ok = r.status !== 'wrong'; if (ok) score++; results.push({ kind: c.kind, ok });
    if (!ok) await store.logMistake({ source: 'grammar', refId: c.refId, original: r.typed || '(no answer)', fix: r.answer, rule: `weekly test: ${c.kind}`, makeCard: false });
    $('#nav', container).hidden = false; $('#next', container).onclick = () => { i++; draw(); };
  };
  draw();
  setContext({ title: 'Weekly test', text: 'Cumulative test in progress.' });
}
/** Turn any card into an exercise item. */
async function toItem(c) {
  const p = c.payload || {};
  if (c.kind === 'vocab') { const w = await content.wordById(c.refId); if (!w) return null; const cl = w.cloze; return cl && cl.sentence.includes('____') ? { type: 'fill', prompt: cl.sentence.replace('____', '___'), answer: [cl.answer, w.word], hi: (w.examples || [])[0]?.hi || '', feedback_en: `${w.word}: ${w.en_def}` } : { type: 'fill', prompt: `${w.hi_def} = ___`, answer: [w.word], feedback_en: w.en_def }; }
  if (c.kind === 'grammar' && p.item) return p.item;
  if (c.kind === 'mistake' || c.kind === 'correction') return { type: 'fix', prompt: p.original || p.from, answer: [p.fix || p.to], feedback_en: p.why_en || '', feedback_hi: p.why_hi || '' };
  if (c.kind === 'confusable') { const q = pick(p.quiz || []); return q ? { type: 'choose', prompt: q.sentence, options: [p.a, p.b, ...(p.c ? [p.c] : [])], answer: [q.answer], feedback_en: p.rule_en } : null; }
  if (c.kind === 'chunk' || c.kind === 'phrase') return { type: 'fix', prompt: `${p.cue}: ${p.hi}`, answer: [p.text.replace(/…/g, '').trim()], feedback_en: `Register: ${p.register}` };
  if (c.kind === 'collocation') { const col = await content.collocationById(c.refId); return col ? { type: 'fix', prompt: col.wrong, answer: [col.phrase], feedback_en: col.why_en || col.en_def } : null; }
  if (c.kind === 'root') return { type: 'fill', prompt: `${p.part} means ___`, answer: [p.meaning_en, ...p.meaning_en.split(/[,/]/).map((x) => x.trim())], feedback_en: (p.derived || []).join(', ') };
  if (c.kind === 'dictation') return { type: 'fix', prompt: '(listen) ' + (p.text || '').split(' ').map((w, i) => (i % 3 === 1 ? '___' : w)).join(' '), answer: [p.text], feedback_en: p.text };
  if (c.kind === 'stress') return { type: 'choose', prompt: `Which syllable of "${p.word}" is stressed?`, options: p.syllables, answer: [p.syllables[p.stressed]], feedback_en: p.rule_en || '' };
  return null;
}

/* ---------------- voice diary ---------------- */
async function runDiary(container) {
  const month = new Date().toISOString().slice(0, 7);
  const topic = DIARY_TOPICS[(new Date().getFullYear() * 12 + new Date().getMonth()) % DIARY_TOPICS.length];
  let recording = false; let t0 = 0; let blob = null; let seconds = 0;
  mount(container, html`${backLink('#/proof', 'Proof')}
    <div class="page-head"><div><h1>Voice diary · ${month}</h1><p class="sub">Two minutes, unscripted. No corrections, no score. Just you, saved.</p></div></div>
    <div class="card"><p style="font-size:var(--fs-xl)">${topic}</p>
      <div class="row" style="justify-content:center;gap:16px;margin-top:12px"><button class="rec-btn" id="rec">${icon('mic')}</button><div class="stack" style="flex:1;max-width:260px"><div class="meter"><span id="meter"></span></div><div class="xs muted center" id="status">Tap to start. Aim for 2 minutes.</div><div class="progress"><span id="bar" style="width:0"></span></div></div></div>
      <div id="after" class="mt"></div></div>`);
  let timer = null;
  $('#rec', container).onclick = async () => {
    const btn = $('#rec', container); const status = $('#status', container);
    if (!recording) {
      const ok = await audio.start({ onLevel: (v) => { { const _m = $('#meter', container); if (_m) _m.style.width = `${Math.round(v * 100)}%`; } } }); if (!ok) return;
      recording = true; t0 = performance.now(); btn.classList.add('recording'); btn.innerHTML = String(icon('stop'));
      timer = setInterval(() => { const s = (performance.now() - t0) / 1000; status.textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; $('#bar', container).style.width = `${Math.min(100, (s / 120) * 100)}%`; }, 250);
    } else {
      recording = false; clearInterval(timer); btn.classList.remove('recording'); btn.innerHTML = String(icon('mic'));
      const r = await audio.stop(); if (!r || !r.blob || !r.blob.size) { status.textContent = 'Nothing recorded.'; return; }
      blob = r.blob; seconds = r.seconds; status.textContent = `Recorded ${Math.round(seconds)}s`;
      mount($('#after', container), html`<div class="btn-row"><button class="btn" id="play">${icon('play')} Listen</button><button class="btn btn-primary" id="save">${icon('check')} Save to diary</button><button class="btn btn-ghost" id="redo">Record again</button></div>`);
      $('#play', container).onclick = () => audio.play(blob);
      $('#redo', container).onclick = () => { blob = null; mount($('#after', container), ''); };
      $('#save', container).onclick = async () => { await db.put('diary', { id: uid('dy'), month, topic, blob, mime: r.mime, seconds, ts: nowISO() }); await store.logAttempt({ kind: 'speaking', refId: `diary:${month}`, transcript: '', extra: { seconds, diary: true } }); toast('Saved. Listen to it next month.', 'ok'); location.hash = '#/proof'; };
    }
  };
  setContext({ title: 'Voice diary', text: topic });
  return () => { if (recording) audio.cancel(); };
}
