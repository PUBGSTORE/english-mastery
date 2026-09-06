// books.js (view) — 📚 Book explainer: type a book, get every chapter explained and study notes at the end.
import { html, mount, icon, toast, confirmDialog, openSheet, backLink, speakButton, progressBar, $ } from '../ui.js';
import * as db from '../db.js';
import * as ai from '../ai.js';
import * as bk from '../books.js';
import * as tts from '../tts.js';
import { setContext } from '../router.js';
import { fmtDate, download, debounce } from '../utils.js';

const SUGGESTIONS = ['Atomic Habits', 'Deep Work', 'The Psychology of Money', 'Thinking, Fast and Slow', 'How to Win Friends and Influence People', 'Sapiens', 'The 7 Habits of Highly Effective People', 'Zero to One', 'Ikigai', 'Rich Dad Poor Dad', 'The Alchemist', 'Man\'s Search for Meaning'];

export async function render(container, params) {
  if (params.id) return renderBook(container, decodeURIComponent(params.id));
  return renderHub(container);
}

async function renderHub(container) {
  const books = await bk.list();
  const key = await ai.hasKey();
  mount(container, html`
    <div class="book-hero"><div class="book-emoji">📚</div><div><h1>Book explainer</h1><p>Type any well-known book. The tutor identifies it, then explains <strong>every chapter</strong> in full: the argument, the stories and examples, quotes, terms in English, हिन्दी and ગુજરાતી, and the lesson of each chapter. At the end you get study notes: big ideas, an action checklist, memorable quotes, how to apply it, what to read next. Saved forever; paid once.</p></div></div>
    <div class="card book-card">
      <form id="bk-form" autocomplete="off"><div class="row"><input class="input" id="bk-title" placeholder="Book title (e.g. Atomic Habits)" style="flex:2;min-width:200px"><input class="input" id="bk-author" placeholder="Author (optional)" style="flex:1;min-width:140px"><button class="btn btn-primary btn-lg" type="submit">${icon('sparkle')} Explain</button></div></form>
      <div class="chips scroll mt">${SUGGESTIONS.map((s) => html`<button class="chip" data-sug="${s}">${s}</button>`)}</div>
      ${key ? '' : html`<p class="xs mt mb-0" style="color:var(--amber)">Add your DeepSeek key in Settings to use this section.</p>`}
      <div id="bk-status" class="mt"></div>
    </div>
    ${books.length ? html`<h3 class="mt-lg">Your shelf <span class="badge muted">${books.length}</span></h3><div class="grid">${books.map((b) => html`<a class="card book-item" href="#/books/${encodeURIComponent(b.id)}" style="margin:0"><div class="book-spine">${b.title}</div><div class="xs muted mt">${b.data.author}${b.data.year ? ' · ' + b.data.year : ''} · ${b.data.chapters.length} chapters · ${fmtDate(b.ts)}</div><div class="row between mt"><span class="xs">${b.data.chapters.reduce((a, c) => a + c.key_ideas.length, 0)} ideas · ${b.data.terms.length} terms</span><button class="btn btn-sm btn-ghost" data-del="${b.id}" aria-label="Delete">${icon('trash')}</button></div></a>`)}</div>` : html`<div class="empty">${icon('book')}<p>Your shelf is empty. Try one of the suggestions above.</p></div>`}`);
  $('#bk-form', container).onsubmit = (e) => { e.preventDefault(); start(container, $('#bk-title', container).value.trim(), $('#bk-author', container).value.trim()); };
  container.querySelectorAll('[data-sug]').forEach((b) => b.onclick = () => { $('#bk-title', container).value = b.dataset.sug; $('#bk-author', container).value = ''; start(container, b.dataset.sug, ''); });
  container.querySelectorAll('[data-del]').forEach((b) => b.onclick = async (e) => { e.preventDefault(); e.stopPropagation(); if (await confirmDialog('Delete this book from your shelf? Its Notes page (if saved) stays.', { okLabel: 'Delete', danger: true })) { await bk.remove(b.dataset.del); renderHub(container); } });
  setContext({ title: 'Book explainer', text: 'Chapter-by-chapter book explanations.' });
}

