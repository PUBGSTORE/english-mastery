// discover.js (view) — 🧠 Daily Discovery: three fresh topics a day from any field, or your own genre, explained simply with real-life use.
import { html, mount, icon, toast, confirmDialog, openSheet, closeSheet, backLink, speakButton, progressBar, $ } from '../ui.js';
import * as db from '../db.js';
import * as ai from '../ai.js';
import * as dc from '../discover.js';
import * as tts from '../tts.js';
import { setContext } from '../router.js';
import { fmtDate, download, debounce, todayKey } from '../utils.js';

export async function render(container, params) {
  if (params.id === 'library') return renderLibrary(container);
  if (params.id) return renderTopic(container, decodeURIComponent(params.id));
  return renderHub(container);
}

async function renderHub(container) {
  const [picks, all, recs, key, est, genres, auto, estD] = await Promise.all([dc.picksFor(), dc.fields(), dc.list(), ai.hasKey(), dc.estimate(), dc.getGenres(), dc.getAuto(), dc.estimateDaily()]);
  const daily = (await db.getSetting('dcDaily', null)); const dailyToday = daily && daily.day === todayKey() ? daily : null;
  const done = new Map(recs.map((r) => [r.id, r]));
  const streak = dc.streakOf(recs);
  const today = recs.filter((r) => r.day === todayKey()).length;
  const explored = new Set(recs.map((r) => (r.data.field || '').toLowerCase()));
  const fieldDone = (f) => explored.has(f.name.toLowerCase()) || recs.some((r) => f.topics.some((t) => dc.topicId(t.t) === r.id));
  mount(container, html`
    <div class="dc-hero"><div class="dc-emoji">🧠</div><div class="grow"><h1>Daily Discovery</h1><p>Every day, three new topics from anywhere: economics, physics, neuroscience, law, music, space… Each one explained in simple English with real examples, where it shows up in your life, and how to use it. Or type any genre or topic you like.</p></div>
      <div class="dc-stats"><div><strong>${streak}</strong><span>day streak</span></div><div><strong>${recs.length}</strong><span>discovered</span></div><div><strong>${explored.size}</strong><span>fields</span></div></div></div>
    <div class="card dc-card"><form id="dc-form" autocomplete="off"><div class="row"><input class="input" id="dc-q" placeholder="Your genre or topic: neuroscience, how inflation works, black holes…" style="flex:1;min-width:220px"><button class="btn btn-primary btn-lg" type="submit">${icon('sparkle')} Explain</button><button class="btn btn-lg" type="button" id="dc-surprise" title="Random topic from a random field">🎲 Surprise me</button></div></form>
      <p class="xs muted mt mb-0">≈ ₹${est.inr.toFixed(2)} per topic, paid once; saved forever. ${key ? '' : html`<span style="color:var(--amber)">Add your DeepSeek key in Settings first.</span>`}</p><div id="dc-status" class="mt"></div></div>
    <div class="card dc-genres"><div class="row between"><h2 class="mb-0">🎛️ Your genres</h2><span class="xs muted">${genres.length ? `${genres.length} chosen` : 'none chosen: all fields'}</span></div>
      <p class="small muted">Pick the fields you care about. Today's three come from them, and the AI can invent fresh topics inside them every day.</p>
      <div class="chips" id="dc-genres">${all.map((f) => html`<button class="chip ${genres.includes(f.id) ? 'active' : ''}" data-g="${f.id}" aria-pressed="${genres.includes(f.id)}">${f.emoji} ${f.name}</button>`)}</div>
      <div class="row between mt" style="flex-wrap:wrap;gap:10px"><button class="btn btn-primary" id="dc-ai-daily">${icon('sparkle')} ${dailyToday ? 'Regenerate today\'s AI topics' : 'Generate today\'s topics with AI'} <span class="xs" style="opacity:.8">≈ ₹${estD.inr.toFixed(2)}</span></button>
        <label class="switch"><input type="checkbox" id="dc-auto" ${auto ? 'checked' : ''}><span class="track"></span><span class="small">Auto-generate each day when I open this page</span></label></div>
      <div id="dc-ai-out" class="mt">${dailyToday ? aiDailyHtml(dailyToday, done) : ''}</div></div>
    <h3 class="mt-lg">Today's three <span class="chip">${new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span> ${today ? html`<span class="chip green">${today} done today</span>` : ''}</h3>
    <div class="dc-grid" id="dc-picks">${picksHtml(picks, done)}</div>
    <h3 class="mt-lg">Browse by field <span class="chip">${all.length} fields · ${all.reduce((a, f) => a + f.topics.length, 0)} topics</span></h3>
    <div class="chips" id="dc-fields">${all.map((f) => html`<button class="chip ${fieldDone(f) ? 'active' : ''}" data-f="${f.id}">${f.emoji} ${f.name}</button>`)}</div>
    <div id="dc-field-topics" class="mt"></div>
    ${recs.length ? html`<div class="row between mt-lg"><h3 class="mb-0">📥 Your library <span class="badge muted">${recs.length}</span></h3><a class="btn btn-sm" href="#/discover/library">${icon('list')} Open library · offline</a></div><div class="grid mt">${recs.slice(0, 6).map((r) => itemCard(r))}</div>` : html`<div class="card dc-card mt-lg compact small muted">📥 Every topic you explain is saved in your library on this device and readable offline, on the train, without the AI.</div>`}`);
  const go = (t, f = '') => start(container, t, f);
  $('#dc-form', container).onsubmit = (e) => { e.preventDefault(); go($('#dc-q', container).value.trim()); };
  $('#dc-surprise', container).onclick = async () => { const s = await dc.surprise(); $('#dc-q', container).value = s.t; go(s.t, s.field.name); };
  container.querySelectorAll('[data-topic]').forEach((b) => b.onclick = () => go(b.dataset.topic, b.dataset.field));
  container.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { const f = all.find((x) => x.id === b.dataset.f); container.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('sel', x === b)); mount($('#dc-field-topics', container), html`<div class="card dc-card compact"><div class="row between"><strong>${f.emoji} ${f.name}</strong><button class="btn btn-sm" data-genre="${f.name}">${icon('sparkle')} Let the tutor pick a topic in ${f.name}</button></div><div class="stack mt">${f.topics.map((t) => { const r = done.get(dc.topicId(t.t)); return html`<div class="row between dc-topic-row"><div><strong>${t.t}</strong><div class="xs muted">${t.h}</div></div>${r ? html`<a class="btn btn-sm" href="#/discover/${encodeURIComponent(r.id)}">${icon('check')} Read</a>` : html`<button class="btn btn-sm btn-primary" data-topic2="${t.t}">Explain</button>`}</div>`; })}</div></div>`); container.querySelectorAll('[data-topic2]').forEach((x) => x.onclick = () => go(x.dataset.topic2, f.name)); const g = container.querySelector('[data-genre]'); if (g) g.onclick = () => go(f.name, f.name); $('#dc-field-topics', container).scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  container.querySelectorAll('[data-del]').forEach((b) => b.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); if (await confirmDialog('Delete this discovery? Its Notes page (if saved) stays.', { okLabel: 'Delete', danger: true })) { await dc.remove(b.dataset.del); renderHub(container); } });
  // genres
  container.querySelectorAll('[data-g]').forEach((b) => b.onclick = async () => { const cur = await dc.getGenres(); const id = b.dataset.g; const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]; await dc.setGenres(next); b.classList.toggle('active', next.includes(id)); b.setAttribute('aria-pressed', String(next.includes(id))); const np = await dc.picksFor(); mount($('#dc-picks', container), picksHtml(np, done)); container.querySelectorAll('[data-topic]').forEach((x) => x.onclick = () => go(x.dataset.topic, x.dataset.field)); toast(next.includes(id) ? 'Genre added · today\'s three updated' : 'Genre removed', 'ok', { timeout: 1200 }); });
  $('#dc-auto', container).onchange = async (e) => { await dc.setAuto(e.target.checked); if (e.target.checked && !dailyToday) runDaily(container, false); };
  const runDaily = async (cont, force) => { const out = $('#dc-ai-out', cont); const btn = $('#dc-ai-daily', cont); if (!(await ai.hasKey())) { mount(out, html`<div class="feedback bad small">Add your DeepSeek key in Settings first.</div>`); return; } btn.disabled = true; mount(out, html`<div class="row"><span class="spinner"></span> Choosing today's topics for ${genres.length ? 'your genres' : 'all fields'}…</div>`); try { const d = await dc.dailyAI({ force }); mount(out, aiDailyHtml(d, done)); btn.innerHTML = String(html`${icon('sparkle')} Regenerate today's AI topics <span class="xs" style="opacity:.8">≈ ₹${estD.inr.toFixed(2)}</span>`); wireDaily(cont); } catch (e) { mount(out, html`<div class="feedback bad small">${e.message === 'CAP_REACHED' ? 'Monthly AI cap reached (Settings).' : e.message}</div>`); } btn.disabled = false; };
  const wireDaily = (cont) => cont.querySelectorAll('[data-ai-topic]').forEach((b) => b.onclick = () => go(b.dataset.aiTopic, b.dataset.aiField));
  $('#dc-ai-daily', container).onclick = () => runDaily(container, !!dailyToday);
  wireDaily(container);
  if (auto && !dailyToday && key) runDaily(container, false);
  setContext({ title: 'Daily Discovery', text: `Today's topics: ${picks.map((p) => p.t).join('; ')}` });
}

