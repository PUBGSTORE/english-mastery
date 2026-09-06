// converse.js — §6 voice roleplay: scenario → turns (my speech/typed → DeepSeek in character → TTS) → post-mortem report → SRS cards.
import { html, mount, icon, toast, backLink, confirmDialog, $ } from '../ui.js';
import { hi, hiBlock } from '../i18n.js';
import * as db from '../db.js';
import * as store from '../store.js';
import * as content from '../content.js';
import * as ai from '../ai.js';
import * as tts from '../tts.js';
import * as asr from '../asr.js';
import { setContext } from '../router.js';
import { mdLite, wordDiffHtml, countWords, nowISO, uid, fmtDate } from '../utils.js';

export async function render(container, params) {
  const scenarios = await content.load('scenarios');
  if (params.id) return runScenario(container, scenarios.find((s) => s.id === params.id) || scenarios[0]);
  const key = await ai.hasKey();
  const past = (await db.getAll('generated', { index: 'kind', query: 'conversation' })).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 8);
  mount(container, html`
    <div class="page-head"><div><h1>Conversation</h1><p class="sub">Pick a scenario. The tutor plays the other person and never corrects you mid-flow. The report comes at the end.</p></div></div>
    ${!key ? html`<div class="card amber compact small">Roleplay needs a DeepSeek key (Settings). ${asr.supported() ? '' : 'On iPad you type your turns; on Chrome you can speak them.'}</div>` : ''}
    <div class="grid">${scenarios.map((s) => html`<a class="card compact" href="#/converse/${s.id}" style="margin:0"><div class="row between"><strong>${s.title}</strong><span class="chip" style="min-height:22px">${s.cefr}</span></div><div class="xs muted mt">${s.role_me}</div><div class="xs">${hi(s.hi, { block: false })}</div></a>`)}</div>
    ${past.length ? html`<h3 class="mt-lg">Past conversations</h3><div class="list">${past.map((p) => html`<div class="list-item"><div class="grow"><div class="title">${p.title}</div><div class="sub">${fmtDate(p.ts)} · ${p.data.turns} turns · range ${p.data.report?.scores?.vocabulary ?? '–'}/10</div></div><span class="chip ${(p.data.report?.overall || 0) >= 70 ? 'green' : 'amber'}">${p.data.report?.overall ?? '–'}</span></div>`)}</div>` : ''}`);
  setContext({ title: 'Conversation practice', text: 'Voice roleplay scenarios.' });
}

