// speaking.js — daily speaking prompt: record → transcript → AI feedback on grammar, vocabulary, fillers.
import { html, mount, icon, toast, backLink, $ } from '../ui.js';
import { hi, hiBlock } from '../i18n.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as asr from '../asr.js';
import * as audio from '../audio.js';
import * as ai from '../ai.js';
import { setContext } from '../router.js';
import { todayKey, hashStr, cefrIndex, CEFR, wordDiffHtml, fmtDate, countWords } from '../utils.js';

export async function render(container) {
  const prompts = await content.speakingPrompts();
  const s = await store.settings();
  const lvlIdx = cefrIndex(s.level);
  const pool = prompts.filter((p) => Math.abs(cefrIndex(p.cefr) - lvlIdx) <= 1);
  const day = todayKey();
  let p = pool[hashStr(day + '|speak') % pool.length];
  const history = (await store.attemptsByKind('speaking')).sort((a, b) => b.ts.localeCompare(a.ts));
  const key = await ai.hasKey();
  let recording = false; let t0 = 0; let asrPromise = null; let blob = null; let transcript = '';
  const draw = () => {
    mount(container, html`
      <div class="page-head"><div><h1>Speaking</h1><p class="sub">${fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })} · ${p.seconds}s · ${p.cefr}</p></div><button class="btn btn-sm btn-ghost" id="other">${icon('shuffle')} Different prompt</button></div>
      <div class="card"><p style="font-size:var(--fs-lg)">${p.prompt_en}</p>${hiBlock(p.prompt_hi)}
        ${p.target_structures && p.target_structures.length ? html`<div class="chips mt">${p.target_structures.map((t) => html`<span class="chip">${t}</span>`)}</div>` : ''}
        <hr>
        ${asr.supported() ? '' : html`<div class="feedback close small mb">Speech recognition is not available in this browser, so there is no automatic transcript. Record, listen back, then type what you said (or a summary) to get AI feedback.</div>`}
        <div class="row" style="justify-content:center;gap:16px"><button class="rec-btn" id="rec">${icon('mic')}</button><div class="stack" style="flex:1;max-width:260px"><div class="meter"><span id="meter"></span></div><div class="xs muted center" id="status">Tap to start. Aim for ${p.seconds} seconds.</div><div class="progress"><span id="timebar" style="width:0"></span></div></div></div>
        <div id="after" class="mt"></div></div>
      ${history.length ? html`<h3 class="mt-lg">Past attempts</h3><div class="list">${history.slice(0, 10).map((a) => html`<div class="list-item"><div class="grow"><div class="sub">${fmtDate(a.ts, { month: 'short', day: 'numeric' })} · ${a.words || 0} words · ${a.extra?.fillers?.length ? `fillers: ${a.extra.fillers.join(', ')}` : ''}</div><div class="small">${(a.transcript || '').slice(0, 140)}</div></div>${typeof a.accuracy === 'number' ? html`<span class="chip ${a.accuracy >= 70 ? 'green' : 'amber'}">${a.accuracy}</span>` : ''}</div>`)}</div>` : ''}`);
    $('#other', container).onclick = () => { p = pool[Math.floor(Math.random() * pool.length)]; draw(); };
    let timer = null;
    $('#rec', container).onclick = async () => {
      const btn = $('#rec', container); const status = $('#status', container);
      if (!recording) {
        const ok = await audio.start({ onLevel: (v) => { $('#meter', container).style.width = `${Math.round(v * 100)}%`; } });
        if (!ok && !asr.supported()) return;
        recording = true; t0 = performance.now(); btn.classList.add('recording'); btn.innerHTML = String(icon('stop'));
        timer = setInterval(() => { const sec = (performance.now() - t0) / 1000; status.textContent = `${Math.round(sec)}s`; $('#timebar', container).style.width = `${Math.min(100, (sec / p.seconds) * 100)}%`; }, 250);
        if (asr.supported()) asrPromise = recogniseLong(p.seconds + 30, (t) => { transcript = t; });
      } else {
        recording = false; clearInterval(timer); btn.classList.remove('recording'); btn.innerHTML = String(icon('mic'));
        const seconds = (performance.now() - t0) / 1000;
        const r = await audio.stop(); asr.stop();
        if (r && r.blob && r.blob.size) { blob = r.blob; await audio.saveRecording(`speak:${day}`, r.blob, r.mime, r.seconds); }
        if (asrPromise) { const t = await asrPromise; if (t) transcript = t; }
        status.textContent = `Recorded ${Math.round(seconds)}s`;
        showAfter(seconds);
      }
    };
  };
  const showAfter = (seconds) => {
    mount($('#after', container), html`
      <div class="btn-row"><button class="btn" id="play" ${blob ? '' : 'disabled'}>${icon('play')} Play back</button></div>
      <div class="field mt"><label>Transcript ${asr.supported() ? '(auto — fix any recognition errors)' : '(type what you said)'}</label><textarea class="textarea" id="tr" rows="4">${transcript}</textarea><span class="help"><span id="wc">${countWords(transcript)}</span> words · ${Math.round(seconds)}s · ${seconds > 0 ? Math.round((countWords(transcript) / seconds) * 60) : 0} wpm (natural speech: 120–160)</span></div>
      <div class="btn-row"><button class="btn btn-primary" id="feedback">${key ? html`${icon('sparkle')} Get AI feedback` : 'Save (add API key for feedback)'}</button></div>
      <div id="fb" class="mt"></div>`);
    $('#play', container).onclick = () => blob && audio.play(blob);
    $('#tr', container).oninput = (e) => { $('#wc', container).textContent = countWords(e.target.value); };
    $('#feedback', container).onclick = async (e) => {
      const text = $('#tr', container).value.trim();
      const b = e.currentTarget;
      if (!key) { await store.logAttempt({ kind: 'speaking', refId: p.id, transcript: text, extra: { seconds }, words: countWords(text) }); toast('Saved', 'ok'); return; }
      if (!text) { toast('No transcript to grade. Type what you said.', 'warn'); return; }
      b.disabled = true; b.innerHTML = '<span class="spinner"></span> Analysing…';
      try {
        const r = await ai.speakingFeedback(p.prompt_en, text, seconds, s.level);
        const sc = r.scores || {}; const overall = Math.round(((sc.grammar || 0) + (sc.vocabulary || 0) + (sc.fluency || 0) + (sc.task || 0)) / 4 * 10);
        for (const c of r.corrections || []) if (c.from && c.to) await store.logMistake({ source: 'speaking', refId: p.id, original: c.from, fix: c.to, rule: c.rule || 'speaking', why_en: c.why_en, why_hi: c.why_hi });
        await store.logAttempt({ kind: 'speaking', refId: p.id, accuracy: overall, transcript: text, words: countWords(text), extra: { seconds, fillers: r.fillers || [], scores: sc } });
        mount($('#fb', container), html`
          <div class="rubric">${['grammar', 'vocabulary', 'fluency', 'task'].map((k) => html`<div class="stat"><div class="label">${k}</div><div class="value">${sc[k] ?? '–'}<small>/10</small></div></div>`)}</div>
          ${r.fillers && r.fillers.length ? html`<div class="feedback close mt small"><strong>Fillers:</strong> ${r.fillers.join(', ')} — pause silently instead.</div>` : ''}
          <div class="feedback ok mt"><div>${r.feedback_en}</div><div class="small">${hi(r.feedback_hi)}</div></div>
          ${(r.corrections || []).length ? html`<div class="section-label">Corrections (added to your mistakes)</div>${r.corrections.map((c) => html`<div class="card compact" style="margin-bottom:6px"><div class="diff">${{ toString: () => wordDiffHtml(c.from || '', c.to || '') }}</div><div class="small mt">${c.why_en}</div><div class="small">${hi(c.why_hi)}</div></div>`)}` : ''}
          ${r.better_version ? html`<div class="section-label">A stronger version</div><div class="card compact"><p class="mb-0">${r.better_version}</p><div class="btn-row mt"><button class="btn btn-sm" data-speak="${r.better_version}">${icon('speaker')} Listen</button><a class="btn btn-sm" href="#/shadow">Shadow it</a></div></div>` : ''}`);
        b.innerHTML = 'Done';
      } catch (err) { toast(err.message === 'NO_KEY' ? 'Add your DeepSeek key in Settings.' : err.message, 'err', { timeout: 6000 }); b.disabled = false; b.textContent = 'Get AI feedback'; }
    };
  };
  draw();
  setContext({ title: 'Speaking prompt', text: p.prompt_en });
  return () => { if (recording) { audio.cancel(); asr.stop(); } };
}

/** Long-form recognition: chain sessions since non-continuous recognisers stop at pauses. */
function recogniseLong(maxSeconds, onText) {
  let text = ''; let stopped = false;
  const started = Date.now();
  const loop = async () => {
    while (!stopped && (Date.now() - started) / 1000 < maxSeconds) {
      try {
        const r = await asr.recognise({ timeoutMs: 12000, onInterim: (t) => onText((text + ' ' + t).trim()) });
        if (r.transcript) { text = (text + ' ' + r.transcript).trim(); onText(text); }
        if (r.error === 'aborted') break;
      } catch (e) { if (e.message === 'not-allowed' || e.message === 'unsupported') break; }
    }
    return text;
  };
  const p = loop();
  const origStop = asr.stop;
  // when asr.stop() is called by the caller, mark stopped
  const guard = setInterval(() => { /* no-op: loop checks asr state on each iteration */ }, 1000);
  p.finally(() => clearInterval(guard));
  p.stop = () => { stopped = true; origStop(); };
  return p;
}