async function start(container, title, author) {
  if (!title) { toast('Type a book title.', 'warn'); return; }
  const status = $('#bk-status', container);
  if (!(await ai.hasKey())) { mount(status, html`<div class="feedback bad small">Add your DeepSeek key in Settings first.</div>`); return; }
  const existing = await bk.get(bk.bookId(title, author));
  if (existing) { location.hash = `#/books/${encodeURIComponent(existing.id)}`; return; }
  mount(status, html`<div class="row"><span class="spinner"></span> Identifying the book and its chapters…</div>`);
  let meta;
  try { meta = await bk.identify(title, author); }
  catch (e) { mount(status, html`<div class="feedback bad small">${e.message === 'CAP_REACHED' ? 'Monthly AI cap reached.' : e.message}</div>`); return; }
  const dup = await bk.get(bk.bookId(meta.title, meta.author)); if (dup) { location.hash = `#/books/${encodeURIComponent(dup.id)}`; return; }
  const est = await bk.estimate(meta.chapters.length);
  mount(status, html`<div class="card compact"><strong>${meta.title}</strong> <span class="muted">by ${meta.author}${meta.year ? ', ' + meta.year : ''}</span><div class="small mt">${meta.one_line}</div>
    ${meta.confidence !== 'high' ? html`<div class="feedback close small mt">The tutor is only ${meta.confidence}-confident about this book${meta.note ? ': ' + meta.note : '.'} Details may be imprecise; check the chapter list below.</div>` : ''}
    <div class="chips mt" style="max-height:120px;overflow:auto">${meta.chapters.map((c) => html`<span class="chip">${c.n}. ${c.title}</span>`)}</div>
    <div class="row between mt"><span class="small">${meta.chapters.length} chapters · full explanation ≈ <strong>₹${est.inr.toFixed(2)}</strong> ($${est.usd.toFixed(3)})</span><div class="btn-row"><button class="btn" id="bk-cancel">Cancel</button><button class="btn btn-primary" id="bk-go">${icon('sparkle')} Explain the whole book</button></div></div></div>`);
  $('#bk-cancel', container).onclick = () => mount(status, '');
  $('#bk-go', container).onclick = async () => {
    mount(status, html`<div class="card compact"><div class="row"><span class="spinner"></span> <span id="bk-prog">Starting…</span></div><div class="mt" id="bk-bar">${progressBar(0)}</div><p class="xs muted mt mb-0">Keep this tab open. A 15-chapter book takes about two minutes.</p></div>`);
    try {
      const rec = await bk.explain(meta, { onProgress: (i, n, label) => { const p = $('#bk-prog', container); if (p) p.textContent = label; const b = $('#bk-bar', container); if (b) mount(b, progressBar((i / (n + 1)) * 100)); } });
      toast('Book explained', 'ok'); location.hash = `#/books/${encodeURIComponent(rec.id)}`;
    } catch (e) { mount(status, html`<div class="feedback bad small">${e.message === 'CAP_REACHED' ? 'Monthly AI cap reached (Settings).' : e.message}</div>`); }
  };
}