async function runScenario(container, sc) {
  const key = await ai.hasKey();
  const level = await store.level();
  const maxTurns = sc.turns || 10;
  const turns = []; // {role:'ai'|'me', text, ts}
  let busy = false; let recording = false; let asrPromise = null; let t0 = 0;
  const system = `${sc.role_ai}\n\nYou are roleplaying with a Hindi-speaking English learner (level ${level}). ${sc.role_me} Stay in character for the whole conversation. Speak naturally, 1–3 sentences per turn, and ask a question or give a cue to keep the learner talking. NEVER correct the learner's English, never comment on their language, never break character, never use Hindi. The learner should achieve: ${sc.goals.join('; ')}. After about ${maxTurns} learner turns, wrap the conversation up naturally.`;
  const draw = () => {
    mount(container, html`
      ${backLink('#/converse', 'Scenarios')}
      <div class="page-head"><div><h1 style="font-size:var(--fs-xl)">${sc.title}</h1><p class="sub">${sc.role_me} · goals: ${sc.goals.join(' · ')}</p></div><span class="chip">${turns.filter((t) => t.role === 'me').length}/${maxTurns}</span></div>
      <div class="card"><div class="chat-log" id="log" style="max-height:48dvh;min-height:200px"></div>
        <div class="chat-input mt"><textarea class="textarea" id="in" rows="1" placeholder="${asr.supported() ? 'Tap the mic and speak, or type' : 'Type your reply (speech recognition unavailable here)'}"></textarea>${asr.supported() ? html`<button class="btn btn-icon" id="mic" aria-label="Speak">${icon('mic')}</button>` : ''}<button class="btn btn-primary btn-icon" id="send" aria-label="Send">${icon('send')}</button></div>
        <div class="btn-row mt"><button class="btn btn-sm btn-ghost" id="replay">${icon('speaker')} Replay last</button><button class="btn btn-sm" id="finish" ${turns.length < 2 ? 'disabled' : ''}>${icon('check')} End &amp; get report</button></div></div>
      <div id="report"></div>`);
    drawLog();
    $('#send', container).onclick = () => send($('#in', container).value);
    $('#in', container).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#in', container).value); } });
    $('#replay', container).onclick = () => { const last = [...turns].reverse().find((t) => t.role === 'ai'); if (last) tts.speak(last.text); };
    $('#finish', container).onclick = () => report();
    const mic = $('#mic', container);
    if (mic) mic.onclick = async () => {
      if (!recording) { recording = true; mic.classList.add('btn-primary'); t0 = performance.now(); asrPromise = asr.recognise({ timeoutMs: 30000, onInterim: (t) => { $('#in', container).value = t; } }).catch(() => ({ transcript: '' })); }
      else { recording = false; mic.classList.remove('btn-primary'); asr.stop(); const r = await asrPromise; if (r.transcript) { $('#in', container).value = r.transcript; send(r.transcript, (performance.now() - t0) / 1000); } }
    };
  };
  const drawLog = () => { const log = $('#log', container); if (!log) return; mount(log, html`${turns.map((t) => html`<div class="msg ${t.role === 'ai' ? 'assistant' : 'user'}">${t.text}</div>`)}${busy ? html`<div class="msg assistant"><span class="spinner"></span></div>` : ''}`); log.scrollTop = log.scrollHeight; };
  const send = async (text, seconds = null) => {
    text = (text || '').trim(); if (!text || busy) return;
    if (!key) { toast('Add your DeepSeek key in Settings.', 'warn'); return; }
    $('#in', container).value = '';
    turns.push({ role: 'me', text, ts: nowISO(), seconds }); busy = true; drawLog();
    try {
      const msgs = turns.map((t) => ({ role: t.role === 'ai' ? 'assistant' : 'user', content: t.text }));
      const r = await ai.chat({ feature: 'conversation', system, messages: msgs, temperature: 0.8, maxTokens: 220 });
      turns.push({ role: 'ai', text: r.content.trim(), ts: nowISO() });
      busy = false; drawLog(); tts.speak(r.content.trim());
      $('#finish', container).disabled = false;
      if (turns.filter((t) => t.role === 'me').length >= maxTurns) toast('Good place to stop. Tap "End & get report".', '', { timeout: 5000 });
    } catch (e) { busy = false; drawLog(); toast(e.message === 'CAP_REACHED' ? 'Monthly AI cap reached.' : e.message, 'err', { timeout: 6000 }); }
  };
  const report = async () => {
    const mine = turns.filter((t) => t.role === 'me');
    if (mine.length < 2) return;
    const btn = $('#finish', container); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Analysing…';
    try {
      const transcript = turns.map((t) => `${t.role === 'ai' ? sc.title.split(' ')[0] + ' (AI)' : 'ME'}: ${t.text}`).join('\n');
      const r = await ai.chat({ feature: 'conversation', json: true, temperature: 0.3, maxTokens: 2200, system: `You are an English coach reviewing a roleplay ("${sc.title}") by a Hindi-speaking learner (level ${level}). Only judge the lines marked ME. Return JSON only:
{"scores":{"grammar":0-10,"vocabulary":0-10,"fluency":0-10,"task":0-10},
 "corrections":[{"from":"exact ME line or fragment","to":"corrected","why_en":"short","why_hi":"Devanagari","rule":"tag"}] (every real error, max 12),
 "native":[{"from":"ME line","to":"what a native speaker would more likely say"}] (5 items),
 "best":["three specific things the learner did well, quoting their words"],
 "fillers":["filler words used"],
 "summary_en":"3 sentences","summary_hi":"Devanagari"}`, messages: [{ role: 'user', content: transcript }] });
      let rep; try { rep = JSON.parse(r.content); } catch { rep = JSON.parse(r.content.match(/\{[\s\S]*\}/)[0]); }
      const sc_ = rep.scores || {}; const overall = Math.round((['grammar', 'vocabulary', 'fluency', 'task'].reduce((a, k) => a + (sc_[k] || 0), 0) / 4) * 10);
      const words = mine.reduce((a, t) => a + countWords(t.text), 0);
      let added = 0;
      for (const c of rep.corrections || []) if (c.from && c.to && c.from !== c.to) { await store.logMistake({ source: 'speaking', refId: sc.id, original: c.from, fix: c.to, rule: c.rule || 'speaking', why_en: c.why_en, why_hi: c.why_hi }); added++; }
      await store.logAttempt({ kind: 'speaking', refId: sc.id, accuracy: overall, transcript: mine.map((t) => t.text).join(' | '), words, extra: { scenario: sc.id, scores: sc_, fillers: rep.fillers || [] } });
      await db.put('generated', { id: uid('gen'), kind: 'conversation', refId: sc.id, title: sc.title, ts: nowISO(), data: { turns: mine.length, transcript, report: { ...rep, overall } } });
      mount($('#report', container), html`
        <div class="card accent"><h3>Report · ${overall}/100</h3>
          <div class="rubric">${['grammar', 'vocabulary', 'fluency', 'task'].map((k) => html`<div class="stat"><div class="label">${k}</div><div class="value">${sc_[k] ?? '–'}<small>/10</small></div></div>`)}</div>
          <div class="grid-3 mt"><div class="stat"><div class="label">Your turns</div><div class="value">${mine.length}</div></div><div class="stat"><div class="label">Avg length</div><div class="value">${Math.round(words / mine.length)}<small> words</small></div></div><div class="stat"><div class="label">Fillers</div><div class="value">${(rep.fillers || []).length}</div></div></div>
          <p class="mt">${rep.summary_en}</p>${hiBlock(rep.summary_hi)}</div>
        ${(rep.best || []).length ? html`<div class="card green"><h3>${icon('award')} Your best moments</h3><ul>${rep.best.map((b) => html`<li>${b}</li>`)}</ul></div>` : ''}
        <div class="card"><h3>What you said, corrected</h3>${mine.map((t) => { const c = (rep.corrections || []).find((x) => x.from && t.text.includes(x.from)); return html`<div class="diff mb" style="line-height:1.7">${c ? { toString: () => wordDiffHtml(t.text, t.text.replace(c.from, c.to)) } : t.text}</div>`; })}
          ${(rep.corrections || []).length ? html`<div class="section-label">Why (${added} added to your reviews)</div>${rep.corrections.map((c) => html`<div class="small mb"><span style="color:var(--red);text-decoration:line-through">${c.from}</span> → <span style="color:var(--green)">${c.to}</span> · ${c.why_en} <span class="muted">${hi(c.why_hi, { block: false })}</span></div>`)}` : html`<p class="small muted">No grammar errors found.</p>`}</div>
        ${(rep.native || []).length ? html`<div class="card"><h3>A native speaker would more likely say…</h3>${rep.native.map((n) => html`<div class="mb"><div class="small muted">${n.from}</div><div>${n.to} ${{ toString: () => String(html`<button class="speak-btn" data-speak="${n.to}">${icon('speaker')}</button>`) }}</div></div>`)}</div>` : ''}
        <div class="btn-row"><a class="btn btn-primary" href="#/converse">Another scenario</a><a class="btn" href="#/mistakes">Mistakes notebook</a></div>`);
      btn.textContent = 'Report ready'; $('#report', container).scrollIntoView({ behavior: 'smooth' });
    } catch (e) { toast(e.message, 'err', { timeout: 6000 }); btn.disabled = false; btn.innerHTML = 'End & get report'; }
  };
  draw();
  // opening line
  turns.push({ role: 'ai', text: sc.opening, ts: nowISO() }); drawLog(); tts.speak(sc.opening);
  setContext({ title: `Roleplay: ${sc.title}`, text: sc.role_ai });
  return () => { tts.stop(); if (recording) asr.stop(); };
}
