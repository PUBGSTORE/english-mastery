// writing.js — writing studio: templates, prompts, AI rubric with inline diff, corrections → SRS.
import { html, mount, icon, toast, backLink, confirmDialog, $ } from '../ui.js';
import { hi, hiBlock } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as ai from '../ai.js';
import * as db from '../db.js';
import { setContext } from '../router.js';
import { wordDiffHtml, countWords, fmtDate, uid, nowISO, hashStr } from '../utils.js';

export async function render(container, params) {
  if (params.id) return renderEditor(container, params.id);
  return renderList(container);
}

async function renderList(container) {
  const data = await content.writingPrompts();
  const drafts = (await store.allNotes()).filter((n) => (n.tags || []).includes('writing'));
  const attempts = (await store.attemptsByKind('writing')).filter((a) => a.extra?.mode !== 'production');
  const s = await store.settings();
  mount(container, html`
    <div class="page-head"><div><h1>Writing studio</h1><p class="sub">Write it, get a rubric and a corrected version. Every correction becomes a card.</p></div></div>
    <h3>Templates</h3>
    <div class="grid">${data.templates.map((t) => html`<a class="card compact" href="#/write/${t.id}"><div class="row between"><strong>${t.name}</strong><span class="chip">${t.register}</span></div><div class="xs muted mt">${t.skeleton.split('\n').filter(Boolean).slice(0, 2).join(' · ')}</div></a>`)}</div>
    <h3 class="mt-lg">Prompts</h3>
    <div class="list">${data.prompts.map((p) => { const t = data.templates.find((x) => x.id === p.template); return html`<a class="list-item" href="#/write/${p.id}"><div class="grow"><div class="title">${t ? t.name : p.template} <span class="chip" style="min-height:22px">${p.cefr}</span></div><div class="sub">${p.task_en.slice(0, 110)}${p.task_en.length > 110 ? '…' : ''}</div></div>${icon('next', 'arrow')}</a>`; })}</div>
    ${attempts.length ? html`<h3 class="mt-lg">Recent scores</h3><div class="list">${attempts.slice(-8).reverse().map((a) => html`<div class="list-item"><div class="grow"><div class="sub">${fmtDate(a.ts)} · ${a.refId}</div></div><span class="chip ${a.accuracy >= 70 ? 'green' : 'amber'}">${a.accuracy}%</span></div>`)}</div>` : ''}`);
  setContext({ title: 'Writing studio', text: 'Writing practice: emails, bug reports, Slack messages, essays.' });
}