async function renderBook(container, id) {
  const rec = await bk.get(id);
  if (!rec) { mount(container, html`${backLink('#/books', 'Books')}<div class="empty">Not found</div>`); return; }
  const d = rec.data; const noteId = `nt:${rec.id}`; const hasNote = !!(await db.get('notes', noteId));
  const ideas = d.chapters.reduce((a, c) => a + c.key_ideas.length, 0);
  mount(container, html`
    ${backLink('#/books', 'Books')}
    <div class="book-hero compact"><div class="book-emoji" style="font-size:40px">📚</div><div class="grow"><h1 style="font-size:var(--fs-xl)">${rec.title}</h1><p class="mb-0">${d.author}${d.year ? ' · ' + d.year : ''}${d.genre ? ' · ' + d.genre : ''} · ${d.chapters.length} chapters · ${ideas} ideas · ${d.terms.length} terms${d.failed ? ` · ${d.failed} chapter(s) failed` : ''}</p></div></div>
    <div class="btn-row mb">
      <button class="btn btn-primary" id="save-note">${icon('note')} ${hasNote ? 'Update Notes page' : 'Save to Notes (own page)'}</button>${hasNote ? html`<a class="btn" href="#/notes/${noteId}">Open Notes page</a>` : ''}
      <button class="btn" id="ask">${icon('chat')} Ask about this book</button><button class="btn" id="read">${icon('speaker')} Read aloud</button><button class="btn" id="export">${icon('download')} Export .md</button><button class="btn btn-ghost" id="del">${icon('trash')}</button></div>
    <div class="chips scroll mb" id="toc"><a class="chip" href="#bk-overview">Overview</a>${d.chapters.map((c) => html`<a class="chip" href="#bk-ch-${c.n}">${c.n}. ${c.title.slice(0, 24)}</a>`)}<a class="chip" href="#bk-notes">Study notes</a><a class="chip" href="#bk-my">My notes</a></div>
    <div class="card book-card" id="bk-overview"><h2>Overview</h2><p style="font-size:var(--fs-lg)">${d.one_line}</p><p>${d.overview}</p>
      ${d.hi_overview ? html`<details class="hi-block" open><summary>हिन्दी में</summary><div class="hi-text" lang="hi">${d.hi_overview}</div></details>` : ''}
      ${d.gu_overview ? html`<details class="hi-block" open><summary>ગુજરાતીમાં</summary><div class="hi-text" lang="gu">${d.gu_overview}</div></details>` : ''}
      ${d.big_ideas.length ? html`<h3 class="mt">Big ideas</h3><ol class="owl-ideas">${d.big_ideas.map((b) => html`<li>${b}</li>`)}</ol>` : ''}
      ${d.confidence !== 'high' ? html`<div class="feedback close small mt">Confidence: ${d.confidence}. ${d.note}</div>` : ''}</div>
    ${d.chapters.map((c, ci) => html`<div class="card owl-chapter book-chapter" id="bk-ch-${c.n}" style="--owl-hue:${(250 + ci * 29) % 360}"><div class="row between"><h2>Chapter ${c.n}: ${c.title}</h2><button class="btn btn-sm" data-deep="${c.n}">${icon('sparkle')} Explain more${c.deepened ? ` (${c.deepened})` : ''}</button></div>
      ${c.failed ? html`<p class="small" style="color:var(--red)">This chapter could not be explained${c.error ? ': ' + c.error : ''}. Tap Explain more to retry.</p>` : html`<p style="font-size:var(--fs-md)">${c.summary}</p>`}
      ${c.key_ideas.map((k, ki) => html`<div class="owl-learning ${k.deeper ? 'deeper' : ''}"><h3>${ki + 1}. ${k.idea}</h3><p>${k.explanation}</p>${k.example ? html`<div class="owl-sub"><span class="owl-label">Example</span><div>${k.example}</div></div>` : ''}</div>`)}
      ${c.quotes.length ? c.quotes.map((q) => html`<blockquote class="owl-quote">“${q}”</blockquote>`) : ''}
      ${c.lesson ? html`<div class="feedback ok small mt"><strong>Lesson:</strong> ${c.lesson}</div>` : ''}
      ${c.hi_summary ? html`<details class="hi-block"><summary>हिन्दी सार</summary><div class="hi-text" lang="hi">${c.hi_summary}</div></details>` : ''}
      ${c.gu_summary ? html`<details class="hi-block"><summary>ગુજરાતી સાર</summary><div class="hi-text" lang="gu">${c.gu_summary}</div></details>` : ''}</div>`)}
    <div class="card book-notes" id="bk-notes"><h2>📝 Study notes</h2>
      ${d.quotes.length ? html`<h3>Memorable quotes</h3>${d.quotes.map((q) => html`<blockquote class="owl-quote">“${q}”</blockquote>`)}` : ''}
      ${d.actions.length ? html`<h3 class="mt">Action checklist</h3><div class="stack">${d.actions.map((a, i) => html`<label class="switch"><input type="checkbox" data-act="${i}" ${a.done ? 'checked' : ''}><span class="track"></span><span ${a.done ? 'style="text-decoration:line-through;opacity:.6"' : ''}>${a.text}</span></label>`)}</div>` : ''}
      ${d.apply_en ? html`<h3 class="mt">How to apply it</h3><p>${d.apply_en}</p>` : ''}
      ${d.critique ? html`<h3 class="mt">Limits and criticism</h3><p>${d.critique}</p>` : ''}
      ${d.similar.length ? html`<h3 class="mt">Read next</h3><ul>${d.similar.map((s) => html`<li>${s}</li>`)}</ul>` : ''}
      ${d.terms.length ? html`<h3 class="mt">Glossary</h3><div class="scroll-x"><table class="tbl"><thead><tr><th>Term</th><th>English</th><th>हिन्दी</th><th>ગુજરાતી</th><th></th></tr></thead><tbody>${d.terms.map((t, i) => html`<tr><td><strong>${t.term}</strong> ${speakButton(t.term)}</td><td>${t.en}</td><td class="hi-text" lang="hi">${t.hi}</td><td class="hi-text" lang="gu">${t.gu}</td><td><button class="btn btn-sm btn-ghost" data-fav="${i}" aria-label="Add to my vocabulary list">❤</button></td></tr>`)}</tbody></table></div>` : ''}
      ${d.revision_plan ? html`<div class="feedback ok small mt">${icon('info')} ${d.revision_plan}</div>` : ''}</div>
    <div class="card book-card" id="bk-my"><h2>My notes</h2><p class="xs muted">Saved automatically and included in the Notes page.</p><textarea class="textarea" id="my-notes" rows="6" placeholder="Which idea will you try this week?">${d.myNotes || ''}</textarea></div>`);
  $('#save-note', container).onclick = async () => { await bk.saveToNotes(rec); toast('Saved as its own page in Notes', 'ok'); renderBook(container, id); };
  $('#export', container).onclick = () => download(`${rec.title.replace(/[^\w]+/g, '-').slice(0, 50)}.md`, bk.toMarkdown(rec), 'text/markdown');
  $('#del', container).onclick = async () => { if (await confirmDialog('Delete this book from your shelf?', { okLabel: 'Delete', danger: true })) { await bk.remove(id); location.hash = '#/books'; } };
  $('#ask', container).onclick = async () => { const mod = await import('./chat.js'); const body = openSheet('<div class="chat-sheet"></div>', { wide: true }); await mod.mountChat(body.querySelector('.chat-sheet'), { embedded: true, context: { title: rec.title, text: `The book "${rec.title}" by ${d.author}. ${d.overview} Big ideas: ${d.big_ideas.join(' | ')}. Chapters: ${d.chapters.map((c) => c.n + '. ' + c.title + ': ' + c.lesson).join(' || ').slice(0, 3000)}` } }); };
  let reading = false;
  $('#read', container).onclick = async (e) => { const b = e.currentTarget; if (reading) { reading = false; tts.stop(); b.innerHTML = String(html`${icon('speaker')} Read aloud`); return; } reading = true; b.innerHTML = String(html`${icon('stop')} Stop`); const parts = [d.overview, ...d.chapters.flatMap((c) => [`Chapter ${c.n}. ${c.title}`, c.summary, ...c.key_ideas.flatMap((k) => [k.idea, k.explanation])])].filter(Boolean); for (const p of parts) { if (!reading) break; const ok = await tts.speak(p); if (!ok) break; } reading = false; b.innerHTML = String(html`${icon('speaker')} Read aloud`); };
  container.querySelectorAll('[data-act]').forEach((cb) => cb.onchange = async () => { d.actions[+cb.dataset.act].done = cb.checked; await bk.save(rec); });
  container.querySelectorAll('[data-deep]').forEach((b) => b.onclick = async () => { if (!(await ai.hasKey())) { toast('Add your DeepSeek key in Settings.', 'warn'); return; } b.disabled = true; b.innerHTML = '<span class="spinner"></span>'; try { const n = await bk.deepen(rec, +b.dataset.deep); toast(`${n} more points added`, 'ok'); renderBook(container, id); } catch (e) { toast(e.message === 'CAP_REACHED' ? 'Monthly AI cap reached.' : e.message, 'err'); b.disabled = false; b.textContent = 'Explain more'; } });
  container.querySelectorAll('[data-fav]').forEach((b) => b.onclick = async () => { const t = d.terms[+b.dataset.fav]; const mv = await import('../myvocab.js'); const added = await mv.toggle({ key: `term:${t.term.toLowerCase()}`, word: t.term, en: t.en, hi: t.hi, gu: t.gu, ipa: '', source: { title: rec.title, href: `#/books/${encodeURIComponent(id)}` } }); b.style.color = added ? 'var(--red)' : ''; toast(added ? 'Added to your vocabulary list' : 'Removed', 'ok', { timeout: 1500 }); });
  (async () => { const mv = await import('../myvocab.js'); const keys = new Set((await mv.list()).map((x) => x.key)); container.querySelectorAll('[data-fav]').forEach((b) => { if (keys.has(`term:${d.terms[+b.dataset.fav].term.toLowerCase()}`)) b.style.color = 'var(--red)'; }); })();
  $('#my-notes', container).oninput = debounce(async (e) => { d.myNotes = e.target.value; await bk.save(rec); if (await db.get('notes', noteId)) await bk.saveToNotes(rec); }, 600);
  container.querySelectorAll('#toc a').forEach((a) => a.onclick = (e) => { e.preventDefault(); const el = document.querySelector(a.getAttribute('href')); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  setContext({ title: `Book: ${rec.title}`, text: `${d.overview} Big ideas: ${d.big_ideas.join(' | ')}`.slice(0, 1500) });
  return () => tts.stop();
}
