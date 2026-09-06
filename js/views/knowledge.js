// knowledge.js (view) — 🦉 Get Fast Knowledge: paste a long video, get every learning explained, with Hindi and Gujarati.
import { html, mount, icon, toast, confirmDialog, openSheet, backLink, speakButton, progressBar, $ } from '../ui.js';
import { hiBlock } from '../i18n.js';
import * as db from '../db.js';
import * as store from '../store.js';
import * as ai from '../ai.js';
import * as yt from '../youtube.js';
import * as kn from '../knowledge.js';
import * as tts from '../tts.js';
import { setContext } from '../router.js';
import { fmtDate, download, debounce, readFileText, mdLite, escapeHtml } from '../utils.js';

export async function render(container, params) {
  if (params.id) return renderGuide(container, decodeURIComponent(params.id));
  return renderHub(container);
}

async function renderHub(container) {
  const guides = await kn.list();
  const key = await ai.hasKey();
  const inr = await db.getSetting('inrRate', 84);
  mount(container, html`
    <div class="owl-hero"><div class="owl-emoji">🦉</div><div><h1>Get Fast Knowledge</h1><p>Paste a podcast, lecture or any long video. The tutor reads the <strong>entire</strong> transcript in parts and writes out every learning: full explanations, examples, quotes, action steps, and a glossary in English, हिन्दी and ગુજરાતી. Nothing is skipped, and every guide is kept here so you never pay for the same video twice.</p></div></div>
    <div class="card owl-card">
      <form id="kn-form" autocomplete="off"><div class="row"><input class="input" id="kn-url" placeholder="Paste a YouTube link (podcasts, talks, courses…)" inputmode="url" autocapitalize="off" style="flex:1;min-width:220px"><button class="btn btn-primary btn-lg" type="submit">${icon('sparkle')} Analyse</button></div></form>
      <details class="mt"><summary class="small muted" style="cursor:pointer">No link? Paste the transcript or drop a file</summary><textarea class="textarea mt" id="kn-paste" rows="5" placeholder="Paste transcript or any long text…"></textarea><div class="row mt"><input class="input" id="kn-title" placeholder="Title" style="flex:1"><label class="btn" for="kn-file">${icon('upload')} File</label><input type="file" id="kn-file" accept=".txt,.srt,.vtt,.md,text/plain" hidden><button class="btn btn-primary" id="kn-text">Analyse text</button></div></details>
      ${key ? '' : html`<p class="xs mt mb-0" style="color:var(--amber)">Add your DeepSeek key in Settings to use this section.</p>`}
      <div id="kn-status" class="mt"></div>
    </div>
    ${guides.length ? html`<h3 class="mt-lg">Your library <span class="badge muted">${guides.length}</span></h3><div class="grid">${guides.map((g) => html`<a class="card owl-item" href="#/knowledge/${encodeURIComponent(g.refId)}" style="margin:0">${g.data.thumb ? html`<img src="${g.data.thumb}" alt="" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;margin-bottom:8px">` : ''}<strong>${g.title}</strong><div class="xs muted mt">${g.data.channel ? g.data.channel + ' · ' : ''}${g.data.chapters.length} chapters · ${g.data.chapters.reduce((a, c) => a + c.learnings.length, 0)} learnings · ${fmtDate(g.ts)}</div></a>`)}</div>` : html`<div class="empty">${icon('book')}<p>Your first guide will appear here. Try a TED talk or a podcast episode you already like.</p></div>`}`);
  $('#kn-form', container).onsubmit = (e) => { e.preventDefault(); startFromUrl(container, $('#kn-url', container).value); };
  $('#kn-file', container).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; $('#kn-paste', container).value = await readFileText(f); $('#kn-title', container).value ||= f.name.replace(/\.[^.]+$/, ''); };
  $('#kn-text', container).onclick = () => { const t = $('#kn-paste', container).value.trim(); if (t.split(/\s+/).length < 80) { toast('Paste at least a few paragraphs.', 'warn'); return; } const segs = yt.parseCaptions(t); const st = yt.segmentsToText(segs); run(container, { videoId: `text:${Math.abs(hash(t)).toString(36)}`, title: $('#kn-title', container).value.trim() || 'Pasted text', channel: '', thumb: '', url: '', duration: 0, transcript: st.text, segments: st.timed ? segs : null }); };
  setContext({ title: 'Get Fast Knowledge', text: 'Exhaustive study guides from long videos.' });
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

async function startFromUrl(container, input) {
  const id = yt.parseVideoId(input);
  if (!id) { toast('That does not look like a YouTube link.', 'warn'); return; }
  const existing = await kn.get(id);
  if (existing) { location.hash = `#/knowledge/${id}`; return; }
  const status = $('#kn-status', container);
  mount(status, html`<div class="row"><span class="spinner"></span> Fetching the video and its transcript through your worker… (up to a minute for long videos)</div>`);
  const meta = await yt.fetchMeta(id);
  try {
    const t = await yt.fetchTranscript(id);
    const st = yt.segmentsToText(t.segments);
    const duration = st.timed ? Math.max(...t.segments.map((s) => (s.t || 0) + (s.d || 0))) : 0;
    await run(container, { videoId: id, title: meta.title || t.title || id, channel: meta.channel || t.channel || '', thumb: meta.thumb, url: yt.watchUrl(id), duration, transcript: st.text, segments: st.timed ? t.segments : null });
  } catch (e) {
    mount(status, html`<div class="feedback close small">${e.code === 'NO_CAPTIONS' ? 'This video has no captions.' : e.message} Paste the transcript instead: open the video → …more → Show transcript → copy.</div><textarea class="textarea mt" id="kn-fb" rows="5" placeholder="Paste the transcript…"></textarea><div class="btn-row mt"><button class="btn btn-primary" id="kn-fb-go">Analyse pasted transcript</button></div>`);
    $('#kn-fb-go', container).onclick = () => { const raw = $('#kn-fb', container).value.trim(); if (!raw) return; const segs = yt.parseCaptions(raw); const st = yt.segmentsToText(segs); run(container, { videoId: id, title: meta.title || id, channel: meta.channel, thumb: meta.thumb, url: yt.watchUrl(id), duration: 0, transcript: st.text, segments: st.timed ? segs : null }); };
  }
}

async function run(container, video) {
  const status = $('#kn-status', container);
  if (!(await ai.hasKey())) { mount(status, html`<div class="feedback bad small">Add your DeepSeek key in Settings first.</div>`); return; }
  const est = await kn.estimate(video.transcript);
  const words = video.transcript.split(/\s+/).length;
  const ok = await confirmDialog(`"${video.title}" has about ${words.toLocaleString()} words (${est.chunks} part${est.chunks > 1 ? 's' : ''}). Full analysis ≈ ₹${est.inr.toFixed(2)} ($${est.usd.toFixed(3)}). The guide is saved forever, so this is paid once. Go ahead?`, { okLabel: 'Analyse' });
  if (!ok) { mount(status, ''); return; }
  mount(status, html`<div class="card compact"><div class="row"><span class="spinner"></span> <span id="kn-prog">Starting…</span></div><div class="mt" id="kn-bar">${progressBar(0)}</div><p class="xs muted mt mb-0">Keep this tab open. A 2-hour podcast takes a few minutes.</p></div>`);
  try {
    const rec = await kn.analyse(video, { onProgress: (i, n, label) => { const p = $('#kn-prog', container); if (p) p.textContent = label; const b = $('#kn-bar', container); if (b) mount(b, progressBar((i / (n + 1)) * 100)); } });
    toast('Guide ready', 'ok');
    location.hash = `#/knowledge/${encodeURIComponent(video.videoId)}`;
  } catch (e) {
    mount(status, html`<div class="feedback bad small">${e.message === 'CAP_REACHED' ? 'Monthly AI spend cap reached (raise it in Settings).' : e.message === 'NO_KEY' ? 'No DeepSeek key.' : e.message}</div>`);
  }
}

async function renderGuide(container, videoId) {
  const rec = await kn.get(videoId);
  if (!rec) { mount(container, html`${backLink('#/knowledge', 'Get Fast Knowledge')}<div class="empty">Not found</div>`); return; }
  const d = rec.data;
  const noteId = `nt:kn:${videoId}`;
  const hasNote = !!(await db.get('notes', noteId));
  const total = d.chapters.reduce((a, c) => a + c.learnings.length, 0);
  mount(container, html`
    ${backLink('#/knowledge', 'Get Fast Knowledge')}
    <div class="owl-hero compact"><div class="owl-emoji" style="font-size:40px">🦉</div><div class="grow"><h1 style="font-size:var(--fs-xl)">${rec.title}</h1><p class="mb-0">${d.channel ? d.channel + ' · ' : ''}${d.duration ? kn.fmt(d.duration) + ' · ' : ''}${d.words.toLocaleString()} words · ${d.chapters.length} chapters · ${total} learnings · ${d.terms.length} terms · analysed ${fmtDate(rec.ts)}${d.failed ? ` · ${d.failed} part(s) failed` : ''}</p></div></div>
    <div class="btn-row mb">
      <button class="btn btn-primary" id="save-note">${icon('note')} ${hasNote ? 'Update Notes page' : 'Save to Notes (own page)'}</button>
      ${hasNote ? html`<a class="btn" href="#/notes/${noteId}">Open Notes page</a>` : ''}
      <button class="btn" id="ask">${icon('chat')} Ask about this video</button>
      <button class="btn" id="read">${icon('speaker')} Read aloud</button>
      <button class="btn" id="export">${icon('download')} Export .md</button>
      ${d.url ? html`<a class="btn" href="${d.url}" target="_blank" rel="noopener">${icon('play')} YouTube</a>` : ''}
      <button class="btn btn-ghost" id="reanalyse">${icon('refresh')} Re-analyse</button>
      <button class="btn btn-ghost" id="del">${icon('trash')}</button>
    </div>
    <div class="chips scroll mb" id="toc"><a class="chip" href="#kn-overview">Overview</a>${d.chapters.map((c) => html`<a class="chip" href="#kn-ch-${c.index}">${c.index + 1}. ${c.title.slice(0, 28)}</a>`)}<a class="chip" href="#kn-glossary">Glossary</a><a class="chip" href="#kn-actions">Actions</a><a class="chip" href="#kn-notes">My notes</a></div>
    <div class="card owl-card" id="kn-overview"><h2>Overview</h2><p style="font-size:var(--fs-lg)">${d.overview}</p>${d.who_for ? html`<p class="small muted">${d.who_for}</p>` : ''}
      ${d.hi_overview ? html`<details class="hi-block" open><summary>हिन्दी में</summary><div class="hi-text" lang="hi">${d.hi_overview}</div></details>` : ''}
      ${d.gu_overview ? html`<details class="hi-block" open><summary>ગુજરાતીમાં</summary><div class="hi-text" lang="gu">${d.gu_overview}</div></details>` : ''}
      ${d.big_ideas.length ? html`<h3 class="mt">Big ideas</h3><ol class="owl-ideas">${d.big_ideas.map((b) => html`<li>${b}</li>`)}</ol>` : ''}
      ${d.study_tip ? html`<div class="feedback ok small mt">${icon('info')} ${d.study_tip}</div>` : ''}</div>
    ${d.chapters.map((c, ci) => html`<div class="card owl-chapter" id="kn-ch-${c.index}" style="--owl-hue:${(ci * 47) % 360}"><div class="row between"><h2>${c.index + 1}. ${c.title}</h2>${c.t != null && d.url ? html`<a class="chip" href="${yt.watchUrl(videoId, c.t)}" target="_blank" rel="noopener">${icon('play')} ${kn.fmt(c.t)}</a>` : ''}</div>
      ${c.failed ? html`<p class="small" style="color:var(--red)">This part could not be analysed. Use Re-analyse.</p>` : ''}
      ${c.learnings.map((l, li) => html`<div class="owl-learning"><h3>${li + 1}. ${l.title}</h3><p>${l.explanation}</p>
        ${l.examples.length ? html`<div class="owl-sub"><span class="owl-label">Examples</span><ul>${l.examples.map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
        ${l.steps.length ? html`<div class="owl-sub"><span class="owl-label">Steps</span><ol>${l.steps.map((s) => html`<li>${s}</li>`)}</ol></div>` : ''}
        ${l.quote ? html`<blockquote class="owl-quote">“${l.quote}”</blockquote>` : ''}</div>`)}
      ${c.hi_summary ? html`<details class="hi-block"><summary>हिन्दी सार</summary><div class="hi-text" lang="hi">${c.hi_summary}</div></details>` : ''}
      ${c.gu_summary ? html`<details class="hi-block"><summary>ગુજરાતી સાર</summary><div class="hi-text" lang="gu">${c.gu_summary}</div></details>` : ''}</div>`)}
    ${d.terms.length ? html`<div class="card" id="kn-glossary"><h2>Glossary</h2><p class="xs muted">English · हिन्दी · ગુજરાતી. Tap ❤ to add a term to your vocabulary list.</p><div class="scroll-x"><table class="tbl"><thead><tr><th>Term</th><th>English</th><th>हिन्दी</th><th>ગુજરાતી</th><th></th></tr></thead><tbody>${d.terms.map((t, i) => html`<tr><td><strong>${t.term}</strong> ${speakButton(t.term)}</td><td>${t.en}</td><td class="hi-text" lang="hi">${t.hi}</td><td class="hi-text" lang="gu">${t.gu}</td><td><button class="btn btn-sm btn-ghost" data-fav="${i}" aria-label="Add to my vocabulary list">❤</button><a class="btn btn-sm btn-ghost" href="https://www.google.com/search?q=${encodeURIComponent('define ' + t.term)}" target="_blank" rel="noopener" aria-label="Google">G</a></td></tr>`)}</tbody></table></div></div>` : ''}
    ${d.actions.length ? html`<div class="card" id="kn-actions"><h2>Action checklist</h2><div class="stack">${d.actions.map((a, i) => html`<label class="switch"><input type="checkbox" data-act="${i}" ${a.done ? 'checked' : ''}><span class="track"></span><span ${a.done ? 'style="text-decoration:line-through;opacity:.6"' : ''}>${a.text}</span></label>`)}</div></div>` : ''}
    <div class="card owl-card" id="kn-notes"><h2>My notes</h2><p class="xs muted">Your own thoughts on this video. Saved automatically and included in the Notes page.</p><textarea class="textarea" id="my-notes" rows="6" placeholder="What will you do differently? What surprised you?">${d.myNotes || ''}</textarea></div>`);
  $('#save-note', container).onclick = async () => { await kn.saveToNotes(rec); toast('Saved as its own page in Notes', 'ok'); renderGuide(container, videoId); };
  $('#export', container).onclick = () => download(`${rec.title.replace(/[^\w]+/g, '-').slice(0, 50)}.md`, kn.toMarkdown(rec), 'text/markdown');
  $('#del', container).onclick = async () => { if (await confirmDialog('Delete this guide? (You would pay again to re-analyse.)', { okLabel: 'Delete', danger: true })) { await kn.remove(videoId); location.hash = '#/knowledge'; } };
  $('#reanalyse', container).onclick = async () => { const v = await db.get('videos', videoId); if (!v && !d.url) { toast('Re-analyse needs the transcript; paste it again on the main screen.', 'warn'); return; } if (await confirmDialog('Run the full analysis again? This costs tokens again.', { okLabel: 'Re-analyse' })) { await kn.remove(videoId); location.hash = '#/knowledge'; setTimeout(() => { const u = document.getElementById('kn-url'); if (u) { u.value = d.url || ''; document.getElementById('kn-form').requestSubmit(); } }, 600); } };
  $('#ask', container).onclick = async () => { const mod = await import('./chat.js'); const body = openSheet('<div class="chat-sheet"></div>', { wide: true }); await mod.mountChat(body.querySelector('.chat-sheet'), { embedded: true, context: { title: rec.title, text: `Study guide of the video "${rec.title}". Overview: ${d.overview} Big ideas: ${d.big_ideas.join(' | ')}. Chapters: ${d.chapters.map((c) => c.title + ': ' + c.learnings.map((l) => l.title).join('; ')).join(' || ').slice(0, 3000)}` } }); };
  let reading = false;
  $('#read', container).onclick = async (e) => { const b = e.currentTarget; if (reading) { reading = false; tts.stop(); b.innerHTML = String(html`${icon('speaker')} Read aloud`); return; } reading = true; b.innerHTML = String(html`${icon('stop')} Stop`); const parts = [d.overview, ...d.chapters.flatMap((c) => [c.title, ...c.learnings.flatMap((l) => [l.title, l.explanation])])].filter(Boolean); for (const p of parts) { if (!reading) break; const ok = await tts.speak(p); if (!ok) break; } reading = false; b.innerHTML = String(html`${icon('speaker')} Read aloud`); };
  container.querySelectorAll('[data-act]').forEach((cb) => cb.onchange = async () => { d.actions[+cb.dataset.act].done = cb.checked; await kn.save(rec); });
  container.querySelectorAll('[data-fav]').forEach((b) => b.onclick = async () => { const t = d.terms[+b.dataset.fav]; const mv = await import('../myvocab.js'); const added = await mv.toggle({ key: `term:${t.term.toLowerCase()}`, word: t.term, en: t.en, hi: t.hi, gu: t.gu, ipa: '', source: { title: rec.title, href: `#/knowledge/${encodeURIComponent(videoId)}` } }); b.style.color = added ? 'var(--red)' : ''; toast(added ? 'Added to your vocabulary list' : 'Removed from your list', 'ok', { timeout: 1500 }); });
  (async () => { const mv = await import('../myvocab.js'); const l = await mv.list(); const keys = new Set(l.map((x) => x.key)); container.querySelectorAll('[data-fav]').forEach((b) => { if (keys.has(`term:${d.terms[+b.dataset.fav].term.toLowerCase()}`)) b.style.color = 'var(--red)'; }); })();
  $('#my-notes', container).oninput = debounce(async (e) => { d.myNotes = e.target.value; await kn.save(rec); if (await db.get('notes', noteId)) await kn.saveToNotes(rec); }, 600);
  container.querySelectorAll('#toc a').forEach((a) => a.onclick = (e) => { e.preventDefault(); const el = document.querySelector(a.getAttribute('href')); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  setContext({ title: `Video guide: ${rec.title}`, text: `${d.overview} Big ideas: ${d.big_ideas.join(' | ')}`.slice(0, 1500) });
  return () => tts.stop();
}