function picksHtml(picks, done) {
  return html`${picks.map((p, i) => { const r = done.get(dc.topicId(p.t)); return html`<div class="card dc-pick" style="--dc-hue:${[262, 190, 330][i]};margin:0"><div class="dc-field">${p.field.emoji} ${p.field.name}</div><h3>${p.t}</h3><p class="small">${p.h}</p>${r ? html`<a class="btn btn-primary" href="#/discover/${encodeURIComponent(r.id)}">${icon('check')} Read it</a>` : html`<button class="btn btn-primary" data-topic="${p.t}" data-field="${p.field.name}">${icon('sparkle')} Explain</button>`}</div>`; })}`;
}
function aiDailyHtml(d, done) {
  return html`<div class="dc-grid">${d.topics.map((t, i) => { const r = done.get(dc.topicId(t.t)); return html`<div class="card dc-pick ai" style="--dc-hue:${[290, 200, 20][i]};margin:0"><div class="dc-field">${icon('sparkle')} AI pick · ${t.field}</div><h3>${t.t}</h3><p class="small">${t.h}</p>${t.why ? html`<p class="xs muted">${t.why}</p>` : ''}${r ? html`<a class="btn btn-primary" href="#/discover/${encodeURIComponent(r.id)}">${icon('check')} Read it</a>` : html`<button class="btn btn-primary" data-ai-topic="${t.t}" data-ai-field="${t.field}">${icon('sparkle')} Explain</button>`}</div>`; })}</div><p class="xs muted mt mb-0">Generated ${fmtDate(d.ts, { hour: '2-digit', minute: '2-digit' })} for ${d.day}. Same three all day; new ones tomorrow.</p>`;
}

