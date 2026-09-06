// translate.js — Hindi → English production drill. Reference comparison offline, AI grading when a key is set.
import { html, mount, icon, toast, speakButton, $ } from '../ui.js';
import { hi } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as ai from '../ai.js';
import { setContext } from '../router.js';
import { cefrIndex, CEFR, shuffle, sentenceMatch, wordDiffHtml, avg } from '../utils.js';

export async function render(container) {
  const s = await store.settings();
  const key = await ai.hasKey();
  const all = await content.allVocab();
  const lessons = await content.grammarSorted();
  let lvl = s.level;
  let pool = []; let i = 0; let correct = 0; let total = 0;
  const buildPool = () => {
    const li = cefrIndex(lvl);
    const items = [];
    for (const w of all) {
      if (Math.abs(cefrIndex(w.cefr) - li) > 1) continue;
      for (const ex of (w.examples || []).slice(0, 3)) if (ex.hi && ex.en && ex.en.split(' ').length <= 16) items.push({ hi: ex.hi, en: ex.en, word: w.word, refId: w.id, src: 'vocab' });
    }
    for (const l of lessons) {
      if (Math.abs(cefrIndex(l.cefr) - li) > 1) continue;
      for (const ex of (l.examples || []).slice(0, 4)) if (ex.hi && ex.en) items.push({ hi: ex.hi, en: ex.en, word: l.title, refId: l.id, src: 'grammar' });
    }
    pool = shuffle(items); i = 0;
  };
  buildPool();
  const history = (await store.attemptsByKind('translate')).slice(-30);
  const draw = () => {
    const it = pool[i % pool.length];
    mount(container, html`
      <div class="page-head"><div><h1>Translate</h1><p class="sub">Say it in English. ${key ? 'The tutor accepts any natural version, not only the reference.' : 'Add an API key in Settings and the tutor will grade alternatives; for now your answer is compared to the reference.'}</p></div></div>
      <div class="row between mb"><div class="chips">${CEFR.map((l) => html`<button class="chip ${l === lvl ? 'active' : ''}" data-l="${l}">${l}</button>`)}</div><span class="xs muted">${total ? `${correct}/${total} this session` : history.length ? `recent avg ${Math.round(avg(history.map((a) => a.accuracy || 0)))}%` : ''}</span></div>
      <div class="card">
        <div class="hi-text" lang="hi" style="font-size:var(--fs-xl);line-height:1.7">${it.hi}</div>
        <div class="xs muted mt">${it.src === 'vocab' ? html`uses <strong>${it.word}</strong>` : html`grammar: ${it.word}`}</div>
        <form id="f" class="mt" autocomplete="off"><textarea class="textarea" id="in" rows="2" placeholder="Type the English sentence" autocapitalize="sentences" style="min-height:70px"></textarea>
          <div class="btn-row mt"><button class="btn btn-primary" type="submit">${key ? html`${icon('sparkle')} Check` : 'Check'}</button><button class="btn btn-ghost" type="button" id="skip">Skip</button></div></form>
        <div id="fb" class="mt"></div></div>`);
    container.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => { lvl = b.dataset.l; buildPool(); draw(); });
    const ta = $('#in', container);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#f', container).requestSubmit(); } });
    if (window.matchMedia('(min-width: 768px)').matches) setTimeout(() => ta.focus(), 80);
    $('#skip', container).onclick = () => { i++; draw(); };
    $('#f', container).onsubmit = async (e) => {
      e.preventDefault(); const typed = ta.value.trim(); if (!typed) return;
      ta.disabled = true; const btn = e.target.querySelector('[type="submit"]'); btn.disabled = true;
      const local = sentenceMatch(typed, [it.en]);
      let result = null;
      if (key) {
        btn.innerHTML = '<span class="spinner"></span>';
        try { result = await ai.gradeTranslation(it.hi, it.en, typed, lvl); } catch (err) { toast(err.message === 'NO_KEY' ? 'Add your DeepSeek key in Settings.' : err.message, 'err'); }
      }
      const ok = result ? !!result.ok : local.status !== 'wrong';
      const score = result ? Math.round((result.score || 0) * 10) : local.status === 'exact' ? 100 : local.status === 'close' ? 80 : 30;
      total++; if (ok) correct++;
      mount($('#fb', container), html`<div class="feedback ${ok ? 'ok' : score >= 50 ? 'close' : 'bad'}">
        <div class="bold">${ok ? 'Accepted' : 'Needs a fix'}${result ? ` · ${result.score}/10` : ''}</div>
        ${result && result.corrected && result.corrected !== typed ? html`<div class="diff mt">${{ toString: () => wordDiffHtml(typed, result.corrected) }}</div>` : ''}
        ${result ? html`<div class="small mt">${result.why_en}</div><div class="small">${hi(result.why_hi)}</div>` : ''}
        <div class="small mt muted">Reference: “${it.en}” ${speakButton(it.en)}</div>
        <div class="btn-row mt"><button class="btn btn-primary" id="next">Next ${icon('next')}</button>${it.src === 'vocab' ? html`<a class="btn btn-ghost" href="#/word/${it.refId}">${it.word}</a>` : html`<a class="btn btn-ghost" href="#/grammar/${it.refId}">Lesson</a>`}</div></div>`);
      await store.logAttempt({ kind: 'translate', refId: it.refId, accuracy: score, transcript: typed, extra: { reference: it.en } });
      if (!ok) {
        const fix = (result && result.corrected) || it.en;
        await store.logMistake({ source: 'writing', refId: it.refId, original: typed, fix, rule: (result && result.rule) || 'translation', why_en: result ? result.why_en : '', why_hi: result ? result.why_hi : '', makeCard: true });
      }
      $('#next', container).onclick = () => { i++; draw(); }; $('#next', container).focus();
    };
    setContext({ title: 'Translation drill', text: `Translate to English: "${it.hi}" (reference: ${it.en})` });
  };
  draw();
}