async function renderEditor(container, id) {
  const data = await content.writingPrompts();
  const prompt = data.prompts.find((p) => p.id === id);
  const template = data.templates.find((t) => t.id === (prompt ? prompt.template : id));
  if (!template) { mount(container, html`${backLink('#/write')}<div class="empty">Not found</div>`); return; }
  const key = await ai.hasKey();
  const s = await store.settings();
  const draftKey = `draft:${id}`;
  const saved = await db.getSetting(draftKey, '');
  const task = prompt ? prompt.task_en : `Write a ${template.name.toLowerCase()} of your own choice.`;
  mount(container, html`
    ${backLink('#/write', 'Writing studio')}
    <div class="page-head"><div><span class="chip">${template.name} · ${template.register}${prompt ? ` · ${prompt.cefr}` : ''}</span><h1 style="margin-top:8px">${prompt ? 'Task' : template.name}</h1></div></div>
    <div class="card"><p style="font-size:var(--fs-lg)">${task}</p>${prompt ? hiBlock(prompt.task_hi) : ''}
      ${prompt && prompt.focus ? html`<div class="chips">${prompt.focus.map((f) => html`<span class="chip">${f}</span>`)}</div>` : ''}
      <details class="mt"><summary class="small muted" style="cursor:pointer">Tips for this format</summary><div class="small mt" style="white-space:pre-wrap">${template.tips_en}</div>${hiBlock(template.tips_hi, 'हिन्दी में सुझाव')}</details>
      ${template.model_en ? html`<details class="mt"><summary class="small muted" style="cursor:pointer">Model answer (read after you write)</summary><div class="small mt" style="white-space:pre-wrap">${template.model_en}</div></details>` : ''}
    </div>
    <div class="card"><div class="row between mb"><label for="text" class="bold">Your text</label><span class="xs muted"><span id="wc">0</span> words${prompt ? ` · aim for ${prompt.min_words}+` : ''}</span></div>
      <textarea class="textarea" id="text" rows="12" placeholder="${template.skeleton}" style="min-height:260px;font-family:var(--font)">${saved}</textarea>
      <div class="btn-row mt"><button class="btn btn-primary" id="grade">${key ? html`${icon('sparkle')} Grade my writing` : 'Add API key in Settings to grade'}</button><button class="btn" id="skeleton">Insert template</button><button class="btn btn-ghost" id="save">Save draft</button></div>
      <div id="result" class="mt"></div></div>`);
  const ta = $('#text', container);
  const wc = () => { $('#wc', container).textContent = countWords(ta.value); };
  wc(); ta.oninput = wc;
  $('#skeleton', container).onclick = () => { if (!ta.value.trim() || confirm('Replace your text with the template?')) { ta.value = template.skeleton; wc(); ta.focus(); } };
  $('#save', container).onclick = async () => { await db.setSetting(draftKey, ta.value); toast('Draft saved', 'ok'); };
  $('#grade', container).onclick = async (e) => {
    const text = ta.value.trim(); if (!text) return;
    if (!key) { location.hash = '#/settings'; return; }
    const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Grading…';
    await db.setSetting(draftKey, text);
    try {
      const r = await ai.gradeWriting(task, template.register, text, s.level);
      const sc = r.scores || {};
      const overall = Math.round((['grammar', 'vocabulary', 'coherence', 'register', 'naturalness'].reduce((a, k) => a + (sc[k] || 0), 0) / 5) * 10);
      let added = 0;
      for (const c of r.changes || []) {
        if (c.from && c.to && c.from !== c.to) {
          await store.logMistake({ source: 'writing', refId: id, original: c.from, fix: c.to, rule: c.rule || 'writing', why_en: c.why_en, why_hi: c.why_hi, makeCard: false });
          await store.ensureCard({ id: `card:corr:${hashStr(c.from + c.to)}`, refId: id, deck: 'corrections', kind: 'correction', payload: { from: c.from, to: c.to, why_en: c.why_en, why_hi: c.why_hi, rule: c.rule }, priority: 1 });
          added++;
        }
      }
      await store.logAttempt({ kind: 'writing', refId: id, accuracy: overall, extra: { scores: sc, words: countWords(text) } });
      mount($('#result', container), html`
        <div class="rubric">${['grammar', 'vocabulary', 'coherence', 'register', 'naturalness'].map((k) => html`<div class="stat"><div class="label">${k}</div><div class="value">${sc[k] ?? '–'}<small>/10</small></div></div>`)}</div>
        ${r.strengths_en ? html`<div class="feedback ok mt small"><strong>Strengths:</strong> ${r.strengths_en}</div>` : ''}
        ${r.advice_en ? html`<div class="feedback close mt small"><strong>Work on:</strong> ${r.advice_en}<div>${hi(r.advice_hi)}</div></div>` : ''}
        <div class="section-label">Corrected version (changes highlighted)</div>
        <div class="card compact diff" style="white-space:pre-wrap;line-height:1.7">${{ toString: () => wordDiffHtml(text, r.corrected || text) }}</div>
        <div class="btn-row"><button class="btn btn-sm" id="copy">Use corrected text</button><button class="btn btn-sm" data-speak="${(r.corrected || '').slice(0, 600)}">${icon('speaker')} Listen</button></div>
        ${(r.changes || []).length ? html`<div class="section-label">Why (${added} added to reviews)</div>${r.changes.map((c) => html`<div class="card compact" style="margin-bottom:6px"><div><span style="color:var(--red);text-decoration:line-through">${c.from}</span> → <span style="color:var(--green);font-weight:600">${c.to}</span> <span class="chip" style="min-height:20px;padding:0 6px">${c.rule || ''}</span></div><div class="small mt">${c.why_en}</div><div class="small">${hi(c.why_hi)}</div></div>`)}` : ''}`);
      $('#copy', container).onclick = () => { ta.value = r.corrected || ta.value; wc(); };
      b.innerHTML = 'Graded — edit and grade again';
      b.disabled = false;
    } catch (err) { toast(err.message === 'NO_KEY' ? 'Add your DeepSeek key in Settings.' : err.message, 'err', { timeout: 7000 }); b.disabled = false; b.innerHTML = 'Grade my writing'; }
  };
  setContext({ title: `Writing: ${template.name}`, text: `${task} Register: ${template.register}. My draft so far: ${saved.slice(0, 400)}` });
}