function itemCard(r) {
  const d = r.data;
  return html`<a class="card dc-item ${d.read ? 'read' : ''}" href="#/discover/${encodeURIComponent(r.id)}" style="margin:0"><div class="row between"><div class="dc-field">${d.emoji} ${d.field}</div><div class="row" style="gap:2px">${d.fav ? html`<span title="Favourite">⭐</span>` : ''}<button class="btn btn-sm btn-ghost" data-del="${r.id}" aria-label="Delete">${icon('trash')}</button></div></div><strong>${r.title}</strong><div class="xs muted mt">${fmtDate(r.ts)} · ${dc.readingMinutes(r)} min${d.read ? ' · ✓ read' : ''}${d.quizResult ? ` · quiz ${d.quizResult.score}/${d.quizResult.total}` : ''}${d.teachBack ? ` · taught ${d.teachBack.understanding}/10` : ''}</div></a>`;
}

async function renderLibrary(container) {
  const [recs, all] = await Promise.all([dc.list(), dc.fields()]);
  const state = { q: '', field: '', sort: 'new', only: '' };
  const fieldsIn = [...new Set(recs.map((r) => r.data.field).filter(Boolean))].sort();
  const readCount = recs.filter((r) => r.data.read).length; const favCount = recs.filter((r) => r.data.fav).length;
  const mins = recs.reduce((a, r) => a + dc.readingMinutes(r), 0);
  mount(container, html`${backLink('#/discover', 'Discovery')}
    <div class="dc-hero compact"><div class="dc-emoji" style="font-size:44px">📥</div><div class="grow"><h1 style="font-size:var(--fs-xl)">Your library</h1><p class="mb-0">Every discovery, saved on this device. Works offline. ${recs.length} topics · ${readCount} read · ${favCount} favourites · ${mins} min of reading.</p></div>
      <div class="btn-row"><button class="btn" id="lib-export">${icon('download')} Export all (.md)</button></div></div>
    <div class="card dc-card compact"><div class="row" style="flex-wrap:wrap"><input class="input" id="lib-q" placeholder="Search titles, fields, terms…" style="flex:1;min-width:200px">
      <select class="input" id="lib-sort" style="max-width:170px"><option value="new">Newest first</option><option value="old">Oldest first</option><option value="az">A → Z</option><option value="long">Longest read</option></select></div>
      <div class="chips mt"><button class="chip active" data-only="">All</button><button class="chip" data-only="unread">Unread</button><button class="chip" data-only="read">Read</button><button class="chip" data-only="fav">⭐ Favourites</button><button class="chip" data-only="quiz">Quiz not done</button></div>
      ${fieldsIn.length > 1 ? html`<div class="chips mt"><button class="chip active" data-lf="">Every field</button>${fieldsIn.map((f) => { const meta = all.find((x) => x.name.toLowerCase() === f.toLowerCase()); return html`<button class="chip" data-lf="${f}">${meta ? meta.emoji + ' ' : ''}${f}</button>`; })}</div>` : ''}</div>
    <div id="lib-list" class="grid mt"></div>`);
  const draw = () => {
    let list = recs.filter((r) => { const d = r.data; if (state.field && d.field !== state.field) return false; if (state.only === 'unread' && d.read) return false; if (state.only === 'read' && !d.read) return false; if (state.only === 'fav' && !d.fav) return false; if (state.only === 'quiz' && (d.quizResult || !d.quiz.length)) return false; if (state.q) { const q = state.q.toLowerCase(); return (r.title + ' ' + d.field + ' ' + d.hook + ' ' + d.terms.map((t) => t.term).join(' ')).toLowerCase().includes(q); } return true; });
    if (state.sort === 'old') list = list.slice().reverse(); else if (state.sort === 'az') list = list.slice().sort((a, b) => a.title.localeCompare(b.title)); else if (state.sort === 'long') list = list.slice().sort((a, b) => dc.readingMinutes(b) - dc.readingMinutes(a));
    mount($('#lib-list', container), list.length ? html`${list.map((r) => itemCard(r))}` : html`<div class="empty" style="grid-column:1/-1">${icon('search')}<p>Nothing matches.</p></div>`);
    container.querySelectorAll('[data-del]').forEach((b) => b.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); if (await confirmDialog('Delete this discovery?', { okLabel: 'Delete', danger: true })) { await dc.remove(b.dataset.del); renderLibrary(container); } });
  };
  $('#lib-q', container).oninput = debounce((e) => { state.q = e.target.value.trim(); draw(); }, 150);
  $('#lib-sort', container).onchange = (e) => { state.sort = e.target.value; draw(); };
  container.querySelectorAll('[data-only]').forEach((b) => b.onclick = () => { state.only = b.dataset.only; container.querySelectorAll('[data-only]').forEach((x) => x.classList.toggle('active', x === b)); draw(); });
  container.querySelectorAll('[data-lf]').forEach((b) => b.onclick = () => { state.field = b.dataset.lf; container.querySelectorAll('[data-lf]').forEach((x) => x.classList.toggle('active', x === b)); draw(); });
  $('#lib-export', container).onclick = () => download(`discoveries-${todayKey()}.md`, recs.map((r) => dc.toMarkdown(r)).join('\n\n---\n\n'), 'text/markdown');
  draw();
  setContext({ title: 'Discovery library', text: recs.slice(0, 20).map((r) => r.title).join('; ') });
}

