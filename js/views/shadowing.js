// shadowing.js — listen 1.0× → 0.75× → shadow while recording → A/B → self-rate → SRS card.
import { html, mount, icon, toast, backLink, progressBar, $ } from '../ui.js';
import { hi } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as tts from '../tts.js';
import * as audio from '../audio.js';
import * as asr from '../asr.js';
import { setContext } from '../router.js';
import { CEFR, avg, fmtDate } from '../utils.js';

export async function render(container, params) {
  if (params.id) return renderItem(container, params.id);
  return renderList(container);
}

async function renderList(container) {
  const items = await content.shadowing();
  const s = await store.settings();
  const attempts = await store.attemptsByKind('shadow');
  const byRef = {};
  for (const a of attempts) (byRef[a.refId] ||= []).push(a);
  let lvl = s.level;
  const draw = () => {
    const list = items.filter((x) => x.cefr === lvl);
    mount($('#list', container), html`${list.map((x) => { const at = byRef[x.id] || []; const best = at.length ? Math.max(...at.map((a) => a.selfRating ? a.selfRating * 20 : (a.accuracy || 0))) : null;
      return html`<a class="list-item" href="#/shadow/${x.id}"><div class="grow"><div class="title">${x.title || x.text.slice(0, 40)}</div><div class="sub">${x.text.slice(0, 90)}${x.text.length > 90 ? '…' : ''}</div><div class="xs faint">${x.words} words · ${(x.focus || []).join(', ')}</div></div>${best !== null ? html`<span class="chip ${best >= 80 ? 'green' : 'amber'}">${best}%</span>` : ''}${icon('next', 'arrow')}</a>`; })}`);
  };
  mount(container, html`
    <div class="page-head"><div><h1>Shadowing</h1><p class="sub">Listen, then speak <em>with</em> the voice, copying rhythm and melody. Ten minutes a day moves your accent more than anything else.</p></div></div>
    <div class="chips mb">${CEFR.map((l) => html`<button class="chip ${l === lvl ? 'active' : ''}" data-l="${l}">${l}</button>`)}</div>
    <div class="list" id="list"></div>`);
  container.querySelectorAll('[data-l]').forEach((b) => b.onclick = () => { lvl = b.dataset.l; container.querySelectorAll('[data-l]').forEach((x) => x.classList.toggle('active', x === b)); draw(); });
  draw();
  setContext({ title: 'Shadowing', text: 'Shadowing practice: repeating sentences simultaneously with a native model.' });
}

