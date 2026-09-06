// listening.js — dictation with character diff, plus numbers / dates / spelling drills.
import { html, mount, icon, toast, backLink, progressBar, $ } from '../ui.js';
import { hi } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as tts from '../tts.js';
import { setContext } from '../router.js';
import { CEFR, shuffle, sentenceMatch, charDiffHtml, normalize, avg } from '../utils.js';

export async function render(container, params) {
  const mode = params.mode;
  if (mode === 'dictation') return renderDictation(container);
  if (['numbers', 'dates', 'spelling'].includes(mode)) return renderDrill(container, mode);
  return renderHub(container);
}

async function renderHub(container) {
  const attempts = await store.allAttempts();
  const stat = (k) => { const a = attempts.filter((x) => x.kind === k).slice(-20); return a.length ? `${Math.round(avg(a.map((x) => x.accuracy || 0)))}% recent` : 'not started'; };
  mount(container, html`
    <div class="page-head"><div><h1>Listening</h1><p class="sub">Type exactly what you hear. Every miss becomes a card.</p></div></div>
    <div class="list">
      <a class="list-item" href="#/listen/dictation">${icon('ear')}<div class="grow"><div class="title">Dictation</div><div class="sub">150 sentences with traps: contractions, weak forms, linking, -ed, -s · ${stat('dictation')}</div></div>${icon('next', 'arrow')}</a>
      <a class="list-item" href="#/listen/numbers">${icon('zap')}<div class="grow"><div class="title">Numbers</div><div class="sub">13 vs 30, phone numbers, versions, ports, CVE ids · ${stat('numbers')}</div></div>${icon('next', 'arrow')}</a>
      <a class="list-item" href="#/listen/dates">${icon('calendar')}<div class="grow"><div class="title">Dates & times</div><div class="sub">Ordinals, decades, deadlines, EOD Friday · ${stat('dates')}</div></div>${icon('next', 'arrow')}</a>
      <a class="list-item" href="#/listen/spelling">${icon('list')}<div class="grow"><div class="title">Spelling & NATO alphabet</div><div class="sub">Names, emails, hostnames read aloud · ${stat('spelling')}</div></div>${icon('next', 'arrow')}</a>
    </div>`);
  setContext({ title: 'Listening', text: 'Listening practice: dictation, numbers, dates, spelling.' });
}

async function renderDictation(container) {
  const data = await content.listening();
  const s = await store.settings();
  let lvl = s.level; let rate = 1.0; let items = []; let i = 0; let correct = 0; let total = 0;
  const reset = () => { items = shuffle(data.dictation.filter((d) => d.cefr === lvl)); i = 0; };
  reset();
  const draw = () => {
    const d = items[i % items.length];
    mount(container, html`
      ${backLink('#/listen', 'Listening')}
      <div class="page-head"><div><h1>Dictation</h1><p class="sub">${total ? `${correct}/${total} this session · ` : ''}trap: ${d.trap}</p></div></div>
      <div class="row between mb"><div class="chips">${CEFR.map((l) => html`<button class="chip ${l === lvl ? 'active' : ''}" data-l="${l}">${l}</button>`)}</div><div class="chips">${[0.75, 1.0, 1.15].map((r) => html`<button class="chip ${r === rate ? 'active' : ''}" data-r="${r}">${r}×</button>`)}</div></div>
      <div class="card"><div class="btn-row center"><button class="btn btn-lg btn-primary" id="play">${icon('speaker')} Play</button><button class="btn" id="slow">0.7×</button></div>
        <form id="f" class="mt" autocomplete="off"><textarea class="textarea" id="in" rows="2" placeholder="Type the sentence exactly, with punctuation if you can" autocapitalize="sentences" autocorrect="off" spellcheck="false" style="min-height:70px"></textarea>
        <div class="btn-row mt"><button class="btn btn-primary" type="submit">Check</button><button class="btn btn-ghost" type="button" id="skip">Skip</button></div></form>
        <div id="fb" class="mt"></div></div>`);
    container.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => { lvl = b.dataset.l; reset(); draw(); });
    container.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { rate = +b.dataset.r; draw(); });
    const play = () => tts.speak(d.text, { rate });
    $('#play', container).onclick = play; $('#slow', container).onclick = () => tts.speak(d.text, { rate: 0.7 });
    setTimeout(play, 300);
    const ta = $('#in', container);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#f', container).requestSubmit(); } });
    if (window.matchMedia('(min-width: 768px)').matches) setTimeout(() => ta.focus(), 100);
    $('#skip', container).onclick = () => { i++; draw(); };
    $('#f', container).onsubmit = async (e) => {
      e.preventDefault(); const typed = ta.value.trim(); if (!typed) return;
      const r = sentenceMatch(typed, [d.text]); total++; if (r.status !== 'wrong') correct++;
      const acc = Math.max(0, Math.round((1 - r.distance / Math.max(1, normalize(d.text).length)) * 100));
      ta.disabled = true;
      mount($('#fb', container), html`<div class="feedback ${r.status === 'exact' ? 'ok' : r.status === 'close' ? 'close' : 'bad'}"><div class="bold">${r.status === 'exact' ? 'Perfect' : r.status === 'close' ? 'Nearly' : `${acc}% match`}</div>
        <div class="diff chars mt" style="font-size:var(--fs-lg)">${{ toString: () => charDiffHtml(d.text, typed) }}</div>
        <div class="small mt muted">Correct: ${d.text}</div><div class="small">${hi(d.hi)}</div>
        <div class="btn-row mt"><button class="btn btn-primary" id="next">Next ${icon('next')}</button><button class="btn" data-speak="${d.text}" data-rate="0.75">${icon('speaker')} Hear again slowly</button></div></div>`);
      await store.logAttempt({ kind: 'dictation', refId: d.id, accuracy: acc, transcript: typed, extra: { trap: d.trap } });
      if (r.status === 'wrong') {
        await store.logMistake({ source: 'dictation', refId: d.id, original: typed, fix: d.text, rule: `listening: ${d.trap}`, makeCard: false });
        await store.ensureCard({ id: `card:${d.id}`, refId: d.id, deck: 'dictation', kind: 'dictation', payload: { text: d.text, hi: d.hi }, priority: 1 });
      }
      $('#next', container).onclick = () => { i++; draw(); }; $('#next', container).focus();
    };
    setContext({ title: 'Dictation', text: `Dictation sentence: "${d.text}" (trap: ${d.trap})` });
  };
  draw();
  return () => tts.stop();
}