async function start(container, input, field) {
  if (!input) { toast('Type a topic or genre.', 'warn'); return; }
  const status = $('#dc-status', container);
  if (!(await ai.hasKey())) { mount(status, html`<div class="feedback bad small">Add your DeepSeek key in Settings first.</div>`); return; }
  const existing = await dc.get(dc.topicId(input));
  if (existing) { location.hash = `#/discover/${encodeURIComponent(existing.id)}`; return; }
  mount(status, html`<div class="card compact"><div class="row"><span class="spinner"></span> Explaining <strong>${input}</strong>… about 30 seconds.</div><div class="mt">${progressBar(35)}</div></div>`);
  status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try { const rec = await dc.explain(input, { field }); toast('Discovered!', 'ok'); location.hash = `#/discover/${encodeURIComponent(rec.id)}`; }
  catch (e) { mount(status, html`<div class="feedback bad small">${e.message === 'CAP_REACHED' ? 'Monthly AI cap reached (Settings).' : e.message}</div>`); }
}

async function renderTopic(container, id) {
  const rec = await dc.get(id);
  if (!rec) { mount(container, html`${backLink('#/discover', 'Discovery')}<div class="empty">Not found</div>`); return; }
  const d = rec.data; const noteId = `nt:${rec.id}`; const hasNote = !!(await db.get('notes', noteId));
  const quizState = { picked: d.quizResult ? d.quizResult.picked : Array(d.quiz.length).fill(null) };
  mount(container, html`
    ${backLink('#/discover', 'Discovery')}
    <div class="dc-hero compact"><div class="dc-emoji" style="font-size:44px">${d.emoji}</div><div class="grow"><div class="dc-field" style="color:rgba(255,255,255,.85)">${d.field}</div><h1 style="font-size:var(--fs-xl)">${rec.title}</h1><p class="mb-0">${d.hook}</p></div></div>
    <div class="row between mb" style="flex-wrap:wrap;gap:8px"><span class="chip green">${icon('check')} Saved in your library · offline · ${dc.readingMinutes(rec)} min read</span><div class="btn-row"><button class="btn btn-sm ${d.fav ? 'btn-primary' : ''}" id="fav">${d.fav ? '⭐ Favourite' : '☆ Favourite'}</button><button class="btn btn-sm ${d.read ? 'btn-primary' : ''}" id="mark-read">${icon('check')} ${d.read ? 'Read' : 'Mark as read'}</button></div></div>
    <div class="btn-row mb"><button class="btn btn-primary" id="reading-mode">${icon('eye')} Reading mode</button><button class="btn" id="save-note">${icon('note')} ${hasNote ? 'Update Notes page' : 'Save to Notes'}</button>${hasNote ? html`<a class="btn" href="#/notes/${noteId}">Open Notes page</a>` : ''}<button class="btn" id="ask">${icon('chat')} Ask about this</button><button class="btn" id="read">${icon('speaker')} Read aloud</button><button class="btn" id="export">${icon('download')} Export .md</button><button class="btn btn-ghost" id="del">${icon('trash')}</button></div>
    <div class="chips scroll mb" id="toc"><a class="chip" href="#dc-simple">Simple</a><a class="chip" href="#dc-core">Explanation</a><a class="chip" href="#dc-examples">Examples</a><a class="chip" href="#dc-life">Real life</a><a class="chip" href="#dc-apply">Apply</a><a class="chip" href="#dc-deeper">Deeper</a><a class="chip" href="#dc-quiz">Quiz</a><a class="chip" href="#dc-teach">Teach it back</a><a class="chip" href="#dc-terms">Terms</a><a class="chip" href="#dc-my">My notes</a></div>

    <div class="card dc-card" id="dc-simple"><h2>🧒 In simple words</h2><p style="font-size:var(--fs-lg)">${d.eli10}</p>
      ${d.mental_model ? html`<div class="dc-model"><span class="owl-label">Mental model · ${d.mental_model.name}</span><div>${d.mental_model.line}</div></div>` : ''}</div>
    <div class="card dc-card" id="dc-core"><h2>📖 The real explanation</h2><p style="font-size:var(--fs-md)">${d.core}</p>
      ${d.how_it_works.length ? html`<h3 class="mt">How it works</h3><ol class="owl-ideas">${d.how_it_works.map((s) => html`<li>${s}</li>`)}</ol>` : ''}
      ${d.hi_summary ? html`<details class="hi-block"><summary>हिन्दी में</summary><div class="hi-text" lang="hi">${d.hi_summary}</div></details>` : ''}
      ${d.gu_summary ? html`<details class="hi-block"><summary>ગુજરાતીમાં</summary><div class="hi-text" lang="gu">${d.gu_summary}</div></details>` : ''}</div>
    ${d.examples.length ? html`<div class="card dc-card" id="dc-examples"><h2>💡 Examples</h2>${d.examples.map((e) => html`<div class="owl-learning"><h3>${e.title}</h3><p>${e.text}</p></div>`)}</div>` : ''}
    <div class="card dc-life" id="dc-life"><h2>🏠 In your real life</h2>${d.real_life.map((r) => html`<div class="owl-learning"><h3>${r.situation}</h3><p>${r.how}</p></div>`)}
      ${d.why_useful ? html`<h3 class="mt">Why it is useful</h3><p>${d.why_useful}</p>` : ''}
      ${d.for_security_engineer ? html`<div class="dc-sec"><span class="owl-label">🔐 For a security engineer</span><div>${d.for_security_engineer}</div></div>` : ''}</div>
    ${d.apply_steps.length ? html`<div class="card dc-card" id="dc-apply"><h2>✅ Apply it this week</h2><div class="stack">${d.apply_steps.map((a, i) => html`<label class="switch"><input type="checkbox" data-act="${i}" ${a.done ? 'checked' : ''}><span class="track"></span><span ${a.done ? 'style="text-decoration:line-through;opacity:.6"' : ''}>${a.text}</span></label>`)}</div></div>` : ''}
    <div class="card dc-card" id="dc-deeper"><div class="row between"><h2>🔬 Going deeper</h2><button class="btn btn-sm" id="deepen">${icon('sparkle')} Explain more${d.more.length ? ` (+${d.more.length})` : ''}</button></div>
      ${d.misconceptions.length ? html`<h3>Misconceptions</h3>${d.misconceptions.map((m) => html`<div class="dc-myth"><div class="myth">❌ ${m.myth}</div><div class="truth">✅ ${m.truth}</div></div>`)}` : ''}
      ${d.deeper ? html`<h3 class="mt">What experts know</h3><p>${d.deeper}</p>` : ''}
      ${d.more.map((p) => html`<div class="owl-learning deeper"><h3>${p.title}</h3><p>${p.text}</p>${p.example ? html`<div class="owl-sub"><span class="owl-label">Example</span><div>${p.example}</div></div>` : ''}</div>`)}
      ${d.facts.length ? html`<h3 class="mt">Facts</h3><ul>${d.facts.map((f) => html`<li>${f}</li>`)}</ul>` : ''}
      ${d.history ? html`<h3 class="mt">History</h3><p>${d.history}</p>` : ''}</div>
    ${d.quiz.length ? html`<div class="card dc-quiz" id="dc-quiz"><h2>🎯 Quiz</h2>${d.quizResult ? html`<p class="small muted">Last score ${d.quizResult.score}/${d.quizResult.total}. Tap Retake to try again.</p>` : html`<p class="small muted">Answer all four, then Check.</p>`}
      ${d.quiz.map((q, qi) => html`<div class="dc-q" data-q="${qi}"><strong>${qi + 1}. ${q.q}</strong><div class="stack mt">${q.options.map((o, oi) => html`<button class="btn dc-opt ${d.quizResult ? (oi === q.answer ? 'right' : quizState.picked[qi] === oi ? 'wrong' : '') : ''}" data-q="${qi}" data-o="${oi}" ${d.quizResult ? 'disabled' : ''}>${String.fromCharCode(65 + oi)}. ${o}</button>`)}</div>${d.quizResult ? html`<div class="xs muted mt">${q.why}</div>` : ''}</div>`)}
      <div class="btn-row mt">${d.quizResult ? html`<button class="btn" id="quiz-retake">${icon('refresh')} Retake</button>` : html`<button class="btn btn-primary" id="quiz-check">${icon('check')} Check answers</button>`}</div></div>` : ''}
    <div class="card dc-card" id="dc-teach"><h2>🗣️ Teach it back</h2><p class="small">${d.teach_prompt || 'Explain this topic in your own words, in three sentences, as if to a friend.'} The AI checks your understanding and your English.</p>
      <textarea class="textarea" id="teach-text" rows="4" placeholder="In my own words…">${d.teachBack ? d.teachBack.text : ''}</textarea>
      <div class="btn-row mt"><button class="btn btn-primary" id="teach-go">${icon('sparkle')} Check my explanation</button></div><div id="teach-out" class="mt">${d.teachBack ? teachHtml(d.teachBack) : ''}</div></div>
    ${d.terms.length ? html`<div class="card dc-card" id="dc-terms"><h2>🔤 Terms</h2><div class="scroll-x"><table class="tbl"><thead><tr><th>Term</th><th>English</th><th>हिन्दी</th><th>ગુજરાતી</th><th></th></tr></thead><tbody>${d.terms.map((t, i) => html`<tr><td><strong>${t.term}</strong> ${speakButton(t.term)}</td><td>${t.en}</td><td class="hi-text" lang="hi">${t.hi}</td><td class="hi-text" lang="gu">${t.gu}</td><td><button class="btn btn-sm btn-ghost" data-fav="${i}" aria-label="Add to my vocabulary list">❤</button></td></tr>`)}</tbody></table></div></div>` : ''}
    ${d.related.length || d.further.length ? html`<div class="card dc-card"><h2>🧭 Explore next</h2><div class="chips">${d.related.map((r) => html`<a class="chip" href="#/discover?q=${encodeURIComponent(r)}" data-rel="${r}">${icon('sparkle')} ${r}</a>`)}</div>${d.further.length ? html`<h3 class="mt">Go further</h3><ul>${d.further.map((f) => html`<li>${f}</li>`)}</ul>` : ''}</div>` : ''}
    <div class="card dc-card" id="dc-my"><h2>My notes</h2><p class="xs muted">Saved automatically and included in the Notes page.</p><textarea class="textarea" id="my-notes" rows="5" placeholder="What surprised you? Where will you use this?">${d.myNotes || ''}</textarea></div>`);
  $('#save-note', container).onclick = async () => { await dc.saveToNotes(rec); toast('Saved as its own page in Notes', 'ok'); renderTopic(container, id); };
  $('#fav', container).onclick = async () => { d.fav = !d.fav; await dc.save(rec); renderTopic(container, id); };
  $('#mark-read', container).onclick = async () => { d.read = !d.read; await dc.save(rec); toast(d.read ? 'Marked as read' : 'Marked unread', 'ok', { timeout: 1200 }); renderTopic(container, id); };
  $('#reading-mode', container).onclick = () => { const body = openSheet('<div class="dc-reader"></div>', { wide: true }); mount(body.querySelector('.dc-reader'), readerHtml(rec)); body.querySelector('[data-done]').onclick = async () => { d.read = true; await dc.save(rec); closeSheet(); toast('Marked as read', 'ok', { timeout: 1200 }); renderTopic(container, id); }; };
  $('#export', container).onclick = () => download(`${rec.title.replace(/[^\w]+/g, '-').slice(0, 50)}.md`, dc.toMarkdown(rec), 'text/markdown');
  $('#del', container).onclick = async () => { if (await confirmDialog('Delete this discovery?', { okLabel: 'Delete', danger: true })) { await dc.remove(id); location.hash = '#/discover'; } };
  $('#ask', container).onclick = async () => { const mod = await import('./chat.js'); const body = openSheet('<div class="chat-sheet"></div>', { wide: true }); await mod.mountChat(body.querySelector('.chat-sheet'), { embedded: true, context: { title: rec.title, text: `${d.field}: ${d.core} How it works: ${d.how_it_works.join(' ')} Deeper: ${d.deeper}`.slice(0, 3000) } }); };
  let reading = false;
  $('#read', container).onclick = async (e) => { const b = e.currentTarget; if (reading) { reading = false; tts.stop(); b.innerHTML = String(html`${icon('speaker')} Read aloud`); return; } reading = true; b.innerHTML = String(html`${icon('stop')} Stop`); const parts = [rec.title, d.eli10, d.core, ...d.how_it_works, ...d.examples.map((x) => `${x.title}. ${x.text}`), ...d.real_life.map((x) => `${x.situation}. ${x.how}`), d.why_useful, d.deeper].filter(Boolean); for (const p of parts) { if (!reading) break; const ok = await tts.speak(p); if (!ok) break; } reading = false; b.innerHTML = String(html`${icon('speaker')} Read aloud`); };
  container.querySelectorAll('[data-act]').forEach((cb) => cb.onchange = async () => { d.apply_steps[+cb.dataset.act].done = cb.checked; await dc.save(rec); });
  $('#deepen', container).onclick = async (e) => { const b = e.currentTarget; if (!(await ai.hasKey())) { toast('Add your DeepSeek key in Settings.', 'warn'); return; } b.disabled = true; b.innerHTML = '<span class="spinner"></span>'; try { const n = await dc.deepen(rec); toast(`${n} more points added`, 'ok'); renderTopic(container, id); } catch (err) { toast(err.message === 'CAP_REACHED' ? 'Monthly AI cap reached.' : err.message, 'err'); b.disabled = false; b.textContent = 'Explain more'; } };
  // quiz
  container.querySelectorAll('.dc-opt').forEach((b) => b.onclick = () => { if (d.quizResult) return; const qi = +b.dataset.q; quizState.picked[qi] = +b.dataset.o; container.querySelectorAll(`.dc-opt[data-q="${qi}"]`).forEach((x) => x.classList.toggle('sel', x === b)); });
  const qc = $('#quiz-check', container); if (qc) qc.onclick = async () => { if (quizState.picked.some((p) => p == null)) { toast('Answer every question first.', 'warn'); return; } const score = d.quiz.reduce((a, q, i) => a + (quizState.picked[i] === q.answer ? 1 : 0), 0); d.quizResult = { score, total: d.quiz.length, picked: quizState.picked, ts: new Date().toISOString() }; await dc.save(rec); toast(score === d.quiz.length ? 'Perfect!' : `${score}/${d.quiz.length}`, score >= d.quiz.length / 2 ? 'ok' : 'warn'); renderTopic(container, id); setTimeout(() => { const el = document.getElementById('dc-quiz'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); };
  const qr = $('#quiz-retake', container); if (qr) qr.onclick = async () => { d.quizResult = null; await dc.save(rec); renderTopic(container, id); };
  // teach back
  $('#teach-go', container).onclick = async (e) => { const text = $('#teach-text', container).value.trim(); if (text.split(/\s+/).length < 8) { toast('Write at least a couple of sentences.', 'warn'); return; } if (!(await ai.hasKey())) { toast('Add your DeepSeek key in Settings.', 'warn'); return; } const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Checking…'; try { const r = await dc.gradeTeachBack(rec, text); mount($('#teach-out', container), teachHtml(r)); } catch (err) { toast(err.message === 'CAP_REACHED' ? 'Monthly AI cap reached.' : err.message, 'err'); } b.disabled = false; b.innerHTML = String(html`${icon('sparkle')} Check my explanation`); };
  container.querySelectorAll('[data-fav]').forEach((b) => b.onclick = async () => { const t = d.terms[+b.dataset.fav]; const mv = await import('../myvocab.js'); const added = await mv.toggle({ key: `term:${t.term.toLowerCase()}`, word: t.term, en: t.en, hi: t.hi, gu: t.gu, ipa: '', source: { title: rec.title, href: `#/discover/${encodeURIComponent(id)}` } }); b.style.color = added ? 'var(--red)' : ''; toast(added ? 'Added to your vocabulary list' : 'Removed', 'ok', { timeout: 1500 }); });
  (async () => { const mv = await import('../myvocab.js'); const keys = new Set((await mv.list()).map((x) => x.key)); container.querySelectorAll('[data-fav]').forEach((b) => { if (keys.has(`term:${d.terms[+b.dataset.fav].term.toLowerCase()}`)) b.style.color = 'var(--red)'; }); })();
  container.querySelectorAll('[data-rel]').forEach((a) => a.onclick = async (e) => { e.preventDefault(); const t = a.dataset.rel; const ex = await dc.get(dc.topicId(t)); if (ex) { location.hash = `#/discover/${encodeURIComponent(ex.id)}`; return; } if (!(await ai.hasKey())) { toast('Add your DeepSeek key in Settings.', 'warn'); return; } a.innerHTML = '<span class="spinner"></span> ' + t; try { const r = await dc.explain(t, { field: d.field }); location.hash = `#/discover/${encodeURIComponent(r.id)}`; } catch (err) { toast(err.message === 'CAP_REACHED' ? 'Monthly AI cap reached.' : err.message, 'err'); a.textContent = t; } });
  $('#my-notes', container).oninput = debounce(async (e) => { d.myNotes = e.target.value; await dc.save(rec); if (await db.get('notes', noteId)) await dc.saveToNotes(rec); }, 600);
  container.querySelectorAll('#toc a').forEach((a) => a.onclick = (e) => { e.preventDefault(); const el = document.querySelector(a.getAttribute('href')); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  setContext({ title: `Discovery: ${rec.title}`, text: `${d.field}. ${d.core}`.slice(0, 1500) });
  return () => tts.stop();
}

function teachHtml(r) {
  return html`<div class="feedback ${r.understanding >= 7 ? 'ok' : r.understanding >= 4 ? 'close' : 'bad'} small"><div class="row" style="gap:14px"><strong>Understanding ${r.understanding}/10</strong><strong>English ${r.english}/10</strong></div>
    ${(r.correct || []).length ? html`<div class="mt">✅ ${r.correct.join(' · ')}</div>` : ''}${(r.missing || []).length ? html`<div class="mt">❗ ${r.missing.join(' · ')}</div>` : ''}
    ${r.corrected ? html`<div class="mt"><span class="owl-label">Better English</span><div>${r.corrected}</div></div>` : ''}${r.tip ? html`<div class="mt muted">${r.tip}</div>` : ''}</div>`;
}

function readerHtml(rec) {
  const d = rec.data;
  return html`<div class="dc-reader-head"><div class="dc-field">${d.emoji} ${d.field} · ${dc.readingMinutes(rec)} min</div><h1>${rec.title}</h1><p class="lead">${d.hook}</p></div>
    <h2>In simple words</h2><p>${d.eli10}</p>${d.mental_model ? html`<blockquote class="owl-quote">${d.mental_model.line}</blockquote>` : ''}
    <h2>The real explanation</h2><p>${d.core}</p>${d.how_it_works.length ? html`<ol>${d.how_it_works.map((s) => html`<li>${s}</li>`)}</ol>` : ''}
    ${d.examples.length ? html`<h2>Examples</h2>${d.examples.map((e) => html`<h3>${e.title}</h3><p>${e.text}</p>`)}` : ''}
    ${d.real_life.length ? html`<h2>In your real life</h2>${d.real_life.map((r) => html`<h3>${r.situation}</h3><p>${r.how}</p>`)}` : ''}
    ${d.why_useful ? html`<h2>Why it is useful</h2><p>${d.why_useful}</p>` : ''}
    ${d.for_security_engineer ? html`<h2>For a security engineer</h2><p>${d.for_security_engineer}</p>` : ''}
    ${d.misconceptions.length ? html`<h2>Misconceptions</h2>${d.misconceptions.map((m) => html`<p><span style="color:var(--red)">✗ ${m.myth}</span><br><span style="color:var(--green)">✓ ${m.truth}</span></p>`)}` : ''}
    ${d.deeper ? html`<h2>Going deeper</h2><p>${d.deeper}</p>` : ''}${d.more.map((p) => html`<h3>${p.title}</h3><p>${p.text}</p>`)}
    ${d.facts.length ? html`<h2>Facts</h2><ul>${d.facts.map((f) => html`<li>${f}</li>`)}</ul>` : ''}
    ${d.history ? html`<h2>History</h2><p>${d.history}</p>` : ''}
    ${d.hi_summary ? html`<h2>हिन्दी सार</h2><p class="hi-text" lang="hi">${d.hi_summary}</p>` : ''}${d.gu_summary ? html`<h2>ગુજરાતી સાર</h2><p class="hi-text" lang="gu">${d.gu_summary}</p>` : ''}
    <div class="btn-row center mt-lg"><button class="btn btn-primary btn-lg" data-done>${icon('check')} Finished reading</button></div>`;
}