async function renderItem(container, id) {
  const items = await content.shadowing();
  const it = items.find((x) => x.id === id);
  if (!it) { mount(container, html`${backLink('#/shadow')}<div class="empty">Not found</div>`); return; }
  const idx = items.indexOf(it);
  const next = items.slice(idx + 1).find((x) => x.cefr === it.cefr) || items[idx + 1];
  const history = (await store.attemptsFor(id)).filter((a) => a.kind === 'shadow');
  let step = 0; let recording = false; let myBlob = null; let asrPromise = null; let t0 = 0;
  const STEPS = ['Listen 1.0×', 'Listen 0.75×', 'Shadow & record', 'Compare', 'Rate'];
  const draw = async () => {
    const saved = await audio.getRecording(id);
    mount(container, html`
      ${backLink('#/shadow', 'Shadowing')}
      <div class="row between mb"><span class="chip">${it.cefr}</span><span class="xs muted">${it.words} words · target ${it.target_wps[0]}–${it.target_wps[1]} w/s</span></div>
      <div class="chips scroll mb">${STEPS.map((s, k) => html`<span class="chip ${k === step ? 'active' : k < step ? 'green' : ''}">${k + 1}. ${s}</span>`)}</div>
      <div class="card"><p style="font-size:var(--fs-xl);line-height:1.65" id="text">${it.text}</p><div>${hi(it.hi)}</div>
        ${it.notes_en ? html`<div class="small mt muted">${icon('info')} ${it.notes_en}</div><div class="small">${hi(it.notes_hi)}</div>` : ''}
        <div class="mt" id="step"></div></div>
      ${history.length ? html`<p class="xs muted">Previous: ${history.slice(-5).map((a) => `${a.selfRating ? a.selfRating + '/5' : a.accuracy + '%'} (${fmtDate(a.ts)})`).join(' · ')}</p>` : ''}
      <div class="btn-row between">${idx > 0 ? html`<a class="btn btn-ghost" href="#/shadow/${items[idx - 1].id}">${icon('back')} Prev</a>` : '<span></span>'}${next ? html`<a class="btn btn-ghost" href="#/shadow/${next.id}">Next ${icon('next')}</a>` : ''}</div>`);
    const stepEl = $('#step', container);
    if (step === 0) {
      mount(stepEl, html`<div class="btn-row"><button class="btn btn-primary btn-lg" id="play">${icon('speaker')} Listen at normal speed</button><button class="btn" id="skip">Done, next step</button></div><p class="small muted mt">Just listen. Notice which words are loud and long, and which almost disappear.</p>`);
      $('#play', container).onclick = () => tts.speak(it.text, { rate: 1.0, onEnd: () => {} });
      $('#skip', container).onclick = () => { step = 1; draw(); };
    } else if (step === 1) {
      mount(stepEl, html`<div class="btn-row"><button class="btn btn-primary btn-lg" id="play">${icon('speaker')} Listen at 0.75×</button><button class="btn" id="skip">Next step</button></div><p class="small muted mt">Now mouth the words silently along with the voice.</p>`);
      $('#play', container).onclick = () => tts.speak(it.text, { rate: 0.75 });
      $('#skip', container).onclick = () => { step = 2; draw(); };
    } else if (step === 2) {
      mount(stepEl, html`<p class="small muted">Tap record. The model plays; speak <strong>with it</strong> (not after it). Recording stops when you tap again.</p>
        <div class="row" style="justify-content:center;gap:16px"><button class="rec-btn" id="rec">${icon('mic')}</button><div class="stack" style="flex:1;max-width:240px"><div class="meter"><span id="meter"></span></div><div class="xs muted center" id="status">Ready</div></div></div>
        <div class="btn-row center mt"><button class="chip ${'active'}" id="rate-1">with 1.0× model</button><button class="chip" id="rate-0">with 0.75× model</button><button class="chip" id="rate-n">no model (from memory)</button></div>`);
      let rate = 1.0;
      for (const [sel, r] of [['#rate-1', 1.0], ['#rate-0', 0.75], ['#rate-n', 0]]) $(sel, container).onclick = (e) => { rate = r; ['#rate-1', '#rate-0', '#rate-n'].forEach((x) => $(x, container).classList.toggle('active', x === sel)); };
      $('#rec', container).onclick = async () => {
        const btn = $('#rec', container); const status = $('#status', container);
        if (!recording) {
          const ok = await audio.start({ onLevel: (v) => { $('#meter', container).style.width = `${Math.round(v * 100)}%`; } });
          if (!ok) return;
          recording = true; btn.classList.add('recording'); btn.innerHTML = String(icon('stop')); status.textContent = 'Recording — speak with the voice'; t0 = performance.now();
          if (asr.supported()) asrPromise = asr.recognise({ timeoutMs: 45000 }).catch(() => ({ transcript: '', alternatives: [] }));
          if (rate > 0) setTimeout(() => tts.speak(it.text, { rate }), 400);
        } else {
          recording = false; btn.classList.remove('recording'); btn.innerHTML = String(icon('mic')); status.textContent = 'Saved';
          tts.stop();
          const r = await audio.stop(); asr.stop();
          const seconds = (performance.now() - t0) / 1000;
          if (r && r.blob && r.blob.size) { myBlob = r.blob; await audio.saveRecording(id, r.blob, r.mime, r.seconds); }
          let scored = null;
          if (asrPromise) { const a = await asrPromise; if (a.transcript) scored = asr.score(it.text, a, seconds, it.target_wps); }
          step = 3; it._scored = scored; draw();
        }
      };
    } else if (step === 3) {
      const mine = myBlob ? { blob: myBlob } : saved;
      const scored = it._scored;
      mount(stepEl, html`<div class="btn-row center"><button class="btn btn-lg" id="ab">${icon('refresh')} Model then me</button><button class="btn" data-speak="${it.text}">${icon('speaker')} Model</button><button class="btn" id="mine" ${mine ? '' : 'disabled'}>${icon('play')} Me</button></div>
        ${scored ? html`<div class="mt">${{ toString: () => asr.tilesHtml(scored.words, scored.extra) }}<div class="xs muted mt">Recognised ${scored.completeness}% of words · ${scored.wps} words/sec${scored.fluency < 60 ? ' — try to keep up with the model' : ''}. (Recognition is a rough guide while shadowing; the A/B comparison is what matters.)</div></div>` : ''}
        <p class="small muted mt">Listen for: length of stressed syllables, where the pitch rises and falls, and whether your function words are as short as the model's.</p>
        <div class="btn-row mt"><button class="btn" id="again">${icon('mic')} Record again</button><button class="btn btn-primary" id="rate">Rate myself ${icon('next')}</button></div>`);
      $('#ab', container).onclick = async () => { await tts.speak(it.text); if (mine) await audio.play(mine.blob); };
      $('#mine', container).onclick = () => mine && audio.play(mine.blob);
      $('#again', container).onclick = () => { step = 2; draw(); };
      $('#rate', container).onclick = () => { step = 4; draw(); };
    } else {
      mount(stepEl, html`<p class="small">How close was your rhythm and melody to the model?</p><div class="btn-row stretch">${[1, 2, 3, 4, 5].map((n) => html`<button class="btn btn-lg" data-r="${n}">${n}</button>`)}</div><div class="xs muted center mt">1 = far · 3 = same words, different music · 5 = nearly identical</div>`);
      container.querySelectorAll('[data-r]').forEach((b) => b.onclick = async () => {
        const n = +b.dataset.r;
        const scored = it._scored;
        await store.logAttempt({ kind: 'shadow', refId: id, selfRating: n, accuracy: scored ? scored.accuracy : n * 20, fluency: scored ? scored.fluency : null, completeness: scored ? scored.completeness : null, transcript: scored ? scored.transcript : '' });
        await store.ensureCard({ id: `card:${id}`, refId: id, deck: 'shadowing', kind: 'shadow' });
        toast(n >= 4 ? 'Excellent. This sentence is now an SRS card; it will return in a few days.' : 'Logged. It will come back in your reviews for another pass.', 'ok', { timeout: 4000 });
        mount(stepEl, html`<div class="feedback ok"><div class="bold">Rated ${n}/5 — saved</div><div class="btn-row mt"><button class="btn" id="redo">Shadow again</button>${next ? html`<a class="btn btn-primary" href="#/shadow/${next.id}">Next sentence ${icon('next')}</a>` : html`<a class="btn btn-primary" href="#/shadow">All sentences</a>`}</div></div>`);
        $('#redo', container).onclick = () => { step = 0; draw(); };
      });
    }
  };
  draw();
  setContext({ title: 'Shadowing', text: `Shadowing sentence: "${it.text}" (focus: ${(it.focus || []).join(', ')})` });
  return () => { if (recording) { audio.cancel(); asr.stop(); } tts.stop(); };
}