async function renderDrill(container, mode) {
  const data = await content.listening();
  const list = shuffle(data[mode]); let i = 0; let correct = 0; let total = 0;
  const titles = { numbers: 'Numbers', dates: 'Dates & times', spelling: 'Spelling' };
  const draw = () => {
    const d = list[i % list.length];
    mount(container, html`
      ${backLink('#/listen', 'Listening')}
      <div class="page-head"><div><h1>${titles[mode]}</h1><p class="sub">${total ? `${correct}/${total} this session` : 'Listen, then type what you heard'}</p></div></div>
      <div class="card"><div class="btn-row center"><button class="btn btn-lg btn-primary" id="play">${icon('speaker')} Play</button><button class="btn" id="slow">Slow</button></div>
        <form id="f" class="row mt" autocomplete="off"><input class="input" id="in" placeholder="${mode === 'numbers' ? 'e.g. 13050' : mode === 'dates' ? 'e.g. 3 March 2024 or 03/03/2024' : 'type the letters'}" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="${mode === 'numbers' ? 'text' : 'text'}"><button class="btn btn-primary" type="submit">Check</button></form>
        <div id="fb" class="mt"></div></div>`);
    const spokenRate = mode === 'spelling' ? 0.9 : 1.0;
    const play = () => tts.speak(d.spoken, { rate: spokenRate });
    $('#play', container).onclick = play; $('#slow', container).onclick = () => tts.speak(d.spoken, { rate: 0.7 });
    setTimeout(play, 300);
    const inp = $('#in', container);
    if (window.matchMedia('(min-width: 768px)').matches) setTimeout(() => inp.focus(), 100);
    $('#f', container).onsubmit = async (e) => {
      e.preventDefault(); const typed = inp.value.trim(); if (!typed) return;
      const norm = (x) => String(x).toLowerCase().replace(/[\s,.\-_/]/g, '');
      const accepted = [d.answer, ...(d.alt || [])];
      const ok = accepted.some((a) => norm(a) === norm(typed));
      total++; if (ok) correct++;
      inp.disabled = true; inp.classList.add(ok ? 'ok' : 'bad');
      mount($('#fb', container), html`<div class="feedback ${ok ? 'ok' : 'bad'}"><div class="bold">${ok ? 'Correct' : `Answer: ${d.answer}`}</div><div class="small muted mt">Spoken: “${d.spoken}”</div>${d.hi ? html`<div class="small">${hi(d.hi)}</div>` : ''}<div class="btn-row mt"><button class="btn btn-primary" id="next">Next ${icon('next')}</button></div></div>`);
      await store.logAttempt({ kind: mode, refId: d.id, accuracy: ok ? 100 : 0, transcript: typed });
      if (!ok) store.logMistake({ source: 'dictation', refId: d.id, original: typed, fix: d.answer, rule: `listening: ${mode}`, makeCard: false }).catch(() => {});
      $('#next', container).onclick = () => { i++; draw(); }; $('#next', container).focus();
    };
    setContext({ title: titles[mode], text: `Listening drill (${mode}). Spoken: "${d.spoken}", answer: ${d.answer}` });
  };
  draw();
  return () => tts.stop();
}
